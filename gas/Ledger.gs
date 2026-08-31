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

    // 列がスキーマと食い違ったまま書くと、値が黙って捨てられる。書く前に必ず検査する。
    assertHeaders_(headers);

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

/**
 * シートの列見出しがスキーマ定義と一致しているかを検査する。
 *
 * buildRow_ は「シートのヘッダー」を正として値を並べるため、
 * 運用者が列名を編集した／列を消した／schema.js に項目を足して setup() を再実行していない、
 * のいずれでも該当項目が黙って空欄になる。応募者には受付完了メールが届くため誰も気づかない。
 * それを防ぐため、書き込み前にここで止める。
 */
function assertHeaders_(headers) {
  var missing = [];
  FIELDS.forEach(function (f) {
    if (f.sheet && headers.indexOf(f.sheet) === -1) missing.push(f.sheet);
    if (f.unknownCheckbox && headers.indexOf(f.unknownCheckbox.sheet) === -1) {
      missing.push(f.unknownCheckbox.sheet);
    }
  });
  ADMIN_COLUMNS.forEach(function (c) {
    if (headers.indexOf(c) === -1) missing.push(c);
  });
  if (missing.length) {
    throw new Error('応募一覧の列が定義と一致していません（不足：' + missing.join('、') + '）。'
      + 'setup() を実行して列を作り直してください。');
  }
}

/**
 * 台帳に書けなかった応募を退避する。
 * ハニーポット検知・列不整合・ロック取得失敗など、どんな理由であれ
 * 「応募者が送信したのにどこにも残らない」状態を作らないための最後の受け皿。
 */
function quarantine_(values, reason) {
  try {
    var ss = ss_();
    var sh = ss.getSheetByName(SHEET.QUARANTINE);
    if (!sh) {
      sh = ss.insertSheet(SHEET.QUARANTINE);
      sh.getRange(1, 1, 1, 4).setValues([['日時', '理由', '企業名', '応募内容(JSON)']]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#231816').setFontColor('#FFFFFF');
    }
    sh.appendRow([new Date(), reason, safeCell_(values && values.companyName),
                  JSON.stringify(values).slice(0, 40000)]);
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    console.error('[quarantine_] 退避にも失敗: ' + e);
    return false;
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

  var colEmail = headers.indexOf('担当者メール') + 1;
  var colName  = headers.indexOf('企業名') + 1;
  var colId    = headers.indexOf('受付ID') + 1;
  if (!colEmail || !colName || !colId) return '';

  // ロックを握っている間の読み取りは必要な3列だけにする。
  // 全46列を読むと応募が増えるほどロック保持時間が延び、同時応募のタイムアウトを招く。
  var n = last - 1;
  var ids    = sh.getRange(2, colId, n, 1).getValues();
  var emails = sh.getRange(2, colEmail, n, 1).getValues();
  var names  = sh.getRange(2, colName, n, 1).getValues();

  var email = String(values.contactEmail || '').trim().toLowerCase();
  var company = String(values.companyName || '').trim();
  var hitsByName = [], hitsByMail = [];

  for (var i = 0; i < n; i++) {
    var e = String(emails[i][0] || '').trim().toLowerCase();
    var c = String(names[i][0] || '').trim();
    var id = String(ids[i][0] || '');
    if (company && c === company) hitsByName.push(id);
    else if (email && e === email) hitsByMail.push(id);
  }

  var all = hitsByName.concat(hitsByMail);
  if (!all.length) return '';

  // 「複数ブースはブースごとに応募」が正規の運用なので、事故ではなく事実として書く。
  // 判定根拠（企業名一致かメール一致か）と先行の受付IDを必ず添える。
  var reason = hitsByName.length ? '企業名が一致' : 'メールアドレスが一致';
  return '他に' + all.length + '件（' + reason + '／先行：' + all.join('、') + '）';
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
      // 列構成が万一ずれても、ここから応募内容を完全に復元できる
      case '生データ(JSON)': return JSON.stringify(values).slice(0, 40000);
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
  if (Array.isArray(v)) return safeCell_(v.join('、'));
  if (typeof v === 'boolean') return v ? '○' : '';
  if (field.type === 'radio' && Array.isArray(field.options) && field.options.length
      && typeof field.options[0] === 'object') {
    // boothSize のように value/label を持つ選択肢は、台帳には人が読めるラベルで残す
    for (var i = 0; i < field.options.length; i++) {
      if (field.options[i].value === v) return field.options[i].label;
    }
  }
  return safeCell_(v);
}

/**
 * スプレッドシートに数式として解釈される先頭文字を無害化する。
 * 企業名が「=BAR商店」のような場合、そのまま入れると #NAME? になり
 * 元のテキストが台帳から失われる（受付確認メールには正しく載るため誰も気づかない）。
 */
function safeCell_(v) {
  if (v === undefined || v === null) return '';
  var s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
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
