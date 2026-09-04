/**
 * 管理ページの認証。
 *
 * ■ 前提
 *   管理ページは GitHub Pages（誰でも開ける公開URL）に置き、データはすべて
 *   このウェブアプリから取る。ウェブアプリ自体も匿名アクセスを許可している
 *   （応募フォームがそこから送るため）。
 *   つまり **画面を隠しても意味がなく、守りはすべてこちら側にある**。
 *   トークンの無い／壊れたリクエストには、一切データを返さない。
 *
 * ■ トークンの作り
 *   base64url(ペイロード) + '.' + 署名
 *   ペイロード = { p:氏名, r:役割, e:失効時刻, f:パスワードの指紋 }
 *   署名 = HMAC-SHA256(ペイロード, スクリプトプロパティの秘密鍵)
 *
 *   「パスワードを変えたら全端末で失効」を、失効リストを持たずに満たすために、
 *   ペイロードへ**現在のパスワードから作った指紋**を入れる。
 *   パスワードが変われば指紋が変わり、既存のトークンは自動的に合わなくなる。
 *
 * ■ 総当たり対策
 *   照合に失敗したら少し待たせ、失敗が続いたら運用者に通知する。
 *   IPで締め出す手段が無い（GASからは取れない）ため、
 *   「遅くする」と「気づける」の2つで守る。
 */

var TOKEN_DAYS = 30;
var LOGIN_FAIL_SLEEP_MS = 1200;   // 失敗するたびに待たせる
var LOGIN_FAIL_ALERT = 10;        // この回数を超えたら運用者に通知
var LOGIN_FAIL_WINDOW_SEC = 3600;
var LOGIN_FAIL_LOCK = 30;         // この回数を超えたら、照合せずに拒否する
var MIN_PASSWORD_LEN = 16;        // これ未満のパスワードでは管理ページを開かない

/** 署名用の秘密鍵。無ければ作る（初回のみ） */
function authSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('AUTH_SECRET');
  if (s) return s;

  // 初回だけ作る。ここを素通しにすると、最初の数リクエストが同時に来たときに
  // それぞれ別の鍵を作ってしまい、**発行したトークンを次の瞬間に検証できない**。
  // 入室した直後に「入室の情報を読み取れませんでした」と出る形になる。
  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(15000); } catch (e) {}
  try {
    s = props.getProperty('AUTH_SECRET');   // 待っている間に誰かが作ったかもしれない
    if (!s) {
      s = Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
          Utilities.getUuid() + '|' + new Date().getTime() + '|' + Utilities.getUuid()));
      props.setProperty('AUTH_SECRET', s);
    }
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) {} }
  }
  return s;
}

function sha256_(text) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function hmac_(text) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(text, authSecret_()));
}

/**
 * いま設定されているパスワードの指紋。
 * どちらか一方でも変われば値が変わるので、既存のトークンが失効する。
 */
function passwordFingerprint_() {
  return sha256_('pw|' + configText('管理者パスワード', '') + '|'
                       + configText('一般パスワード', '')).slice(0, 16);
}

/**
 * 文字列の一致を、長さの違いで早く抜けない形で比べる。
 * ハッシュ同士の比較なので実務上の意味は小さいが、素の比較を書かない習慣を残す。
 */
function safeEquals_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function issueToken_(person, role) {
  var payload = {
    p: person,
    r: role,
    e: new Date().getTime() + TOKEN_DAYS * 86400000,
    f: passwordFingerprint_(),
  };
  // 文字コードを既定に任せない。氏名は日本語なので、
  // 書き出しと読み取りで解釈が食い違うと JSON が壊れ、
  // 「入室の情報を読み取れませんでした」になる。
  var body = Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  return body + '.' + hmac_(body);
}

/**
 * トークンを検証する。通らなければ null。
 * 呼び出し側は null をそのまま「権限なし」として扱うこと。
 */
/**
 * なぜ入室が切れたのかを、呼び出し側に伝えられる形で検証する。
 *
 * 以前はどの理由でも同じ「セッションが切れました」を返していた。
 * 期限切れ・パスワード変更・関係者シートから外れた、のどれなのかが分からず、
 * **利用者にも運用者にも直しようがない**状態になっていた。
 * 理由が分かるのは正しいトークンを持っている人だけなので、
 * ここで理由を返しても総当たりの助けにはならない。
 */
function verifyTokenDetail_(token) {
  var bad = function (why) { return { auth: null, reason: why }; };

  // 「読み取れない」を一括りにすると、次に起きたときも原因が分からない。
  //   bad_shape     … 形が違う（送られ方の問題）
  //   bad_signature … 署名が合わない（署名鍵が実行ごとに変わっている疑い）
  //   bad_encoding  … 中身を読めない（文字コードの食い違いの疑い）
  if (!token || String(token).indexOf('.') < 0) return bad('bad_shape');
  var parts = String(token).split('.');
  if (parts.length !== 2) return bad('bad_shape');
  if (!safeEquals_(hmac_(parts[0]), parts[1])) return bad('bad_signature');

  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (e) { return bad('bad_encoding'); }

  if (!payload || !payload.e) return bad('bad_encoding');
  if (payload.e < new Date().getTime()) return bad('expired');
  if (!safeEquals_(payload.f || '', passwordFingerprint_())) return bad('password_changed');
  if (payload.r !== '管理者' && payload.r !== '一般') return bad('bad_encoding');

  // 関係者シートから外された人のトークンを生かしておかない
  var still = getPeople({ canLoginOnly: true }).filter(function (p) { return p.name === payload.p; });
  if (!still.length) return bad('not_listed');

  // 役割は「シートの役割」と「どのパスワードで入ったか」の両方が管理者のときだけ管理者。
  //
  // シートだけを見ていた時期があり、そのときは
  // **一般パスワードしか知らない人が、管理者の氏名を選ぶだけで管理者になれた**。
  // 氏名は秘密ではない（応募フォームが担当社員の一覧を公開している）ので、実際に通ってしまう。
  //
  // 逆に、シートで一般に落とした人は sheetAdmin が false になるので、
  // 「管理者から一般へ降格したらすぐ効く」という当初の意図はそのまま保たれる。
  var sheetAdmin = (still[0].role === '管理者');
  var tokenAdmin = (payload.r === '管理者');
  return { auth: { person: payload.p, role: (sheetAdmin && tokenAdmin) ? '管理者' : '一般' },
           reason: '' };
}

/** 「通ったか否か」だけが要る場所のために残す */
function verifyToken_(token) {
  return verifyTokenDetail_(token).auth;
}

/** 切れた理由を、その場で直せる言葉にする */
function authMessage_(reason) {
  var m = {
    expired:          '入室から30日が経ちました。お手数ですが、もう一度お入りください。',
    password_changed: 'パスワードが変更されたため、全員が入り直しになりました。新しいパスワードでお入りください。',
    not_listed:       '関係者シートで、あなたの「管理ページ利用」が「有」になっていません。管理者の方にご確認ください。',
    bad_shape:        '入室の情報が正しく送られませんでした。もう一度お入りください。',
    bad_signature:    '入室の照合に失敗しました（署名A）。この文言のまま担当者へお知らせください。',
    bad_encoding:     '入室の照合に失敗しました（文字B）。この文言のまま担当者へお知らせください。',
    bad_token:        '入室の情報を読み取れませんでした。もう一度お入りください。'
  };
  return m[reason] || 'もう一度お入りください。';
}

/**
 * 失敗の数を数え、閾値を超えたら締め出す。
 *
 * 以前は「10回目ちょうど」でしか通知せず、しかも失敗のたびにTTLを延ばしていたため、
 * 攻撃が続いているあいだ通知は生涯1通だけだった。「気づける」が成立していなかった。
 * GASは同時実行を受け付けるので、待たせるだけでは毎時数万回の試行を止められない。
 */
function loginFailKey_(kind) { return 'login_fail_' + kind; }

function countLoginFailure_(kind) {
  var cache = CacheService.getScriptCache();
  var key = loginFailKey_(kind);
  var n = Number(cache.get(key) || 0) + 1;
  // TTLを延ばさない。窓の開始時刻を別に持ち、窓が終わったら数え直す
  var startKey = key + '_at';
  var start = Number(cache.get(startKey) || 0);
  var now = new Date().getTime();
  if (!start || now - start > LOGIN_FAIL_WINDOW_SEC * 1000) {
    n = 1; start = now;
    cache.put(startKey, String(start), LOGIN_FAIL_WINDOW_SEC);
  }
  cache.put(key, String(n), LOGIN_FAIL_WINDOW_SEC);

  if (n >= LOGIN_FAIL_ALERT && n % LOGIN_FAIL_ALERT === 0) {
    try {
      alertOperator_('loginFailures', '',
        '1時間で' + n + '回（' + kind + '）'
        + (n >= LOGIN_FAIL_LOCK ? '／現在ログインを一時的に止めています' : ''));
    } catch (e) { logError_('countLoginFailure_', e); }
  }
  return n;
}

/**
 * 締め出し中かどうか。
 * キャッシュが読めないときは通常処理に戻す（危険側ではなく、使えなくならない側に倒す）。
 */
function loginLocked_(kind) {
  try {
    var n = Number(CacheService.getScriptCache().get(loginFailKey_(kind)) || 0);
    return n >= LOGIN_FAIL_LOCK;
  } catch (e) { return false; }
}

/**
 * パスワードが総当たりに耐える長さかを、コード側で担保する。
 * 運用ルール（§6-5）に頼ると、短いパスワードのまま公開されうる。
 */
function passwordTooWeak_() {
  var a = configText('管理者パスワード', ''), b = configText('一般パスワード', '');
  return (a && a.length < MIN_PASSWORD_LEN) || (b && b.length < MIN_PASSWORD_LEN);
}

/**
 * 入室の1段目：パスワードだけを受け取り、合っていれば氏名の一覧を返す。
 *
 * 仕様書§6-1は「氏名を関係者シートから選択」としているが、
 * 公開URLで氏名の一覧を無条件に返すと、誰が管理ページを使えるのかが
 * 外から分かってしまう。そこで**パスワードが合った人にだけ**一覧を返す。
 */
function adminNames_(payload) {
  var pw = String((payload && payload.password) || '');
  var adminPw = configText('管理者パスワード', '');
  var userPw = configText('一般パスワード', '');

  var gate = loginGate_(adminPw, userPw, 'names');
  if (gate) return gate;

  var ok = (adminPw && safeEquals_(sha256_(pw), sha256_(adminPw)))
        || (userPw && safeEquals_(sha256_(pw), sha256_(userPw)));
  if (!ok) {
    Utilities.sleep(LOGIN_FAIL_SLEEP_MS);
    countLoginFailure_('names');
    return { ok: false, error: 'denied', message: 'パスワードが違います。' };
  }

  var names = getPeople({ canLoginOnly: true }).map(function (p) {
    return { name: p.name, dept: p.dept || p.org };
  });
  if (!names.length) {
    return { ok: false, error: 'no_people',
      message: '関係者シートに「管理ページ利用＝有」の方が登録されていません。' };
  }
  return { ok: true, names: names };
}

/**
 * 入室の2段目。パスワードと氏名の両方が合って初めてトークンを出す。
 *
 * パスワードだけでは入れない（誰が操作したかを変更履歴に残せないため）。
 * 氏名は関係者シートの「管理ページ利用＝有」の人だけを受け付ける。
 */
function adminLogin_(payload) {
  var pw = String((payload && payload.password) || '');
  var person = String((payload && payload.person) || '').trim();

  var adminPw = configText('管理者パスワード', '');
  var userPw = configText('一般パスワード', '');

  var gate = loginGate_(adminPw, userPw, 'login');
  if (gate) return gate;

  var role = '';
  if (adminPw && safeEquals_(sha256_(pw), sha256_(adminPw))) role = '管理者';
  else if (userPw && safeEquals_(sha256_(pw), sha256_(userPw))) role = '一般';

  var people = getPeople({ canLoginOnly: true });
  var me = people.filter(function (p) { return p.name === person; })[0];

  if (!role || !me) {
    Utilities.sleep(LOGIN_FAIL_SLEEP_MS);
    countLoginFailure_('login');
    // どちらが違うのかは返さない。氏名の総当たりに使われるため。
    return { ok: false, error: 'denied', message: 'お名前またはパスワードが違います。' };
  }

  // シート側の役割が「管理者」なら、一般パスワードで入っても管理者にはしない。
  // 逆に、管理者パスワードで入っても、シートで一般なら一般として扱う。
  // 権限の正はシートの役割列（仕様書§6-1）。
  var effective = (me.role === '管理者' && role === '管理者') ? '管理者' : '一般';

  return {
    ok: true,
    token: issueToken_(me.name, effective),
    person: me.name,
    role: effective,
    expiresAt: new Date(new Date().getTime() + TOKEN_DAYS * 86400000).toISOString(),
  };
}

/**
 * 入室の入口で共通して確かめること。
 * 通してよければ null、止めるべきならそのまま返す応答を返す。
 */
function loginGate_(adminPw, userPw, kind) {
  // パスワードが未設定のまま開けてしまうと、公開URLが素通しになる
  if (!adminPw && !userPw) {
    return { ok: false, error: 'not_configured',
      message: '管理ページのパスワードが設定されていません。設定シートをご確認ください。' };
  }
  if (passwordTooWeak_()) {
    return { ok: false, error: 'weak_password',
      message: 'パスワードが短すぎるため、管理ページを開けません（' + MIN_PASSWORD_LEN
             + '文字以上にしてください）。設定シートをご確認ください。' };
  }
  if (loginLocked_(kind)) {
    // 照合そのものを行わない。ここで返すことで、待ち時間ではなく回数で止める
    return { ok: false, error: 'locked',
      message: '入室の失敗が続いたため、しばらくお待ちいただく必要があります。'
             + '時間をおいてからもう一度お試しください。' };
  }
  return null;
}

/** 管理APIの入口で必ず通す。通らなければ例外にせず、呼び出し側にnullを返す */
function requireAuth_(payload) {
  return verifyToken_(payload && payload.token);
}
