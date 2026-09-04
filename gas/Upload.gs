/**
 * 素材アップロード（仕様書 §6-3）。採択された事業者が、告知用の素材を提出する。
 *
 * 入口は採択通知メールのリンクだけ。鍵は確定情報フォームと同じ
 * （同じメールに両方のリンクが載るので、分けても守りは増えない）。
 *
 * ■ 一番効く歯止めは「送る前に断る」
 *   GASのウェブアプリはPOSTの本文に上限があり、base64は約1.33倍に膨らむ。
 *   超えると**送信を押しても無反応**という形で失敗する。
 *   画面側で大きさを測って断り、ここでも同じ値で二重に止める。
 *
 * ■ 1件ずつ受け取る
 *   複数まとめて送ると、1つ大きいものが混ざっただけで全部落ちる。
 *   画面が1件ずつ送り、1件ずつ結果を返す。
 *   途中で失敗しても、そこまでの提出は残る。
 *
 * ■ 消す操作は用意しない
 *   事業者が自分で消せると、間違えて消したときに復旧できない。
 *   同じ名前で出し直せば新しい版が並ぶので、実務はそれで足りる。
 *   本当に消す必要があるときは、管理ページ（管理者のみ）から行う。
 */

function uploadDispatch_(payload) {
  var action = payload && payload.action;
  if (action === 'uploadInfo') return uploadInfo_(payload);
  if (action === 'uploadFile') return uploadFile_(payload);
  return { ok: false, error: 'unknown_action' };
}

/** 確定情報フォームと同じ入口の作り。どの失敗でも同じ文言を返す */
function uploadDenied_() {
  return { ok: false, error: 'denied',
    message: 'このリンクは有効ではありません。'
           + '採択通知メールに記載のリンクを、そのままお開きください。' };
}

/**
 * 鍵とステータスを確かめ、提出済みの一覧を返す。
 * ここでフォルダを作る（開いた時点で作っておけば、
 * 1件目のアップロードだけ遅い、という見え方にならない）。
 */
function uploadInfo_(payload) {
  var receiptId = String((payload && payload.id) || '').trim().toUpperCase();
  var token = String((payload && payload.t) || '').trim();

  var hit = findAcceptedRow_(receiptId, token);
  if (!hit) { confirmNoteFailure_(); return uploadDenied_(); }
  if (hit.status !== '採択') {
    return { ok: false, error: 'not_accepted',
      message: 'ただいま選考中です。出店決定のご連絡後にご提出いただけます。' };
  }

  var base = confirmBaseValues_(hit.raw);
  var files = [];
  var used = 0;
  try {
    // フォルダ作りは排他の中で行う。二人が同時に開くと、
    // 同じ名前の SB-0001 が2つできて、件数の数え方も一覧も割れる。
    var lock = LockService.getScriptLock();
    var folder;
    if (lock.tryLock(LOCK_WAIT_MS)) {
      try { folder = vendorFolder_(receiptId); } finally { lock.releaseLock(); }
    } else {
      folder = vendorFolder_(receiptId);     // 取れなくても表示だけはさせる
    }
    var it = folder.getFiles();
    while (it.hasNext()) {
      var o = fileToObject_(it.next());
      used += Number(o.size) || 0;
      files.push(o);
    }
    files.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
  } catch (e) {
    logError_('uploadInfo_:Drive', e);
    return { ok: false, error: 'server_error',
      message: '提出先の準備ができていません。お手数ですが担当までご連絡ください。' };
  }

  return {
    ok: true,
    receiptId: receiptId,
    company: base.companyName,
    boothName: base.boothName,
    files: files,
    maxBytes: UPLOAD_MAX_BYTES,
    maxFiles: UPLOAD_MAX_FILES,
    maxSizeText: humanSize_(UPLOAD_MAX_BYTES),
    deadline: materialDeadlineText_(),
    maxTotalBytes: UPLOAD_MAX_TOTAL_BYTES,
    maxTotalText: humanSize_(UPLOAD_MAX_TOTAL_BYTES),
    usedBytes: used,
    usedText: humanSize_(used),
    allowed: Object.keys(UPLOAD_ALLOWED),
  };
}

/** 1件だけ受け取る */
function uploadFile_(payload) {
  var receiptId = String((payload && payload.id) || '').trim().toUpperCase();
  var token = String((payload && payload.t) || '').trim();

  var hit = findAcceptedRow_(receiptId, token);
  if (!hit) { confirmNoteFailure_(); return uploadDenied_(); }
  if (hit.status !== '採択') {
    return { ok: false, error: 'not_accepted',
      message: 'ただいま選考中です。出店決定のご連絡後にご提出いただけます。' };
  }

  var name = String((payload && payload.name) || '');
  var mime = String((payload && payload.mime) || '');
  var data = String((payload && payload.data) || '');

  if (!data) return { ok: false, error: 'empty', message: 'ファイルを読み取れませんでした。' };

  // 種類は allowedExt_ で見る。UPLOAD_ALLOWED[mime] を直に書くと、
  // 種別に `constructor` と入れられただけで真になって素通りする
  var ext = allowedExt_(mime);
  if (!ext) {
    return { ok: false, error: 'type',
      message: 'この種類のファイルはお預かりできません。'
             + '画像（JPEG・PNG・GIF・WebP・SVG）、PDF、Word、PowerPoint、'
             + 'Illustrator、ZIP をご利用ください。' };
  }

  // base64 の長さから、元の大きさを見積もって先に止める。
  // 復号してから測ると、上限を超えたものを一度メモリに展開することになる。
  //
  // 末尾の `=` は元のバイトに含まれないので、そのぶん多めに出る。
  // ちょうど上限のファイルを、画面は通してここで断る、をなくすため 3 の余裕を見る
  // （実測：10,485,760 バイトが 10,485,762 と見積もられていた）。
  var approx = Math.floor(data.length * 3 / 4);
  if (approx > UPLOAD_MAX_BYTES + 3) {
    return { ok: false, error: 'too_large',
      message: 'ファイルが大きすぎます（1つあたり ' + humanSize_(UPLOAD_MAX_BYTES) + ' まで）。' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };

  try {
    var folder = vendorFolder_(receiptId);

    // 数と合計の上限。鍵を持つ相手がDriveを埋めるのを防ぐ。
    // Driveが埋まるとSheetsへの書き込みも止まり、応募受付ごと落ちる
    var count = 0;
    var used = 0;
    var it = folder.getFiles();
    while (it.hasNext()) { used += Number(it.next().getSize()) || 0; count++; }
    if (count >= UPLOAD_MAX_FILES) {
      return { ok: false, error: 'too_many',
        message: 'ご提出は' + UPLOAD_MAX_FILES + '件までです。'
               + '差し替えが必要な場合は、担当までご連絡ください。' };
    }
    if (used + approx > UPLOAD_MAX_TOTAL_BYTES) {
      return { ok: false, error: 'too_much',
        message: 'ご提出の合計が' + humanSize_(UPLOAD_MAX_TOTAL_BYTES) + 'を超えます'
               + '（現在 ' + humanSize_(used) + '）。'
               + '大きいものは、担当までご相談ください。' };
    }

    var bytes;
    try { bytes = Utilities.base64Decode(data); }
    catch (e) { return { ok: false, error: 'empty', message: 'ファイルを読み取れませんでした。' }; }
    if (bytes.length > UPLOAD_MAX_BYTES) {
      return { ok: false, error: 'too_large',
        message: 'ファイルが大きすぎます（1つあたり ' + humanSize_(UPLOAD_MAX_BYTES) + ' まで）。' };
    }

    // 拡張子はこちらで付け直す。名前を無検査で使うと、
    // `invoice.pdf.html` を image/png と申告して置ける
    var fileName = safeFileName_(name, ext);
    var blob = Utilities.newBlob(bytes, mime, fileName);
    var file = folder.createFile(blob);

    appendHistory('出店者（本人）', receiptId, '素材提出', '', fileName, '素材アップロード');
    SpreadsheetApp.flush();

    var mailWarning = '';
    try { uploadNotify_(receiptId, confirmBaseValues_(hit.raw), fileName, folder.getUrl()); }
    catch (e) {
      logError_('uploadNotify_', e);
      mailWarning = 'notify';
      alertOperator_('noticeMailFailed', receiptId,
        '素材の提出がありました。Driveの「出店者提出物」をご確認ください。');
    }

    return { ok: true, file: fileToObject_(file), mailWarning: mailWarning };
  } catch (e) {
    logError_('uploadFile_:' + receiptId, e);
    return { ok: false, error: 'server_error',
      message: '保存できませんでした。お手数ですが、もう一度お試しください。' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 担当社員と通知ONの管理者に知らせる。
 *
 * 1ファイルごとに送ると、50社×数枚で通知が埋まる。
 * **同じ会社からの提出は、1時間に1回だけ**知らせる（まとめて見に行けば足りる）。
 */
function uploadNotify_(receiptId, base, fileName, folderUrl) {
  var key = 'up_note_' + receiptId;
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(key)) return;
    cache.put(key, '1', 3600);
  } catch (e) {}

  var recipients = getNotifyRecipients(base.fcosakaStaff).filter(function (a) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
  });
  if (!recipients.length) {
    alertOperator_('staffUnknown', receiptId, '素材の提出がありました。');
    return;
  }

  MailApp.sendEmail(Object.assign({
    to: recipients.join(','),
    subject: '【素材提出】' + receiptId + ' ' + (base.companyName || ''),
    body: [
      (base.companyName || '') + ' さまから、告知用の素材が提出されました。',
      '',
      '受付ID　：' + receiptId,
      '直近の1件：' + fileName,
      '提出日時：' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
      '',
      'Drive：' + folderUrl,
      '',
      '※ 同じ会社からの提出が続く場合、この通知は1時間に1回にまとめています。',
      '　 実際のファイルは、上のフォルダをご確認ください。',
      signature_(),
    ].join('\n'),
  }, mailOptions_()));
}
