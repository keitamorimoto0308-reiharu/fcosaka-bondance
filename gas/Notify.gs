/**
 * 採択通知の一括送信（仕様書 §6-5）と、採択後リンクのトークン。
 *
 * ■ この機能の性質：送信は取り消せない
 *   間違えて送ったメールは戻せない。だから設計の重心は
 *   「速く送ること」ではなく「**送りすぎない・二重に送らない**」に置く。
 *
 *   1. 対象は「ステータス＝採択」かつ「採択通知送信日時が空」だけ
 *   2. 画面で件数と宛先を確認 → プレビュー → 送信、の3段
 *   3. 送信は1件ずつ。**送ってから記録する**（下の理由）
 *   4. 1回の上限を決め、超えるぶんは次回に回す
 *
 * ■ なぜ「送ってから記録する」のか
 *   先に記録してから送ると、送信に失敗した行が「送信済み」として残る。
 *   画面上は完了しているのに、事業者には何も届いていない。
 *   **誰も気づけない**うえ、締切まで放置される。
 *   逆に「送ってから記録」で途中停止すると、最悪もう一度届く。
 *   二重に届くのは恥ずかしいが、届かないより桁違いにましなので、こちらを採る。
 *   （記録のたびに flush して、取りこぼす窓を最小にしている）
 *
 * ■ トークンはパスワードから作らない
 *   応募済み修正（SelfEdit.gs）は authSecret_() から署名を作っている。
 *   同じ作りにすると、**管理者がパスワードを変えた瞬間に、
 *   既に送ったメールのリンクが全部死ぬ**。しかも誰にも見えない形で。
 *   §6-5 の運用は「イベント終了後にパスワードを変更する」なので、現実に起きる。
 *   ここでは応募時に台帳へ書いた乱数（素材トークン）をそのまま鍵にする。
 *   パスワードとは無関係なので、鍵を回してもリンクは生き続ける。
 */

/** 1回の送信で扱う上限。GASの実行時間（6分）に届く前に区切る */
var NOTIFY_BATCH_MAX = 40;

/**
 * 送れる通知の種類。
 *
 * ■ なぜ不採択も一括にしたか
 *   仕様書§6-5は「ステータスを不採択に変更した際に確認して送る」だが、
 *   50社ぶんを1件ずつ変えながら送るのは、**送り漏れと誤送信の温床**。
 *   採択と同じ3段階（対象を見る → 本文を読む → 送る）にそろえた。
 *   けいたはこの流れをもう知っているので、覚え直しが要らない。
 *
 * ■ 送信日時の列を分ける
 *   1つの列を使い回すと「採択を送ったのか、不採択なのか」が後から分からない。
 *   ステータスを直したときに、なおさら分からなくなる。
 */
// 種類は外から来た文字列で引く（payload.kind）。素の {} だと
// kind='constructor' が真になり、notifyKind_ が関数を返してしまう。
// Object.create(null) にして、その道を消す
var NOTIFY_KINDS = Object.assign(Object.create(null), {
  accept: { status: '採択',   sentCol: '採択通知送信日時',   label: '採択のご連絡' },
  reject: { status: '不採択', sentCol: '不採択通知送信日時', label: '不採択のご連絡' },
});

function notifyKind_(kind) {
  return NOTIFY_KINDS[String(kind || 'accept')] || null;
}

/**
 * ■ 受付IDごとの失敗ロックは置かない（検証役の指摘で撤去）
 *
 *   鍵は128ビットの乱数なので、総当たりはそもそも成立しない。
 *   一方、受付IDは SB-0001 からの連番で、採択メールの件名にも載る。
 *   受付IDだけをキーにしたロックを置くと、**正しい鍵を1つも知らない相手が、
 *   任意の事業者を締め出せる**（さらに運用者へ警報メールが飛び、
 *   Gmailの日次上限を食い潰して採択通知そのものが送れなくなる）。
 *   守りにならないうえ、攻撃の道具になるので置かない。
 *
 *   代わりに、失敗が続いていることだけは1日1回まで知らせる。
 */
var CONFIRM_ALERT_KEY = 'cf_alerted';
var CONFIRM_ALERT_SEC = 86400;
/** 何回続いたら知らせるか。1回で鳴らすと、こちらの動作確認でも鳴る */
var CONFIRM_ALERT_MIN = 20;
var CONFIRM_COUNT_KEY = 'cf_fails';
var CONFIRM_COUNT_SEC = 3600;

// ─────────────────────────────── 採択後リンクのトークン

/**
 * その行の採択後トークンを返す。無ければ作って書き込む。
 *
 * 応募フォーム経由の行には appendApplication が入れているが、
 * 運用者が台帳へ手で足した行には入っていない。
 * 送信の直前にここで埋めるので、手で足した行でもリンクが成立する。
 */
function ensureAcceptToken_(sheet, headers, rowNo, current) {
  var token = String(current || '').trim();
  if (token) return token;

  var col = headers.indexOf('素材トークン');
  if (col < 0) throw new Error('台帳に「素材トークン」列がありません。setup() を実行してください。');

  token = Utilities.getUuid().replace(/-/g, '');
  sheet.getRange(rowNo, col + 1).setValue(token);
  return token;
}

/** 採択後リンクを組み立てる。URLが未設定なら空文字（メール側で行ごと出さない） */
function acceptLink_(baseUrl, receiptId, token) {
  if (!baseUrl) return '';
  var sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
  return baseUrl + sep + 'id=' + encodeURIComponent(receiptId)
       + '&t=' + encodeURIComponent(token);
}

/**
 * 鍵の合わないアクセスを数える。**続いたときだけ**運用者に知らせる。
 *
 * 相手を止めることはしない（上のコメントの理由）。
 * 「誰かが探っている」を運用者が知る手立てだけを残す。
 * 受付IDを鍵にしないので、警報の量を外から増やせない。
 *
 * ■ 1回で鳴らすのをやめた（2026-09-02）
 *   メールのリンクを古いものから開いた、こちらが動作確認で叩いた、
 *   といったことでも鳴っていた。受け取る側にできることは何も無い。
 *   **本当の警報が埋もれる**のがいちばん危ないので、
 *   1時間に CONFIRM_ALERT_MIN 回を超えたときだけ、1日1回まで知らせる。
 */
function confirmNoteFailure_() {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(CONFIRM_COUNT_KEY) || 0) + 1;
    cache.put(CONFIRM_COUNT_KEY, String(n), CONFIRM_COUNT_SEC);
    if (n < CONFIRM_ALERT_MIN) return;
    if (cache.get(CONFIRM_ALERT_KEY)) return;
    cache.put(CONFIRM_ALERT_KEY, '1', CONFIRM_ALERT_SEC);
    alertOperator_('probing', '',
      '直近1時間で ' + n + ' 回（この通知は1日1回までです）。');
  } catch (e) { logError_('confirmNoteFailure_', e); }
}

/**
 * 受付IDとトークンから台帳の行を探す。
 * 通らなければ null。**なぜ通らなかったかは返さない**
 * （「そのIDは存在するがトークンが違う」と教えると、IDの総当たりに使える）。
 */
function findAcceptedRow_(receiptId, token) {
  if (!/^SB-\d{4}$/.test(String(receiptId || ''))) return null;
  if (!/^[0-9a-f]{32}$/i.test(String(token || ''))) return null;

  var L = readLedger_();
  var idIdx = L.headers.indexOf(COL.id);
  var tkIdx = L.headers.indexOf('素材トークン');
  var stIdx = L.headers.indexOf(COL.status);
  var rawIdx = L.headers.indexOf(COL.raw);
  if (idIdx < 0 || tkIdx < 0 || stIdx < 0) return null;

  for (var i = 0; i < L.rows.length; i++) {
    var r = L.rows[i];
    if (String(r[idIdx]).trim() !== String(receiptId).trim()) continue;
    var stored = String(r[tkIdx] || '').trim();
    // 長さの違いで早く抜けないよう、常に同じ手順で比べる
    if (!stored || !safeEquals_(stored, String(token))) return null;
    return {
      ledger: L, rowNo: i + 2, row: r,
      status: String(r[stIdx]).trim(),
      raw: rawIdx < 0 ? '' : String(r[rawIdx] || ''),
    };
  }
  return null;
}

// ─────────────────────────────── 送信対象の抽出

/** 採択かつ未送信の行を集める。画面にも送信にも同じ関数を使う（食い違いを作らない） */
function pendingNotifyRows_(L, kind) {
  var K = notifyKind_(kind) || NOTIFY_KINDS.accept;
  var H = L.headers;

  // 反対側の送信日時の列が無いと、下の「もう片方を送ってしまった行を外す」が
  // **例外も出さずに0件になる**（cell_ は列が無いと '' を返す）。
  // 歯止めが黙って消えるくらいなら、止まって人に知らせる（2026-09-04 の点検で指摘）
  var otherCol = (K === NOTIFY_KINDS.accept ? NOTIFY_KINDS.reject : NOTIFY_KINDS.accept).sentCol;
  if (H.indexOf(otherCol) < 0) {
    throw new Error('台帳に「' + otherCol + '」列がありません。setup() を実行してください。');
  }
  var rows = liveRows_(H, L.rows);
  var out = [];
  var flipped = [];
  rows.forEach(function (r, i) {
    if (asText_(cell_(H, r, COL.status)).trim() !== K.status) return;
    if (asText_(cell_(H, r, K.sentCol)).trim() !== '') return;

    // **もう片方の通知を送ってしまっている行**は、一斉送信に混ぜない。
    // 「出店が決定いたしました」を受け取った方に、あとから
    // 「見送らせていただきました」が自動で届くのが、いちばんまずい形。
    // ステータスの打ち間違いを直したときに普通に起きる。
    // 機械で送らず、人が事情を説明して個別に連絡する（2026-09-03 の点検で指摘）
    var other = (K === NOTIFY_KINDS.accept) ? NOTIFY_KINDS.reject : NOTIFY_KINDS.accept;
    if (asText_(cell_(H, r, other.sentCol)).trim() !== '') {
      flipped.push({
        id: asText_(cell_(H, r, COL.id)).trim(),
        company: asText_(cell_(H, r, COL.company)).trim(),
        sentAt: asText_(cell_(H, r, other.sentCol)).trim(),
        sentLabel: other.label,
      });
      return;
    }

    out.push({
      // rowNo はここでは返さない。liveRows_ が空行を落としているので
      // 添字と実際の行がずれる。書き戻し先は rowNoByReceiptId_ で引き直すこと。
      id: asText_(cell_(H, r, COL.id)).trim(),
      company: asText_(cell_(H, r, COL.company)).trim(),
      shopName: asText_(cell_(H, r, COL.shopName)).trim(),
      person: asText_(cell_(H, r, COL.person)).trim(),
      email: asText_(cell_(H, r, COL.email)).trim(),
      staff: asText_(cell_(H, r, COL.staff)).trim(),
      token: asText_(cell_(H, r, '素材トークン')).trim(),
    });
  });
  out.flipped = flipped;
  return out;
}

/**
 * ⚠ liveRows_ は空行を落とすので、行番号がずれる。
 * 書き戻す先を間違えると**別の会社を送信済みにする**ので、
 * 受付IDで引き直す。
 */
function rowNoByReceiptId_(L, receiptId) {
  var idIdx = L.headers.indexOf(COL.id);
  var found = -1;
  for (var i = 0; i < L.rows.length; i++) {
    if (String(L.rows[i][idIdx]).trim() !== receiptId) continue;
    // 同じ受付IDが2行あると、先頭一致では**送った行と印を付ける行がずれる**。
    // ずれたまま送ると、その会社に何度でも届き続ける（手でコピーした行で起きる）。
    // 曖昧なら書かない。失敗として運用者に見せるほうが安全。
    if (found >= 0) return -1;
    found = i + 2;
  }
  return found;
}

// ─────────────────────────────── メール本文

/** 提出期限の表記。設定シートに日付があればそれを、無ければ運用ルールの文言 */
/**
 * 素材の提出期限。空なら期限を切らない書き方にする。
 * **催促の根拠が画面に無いと、営業が電話をかけられない。**
 */
function materialDeadlineText_() {
  var raw = configText('素材の提出期限', '');
  if (!raw) return '';
  var d = new Date(raw);
  if (isNaN(d.getTime())) return String(raw);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy年M月d日') + 'まで';
}

function confirmDeadlineText_() {
  var raw = configText('確定情報の回収期限', '');
  if (!raw) return '出店可否のご連絡から5営業日以内';
  var d = new Date(raw);
  if (isNaN(d.getTime())) return String(raw);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy年M月d日') + 'まで';
}

/**
 * 採択通知の本文。
 *
 * ここには**紙面から外した3件**を必ず含める（src/content.js の PDF.afterAcceptRows）。
 * 荒天時の中断／お支払い／区画の場所は、
 * 「応募するかどうかの判断には要らないが、出店するなら知っておく必要がある」
 * として募集要項から外した。外した先がここなので、抜けると行き場が無くなる。
 */
/**
 * 不採択のご連絡。
 *
 * ■ 書き方で気をつけたこと
 *   ・**理由を書かない。**「区画数に限りがあり」までにとどめる。
 *     具体的な理由を書くと、必ず「なぜうちが」という問い合わせになる。
 *     選考基準を公開していない以上、答えられない。
 *   ・**次につなげる。** この会は継続する予定なので、
 *     次回のご案内という出口を必ず置く。
 *   ・**リンクを載せない。** 確定情報フォームも素材提出も、この方には要らない。
 *     載っていると「まだ何かするのか」と読ませてしまう。
 *   ・受付IDは載せる。問い合わせのときに、こちらが探せる。
 */
/**
 * 不採択通知の本文。文面はシート（メール文面）が正。
 * 下の buildRejectMailLegacy_ は、既定の文面との突き合わせ用に残す。
 */
function buildRejectMail_(row) {
  return mailtplBuild_('reject', row, null);
}

function buildRejectMailLegacy_(row) {
  var subject = '【選考結果のご連絡】' + EVENT_NAME
              + '（受付ID：' + row.id + '）';

  var body = [
    (row.person || '') + ' 様',
    '',
    'このたびは「' + EVENT_NAME + '」への出店にお申し込みいただき、',
    'ありがとうございました。',
    '',
    '慎重に検討させていただきましたが、ご用意できる区画数に限りがあり、',
    '誠に残念ながら、今回は出店を見送らせていただくこととなりました。',
    'ご期待に添えず、申し訳ございません。',
    '',
    '受付ID：' + row.id,
    (row.shopName ? '出店名：' + row.shopName : null),
    (row.company ? '企業・団体名：' + row.company : null),
    '',
    'お忙しいなかご準備いただきましたこと、あらためて御礼申し上げます。',
    '本イベントは今後も継続して開催してまいります。',
    '次回の募集の際には、あらためてご案内させていただければ幸いです。',
    '',
    'ご不明な点がございましたら、本メールへのご返信でお問い合わせください。',
    signature_(),
  ];

  // null を混ぜてある行（出店名が無い場合など）は、行ごと落とす
  return {
    subject: subject,
    body: body.filter(function (l) { return l !== null; }).join('\n'),
  };
}
/**
 * 採択通知の本文。
 *
 * 2026-09-03 から、**文面はシート（メール文面）が正**になった。
 * けいたが管理ページから直せる。シートが空なら
 * gas/MailTemplate.gs の既定（下に残してある旧・直書きと同じ内容）が使われる。
 *
 * 下の buildAcceptMailLegacy_ は、既定の文面が正しいかを検査で突き合わせるために残す。
 */
function buildAcceptMail_(row, links) {
  return mailtplBuild_('accept', row, links);
}

function buildAcceptMailLegacy_(row, links) {
  var subject = '【出店決定のご案内】' + EVENT_NAME
              + '（受付ID：' + row.id + '）';

  var body = [
    (row.person || '') + ' 様',
    '',
    'このたびは「' + EVENT_NAME + '」への出店にお申し込みいただき、',
    'ありがとうございました。',
    '厳正な選考の結果、' + (row.company || '') + ' さまの出店が決定いたしました。',
    '',
    '受付ID：' + row.id,
    (row.shopName ? '出店名：' + row.shopName : null),
    '',
    eventFactsBlock_(),
    '',
    '───────────────────────',
    '■ ご対応をお願いしたいこと',
    '───────────────────────',
    '',
    '当日の運営に必要な情報を、下記のフォームからご登録ください。',
    '搬入の時間帯や誘導の計画に使わせていただきます。',
    '',
    '　▼ 出店確定情報フォーム',
    '　' + links.confirm,
    '',
    '　ご提出期限：' + confirmDeadlineText_(),
    '',
    '※ このリンクは ' + (row.company || 'お申し込み') + ' さま専用です。',
    '　 他社さまには共有しないようお願いいたします。',
    '',
  ];

  if (links.upload) {
    body = body.concat([
      '告知に使わせていただく素材（ロゴ・お店の写真など）は、',
      'こちらからご提出ください。',
      '',
      '　▼ 素材アップロード',
      '　' + links.upload,
      '',
    ]);
  }

  body = body.concat([
    '───────────────────────',
    '■ あらためてお伝えする事項',
    '───────────────────────',
    '',
    '【区画の場所】',
    '　場外エリア内のどこになるかは、区画図の確定後にご案内します。',
    '',
    '【お支払い】',
    '　レンタル備品をお申し込みの場合、方法・時期は追ってご連絡いたします。',
    '　請求書の発行に対応します（領収書の発行はいたしかねます）。',
    '',
    '【荒天時の中断】',
    '　営業中に風雨が強まった場合、主催の判断で火気の使用停止や',
    '　営業の中断・終了をお願いすることがあります。',
    '　当日は主催の指示に従っていただきますようお願いいたします。',
    '',
    'ご不明な点がございましたら、本メールへのご返信でお問い合わせください。',
    '当日お会いできることを楽しみにしております。',
    signature_(),
  ]);

  // null を混ぜてある行（出店名が無い場合など）は、行ごと落とす。
  // 空文字にすると、そこだけ空行が1本余る。
  return {
    subject: subject,
    body: body.filter(function (l) { return l !== null; }).join('\n'),
  };
}

// ─────────────────────────────── 管理APIの入口

/**
 * 送信対象の一覧と、1件目の本文をそのまま返す（プレビュー）。
 * **送信はしない。** 画面はこの結果を見せてから、送信の確認を取る。
 */
function adminNotifyPreview_(auth, payload) {
  var K = notifyKind_(payload && payload.kind);
  if (!K) return { ok: false, error: 'bad_request', message: '通知の種類が不正です。' };

  var L = readLedger_();
  var rows;
  try {
    rows = pendingNotifyRows_(L, payload && payload.kind);
  } catch (e) {
    // 台帳の列が足りないときの throw。gas/Api.gs は例外を
    // 文言なしの server_error に潰すので、**直し方が画面に出ない**
    //（2026-09-04 の点検で指摘）。ここで受けて、そのまま伝える
    logError_('adminNotifyPreview_', e);
    return { ok: false, error: 'server_error', message: String(e.message || e) };
  }

  var base = {
    confirm: configText('確定情報フォームURL', ''),
    upload: configText('素材アップロードURL', ''),
  };

  // 宛先の形が壊れている行は、送信前に画面で気づけるように分けて返す
  var ok = [], bad = [];
  rows.forEach(function (r) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) ok.push(r); else bad.push(r);
  });

  var sample = null;
  if (ok.length) {
    // プレビューではトークンを台帳に書かない（送信していないのに書き換えない）。
    // 実際の見た目が分かればよいので、リンクは見本の文字列にする。
    var s = ok[0];
    // 見本のリンクには**実際のトークンを載せない**。
    // NEVER_SEND でわざわざブラウザに返さないようにしている値なので、
    // ここだけ素通しにしない（画面のDOMにも通信欄にも残る）。
    var m = (K.status === '不採択')
      ? buildRejectMail_(s)
      : buildAcceptMail_(s, {
          confirm: acceptLink_(base.confirm, s.id, '（送信時に発行されます）'),
          upload: acceptLink_(base.upload, s.id, '（送信時に発行されます）'),
        });
    sample = { to: s.email, company: s.company, subject: m.subject, body: m.body };
  }

  return {
    ok: true,
    kind: (K.status === '不採択') ? 'reject' : 'accept',
    kindLabel: K.label,
    rows: ok.map(function (r) {
      return { id: r.id, company: r.company, shopName: r.shopName,
               person: r.person, email: r.email, staff: r.staff };
    }),
    invalid: bad.map(function (r) {
      return { id: r.id, company: r.company, email: r.email };
    }),
    // もう片方の通知を送ってしまっている行。一斉送信からは外し、
    // **人が事情を説明して個別に連絡する**ものとして画面に出す
    flipped: (rows.flipped || []).slice(),
    sample: sample,
    batchMax: NOTIFY_BATCH_MAX,
    deadlineText: confirmDeadlineText_(),
    urls: base,
    // 差出人の設定が壊れていると、事業者に別のアドレスから届く。送る前に見せる
    mail: diagnoseMail(),
  };
}

/**
 * 一括送信。**ここから先は取り消せない。**
 *
 * 画面から `confirm:true` と、プレビューで見せた件数 `expect` を受け取る。
 * 件数が食い違っていたら送らない（プレビューのあとに誰かがステータスを
 * 変えた、という状況で、見せた覚えのない相手に送るのを防ぐ）。
 */
function adminNotifySend_(auth, payload) {
  if (!payload || payload.confirm !== true) {
    return { ok: false, error: 'not_confirmed', message: '送信の確認が取れていません。' };
  }

  // 種類の検査は**ロックを取る前**に済ませる。
  // あとで return するとロックを持ったまま抜ける（他の5箇所は tryLock の直後が try）
  var K = notifyKind_(payload && payload.kind);
  if (!K) return { ok: false, error: 'bad_request', message: '通知の種類が不正です。' };
  var isReject = (K.status === '不採択');

  // ── 送る文面を、**ここでもう一度確かめる**。
  //
  // 文面の検査（mailtplValidate_）は、管理ページから保存するときにしか走らない。
  // スプレッドシートの「メール文面」シートを直接いじれば、
  // 検査を通っていない文面で送れてしまう。たとえば
  // {{確定情報フォームURL}} の行を消せば、**リンクの無い採択通知が50社に届く**。
  // 送信は取り消せないので、押される前に止める（2026-09-04 の点検で指摘）。
  var tplNow = mailtplRead_(isReject ? 'reject' : 'accept');
  // シートの見出しが壊れていると、既定の文面に差し替わって送られる。
  // **本人が意図した文面ではない**ので、送る前に人へ返す
  if (tplNow.headBroken) {
    return { ok: false, error: 'bad_sheet', message: mailtplHeadBroken_().message
      + '（意図した文面で送れないため、1通も送っていません）' };
  }
  var tplErrs = mailtplValidate_(isReject ? 'reject' : 'accept',
                                 tplNow.subject, tplNow.body);
  if (tplErrs.length) {
    return { ok: false, error: 'bad_template', errors: tplErrs,
      message: 'メールの文面に問題があるため、1通も送っていません：'
             + tplErrs.join(' ／ ')
             + '　「文面を編集する」で直してから、もう一度お試しください。' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };

  try {
    var L = readLedger_();
    var all = pendingNotifyRows_(L, payload && payload.kind).filter(function (r) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email);
    });

    // ■ 件数ではなく、受付IDの集合そのものを突き合わせる
    //   件数だけを見ると、**1社抜けて1社増えたとき素通りする**。
    //   管理者が2人いる、1人が別タブで一覧を触っている、で普通に起きる。
    //   その場合「画面で見ていない会社」に取り消せないメールが届く。
    var nowIds = all.map(function (r) { return r.id; }).sort();
    var sawIds = (payload && Array.isArray(payload.ids) ? payload.ids : [])
      .map(function (x) { return String(x); }).sort();
    if (sawIds.join(',') !== nowIds.join(',')) {
      var added = nowIds.filter(function (i) { return sawIds.indexOf(i) < 0; });
      var gone  = sawIds.filter(function (i) { return nowIds.indexOf(i) < 0; });
      return { ok: false, error: 'changed',
        message: '対象が変わりました。もう一度、対象一覧をご確認ください。'
               + (added.length ? '（増えた：' + added.join('、') + '）' : '')
               + (gone.length  ? '（外れた：' + gone.join('、') + '）' : '') };
    }
    if (!all.length) return { ok: false, error: 'empty', message: '送信対象がありません。' };

    // 送る前に残量を確かめる。途中で尽きると、半分だけ届いた状態になる
    var quota = MailApp.getRemainingDailyQuota();
    var batch = all.slice(0, NOTIFY_BATCH_MAX);
    if (quota < batch.length) {
      return { ok: false, error: 'quota',
        message: '本日の送信可能数が足りません（残り' + quota + '通／対象'
               + batch.length + '件）。明日あらためてお試しください。' };
    }

    var base = {
      confirm: configText('確定情報フォームURL', ''),
      upload: configText('素材アップロードURL', ''),
    };
    // 不採択の本文にはリンクを載せないので、URLの有無は問わない
    if (!isReject && !base.confirm) {
      return { ok: false, error: 'no_url',
        message: '設定シートの「確定情報フォームURL」が空です。'
               + 'リンクの無い採択通知を送ることになるため、中止しました。' };
    }

    var opt = mailOptions_();
    var notifiedCol = L.headers.indexOf(K.sentCol);
    if (notifiedCol < 0) {
      return { ok: false, error: 'server_error',
        message: '応募一覧に「' + K.sentCol + '」の列がありません。'
               + 'Apps Script から setup() を1回実行してください。' };
    }

    var sent = [], failed = [];

    batch.forEach(function (r) {
      var rowNo = rowNoByReceiptId_(L, r.id);
      if (rowNo < 0) { failed.push({ id: r.id, reason: '台帳に行が見つかりません' }); return; }

      try {
        var mail;
        if (isReject) {
          // **不採択では素材トークンを発行しない。**
          // 発行すると、確定情報フォームと素材アップロードが開けてしまう。
          // 本文にリンクは載せないが、鍵だけ有効という状態を作らない
          mail = buildRejectMail_(r);
        } else {
          var token = ensureAcceptToken_(L.sheet, L.headers, rowNo, r.token);
          mail = buildAcceptMail_(r, {
            confirm: acceptLink_(base.confirm, r.id, token),
            upload: acceptLink_(base.upload, r.id, token),
          });
        }

        GmailApp.sendEmail(r.email, mail.subject, mail.body, opt);

        // 送ってから記録する。先に記録すると、失敗した行が
        // 「送信済み」として残り、誰も気づけない（冒頭のコメント参照）
        L.sheet.getRange(rowNo, notifiedCol + 1)
          .setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
        SpreadsheetApp.flush();

        appendHistory(auth.person, r.id, K.label, '未送信', '送信済み', '一括送信');
        sent.push({ id: r.id, company: r.company, email: r.email });
      } catch (e) {
        logError_('adminNotifySend_:' + r.id, e);
        failed.push({ id: r.id, company: r.company,
                      reason: String((e && e.message) || e).slice(0, 200) });
      }
    });

    if (failed.length) {
      alertOperator_('acceptMailFailed', '',
        '送れなかった受付ID：' + failed.map(function (f) { return f.id; }).join(', '));
    }

    return {
      ok: true,
      sent: sent, failed: failed,
      remaining: all.length - batch.length,
      message: sent.length + '件を送信しました。'
        + (failed.length ? '（' + failed.length + '件が失敗しています）' : '')
        + (all.length > batch.length
            ? '　残り' + (all.length - batch.length) + '件は、もう一度実行してください。' : ''),
    };
  } finally {
    lock.releaseLock();
  }
}
