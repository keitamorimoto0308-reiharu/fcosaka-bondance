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
  var sh = sheet_(SHEET.BROADCAST);
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
