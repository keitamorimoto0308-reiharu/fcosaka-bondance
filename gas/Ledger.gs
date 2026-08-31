/**
 * 応募の記録。
 *
 * 最重要要件は「応募が届かない事故をゼロにする」こと（仕様書§0）。
 * そのため、この層では次の3点を守る：
 *   1. 受付IDの採番と行追記を排他ロックで直列化する（同時応募でIDが重複しない）
 *   2. 同じ送信を2回受けても2行にしない（二重クリック・再送の冪等化）
 *   3. 台帳への書き込みが失敗したらメールを送らない（届いた体で確認メールを出さない）
 */

var LOCK_WAIT_MS = 30000;
var DEDUPE_TTL_SEC = 600; // 10分

/**
 * 応募を1行追記して、受付IDと素材トークンを返す。
 * @param {Object} values - スキーマのキーで揃えた応募内容
 * @param {string} submissionId - クライアントが発行した送信ID（冪等化に使う）
 */
function appendApplication(values, submissionId) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'sub_' + submissionId;

  // 二重送信：直前に同じ送信IDを処理していれば、同じ結果を返して終わる
  if (submissionId) {
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('混み合っています。少し時間をおいて、もう一度お試しください。');
  }

  try {
    // ロック取得後にもう一度確認する（待っている間に先行処理が完了している場合がある）
    if (submissionId) {
      var hit2 = cache.get(cacheKey);
      if (hit2) return JSON.parse(hit2);
    }

    var sh = sheet_(SHEET.LEDGER);
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

    var receiptId = nextReceiptId_(sh, headers);
    var token = Utilities.getUuid().replace(/-/g, '');
    var now = new Date();

    var duplicateFlag = detectDuplicate_(sh, headers, values);
    var row = buildRow_(headers, values, {
      receiptId: receiptId,
      receivedAt: now,
      token: token,
      duplicateFlag: duplicateFlag,
    });

    sh.appendRow(row);
    SpreadsheetApp.flush(); // ここで確実に書き切ってからメールに進む

    var result = {
      receiptId: receiptId,
      token: token,
      receivedAt: now.toISOString(),
      duplicateFlag: duplicateFlag,
    };
    if (submissionId) cache.put(cacheKey, JSON.stringify(result), DEDUPE_TTL_SEC);
    return result;

  } finally {
    lock.releaseLock();
  }
}

/** SB-0001 形式の連番。既存の最大値＋1 を採る（行削除があっても番号は戻らない）。 */
function nextReceiptId_(sh, headers) {
  var col = headers.indexOf('受付ID') + 1;
  if (col === 0) throw new Error('応募一覧に「受付ID」列がありません。setup() を実行してください。');
  var last = sh.getLastRow();
  if (last < 2) return 'SB-0001';

  var ids = sh.getRange(2, col, last - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < ids.length; i++) {
    var m = String(ids[i][0]).match(/^SB-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'SB-' + ('0000' + (max + 1)).slice(-4);
}

/**
 * 同一メールまたは同一企業名の既存応募を探す。
 * 「複数ブースはブースごとに応募」が正規の運用なので、これは誤りの断定ではなく
 * 「同一企業から◯件目」という中立な情報として扱う（管理ページのバッジ表記も同じ）。
 */
function detectDuplicate_(sh, headers, values) {
  var last = sh.getLastRow();
  if (last < 2) return '';

  var colEmail = headers.indexOf('担当者メール');
  var colName  = headers.indexOf('企業名');
  if (colEmail < 0 || colName < 0) return '';

  var data = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var email = String(values.contactEmail || '').trim().toLowerCase();
  var company = String(values.companyName || '').trim();
  var count = 0;

  for (var i = 0; i < data.length; i++) {
    var e = String(data[i][colEmail] || '').trim().toLowerCase();
    var c = String(data[i][colName] || '').trim();
    if ((email && e === email) || (company && c === company)) count++;
  }
  return count > 0 ? ('同一企業から' + (count + 1) + '件目') : '';
}

/** ヘッダーの並びに合わせて1行分の配列を組み立てる。列順はヘッダーが正。 */
function buildRow_(headers, values, meta) {
  var byLabel = {};
  FIELDS.forEach(function (f) {
    if (!f.sheet) return;
    byLabel[f.sheet] = f;
    if (f.unknownCheckbox) byLabel[f.unknownCheckbox.sheet] = { key: f.unknownCheckbox.key, type: 'consent' };
  });

  return headers.map(function (h) {
    switch (h) {
      case '受付ID':       return meta.receiptId;
      case '受付日時':     return meta.receivedAt;
      case 'ステータス':   return '未確認';
      case '当日ステータス': return '未着';
      case '素材トークン': return meta.token;
      case '重複フラグ':   return meta.duplicateFlag;
      case '主形態':       return primaryType_(values.boothTypes);
    }
    var f = byLabel[h];
    if (!f) return ''; // 管理側の空欄（担当メモ・搬入予定時刻など）
    return formatCell_(f, values[f.key]);
  });
}

/** 複数選択された出店形態のうち、色分けに使う主形態（初期値は最初に選んだもの） */
function primaryType_(boothTypes) {
  return (Array.isArray(boothTypes) && boothTypes.length) ? boothTypes[0] : '';
}

function formatCell_(field, v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'boolean') return v ? '○' : '';
  if (field.type === 'radio' && Array.isArray(field.options) && field.options.length
      && typeof field.options[0] === 'object') {
    // boothSize のように value/label を持つ選択肢は、台帳には人が読めるラベルで残す
    for (var i = 0; i < field.options.length; i++) {
      if (field.options[i].value === v) return field.options[i].label;
    }
  }
  return v;
}

/** 変更履歴に1行残す。管理ページの操作はすべてここを通す。 */
function appendHistory(operator, receiptId, item, before, after, reason) {
  sheet_(SHEET.HISTORY).appendRow([
    new Date(), operator || '', receiptId || '', item || '',
    before === undefined ? '' : before,
    after === undefined ? '' : after,
    reason || '',
  ]);
}
