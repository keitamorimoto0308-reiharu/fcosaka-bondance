/**
 * 応募済み情報の修正を、実際に走らせて確かめるテスト。
 *
 * ■ なぜ要るか
 *   受付IDは SB-0001 から順番に発行される。
 *   ある企業のメールアドレスを知っている人は、受付IDを1番から順に試せば
 *   **いつか必ず当たる**。応募内容には担当者名・電話番号が含まれる。
 *
 *   だから守りは「メールアドレス単位で回数を数えて止める」ことにある。
 *   受付ID単位で数えても、攻撃者は毎回違うIDを試すので止まらない。
 *   ここが効いているかは、動かして確かめないと分からない。
 *
 * ■ どうやって走らせるか
 *   gas/SelfEdit.gs を、Apps Script の関数の代役と一緒に隔離環境へ読み込む。
 *   台帳・キャッシュ・メールはすべて差し替え可能な代役に置き換える。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

let CACHE, MAILS, ALERTS, ROWS, WRITES, HISTORY;

/** 応募1件ぶんの中身。台帳の 生データ(JSON) に入っているもの */
function baseValues(over) {
  return Object.assign({
    companyName: '株式会社テスト', boothName: 'テスト出店',
    contactName: 'テスト太郎', contactEmail: 'Test@Example.com',
    contactPhone: '06-1234-5678',
    fcosakaStaff: 'その他',
    boothTypes: ['展示'], boothDescription: '展示の内容です。',
    boothSize: 'S1', power: '不要', tentChoice: '持ち込む',
    tentOwnWidth: 2.5, tentOwnDepth: 3, tentWeight: '持参する',
    rentalItems: { 'パイプ椅子': 2 },
    agreeAll: true,
  }, over || {});
}

function makeBox(opts) {
  opts = opts || {};
  const values = opts.values || baseValues();
  const status = opts.status || '未確認';

  const headers = ['受付ID', '受付日時', '企業名', '担当者メール', 'ステータス',
                   'レンタル明細', 'レンタル合計(円)', '主形態', '生データ(JSON)'];
  ROWS = [[opts.receiptId || 'SB-0007', '2026-09-01', values.companyName,
           values.contactEmail, status, '', '', '', JSON.stringify(values)]];

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, Boolean, Date, isFinite,

    Utilities: {
      base64EncodeWebSafe: v => (Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8')).toString('base64url'),
      base64DecodeWebSafe: v => Buffer.from(String(v), 'base64url'),
      computeHmacSha256Signature: (t, k) =>
        crypto.createHmac('sha256', String(k)).update(String(t), 'utf8').digest(),
      newBlob: v => {
        const buf = Buffer.isBuffer(v) ? Buffer.from(v) : Buffer.from(String(v), 'utf8');
        return { getBytes: () => buf, getDataAsString: () => buf.toString('utf8') };
      },
      sleep: () => {},
      formatDate: () => '2026/09/01 12:00',
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in CACHE ? CACHE[k] : null),
        put: (k, v) => { CACHE[k] = v; },
        remove: k => { delete CACHE[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} },
    MailApp: { sendEmail: o => { MAILS.push(o); } },
    LOCK_WAIT_MS: 1000,

    // 台帳の代役。書き込んだ内容を記録する
    readLedger_: () => ({
      headers: headers.slice(),
      rows: ROWS.map(r => r.slice()),
      sheet: {
        getRange: (row, col) => ({
          setValue: v => { WRITES.push({ row, col, header: headers[col - 1], value: v }); },
        }),
      },
    }),
    COL: { id: '受付ID', email: '担当者メール', status: 'ステータス', raw: '生データ(JSON)' },

    // schema / 既存関数の代役
    applyFields: () => require('../src/schema.js').applyFields(),
    validate_: opts.validate || (() => []),
    rentalSummary_: v => {
      const q = v.rentalItems || {};
      const names = Object.keys(q);
      return { detail: names.map(n => n + ' × ' + q[n]).join(' ／ '),
               total: names.length ? 500 * (q['パイプ椅子'] || 0) : '' };
    },
    formatCell_: (f, v) => (Array.isArray(v) ? v.join('、')
      : (typeof v === 'boolean' ? (v ? '○' : '') : String(v == null ? '' : v))),
    safeCell_: v => String(v == null ? '' : v),
    // 生データは、壊れたJSONを書かないよう専用の関数を通す（本番と同じ形）
    rawJson_: v => JSON.stringify(v),
    primaryType_: t => (Array.isArray(t) && t.length ? t[0] : ''),
    appendHistory: (...a) => { HISTORY.push(a); },
    getNotifyRecipients: () => opts.recipients || ['staff@example.com'],
    configText: (k, fb) => (fb || ''),
    signature_: () => '',
    mailOptions_: () => ({}),
    alertOperator_: (key, id, extra) => { ALERTS.push({ key: key, extra: extra || '' }); },
    logError_: () => {},
    sha256_: t => crypto.createHash('sha256').update(String(t), 'utf8').digest('base64url'),
    safeEquals_: (a, b) => String(a) === String(b),
    authSecret_: () => 'test-secret-0123456789',
    console,
  });
  box.globalThis = box;
  vm.runInContext(read('gas/SelfEdit.gs'), box, { filename: 'gas/SelfEdit.gs' });
  return box;
}

const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));

beforeEach(() => { CACHE = {}; MAILS = []; ALERTS = []; WRITES = []; HISTORY = []; });

describe('本人確認：受付IDの総当たりを止める', () => {

  test('正しい組み合わせなら、いまの内容が返る', () => {
    const S = makeBox();
    const r = plain(S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-0007' }));
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.values.companyName, '株式会社テスト');
    assert.ok(r.token, 'トークンが返っていません');
  });

  test('メールアドレスの大文字小文字と前後の空白を無視する', () => {
    const S = makeBox();
    const r = plain(S.selfLookup_({ email: '  TEST@EXAMPLE.COM  ', receiptId: ' sb-0007 ' }));
    assert.strictEqual(r.ok, true, '入力の揺れで本人確認が通らなくなっています');
  });

  test('【要】同じメールアドレスで5回外したら止める', () => {
    // 受付ID単位で数えても、攻撃者は毎回違うIDを試すので止まらない。
    // 止めるべきは「同じメールアドレスで何度も外している」という動き。
    const S = makeBox();
    for (let i = 1; i <= 5; i++) {
      const r = plain(S.selfLookup_({ email: 'test@example.com',
        receiptId: 'SB-' + String(1000 + i) }));
      assert.strictEqual(r.error, 'denied', i + '回目で想定外の応答');
    }
    // 6回目は、正しい受付IDでも通さない
    const after = plain(S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-0007' }));
    assert.strictEqual(after.error, 'locked',
      '5回外しても止まりません（受付IDの総当たりが通ります）');
  });

  test('締め出しに達したら、運用者に知らせる', () => {
    const S = makeBox();
    for (let i = 1; i <= 5; i++) {
      S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-' + String(2000 + i) });
    }
    assert.strictEqual(ALERTS.length, 1, '総当たりを検知しても誰にも知らせていません');
    // 文面は gas/Mail.gs の ALERT_ に持たせた。ここでは**どの警報か**と、
    // 詳細に回数が入っていることを見る
    assert.strictEqual(ALERTS[0].key, 'probing', '警報の種類が違います：' + ALERTS[0].key);
    assert.ok(/回続けて失敗/.test(ALERTS[0].extra), '詳細に回数がありません：' + ALERTS[0].extra);
  });

  test('失敗の理由で、メールアドレスと受付IDのどちらが違うかを教えない', () => {
    // 「メールアドレスが違います」と返すと、そのアドレスが応募済みか分かる
    const S = makeBox();
    const wrongMail = plain(S.selfLookup_({ email: 'other@example.com', receiptId: 'SB-0007' }));
    const wrongId   = plain(S.selfLookup_({ email: 'test@example.com',  receiptId: 'SB-9999' }));
    assert.strictEqual(wrongMail.message, wrongId.message,
      'どちらが違うのかが分かる文言になっています');
  });

  test('成功したら、失敗の数え上げを消す', () => {
    const S = makeBox();
    S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-1111' });
    S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-0007' });
    assert.deepStrictEqual(Object.keys(CACHE), [],
      '正しく入れたのに失敗の記録が残っています（数回で締め出されます）');
  });

  test('採択・不採択まで進んだ応募は、この画面から直せない', () => {
    for (const st of ['採択', '不採択', '辞退', 'キャンセル', '重複（無効）']) {
      const S = makeBox({ status: st });
      const r = plain(S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-0007' }));
      assert.strictEqual(r.error, 'locked_status', st + ' なのに修正できます');
    }
  });

  test('受付IDの形が違えば、台帳を見に行かない', () => {
    const S = makeBox();
    const r = plain(S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-7' }));
    assert.strictEqual(r.error, 'bad_receipt');
    assert.deepStrictEqual(Object.keys(CACHE), [], '形の誤りを失敗として数えています');
  });
});

describe('トークン：管理ページのものと混ざらない', () => {

  test('管理ページの鍵で作った署名では通らない', () => {
    // 署名鍵に別の塩を混ぜてある。仮に管理側の検証がゆるんでも、こちらは通らない
    const S = makeBox();
    const good = plain(S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-0007' })).token;
    const body = good.split('.')[0];
    const adminSig = crypto.createHmac('sha256', 'test-secret-0123456789')
      .update(body, 'utf8').digest('base64url');
    assert.strictEqual(S.selfVerifyToken_(body + '.' + adminSig), null,
      '管理ページの鍵で作った署名が通ってしまいます');
  });

  test('中身を書き換えると通らない', () => {
    const S = makeBox();
    const good = plain(S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-0007' })).token;
    const [body, sig] = good.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.id = 'SB-0001';                         // 別の応募を狙う
    const forged = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
    assert.strictEqual(S.selfVerifyToken_(forged), null,
      '受付IDを書き換えたトークンが通ります（他社の応募を書き換えられます）');
  });

  test('期限が切れたら通らない', () => {
    const S = makeBox();
    const good = plain(S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-0007' })).token;
    const [body] = good.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.e = Date.now() - 1000;
    const nb = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const resigned = nb + '.' + S.selfHmac_(nb);    // 署名し直しても期限で落ちる
    assert.strictEqual(S.selfVerifyToken_(resigned), null);
  });

  test('壊れた値で例外を投げない', () => {
    const S = makeBox();
    for (const bad of [undefined, null, '', '.', 'a.b', '{}', 0, true, 'x'.repeat(5000)]) {
      assert.strictEqual(S.selfVerifyToken_(bad), null, '通った値: ' + String(bad));
    }
  });
});

describe('上書き：消えた情報を辿れるようにする', () => {

  function tokenFor(S) {
    return plain(S.selfLookup_({ email: 'test@example.com', receiptId: 'SB-0007' })).token;
  }

  test('変えた項目だけが、変更前と変更後で履歴に残る', () => {
    const S = makeBox();
    const token = tokenFor(S);
    const r = plain(S.selfSave_({ token, values: baseValues({ contactPhone: '06-9999-0000' }) }));
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(HISTORY.length, 1, '変えた項目の数と履歴の数が合いません');
    const [operator, id, label, before, after] = HISTORY[0];
    assert.strictEqual(operator, '出店者（本人）');
    assert.strictEqual(id, 'SB-0007');
    assert.strictEqual(before, '06-1234-5678', '変更前が残っていません');
    assert.strictEqual(after, '06-9999-0000');
  });

  test('担当社員は、応募者に変えさせない', () => {
    // 誰の紹介かは営業側の記録であって、応募者が変えるものではない
    const S = makeBox();
    const token = tokenFor(S);
    // 担当社員だけを変えても「変更なし」になる（差分の対象外）ので、
    // 実際に書き込みが起きる変更と一緒に送って、守られているかを見る
    const r = plain(S.selfSave_({
      token, values: baseValues({ fcosakaStaff: '別の 社員', contactPhone: '06-9999-0000' }),
    }));
    assert.strictEqual(r.ok, true, r.message);
    assert.deepStrictEqual(r.changed, ['ご担当者さまの電話番号'].slice(0, r.changed.length),
      '担当社員が変更として扱われています');
    const raw = WRITES.filter(w => w.header === '生データ(JSON)').pop();
    assert.ok(raw, '生データを書いていません');
    assert.strictEqual(JSON.parse(raw.value).fcosakaStaff,
      'その他', '担当社員が書き換えられました');
  });

  test('管理側の列（ステータス）に書き込まない', () => {
    const S = makeBox();
    const token = tokenFor(S);
    S.selfSave_({ token, values: baseValues({ contactPhone: '06-9999-0000' }) });
    const touched = WRITES.map(w => w.header);
    assert.ok(!touched.includes('ステータス'),
      '応募者の修正でステータスが書き換わっています');
  });

  test('応募時と同じ検証を通す', () => {
    // ここを緩めると「応募では通らない内容が、修正なら通る」状態ができる
    const S = makeBox({ validate: () => [{ key: 'companyName', message: 'だめ' }] });
    const token = tokenFor(S);
    const r = plain(S.selfSave_({ token, values: baseValues({ companyName: '' }) }));
    assert.strictEqual(r.error, 'validation');
    assert.strictEqual(WRITES.length, 0, '検証で弾いたのに書き込んでいます');
    assert.strictEqual(HISTORY.length, 0);
  });

  test('変更が無ければ、書き込みも通知もしない', () => {
    const S = makeBox();
    const token = tokenFor(S);
    const r = plain(S.selfSave_({ token, values: baseValues() }));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.changed, []);
    assert.strictEqual(WRITES.length, 0, '変更が無いのに書き込んでいます');
    assert.strictEqual(MAILS.length, 0, '変更が無いのに通知しています');
  });

  test('担当社員と管理者に、変わった項目だけを知らせる', () => {
    const S = makeBox();
    const token = tokenFor(S);
    S.selfSave_({ token, values: baseValues({ contactPhone: '06-9999-0000' }) });
    assert.strictEqual(MAILS.length, 1, '通知が送られていません');
    assert.ok(/【修正】/.test(MAILS[0].subject), '件名で修正だと分かりません');
    assert.ok(MAILS[0].body.includes('06-1234-5678'), '変更前が本文にありません');
    assert.ok(MAILS[0].body.includes('06-9999-0000'), '変更後が本文にありません');
    assert.ok(!MAILS[0].body.includes('展示の内容です'),
      '変わっていない項目まで送っています（どこが変わったのか読み取れません）');
  });

  test('確認のあとに採択されていたら、上書きしない', () => {
    // 本人確認を通したあとに担当者が採択した、という行き違いを防ぐ
    const S = makeBox();
    const token = tokenFor(S);
    ROWS[0][4] = '採択';                       // ステータス列
    const r = plain(S.selfSave_({ token, values: baseValues({ contactPhone: '06-9999-0000' }) }));
    assert.strictEqual(r.error, 'locked_status');
    assert.strictEqual(WRITES.length, 0);
  });

  test('メールの送信に失敗しても、修正そのものは失われない', () => {
    const S = makeBox({ recipients: [] });     // 宛先0件 → 通知できない
    const token = tokenFor(S);
    const r = plain(S.selfSave_({ token, values: baseValues({ contactPhone: '06-9999-0000' }) }));
    assert.strictEqual(r.ok, true, '通知の失敗で修正まで失敗しています');
    assert.ok(WRITES.length > 0, '書き込まれていません');
  });
});
