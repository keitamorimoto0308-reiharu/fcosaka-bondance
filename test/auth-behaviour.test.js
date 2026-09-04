/**
 * 認証を「実際に走らせて」確かめるテスト。
 *
 * ■ なぜ要るか
 *   admin.test.js は GAS のソースを文字列として読み、性質を確かめている。
 *   それは「入口が増えていないか」を見張るには十分だが、
 *   **書いたロジックが本当にその通り動くか**は言えない。
 *
 *   実際、権限判定は「シートの役割だけを見る」実装になっており、
 *   ソース検査は通っていたのに、**一般パスワードしか知らない人が
 *   管理者の氏名を選ぶだけで管理者になれる**状態だった。
 *   氏名は秘密ではない（応募フォームが担当社員の一覧を公開している）ので、
 *   これは机上の話ではなく実際に通る。
 *
 * ■ どうやって走らせるか
 *   gas/Auth.gs は Apps Script の関数（Utilities など）に依存していて、
 *   そのままでは Node で動かない。ここでは同じ振る舞いをする最小の代役を作り、
 *   ソースを読み込んで実行する。
 *   代役は Node の crypto で作るので、ハッシュと署名は本物と同じ結果になる。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

/** 設定シート・関係者シートの代わり。テストごとに書き換える */
let CONFIG, PEOPLE, ALERTS, CACHE;

function makeSandbox() {
  const b64url = b => Buffer.from(b).toString('base64url');

  const Utilities = {
    base64EncodeWebSafe: v => (Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8')).toString('base64url'),
    base64DecodeWebSafe: v => Buffer.from(String(v), 'base64url'),
    computeDigest: (_alg, text) => crypto.createHash('sha256').update(String(text), 'utf8').digest(),
    computeHmacSha256Signature: (text, key) =>
      crypto.createHmac('sha256', String(key)).update(String(text), 'utf8').digest(),
    // 本物と同じく、文字列からもバイト列からも作れる。
    // getBytes() は UTF-8 のバイト列、getDataAsString(charset) は文字列に戻す。
    newBlob: v => {
      const buf = Buffer.isBuffer(v) ? Buffer.from(v) : Buffer.from(String(v), 'utf8');
      return {
        getBytes: () => buf,
        getDataAsString: (cs) => buf.toString(
          (cs && String(cs).toUpperCase().replace('-', '_') === 'UTF_8') || !cs ? 'utf8' : 'utf8'),
      };
    },
    getUuid: () => crypto.randomUUID(),
    sleep: () => {},               // テストでは待たない
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
  };

  const props = {};
  const sandbox = {
    Utilities,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
      }),
    },
    // 署名鍵を作るときの競合を防ぐために使っている。テストでは常に取れる扱いでよい
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in CACHE ? CACHE[k] : null),
        put: (k, v) => { CACHE[k] = v; },
      }),
    },
    // Config.gs / Mail.gs の代役
    configText: (k, fb) => (k in CONFIG ? CONFIG[k] : (fb || '')),
    getPeople: opt => PEOPLE.filter(p => !(opt && opt.canLoginOnly) || p.canLogin),
    alertOperator_: msg => { ALERTS.push(msg); },
    logError_: () => {},
    console,
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadAuth() {
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gas', 'Auth.gs'), 'utf8'), sandbox,
    { filename: 'gas/Auth.gs' });
  return sandbox;
}

const LONG_ADMIN = 'admin-password-0123456789';
const LONG_USER  = 'staff-password-0123456789';

beforeEach(() => {
  CONFIG = { '管理者パスワード': LONG_ADMIN, '一般パスワード': LONG_USER };
  PEOPLE = [
    { name: '山田 太郎', dept: '事業推進部', role: '管理者', canLogin: true },
    { name: '佐藤 花子', dept: '営業部',     role: '一般',   canLogin: true },
    { name: '外部 三郎', dept: '—',          role: '一般',   canLogin: false },
  ];
  ALERTS = [];
  CACHE = {};
});

describe('認証：実際に動かして確かめる', () => {

  test('管理者パスワード＋管理者の氏名 → 管理者になる', () => {
    const A = loadAuth();
    const r = A.adminLogin_({ password: LONG_ADMIN, person: '山田 太郎' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.role, '管理者');
    // vm の中で作られたオブジェクトは Node の Object と別物なので、
    // deepStrictEqual ではなく中身で比べる
    const seen = A.verifyToken_(r.token);
    assert.strictEqual(seen.person, '山田 太郎');
    assert.strictEqual(seen.role, '管理者');
  });

  test('【要】一般パスワードで管理者の氏名を選んでも、管理者にはなれない', () => {
    // ここが以前は通っていた。氏名は秘密ではないので、実際に悪用できた。
    const A = loadAuth();
    const r = A.adminLogin_({ password: LONG_USER, person: '山田 太郎' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.role, '一般', '入室時点で一般に落ちていません');

    const seen = A.verifyToken_(r.token);
    assert.strictEqual(seen.role, '一般',
      '一般パスワードで入ったのに、以降のリクエストで管理者になっています（権限昇格）');
  });

  test('トークンの役割を書き換えても、署名が合わないので通らない', () => {
    const A = loadAuth();
    const r = A.adminLogin_({ password: LONG_USER, person: '山田 太郎' });
    const [body, sig] = r.token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.r = '管理者';
    const forged = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
    assert.strictEqual(A.verifyToken_(forged), null);
  });

  test('管理者を一般に落とすと、既存のトークンでも一般になる', () => {
    const A = loadAuth();
    const r = A.adminLogin_({ password: LONG_ADMIN, person: '山田 太郎' });
    assert.strictEqual(A.verifyToken_(r.token).role, '管理者');
    PEOPLE[0].role = '一般';                       // 関係者シートで降格
    assert.strictEqual(A.verifyToken_(r.token).role, '一般');
  });

  test('関係者シートから外すと、既存のトークンが無効になる', () => {
    const A = loadAuth();
    const r = A.adminLogin_({ password: LONG_ADMIN, person: '山田 太郎' });
    PEOPLE[0].canLogin = false;
    assert.strictEqual(A.verifyToken_(r.token), null);
  });

  test('パスワードを変えると、全員のトークンが失効する（§6-1）', () => {
    const A = loadAuth();
    const a = A.adminLogin_({ password: LONG_ADMIN, person: '山田 太郎' });
    const b = A.adminLogin_({ password: LONG_USER, person: '佐藤 花子' });
    CONFIG['一般パスワード'] = 'another-long-password-9876';
    assert.strictEqual(A.verifyToken_(a.token), null, '管理者のトークンが残っています');
    assert.strictEqual(A.verifyToken_(b.token), null, '一般のトークンが残っています');
  });

  test('期限が切れたトークンは通らない', () => {
    const A = loadAuth();
    const r = A.adminLogin_({ password: LONG_ADMIN, person: '山田 太郎' });
    const [body] = r.token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.e = Date.now() - 1000;
    const nb = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const resigned = nb + '.' + A.hmac_(nb);      // 署名し直しても期限で落ちる
    assert.strictEqual(A.verifyToken_(resigned), null);
  });

  test('壊れたトークンで例外を投げない', () => {
    const A = loadAuth();
    for (const bad of [undefined, null, '', '.', 'a.b', '{}', 0, true, 'x'.repeat(5000)]) {
      assert.strictEqual(A.verifyToken_(bad), null, '通ってしまった値: ' + String(bad));
    }
  });

  test('管理ページ利用が無効な人は入室できない', () => {
    const A = loadAuth();
    const r = A.adminLogin_({ password: LONG_ADMIN, person: '外部 三郎' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'denied');
  });

  test('入室に失敗しても、氏名とパスワードのどちらが違うかは分からない', () => {
    const A = loadAuth();
    const a = A.adminLogin_({ password: 'wrong', person: '山田 太郎' });
    const b = A.adminLogin_({ password: LONG_ADMIN, person: '居ない 人' });
    assert.strictEqual(a.message, b.message);
  });
});

describe('認証：総当たりへの備え', () => {

  test('失敗が続くと、照合せずに拒否するようになる', () => {
    const A = loadAuth();
    for (let i = 0; i < A.LOGIN_FAIL_LOCK; i++) A.adminNames_({ password: 'wrong' });
    // 正しいパスワードでも、締め出し中は通さない
    const r = A.adminNames_({ password: LONG_ADMIN });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'locked');
  });

  test('攻撃が続いているあいだ、通知が繰り返し飛ぶ', () => {
    // 以前は「10回目ちょうど」でしか送らず、生涯1通で終わっていた
    const A = loadAuth();
    for (let i = 0; i < A.LOGIN_FAIL_ALERT * 3; i++) A.adminNames_({ password: 'wrong' });
    assert.ok(ALERTS.length >= 3, '通知が ' + ALERTS.length + ' 回しか飛んでいません');
  });

  test('氏名一覧と入室で、締め出しが別々に数えられる', () => {
    const A = loadAuth();
    for (let i = 0; i < A.LOGIN_FAIL_LOCK; i++) A.adminNames_({ password: 'wrong' });
    // 片方が締め出されても、もう片方の正規利用は生きている
    const r = A.adminLogin_({ password: LONG_ADMIN, person: '山田 太郎' });
    assert.strictEqual(r.ok, true);
  });

  test('短いパスワードのままでは開かない', () => {
    const A = loadAuth();
    CONFIG['管理者パスワード'] = 'bondance2026';   // 12文字
    const r = A.adminLogin_({ password: 'bondance2026', person: '山田 太郎' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'weak_password');
  });

  test('パスワードが未設定なら、誰も入れない', () => {
    const A = loadAuth();
    CONFIG['管理者パスワード'] = ''; CONFIG['一般パスワード'] = '';
    const r = A.adminNames_({ password: '' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'not_configured');
  });

  test('氏名の一覧は、パスワードが合った人にだけ返る', () => {
    const A = loadAuth();
    assert.strictEqual(A.adminNames_({ password: 'wrong' }).ok, false);
    const ok = A.adminNames_({ password: LONG_USER });
    assert.strictEqual(ok.ok, true);
    // 管理ページ利用が無効な人は出さない
    assert.deepStrictEqual(ok.names.map(n => String(n.name)), ['山田 太郎', '佐藤 花子']);
  });
});

describe('入室した直後に切れないこと（実際に起きた不具合）', () => {

  test('発行したトークンを、その場で検証できる（日本語の氏名で）', () => {
    // 入室はできるのに、次のリクエストで「入室の情報を読み取れませんでした」に
    // なる不具合が本番で起きた。原因の候補は署名鍵と文字コードの2つ。
    // 氏名は日本語なので、ここを ASCII で試すと意味が無い。
    const S = loadAuth();
    const token = S.issueToken_('山田 太郎', '管理者');
    const d = S.verifyTokenDetail_(token);
    assert.strictEqual(d.reason, '',
      '発行した直後のトークンが通りません（理由: ' + d.reason + '）');
    assert.strictEqual(d.auth && d.auth.person, '山田 太郎',
      '氏名が往復していません（文字コードの食い違い）');
  });

  test('署名鍵は一度作ったら作り直さない', () => {
    // 実行のたびに鍵を作り直すと、発行したトークンを次の瞬間に検証できない。
    // 初回は空なので作るが、2回目以降は同じ値を返さなければならない。
    const S = loadAuth();
    const a = S.authSecret_();
    const b = S.authSecret_();
    assert.strictEqual(a, b, '署名鍵が呼ぶたびに変わっています');
    assert.ok(a && a.length > 20, '署名鍵が短すぎます');
  });

  test('鍵を作るところが、同時に呼ばれても壊れない', () => {
    // 最初のアクセスが重なると、それぞれ別の鍵を作って書き潰しうる。
    // 施錠して、待っている間に誰かが作っていないかを読み直すこと。
    const src = fs.readFileSync(path.join(ROOT, 'gas', 'Auth.gs'), 'utf8');
    const fn = src.slice(src.indexOf('function authSecret_'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.ok(/LockService/.test(body), '鍵の作成を施錠していません');
    assert.ok((body.match(/getProperty\('AUTH_SECRET'\)/g) || []).length >= 2,
      '施錠したあとに読み直していません（待っている間に作られた鍵を上書きします）');
  });

  test('読み取れない理由が、原因ごとに分かれている', () => {
    // 一括りにすると、次に起きたときも何が悪いのか分からない
    const S = loadAuth();
    assert.strictEqual(S.verifyTokenDetail_('ドットの無い文字列').reason, 'bad_shape');
    const token = S.issueToken_('山田 太郎', '管理者');
    const tampered = token.split('.')[0] + '.' + 'ちがう署名';
    assert.strictEqual(S.verifyTokenDetail_(tampered).reason, 'bad_signature');
  });
});
