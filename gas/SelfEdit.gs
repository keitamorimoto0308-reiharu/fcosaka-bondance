/**
 * 応募済み情報の修正（出店企業が自分で直す）
 *
 * ■ 一番の急所：受付IDは連番である
 *   受付IDは SB-0001, SB-0002 … と順番に発行される。
 *   つまり、ある企業のメールアドレスを知っている人は、
 *   受付IDを1番から順に試せば**いつか必ず当たる**。
 *   応募内容には担当者名・電話番号が含まれるので、ここを塞がずに公開してはいけない。
 *
 *   対策は3つ。
 *   1. **メールアドレス単位**で失敗回数を数え、5回外したら30分止める。
 *      受付ID単位で数えても、攻撃者は毎回違うIDを試すので止まらない。
 *      止めるべきは「同じメールアドレスで何度も外している」という動き。
 *   2. 失敗時に、メールアドレスと受付IDのどちらが違うのかを教えない。
 *      「メールアドレスが違います」と返すと、そのアドレスが応募済みかどうかが分かり、
 *      応募企業の一覧が漏れる。
 *   3. 照合の前に必ず一定時間待たせて、総当たりの速度そのものを落とす。
 *
 * ■ 管理ページのトークンとは別物にする
 *   このトークンで管理APIに入れてはいけないので、署名鍵に別の塩を混ぜている。
 *   仮に verifyTokenDetail_ の条件が将来ゆるんでも、署名が合わないので通らない。
 */

var SELF_TOKEN_MIN   = 30;     // 本人確認が有効な時間（分）
var SELF_FAIL_LOCK   = 5;      // 同じメールアドレスで何回外したら止めるか
var SELF_LOCK_SEC    = 1800;   // 止めておく時間（秒）
var SELF_FAIL_SLEEP_MS = 1500; // 照合のたびに待たせる時間

/** 修正を受け付けない状態。ここまで進んだ応募は、担当者を通してもらう */
var SELF_LOCKED_STATUS = ['採択', '不採択', '辞退', 'キャンセル', '重複（無効）'];

function selfDispatch_(payload) {
  var action = payload && payload.action;
  if (action === 'selfLookup') return selfLookup_(payload);
  if (action === 'selfSave')   return selfSave_(payload);
  return { ok: false, error: 'unknown_action' };
}

// ─────────────────────────────────────────── 本人確認

function selfNormalizeEmail_(v) {
  return String(v || '').trim().toLowerCase();
}

function selfFailKey_(email) {
  // メールアドレスそのものをキーにしない（キャッシュを覗かれても誰か分からないように）
  return 'self_fail_' + sha256_('self|' + email).slice(0, 24);
}

function selfLocked_(email) {
  try {
    var n = Number(CacheService.getScriptCache().get(selfFailKey_(email)) || 0);
    return n >= SELF_FAIL_LOCK;
  } catch (e) { return false; }
}

function selfCountFailure_(email) {
  try {
    var cache = CacheService.getScriptCache();
    var key = selfFailKey_(email);
    var n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), SELF_LOCK_SEC);
    if (n === SELF_FAIL_LOCK) {
      alertOperator_('probing', '',
        '応募内容の修正で、同じメールアドレスの照合が' + SELF_FAIL_LOCK
        + '回続けて失敗しました（30分間止めています）。');
    }
  } catch (e) { logError_('selfCountFailure_', e); }
}

function selfClearFailure_(email) {
  try { CacheService.getScriptCache().remove(selfFailKey_(email)); } catch (e) {}
}

/** 管理ページとは別の鍵で署名する（このトークンで管理APIに入れないように） */
function selfHmac_(text) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(text, authSecret_() + '|self-edit'));
}

function selfIssueToken_(receiptId, email) {
  var payload = {
    id: receiptId,
    m: sha256_('self|' + email).slice(0, 16),   // アドレスそのものは入れない
    e: new Date().getTime() + SELF_TOKEN_MIN * 60000,
  };
  var body = Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  return body + '.' + selfHmac_(body);
}

/** 通れば受付IDを返す。通らなければ null */
function selfVerifyToken_(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  var parts = String(token).split('.');
  if (parts.length !== 2) return null;
  if (!safeEquals_(selfHmac_(parts[0]), parts[1])) return null;
  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (e) { return null; }
  if (!payload || !payload.e || payload.e < new Date().getTime()) return null;
  if (!/^SB-\d{4}$/.test(String(payload.id || ''))) return null;
  return String(payload.id);
}

/** どの失敗でも同じ文言を返す。どちらが違うのかを教えない */
function selfDenied_() {
  return { ok: false, error: 'denied',
    message: 'メールアドレスと受付IDの組み合わせが確認できませんでした。'
           + '応募時の自動返信メールをご確認のうえ、もう一度お試しください。' };
}

/** 台帳から1件を探す。見つからなければ null */
function selfFindRow_(receiptId, email) {
  var L = readLedger_();
  var idIdx = L.headers.indexOf(COL.id);
  var mailIdx = L.headers.indexOf(COL.email);
  var statusIdx = L.headers.indexOf(COL.status);
  var rawIdx = L.headers.indexOf(COL.raw);
  if (idIdx < 0 || mailIdx < 0) return null;

  for (var i = 0; i < L.rows.length; i++) {
    var r = L.rows[i];
    if (String(r[idIdx]).trim() !== receiptId) continue;
    if (selfNormalizeEmail_(r[mailIdx]) !== email) continue;
    return {
      ledger: L,
      rowNo: i + 2,                                   // 1行目は見出し
      status: statusIdx < 0 ? '' : String(r[statusIdx]).trim(),
      raw: rawIdx < 0 ? '' : String(r[rawIdx] || ''),
      row: r,
    };
  }
  return null;
}

function selfLookup_(payload) {
  var email = selfNormalizeEmail_(payload && payload.email);
  var receiptId = String((payload && payload.receiptId) || '').trim().toUpperCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // 形が違うだけなら、そう伝えてよい（応募済みかどうかは漏れない）
    return { ok: false, error: 'bad_email', message: 'メールアドレスの形をご確認ください。' };
  }
  if (!/^SB-\d{4}$/.test(receiptId)) {
    return { ok: false, error: 'bad_receipt',
      message: '受付IDは SB- のあとに数字4桁です（例：SB-0007）。' };
  }
  if (selfLocked_(email)) {
    return { ok: false, error: 'locked',
      message: '確認の失敗が続いたため、しばらくお待ちいただく必要があります。'
             + 'お急ぎの場合は、担当までメールでご連絡ください。' };
  }

  Utilities.sleep(SELF_FAIL_SLEEP_MS);   // 総当たりの速度そのものを落とす

  var hit = selfFindRow_(receiptId, email);
  if (!hit) {
    selfCountFailure_(email);
    return selfDenied_();
  }

  if (SELF_LOCKED_STATUS.indexOf(hit.status) >= 0) {
    // 見つかったことは伝えてよい（本人確認は通っている）
    return { ok: false, error: 'locked_status',
      message: 'このお申し込みは、すでに審査の結果が確定しているため、'
             + 'この画面からの修正は承っておりません。'
             + 'お手数ですが、担当までメールでご連絡ください。' };
  }

  selfClearFailure_(email);

  var values = {};
  try { values = JSON.parse(hit.raw || '{}') || {}; } catch (e) { values = {}; }

  return {
    ok: true,
    receiptId: receiptId,
    token: selfIssueToken_(receiptId, email),
    expiresInMinutes: SELF_TOKEN_MIN,
    values: selfPublicValues_(values),
  };
}

/**
 * 応募者に返してよい値だけにする。
 * 生データには将来こちら側で足した項目が混ざりうるので、
 * 「応募フォームにある項目」に限って返す。
 */
function selfPublicValues_(values) {
  var out = {};
  applyFields().forEach(function (f) {
    if (values[f.key] !== undefined) out[f.key] = values[f.key];
    if (f.unknownCheckbox && values[f.unknownCheckbox.key] !== undefined) {
      out[f.unknownCheckbox.key] = values[f.unknownCheckbox.key];
    }
  });
  out.rentalItems = (values.rentalItems && typeof values.rentalItems === 'object'
                     && !Array.isArray(values.rentalItems)) ? values.rentalItems : {};
  return out;
}

// ─────────────────────────────────────────── 上書き

function selfSave_(payload) {
  var receiptId = selfVerifyToken_(payload && payload.token);
  if (!receiptId) {
    return { ok: false, error: 'expired',
      message: '確認から時間が経ちました。お手数ですが、もう一度やり直してください。' };
  }

  var incoming = (payload && payload.values) || {};
  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    return { ok: false, error: 'bad_request' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var L = readLedger_();
    var idIdx = L.headers.indexOf(COL.id);
    var rawIdx = L.headers.indexOf(COL.raw);
    var statusIdx = L.headers.indexOf(COL.status);
    if (idIdx < 0 || rawIdx < 0) return { ok: false, error: 'server_error' };

    var rowNo = -1, current = null, status = '';
    for (var i = 0; i < L.rows.length; i++) {
      if (String(L.rows[i][idIdx]).trim() !== receiptId) continue;
      rowNo = i + 2;
      try { current = JSON.parse(String(L.rows[i][rawIdx] || '{}')) || {}; } catch (e) { current = {}; }
      status = statusIdx < 0 ? '' : String(L.rows[i][statusIdx]).trim();
      break;
    }
    if (rowNo < 0) return { ok: false, error: 'not_found' };

    // 確認を通したあとに採択された、という行き違いを防ぐ
    if (SELF_LOCKED_STATUS.indexOf(status) >= 0) {
      return { ok: false, error: 'locked_status',
        message: 'このお申し込みは、すでに審査の結果が確定しているため、'
               + 'この画面からの修正は承っておりません。担当までご連絡ください。' };
    }

    // 応募フォームにある項目だけを受け取る。
    // 担当社員は営業側の記録なので、応募者には変えさせない。
    var next = {};
    Object.keys(current).forEach(function (k) { next[k] = current[k]; });
    applyFields().forEach(function (f) {
      if (f.key === 'fcosakaStaff') return;
      if (incoming[f.key] !== undefined) next[f.key] = incoming[f.key];
      if (f.unknownCheckbox && incoming[f.unknownCheckbox.key] !== undefined) {
        next[f.unknownCheckbox.key] = incoming[f.unknownCheckbox.key];
      }
    });
    if (incoming.rentalItems !== undefined) next.rentalItems = incoming.rentalItems;

    // 応募時とまったく同じ検証を通す。
    // ここを緩めると「応募では通らない内容が、修正なら通る」状態ができる。
    var errors = validate_(next);
    if (errors.length) return { ok: false, error: 'validation', fields: errors };

    // 何が変わったかを、書き込む前に確定させる
    var changes = selfDiff_(current, next);
    if (!changes.length) {
      return { ok: true, receiptId: receiptId, changed: [], message: '変更はありませんでした。' };
    }

    // 台帳の該当列だけを書き換える。管理側の列（ステータス・担当メモなど）は触らない
    var rental = rentalSummary_(next);
    var byLabel = {};
    applyFields().forEach(function (f) {
      if (!f.sheet) return;
      byLabel[f.sheet] = f;
      if (f.unknownCheckbox) {
        byLabel[f.unknownCheckbox.sheet] = { key: f.unknownCheckbox.key, type: 'consent' };
      }
    });

    L.headers.forEach(function (h, col) {
      if (h === COL.raw) {
        L.sheet.getRange(rowNo, col + 1).setValue(rawJson_(next));
        return;
      }
      if (h === 'レンタル明細')     { L.sheet.getRange(rowNo, col + 1).setValue(rental.detail); return; }
      if (h === 'レンタル合計(円)') { L.sheet.getRange(rowNo, col + 1).setValue(rental.total); return; }
      if (h === '主形態') { L.sheet.getRange(rowNo, col + 1).setValue(safeCell_(primaryType_(next.boothTypes))); return; }
      var f = byLabel[h];
      if (!f) return;                       // 管理側の列。触らない
      L.sheet.getRange(rowNo, col + 1).setValue(formatCell_(f, next[f.key]));
    });

    // 変更前と変更後の両方を残す。上書きで消えた情報を後から辿れるように
    changes.forEach(function (c) {
      appendHistory('出店者（本人）', receiptId, c.label, c.before, c.after, '応募者による修正');
    });
    SpreadsheetApp.flush();

    var mailWarning = '';
    try { selfNotify_(next, receiptId, changes); }
    catch (e) { logError_('selfNotify_', e); mailWarning = 'notify'; }

    return { ok: true, receiptId: receiptId,
             changed: changes.map(function (c) { return c.label; }),
             mailWarning: mailWarning };
  } finally {
    lock.releaseLock();
  }
}

/** 変わった項目だけを「変更前 → 変更後」で並べる */
function selfDiff_(before, after) {
  var out = [];
  var asText = function (f, v) {
    if (f.key === 'rentalItems') {
      var names = Object.keys(v || {});
      if (!names.length) return '（ご利用なし）';
      return names.map(function (n) { return n + ' × ' + v[n]; }).join(' ／ ');
    }
    if (v === undefined || v === null || v === '') return '（未記入）';
    if (Array.isArray(v)) return v.join('、');
    if (typeof v === 'boolean') return v ? 'はい' : 'いいえ';
    return String(v);
  };

  applyFields().forEach(function (f) {
    if (f.key === 'fcosakaStaff') return;
    var a = asText(f, before[f.key]);
    var b = asText(f, after[f.key]);
    if (a !== b) out.push({ key: f.key, label: f.label, before: a, after: b });
    if (f.unknownCheckbox) {
      var ua = before[f.unknownCheckbox.key] ? 'はい' : 'いいえ';
      var ub = after[f.unknownCheckbox.key] ? 'はい' : 'いいえ';
      if (ua !== ub) {
        out.push({ key: f.unknownCheckbox.key, label: f.unknownCheckbox.label || f.label + '（不明）',
                   before: ua, after: ub });
      }
    }
  });

  var ra = asText({ key: 'rentalItems' }, before.rentalItems);
  var rb = asText({ key: 'rentalItems' }, after.rentalItems);
  if (ra !== rb) out.push({ key: 'rentalItems', label: 'レンタル備品', before: ra, after: rb });

  return out;
}

/**
 * 担当社員と、通知ONの管理者に知らせる。
 * 全文ではなく**変わった項目だけ**を送る。全文だと、どこが変わったのか読み取れない。
 */
function selfNotify_(values, receiptId, changes) {
  var recipients = getNotifyRecipients(values.fcosakaStaff).filter(function (a) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
  });
  if (!recipients.length) {
    alertOperator_('staffUnknown', receiptId, '応募内容の修正がありました。');
    return;
  }

  var subject = '【修正】' + receiptId + ' ' + (values.companyName || '')
              + '（' + changes.length + '件の変更）';
  var body = [
    '出店者ご本人により、応募内容が修正されました。',
    '',
    '受付ID　：' + receiptId,
    '企業名　：' + (values.companyName || ''),
    '担当社員：' + (values.fcosakaStaff || ''),
    '修正日時：' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
    '',
    '── 変更された項目 ──',
  ];
  changes.forEach(function (c) {
    body.push('');
    body.push('【' + c.label + '】');
    body.push('  変更前：' + c.before);
    body.push('  変更後：' + c.after);
  });
  body.push('');
  body.push('※ 変更前の内容は「変更履歴」シートにも残っています。');
  var adminUrl = configText('管理ページURL', '');
  if (adminUrl) { body.push(''); body.push('管理ページ：' + adminUrl); }
  body.push(signature_());

  MailApp.sendEmail(Object.assign({
    to: recipients.join(','),
    subject: subject,
    body: body.join('\n'),
  }, mailOptions_()));
}
