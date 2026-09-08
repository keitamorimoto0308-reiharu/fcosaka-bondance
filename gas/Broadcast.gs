/**
 * 一斉メール。
 *
 * ■ なぜ gas/Notify.gs に足さないか
 *   Notify.gs は「機械が対象を決める」前提の関数で埋まっている
 *   （ステータスが採択・送信日時が空、という条件から対象を導く）。
 *   一斉メールは**人が選ぶ**ので前提が逆で、混ぜるとどちらの前提で
 *   書かれた関数か読めなくなる。
 *
 * ■ 採択通知には有って、ここには無いもの
 *   「送信日時の列」。採択通知は台帳のその列が空の行だけを対象にするので、
 *   **台帳そのものが二重送信を止めている**。一斉メールにはそれが無いため、
 *   歯止めを別に作る必要がある（設計メモ docs/internal/design_broadcast_mail.md §3）。
 *
 * ■ 制御文字を直接書かない
 *   引き継ぎ書 §8。改行が要るところは String.fromCharCode(10) で組み立てる。
 */

/** 一斉メールで使える差し込みの値をそろえる */
function broadcastVars_(row) {
  return {
    'お名前': row.person || '',
    '企業名': row.company || '',
    '出店名': row.shopName || '',
    '受付ID': row.id || '',
    'イベント名': EVENT_NAME,
    '開催情報': eventFactsBlock_(),
    '署名': signature_(),
    '区画番号': row.block || '',
    '搬入予定時刻': row.inAt || '',
    '提出期限': confirmDeadlineText_(),
  };
}

/**
 * 下書き。押すと、一斉メールの作成欄に入る雛形。
 *
 * ■ なぜ「編集して保存できるテンプレート」にしないか
 *   仕様書 §6-5 は「辞退確認／当日のご案内を初期登録し、管理者が編集できる」だが、
 *   **一斉メールの作成欄そのものが編集画面**で、送った文面は
 *   送信履歴シートに丸ごと残る。保存先を別に持つと二重管理になり、
 *   「シートは直したのにコードの既定が古い」が起きる
 *   （採択・不採択は毎回同じ文面を送るので、あちらは保存する意味がある）。
 *
 * ■ 中身は、実際に起きる場面から決めた
 *   確定情報・素材の催促と、当日のご案内。
 *   どれも**相手ごとに違う値**が要る（区画番号・搬入予定時刻）。
 *
 * ■ 改行を直接書かない
 *   引き継ぎ書 §8。この行が本物の改行に化けると、
 *   生成物の中で文字列が途中で切れる。
 */
function BROADCAST_DRAFTS_() {
  var NL = String.fromCharCode(10);
  var j = function (lines) { return lines.join(NL); };
  return [
    {
      name: '出店確定情報のご提出のお願い',
      subject: '【ご提出のお願い】{{イベント名}}　出店確定情報（受付ID：{{受付ID}}）',
      body: j([
        '{{お名前}} 様',
        '',
        'いつもお世話になっております。',
        '{{イベント名}} 事務局です。',
        '',
        '出店確定情報のご提出が、まだ確認できておりません。',
        'お手数ですが、{{提出期限}} にご提出をお願いいたします。',
        '',
        '受付ID：{{受付ID}}',
        '企業・団体名：{{企業名}}',
        '',
        'ご提出用のリンクは、出店決定のご案内メールに記載しております。',
        '見当たらない場合は、このメールにご返信ください。',
        '',
        '{{開催情報}}',
        '{{署名}}',
      ]),
    },
    {
      name: '告知用素材のご提出のお願い',
      subject: '【ご提出のお願い】{{イベント名}}　告知用の素材（受付ID：{{受付ID}}）',
      body: j([
        '{{お名前}} 様',
        '',
        'いつもお世話になっております。',
        '{{イベント名}} 事務局です。',
        '',
        '告知に使わせていただく素材（ロゴ・お店の写真など）のご提出が、',
        'まだ確認できておりません。',
        '',
        '受付ID：{{受付ID}}',
        '企業・団体名：{{企業名}}',
        '出店名：{{出店名}}',
        '',
        'ご提出用のリンクは、出店決定のご案内メールに記載しております。',
        '見当たらない場合は、このメールにご返信ください。',
        '',
        '{{署名}}',
      ]),
    },
    {
      name: '当日のご案内',
      subject: '【当日のご案内】{{イベント名}}（受付ID：{{受付ID}}）',
      body: j([
        '{{お名前}} 様',
        '',
        'いつもお世話になっております。',
        '{{イベント名}} 事務局です。',
        '',
        '当日のご案内をお送りいたします。',
        '',
        '　出店名　　{{出店名}}',
        '　区画番号　{{区画番号}}',
        '　搬入時刻　{{搬入予定時刻}}',
        '',
        '※ 区画番号・搬入時刻が記載されていない場合は、',
        '　 追ってあらためてご連絡いたします。',
        '',
        '{{開催情報}}',
        '当日はどうぞよろしくお願いいたします。',
        '{{署名}}',
      ]),
    },
    {
      name: '辞退のご確認',
      subject: '【ご確認】{{イベント名}}　出店辞退について（受付ID：{{受付ID}}）',
      body: j([
        '{{お名前}} 様',
        '',
        'いつもお世話になっております。',
        '{{イベント名}} 事務局です。',
        '',
        '出店の辞退のご連絡を承りました。',
        '下記のとおり手続きを進めさせていただきます。',
        '',
        '受付ID：{{受付ID}}',
        '企業・団体名：{{企業名}}',
        '',
        'お心当たりがない場合は、このメールにご返信ください。',
        '',
        '{{署名}}',
      ]),
    },
  ];
}

/**
 * 送信履歴シートの見出し。
 *
 * **本文を丸ごと残すために、変更履歴とは別のシートにする。**
 * 変更履歴のセルには長さの上限があり（gas/Ledger.gs の historyCell_）、
 * メール本文はそこに入りきらない。
 * 「何を送ったか」を後から読めないと、問い合わせに答えられない。
 */
var BROADCAST_HEAD = ['送信ID', '送信日時', '送信者', '件名', '本文',
                      '対象件数', '宛先の受付ID', '結果'];

/** 同じ件名の再送を「近すぎる」と見なす幅（24時間） */
var BROADCAST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 履歴シートを返す。**まだ無ければ null**（例外にしない）。
 *
 * ■ なぜ例外のままにしないか
 *   反映の順番は GAS → けいたが `setup()` → ページ公開（引き継ぎ書 §3）。
 *   その途中で「メール送信」タブを開く人がいる。
 *   `sheet_` は「setup() を実行してください」という良い文言を投げるが、
 *   **`gas/Api.gs` が例外を文言なしの `server_error` に潰す**ので、
 *   使う人には理由の出ないエラーだけが見える。
 *
 *   ここで null にしておき、呼ぶ側が「相手は見せる／送信は断る」を
 *   それぞれ判断する（`gas/Notify.gs` が台帳の列不足でしている処理と同じ形）。
 */
function broadcastSheetOrNull_() {
  try {
    return sheet_(SHEET.BROADCAST);
  } catch (e) {
    return null;
  }
}

/**
 * 履歴の送信日時を、比べられる数にする。
 *
 * シートの値は、書いた直後は Date だが、
 * 人がシートを触ったあとは文字列で返ってくることがある。**両方受ける。**
 */
function broadcastParseAt_(v) {
  if (v && Object.prototype.toString.call(v) === '[object Date]') return v.getTime();
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(v == null ? '' : v).trim());
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                  Number(m[4]), Number(m[5])).getTime();
}

/**
 * 直前に、同じ件名を同じ相手へ送っていないか。
 *
 * ■ 止めずに、人に見せる
 *   押し間違いと、意図した再送（催促のリマインド）は機械には区別できない。
 *   機械が止めると、人は迂回路を探す（シートを直接いじる等）。
 *   確実に止められるもの（札）と、人が決めるべきもの（ここ）を分ける。
 *
 * @returns {{ids:string[], sentAt:string, sendId:string}} 重なった受付ID
 */
function broadcastRecent_(subject, ids) {
  var want = Object.create(null);
  (Array.isArray(ids) ? ids : []).forEach(function (x) {
    var s = String(x == null ? '' : x).trim();
    if (s) want[s] = true;
  });

  var empty = { ids: [], sentAt: '', sendId: '' };
  var sh = broadcastSheetOrNull_();
  if (!sh || sh.getLastRow() < 2) return empty;

  var grid = sh.getDataRange().getValues();
  var H = grid[0].map(function (h) { return String(h).trim(); });
  var iAt = H.indexOf('送信日時'), iSub = H.indexOf('件名');
  var iTo = H.indexOf('宛先の受付ID'), iId = H.indexOf('送信ID');
  if (iAt < 0 || iSub < 0 || iTo < 0) return empty;

  var now = new Date().getTime();
  var subj = String(subject == null ? '' : subject).trim();

  // 新しいほうから見て、最初に当たったものを返す
  for (var i = grid.length - 1; i >= 1; i--) {
    var r = grid[i];
    if (String(r[iSub] == null ? '' : r[iSub]).trim() !== subj) continue;
    var at = broadcastParseAt_(r[iAt]);
    if (!isFinite(at) || now - at > BROADCAST_WINDOW_MS || at > now) continue;

    var hit = String(r[iTo] == null ? '' : r[iTo]).split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && want[s]; });
    if (!hit.length) continue;

    return {
      ids: hit,
      sentAt: asText_(r[iAt]),
      sendId: iId < 0 ? '' : String(r[iId] == null ? '' : r[iId]).trim(),
    };
  }
  return empty;
}

/**
 * 一斉メールを送ってはいけないステータス。
 *
 * **絞り込みに使ったかどうかに関わらず見る。**
 * 辞退した会社に「当日のご案内」が届くのは、どんな選び方をしていても事故。
 */
var BROADCAST_BLOCKED_STATUS = ['辞退', 'キャンセル', '重複（無効）'];

/** 宛先の形。採択通知（gas/Notify.gs）と同じ判定にそろえる */
var BROADCAST_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 割当開始区画と区画数から「12〜14」を作る。1区画なら範囲にしない */
function broadcastBlock_(start, units) {
  var s = String(start == null ? '' : start).trim();
  if (!s) return '';
  var a = Number(s);
  var n = Number(units) || 1;
  if (!isFinite(a) || n <= 1) return s;
  return s + '〜' + (a + n - 1);
}

/**
 * 画面が選んだ受付IDで、台帳を**引き直す**。
 *
 * ■ 画面から来た値を一切使わない
 *   管理ページは公開URLにあり、守りはサーバー側だけ（引き継ぎ書 §4）。
 *   画面が送ってきた宛先をそのまま使うと、細工した通信で任意の相手に送れる。
 *   画面が送ってよいのは**受付IDの配列だけ**。
 *
 * @returns {{rows:Array, missing:string[], invalid:Array, blocked:Array}}
 *   rows … 送れる行／missing … 台帳に無いID／invalid … 宛先が壊れている行／
 *   blocked … ステータスが送信に向かない行
 */
function broadcastRows_(L, ids) {
  var H = L.headers;

  var byId = Object.create(null);
  liveRows_(H, L.rows).forEach(function (r) {
    var id = asText_(cell_(H, r, COL.id)).trim();
    // 同じIDの行が2つあっても、最初の1行だけを見る。
    // 「関係のない行を上書きする」（2026-09-07 の不具合）と同じ根なので、
    // ここでも黙って2通送らないようにする
    if (id && !byId[id]) byId[id] = r;
  });

  var out = { rows: [], missing: [], invalid: [], blocked: [] };
  var seen = Object.create(null);

  (Array.isArray(ids) ? ids : []).forEach(function (raw) {
    var id = String(raw == null ? '' : raw).trim();
    if (!id || seen[id]) return;   // 同じ相手に2通送らない
    seen[id] = true;

    var r = byId[id];
    if (!r) { out.missing.push(id); return; }

    var rec = {
      id: id,
      company:  asText_(cell_(H, r, COL.company)).trim(),
      shopName: asText_(cell_(H, r, COL.shopName)).trim(),
      person:   asText_(cell_(H, r, COL.person)).trim(),
      email:    asText_(cell_(H, r, COL.email)).trim(),
      status:   asText_(cell_(H, r, COL.status)).trim(),
      block:    broadcastBlock_(cell_(H, r, COL.spaceStart), cell_(H, r, COL.spaceUnits)),
      inAt:     asText_(cell_(H, r, COL.inAt)).trim(),
    };

    if (BROADCAST_BLOCKED_STATUS.indexOf(rec.status) >= 0) { out.blocked.push(rec); return; }
    if (!BROADCAST_EMAIL_RE.test(rec.email)) { out.invalid.push(rec); return; }
    out.rows.push(rec);
  });

  return out;
}

/** 札が生きている時間（秒）。プレビューから30分 */
var BROADCAST_TICKET_SEC = 1800;

/**
 * 一度に送れる上限。採択通知（NOTIFY_BATCH_MAX）と同じ値にそろえる。
 * GAS には1回の実行に6分の制限があり、途中で切れると
 * **どこまで送ったか分からない状態**になる。
 */
var BROADCAST_BATCH_MAX = 40;

/**
 * 宛先の並びを、比べられる1つの文字列にする。
 * 画面の並べ替えで指紋が変わらないように並べ直し、重複も落とす。
 */
function broadcastIdKey_(ids) {
  var seen = Object.create(null);
  var out = [];
  (Array.isArray(ids) ? ids : []).forEach(function (x) {
    var s = String(x == null ? '' : x).trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return out.sort().join(',');
}

/** プレビューで見せた「件名・本文・宛先」の指紋 */
function broadcastFingerprint_(subject, body, ids) {
  var SEP = String.fromCharCode(0);
  return sha256_(String(subject == null ? '' : subject) + SEP
               + String(body == null ? '' : body) + SEP
               + broadcastIdKey_(ids));
}

/**
 * プレビューが札を発行する。
 *
 * 札はただの乱数ではなく、**そのとき画面に出したものの指紋**と結びつける。
 * こうすると札は二重送信を止めるだけでなく、
 * 「プレビューで見たものしか送れない」ことまで保証できる。
 */
function broadcastTicket_(subject, body, ids) {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('bc_' + token,
    broadcastFingerprint_(subject, body, ids), BROADCAST_TICKET_SEC);
  return token;
}

/**
 * 送信が札を使う。**一度きり。**
 *
 * ■ 中身を比べる前に消す
 *   食い違ったときに札を残すと、同じ札で何度でも試せる。
 *   食い違いは「画面で見たものと違うものを送ろうとしている」状態なので、
 *   どのみち取り直しが要る。**消してから比べる**ほうが安全側に倒れる。
 */
function broadcastUseTicket_(ticket, subject, body, ids) {
  var key = 'bc_' + String(ticket == null ? '' : ticket);
  var cache = CacheService.getScriptCache();
  var want = cache.get(key);
  if (!want) return false;
  cache.remove(key);
  return safeEquals_(want, broadcastFingerprint_(subject, body, ids));
}

/**
 * 一斉メールで使える差し込みの名前。
 *
 * **broadcastVars_ から導く。** 別に一覧を持つと、
 * 片方に足してもう片方を忘れたときに「使えるのに知らない差し込みだと断る」
 * （または逆に「値が無いのに通す」）が起きる。
 */
function broadcastVarNames_() {
  var out = [];
  var v = broadcastVars_({});
  for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out.push(k);
  return out;
}

/**
 * その場で書いた文面を送ってよいか。返すのは断る理由の配列（空なら通す）。
 *
 * 保存する文面には種類ごとの規則があるが（mailtplValidate_）、
 * 一斉メールはその経路を通らないので、当てはめられるものだけを当てる。
 */
function broadcastValidate_(subject, body) {
  var errs = [];
  subject = String(subject == null ? '' : subject);
  body = String(body == null ? '' : body);

  if (!subject.trim()) errs.push('件名が空です。');
  if (!body.trim()) errs.push('本文が空です。');
  if (subject.length > MAILTPL_SUBJECT_MAX) {
    errs.push('件名が長すぎます（' + MAILTPL_SUBJECT_MAX + '文字まで）。');
  }
  if (body.length > MAILTPL_BODY_MAX) {
    errs.push('本文が長すぎます（' + MAILTPL_BODY_MAX + '文字まで）。');
  }

  var names = broadcastVarNames_();
  var text = subject + String.fromCharCode(10) + body;

  // 知らない差し込み。**置き換わらないまま、そのまま届く**
  var unknown = [];
  var re = /\{\{([^{}]{1,40})\}\}/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var name = String(m[1]).trim();
    if (names.indexOf(name) >= 0) continue;
    if (unknown.indexOf(name) < 0) unknown.push(name);
  }
  if (unknown.length) {
    errs.push('一斉メールで使えない差し込みがあります：{{' + unknown.join('}} {{')
      + '}}　（使えるのは ' + names.join('・') + ' です）');
  }

  // 括弧の閉じ忘れ。**正しい形を全部取り除いてから**残りを見る。
  // 「知らない差し込み」の検査は正しい形しか見ないので、ここは別に要る
  var rest = text.replace(/\{\{[^{}]{1,40}\}\}/g, '');
  if (rest.indexOf('{{') >= 0 || rest.indexOf('}}') >= 0) {
    errs.push('差し込みの括弧が閉じていないところがあります。'
      + '{{お名前}} のように、二重の波括弧で挟んでください。');
  }

  return errs;
}

/**
 * 1通ぶんを組み立てる。
 *
 * **落ちた差し込みの名前を返すのが要点。**
 * 「値が空なら行ごと落とす」は既存の規則（mailtplRender_）だが、
 * 一斉メールでは50社ぶんの本文を目で追えないので、
 * 落ちたこと自体を機械が数えて画面に出さないと、
 * 区画番号の無い案内が黙って届く。
 *
 * @returns {{subject:string, body:string, dropped:string[]}}
 */
function broadcastBuild_(row, subject, body) {
  var vars = broadcastVars_(row);
  var text = String(subject == null ? '' : subject)
           + String(body == null ? '' : body);

  // 本文と件名で実際に使われていて、かつ値が空になったものだけを挙げる。
  // 「使っていない差し込みが空」は落ちる行が無いので、報せる意味が無い
  var dropped = [];
  var re = /\{\{([^{}]{1,40})\}\}/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var name = String(m[1]).trim();
    if (!Object.prototype.hasOwnProperty.call(vars, name)) continue;
    var v = vars[name];
    if (v !== null && v !== undefined && String(v) !== '') continue;
    if (dropped.indexOf(name) < 0) dropped.push(name);
  }

  return {
    subject: mailtplRender_(String(subject == null ? '' : subject), vars)
      .split(String.fromCharCode(10)).join(' ').trim(),
    body: mailtplRender_(String(body == null ? '' : body), vars),
    dropped: dropped,
  };
}

// ─────────────────────────────── 送信履歴

/** 送信IDを作る。BC-20261007-1 の形（日付＋その日の連番） */
function broadcastSendId_(sh, now) {
  var day = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');
  var prefix = 'BC-' + day + '-';
  var n = 0;
  if (sh && sh.getLastRow() >= 2) {
    var grid = sh.getDataRange().getValues();
    var iId = grid[0].map(function (h) { return String(h).trim(); }).indexOf('送信ID');
    if (iId >= 0) {
      for (var i = 1; i < grid.length; i++) {
        var v = String(grid[i][iId] == null ? '' : grid[i][iId]).trim();
        if (v.indexOf(prefix) !== 0) continue;
        var m = Number(v.slice(prefix.length));
        if (isFinite(m) && m > n) n = m;
      }
    }
  }
  return prefix + (n + 1);
}

/**
 * 送信履歴に1行書く。**送る前に呼ぶ。**
 *
 * ■ gas/Notify.gs とは逆の順序にしている
 *   あちらは「送ってから記録する」。台帳の送信日時の列が
 *   **二重送信の歯止めそのもの**なので、先に書くと失敗した行が
 *   「送信済み」として残り、二度と再送されない。
 *
 *   こちらの履歴は歯止めではなく**監査の記録**で、
 *   GASの6分制限で途中終了したときに「送ったのに記録が無い」が
 *   いちばん困る（問い合わせに答えられず、二重送信の照合もできない）。
 *   だから先に書いて、結果は送り終えてから埋める。
 *
 * @returns {number} 書いた行番号（結果を後から埋めるのに使う）
 */
function broadcastLog_(sh, sendId, now, person, subject, body, ids) {
  sh.appendRow([
    sendId,
    Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    String(person == null ? '' : person),
    String(subject == null ? '' : subject),
    String(body == null ? '' : body),
    ids.length,
    ids.join(','),
    '送信中',
  ]);
  return sh.getLastRow();
}

/** 送り終えてから、結果の列だけを埋める */
function broadcastLogResult_(sh, rowNo, text) {
  var col = BROADCAST_HEAD.indexOf('結果') + 1;
  if (col > 0 && rowNo > 0) sh.getRange(rowNo, col).setValue(text);
}

// ─────────────────────────────── 画面から呼ばれる2つ

/**
 * プレビュー。**ここでは1通も送らない。**
 *
 * 画面が送ってよいのは受付IDの配列と、その場で書いた件名・本文だけ。
 * 宛先も企業名も、ここで台帳から引き直す。
 *
 * 返した ticket は、送信のときにそのまま返してもらう。
 * 札は「件名・本文・送れる相手」の指紋と結びついているので、
 * **画面で見たものしか送れない**。
 */
function adminBroadcastPreview_(auth, payload) {
  payload = payload || {};
  var subject = String(payload.subject == null ? '' : payload.subject);
  var body = String(payload.body == null ? '' : payload.body);

  var L, picked;
  try {
    L = readLedger_();
    picked = broadcastRows_(L, payload.ids);
  } catch (e) {
    // 台帳の列が足りないときの throw。gas/Api.gs は例外を文言なしの
    // server_error に潰すので、**直し方が画面に出ない**。ここで受けて伝える
    logError_('adminBroadcastPreview_', e);
    return { ok: false, error: 'server_error', message: String(e.message || e) };
  }

  var errors = broadcastValidate_(subject, body);

  // 差し込みが空になる行を、**受付IDまで**出す。
  // 50社ぶんの本文は目で追えないので、落ちたことを機械が数えて見せる
  var droppedBy = Object.create(null);
  var sample = null;
  picked.rows.forEach(function (r, i) {
    var built = broadcastBuild_(r, subject, body);
    built.dropped.forEach(function (name) {
      if (!droppedBy[name]) droppedBy[name] = [];
      droppedBy[name].push(r.id);
    });
    if (i === 0) sample = { to: r.email, company: r.company,
                            subject: built.subject, body: built.body };
  });
  var dropped = [];
  for (var name in droppedBy) {
    if (Object.prototype.hasOwnProperty.call(droppedBy, name)) {
      dropped.push({ name: name, ids: droppedBy[name] });
    }
  }

  var sendIds = picked.rows.map(function (r) { return r.id; });

  // 履歴シートが無いと、送った記録が残せない。**相手と見本は見せる**が、
  // 送れないので札は出さない（押せるのに送れない画面を作らない）
  var historyReady = !!broadcastSheetOrNull_();

  return {
    ok: true,
    historyReady: historyReady,
    rows: picked.rows.map(function (r) {
      return { id: r.id, company: r.company, shopName: r.shopName,
               person: r.person, email: r.email, status: r.status,
               block: r.block, inAt: r.inAt };
    }),
    missing: picked.missing,
    invalid: picked.invalid.map(function (r) {
      return { id: r.id, company: r.company, email: r.email };
    }),
    blocked: picked.blocked.map(function (r) {
      return { id: r.id, company: r.company, status: r.status };
    }),
    errors: errors,
    dropped: dropped,
    sample: sample,
    // 24時間以内に同じ件名を送った相手。**止めない。人に見せる**
    recent: broadcastRecent_(subject, sendIds),
    batchMax: BROADCAST_BATCH_MAX,
    tooMany: sendIds.length > BROADCAST_BATCH_MAX,
    vars: broadcastVarNames_(),
    // 画面はこの action を「読み込み」にも使う（件名も本文も空のまま呼ぶ）。
    // 入口を2つに分けると、片方だけ権限の確認を忘れる
    drafts: BROADCAST_DRAFTS_(),
    // 差出人の設定が壊れていると、事業者に別のアドレスから届く。送る前に見せる
    mail: diagnoseMail(),
    // 文面に問題があるうち、履歴シートが無いうちは札を出さない（どのみち送れない）
    ticket: (errors.length || !historyReady)
      ? '' : broadcastTicket_(subject, body, sendIds),
  };
}

/**
 * 一斉送信。**ここから先は取り消せない。**
 *
 * ■ 画面が送ってくる ids は「プレビューで送れると出した相手」
 *   除外された行（辞退・宛先が壊れている・台帳に無い）は入っていない前提。
 *   入っていたら、それは台帳が変わったということなので送らない。
 *
 * ■ 送信者への警報メールは出さない
 *   採択通知は alertOperator_ を呼ぶが、あれは押した人が
 *   結果を見ていない場合があるため。一斉メールは人が画面を見ながら押し、
 *   失敗はその場に出る。**警報が多すぎると本当の警報が埋もれる**（引き継ぎ書 §6）。
 */
function adminBroadcastSend_(auth, payload) {
  payload = payload || {};
  if (payload.confirm !== true) {
    return { ok: false, error: 'not_confirmed', message: '送信の確認が取れていません。' };
  }

  var subject = String(payload.subject == null ? '' : payload.subject);
  var body = String(payload.body == null ? '' : payload.body);

  // 文面の検査は**ロックを取る前**に済ませる（持ったまま抜けないように）
  var errs = broadcastValidate_(subject, body);
  if (errs.length) {
    return { ok: false, error: 'bad_template', errors: errs,
      message: '文面に問題があるため、1通も送っていません：' + errs.join(' ／ ') };
  }

  /*
   * 履歴シートが無ければ、**1通も送らない**。
   *
   * 送った記録が残せない状態で送ると、問い合わせに答えられず、
   * 二重送信の照合（broadcastRecent_）も働かない。
   * ロックを取る前に確かめる（持ったまま抜けないように）。
   */
  var sh = broadcastSheetOrNull_();
  if (!sh) {
    return { ok: false, error: 'no_sheet',
      message: '台帳に「一斉メール履歴」シートがありません。'
             + 'Apps Script から setup() を1回実行してください。'
             + '（送った記録が残せないため、1通も送っていません）' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };

  try {
    var L = readLedger_();
    var picked = broadcastRows_(L, payload.ids);

    // ■ プレビューのあとに台帳が変わっていないか
    //   札は「画面に出したもの」を縛るが、**台帳のほうが変わる**ことは縛れない。
    //   プレビューのあとに辞退へ変わった行に「当日のご案内」が届くのが、
    //   いちばん起きやすくて、いちばんまずい形
    var lost = picked.missing.slice();
    picked.blocked.forEach(function (r) {
      lost.push(r.id + '（' + r.status + '）');
    });
    picked.invalid.forEach(function (r) { lost.push(r.id + '（宛先）'); });
    if (lost.length) {
      return { ok: false, error: 'changed',
        message: 'プレビューのあとに、対象が変わりました。'
               + 'もう一度プレビューをやり直してください。（変わった：'
               + lost.join('、') + '）' };
    }
    if (!picked.rows.length) {
      return { ok: false, error: 'empty', message: '送信対象がありません。' };
    }
    if (picked.rows.length > BROADCAST_BATCH_MAX) {
      return { ok: false, error: 'too_many',
        message: '一度に送れるのは' + BROADCAST_BATCH_MAX + '件までです（いま'
               + picked.rows.length + '件）。分けてお送りください。' };
    }

    // ■ 札を使う。**一度きり**
    //   ここまでの検査を通ってから消費する（台帳が変わっていただけなら、
    //   札を無駄にせずプレビューし直せる）
    var sendIds = picked.rows.map(function (r) { return r.id; });
    if (!broadcastUseTicket_(payload.ticket, subject, body, sendIds)) {
      return { ok: false, error: 'stale',
        message: 'この内容は、プレビューで確認したものと違います'
               + '（または、すでに送信済みです）。'
               + 'もう一度プレビューをやり直してください。' };
    }

    // 送る前に残量を確かめる。途中で尽きると、半分だけ届いた状態になる
    var quota = MailApp.getRemainingDailyQuota();
    if (quota < sendIds.length) {
      return { ok: false, error: 'quota',
        message: '本日の送信可能数が足りません（残り' + quota + '通／対象'
               + sendIds.length + '件）。明日あらためてお試しください。' };
    }

    // ■ 記録してから送る（gas/Notify.gs とは逆。broadcastLog_ の説明を参照）
    //   sh はロックを取る前に取ってある（無ければここまで来ない）
    var now = new Date();
    var sendId = broadcastSendId_(sh, now);
    var logRow = broadcastLog_(sh, sendId, now, auth && auth.person,
                               subject, body, sendIds);
    SpreadsheetApp.flush();

    var opt = mailOptions_();
    var sent = [], failed = [];

    picked.rows.forEach(function (r) {
      try {
        var mail = broadcastBuild_(r, subject, body);
        GmailApp.sendEmail(r.email, mail.subject, mail.body, opt);
        sent.push(r.id);
      } catch (e) {
        logError_('adminBroadcastSend_:' + r.id, e);
        failed.push({ id: r.id, company: r.company,
                      reason: String((e && e.message) || e).slice(0, 200) });
      }
    });

    broadcastLogResult_(sh, logRow,
      '成功' + sent.length + '件'
      + (failed.length ? ' / 失敗' + failed.length + '件：'
          + failed.map(function (f) { return f.id; }).join(',') : ''));

    // 変更履歴は**送信ごとに1行**。1通ごとだと50行増えて履歴が埋まる
    appendHistory(auth && auth.person, '', '一斉メール', '',
      subject + '（' + sent.length + '件）', sendId);

    return {
      ok: true,
      sendId: sendId,
      sent: sent,
      failed: failed,
      message: sent.length + '件を送信しました。'
        + (failed.length ? '（' + failed.length + '件が失敗しています）' : ''),
    };
  } finally {
    lock.releaseLock();
  }
}
