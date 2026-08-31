/**
 * 台帳の初期構築。スプレッドシートに5シートを作る。
 *
 * 何度実行しても壊れないように書いてある（冪等）。
 * 既にデータが入っている応募一覧の中身は消さない。
 */

function setup() {
  var ss = ss_();
  // 台帳のタイムゾーンを日本時間に固定する。ここがずれていると、受付日時も締切も
  // すべて時差の分だけ狂う（しかも画面上は正しく見えるので気づけない）。
  if (ss.getSpreadsheetTimeZone() !== 'Asia/Tokyo') ss.setSpreadsheetTimeZone('Asia/Tokyo');
  setupConfigSheet_(ss);
  setupPeopleSheet_(ss);
  setupLedgerSheet_(ss);
  setupHistorySheet_(ss);
  setupSpacesSheet_(ss);
  removeDefaultSheet_(ss);
  SpreadsheetApp.flush();
  return '台帳の構築が完了しました：' + [SHEET.LEDGER, SHEET.HISTORY, SHEET.SPACES, SHEET.CONFIG, SHEET.PEOPLE].join(' / ');
}

function getOrCreate_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** 「シート1」など初期シートが空のまま残っていれば消す */
function removeDefaultSheet_(ss) {
  var names = [SHEET.LEDGER, SHEET.HISTORY, SHEET.SPACES, SHEET.CONFIG, SHEET.PEOPLE];
  ss.getSheets().forEach(function (s) {
    if (names.indexOf(s.getName()) !== -1) return;
    if (s.getLastRow() === 0 && s.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(s);
    }
  });
}

function styleHeader_(sheet, cols) {
  var r = sheet.getRange(1, 1, 1, cols);
  r.setFontWeight('bold')
   .setBackground('#231816')
   .setFontColor('#FFFFFF')
   .setVerticalAlignment('middle')
   .setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 34);
}

// ───────────────────────────────── 設定
function setupConfigSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.CONFIG);
  var head = ['項目', '値', '説明'];

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 3).setValues([head]);
  }
  // 既存の値は保持し、足りないキーだけ追記する
  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r, i) { existing[String(r[0]).trim()] = i + 2; });
  }
  var toAppend = CONFIG_DEFAULTS.filter(function (d) { return !existing[d[0]]; });
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, 3).setValues(toAppend);
  }

  // 「値」列は必ず文字列として扱う。
  // Sheetsは「2026-09-30 18:00」を日時型に自動変換し、そのときシートのタイムゾーンで
  // 絶対時刻に固定してしまう。シートのTZが日本時間でないと、入力した見た目の時刻と
  // 実際の値がずれる（画面上は正しく見えるので気づけない）。文字列に固定して防ぐ。
  sh.getRange(2, 2, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');

  // 既に日時型で入ってしまっている締切を、文字列に直す
  var dRow = findConfigRow_(sh, '締切日時');
  if (dRow) {
    var cur = sh.getRange(dRow, 2).getValue();
    if (cur instanceof Date) {
      var fixed = CONFIG_DEFAULTS.filter(function (d) { return d[0] === '締切日時'; })[0][1];
      sh.getRange(dRow, 2).setNumberFormat('@').setValue(fixed);
      console.log('締切日時が日時型で保存されていたため、文字列 ' + fixed + ' に直しました。');
    }
  }

  // 旧い既定値のまま残っている項目を、新しい既定値へ移行する。
  // 運用者が意図して変えた値は上書きしない（旧既定値と一致するときだけ書き換える）。
  var MIGRATIONS = [
    ['送信元表示名', 'サステナ盆踊り実行委員会', 'FC大阪サステナ盆踊り実行委員会'],
  ];
  MIGRATIONS.forEach(function (mg) {
    var row = findConfigRow_(sh, mg[0]);
    if (row && String(sh.getRange(row, 2).getValue()).trim() === mg[1]) {
      sh.getRange(row, 2).setValue(mg[2]);
      console.log('設定「' + mg[0] + '」を ' + mg[2] + ' に更新しました。');
    }
  });

  styleHeader_(sh, 3);
  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 520);
  sh.getRange(2, 3, Math.max(sh.getLastRow() - 1, 1), 1).setFontColor('#777777').setWrap(true);

  // パスワード欄は見えにくくしておく（肩越しに覗かれる事故を減らす程度の意味）
  ['管理者パスワード', '一般パスワード'].forEach(function (k) {
    var row = findConfigRow_(sh, k);
    if (row) sh.getRange(row, 2).setFontColor('#CCCCCC').setNote('管理ページの入室に使います。メール本文で配らないでください。');
  });
  return sh;
}

function findConfigRow_(sh, key) {
  if (sh.getLastRow() < 2) return 0;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) return i + 2;
  }
  return 0;
}

// ───────────────────────────────── 関係者
function setupPeopleSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.PEOPLE);
  var head = ['氏名', '所属', '部署', 'メール', 'フォーム表示', '管理ページ利用', '役割', '通知'];

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]);
  }
  styleHeader_(sh, head.length);

  var n = Math.max(sh.getMaxRows() - 1, 1);
  setDropdown_(sh, 2, 2, n, ['FC大阪', 'UPDATER', 'LOP', 'その他']);
  setDropdown_(sh, 5, 2, n, ['有効', '無効']);
  setDropdown_(sh, 6, 2, n, ['有', '無']);
  setDropdown_(sh, 7, 2, n, ['管理者', '一般']);
  setDropdown_(sh, 8, 2, n, ['ON', 'OFF']);

  [140, 100, 160, 240, 110, 130, 90, 80].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 1, 1, head.length).setNote('');
  sh.getRange('E1').setNote('有効にすると応募フォームの「FC大阪の担当社員」プルダウンに表示されます。');
  sh.getRange('G1').setNote('管理者：メール送信・設定変更・関係者編集ができます。一般：閲覧と自分の担当分の更新のみ。');
  return sh;
}

function setDropdown_(sh, col, startRow, numRows, values) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true).setAllowInvalid(false).build();
  sh.getRange(startRow, col, numRows, 1).setDataValidation(rule);
}

// ───────────────────────────────── 応募一覧
function setupLedgerSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.LEDGER);
  var headers = ledgerHeaders();

  var current = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String)
    : [];

  if (current.join('\t') !== headers.join('\t')) {
    if (sh.getLastRow() > 1) {
      // 既にデータがある状態で列構成が変わるのは危険。止めて人に判断させる。
      throw new Error(
        '応募一覧の列構成が定義と異なりますが、既にデータが入っています。\n' +
        '列を移行してよいか確認が必要です。手動でバックアップを取ってから対応してください。\n' +
        '（現在 ' + current.length + ' 列 / 定義 ' + headers.length + ' 列）'
      );
    }
    sh.clear();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  styleHeader_(sh, headers.length);
  sh.setFrozenColumns(3); // 受付ID・受付日時・企業名 を固定

  var n = Math.max(sh.getMaxRows() - 1, 1);
  var colStatus = headers.indexOf('ステータス') + 1;
  var colDay    = headers.indexOf('当日ステータス') + 1;
  if (colStatus) setDropdown_(sh, colStatus, 2, n, STATUS);
  if (colDay)    setDropdown_(sh, colDay, 2, n, DAY_STATUS);

  applyStatusColors_(sh, colStatus, headers.length);

  // 幅の初期値。長文列は広めに。
  headers.forEach(function (h, i) {
    var w = 130;
    if (h === '出店内容' || h === 'サステナ取り組み' || h === '備考' || h === '担当メモ') w = 300;
    if (h === '受付ID') w = 90;
    if (h === '企業名' || h === '出店名') w = 200;
    if (h === '担当者メール' || h === 'HP・SNS' || h === '素材提出フォルダURL') w = 220;
    sh.setColumnWidth(i + 1, w);
  });
  return sh;
}

/** ステータスに応じて行の背景色を変える（仕様書§5） */
function applyStatusColors_(sh, colStatus, numCols) {
  if (!colStatus) return;
  var a1col = columnLetter_(colStatus);
  var range = sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), numCols);
  var colors = {
    '未確認':      '#FFF7E6',
    '審査中':      '#EAF6FD',
    '採択':        '#E9F7EC',
    '不採択':      '#F3F3F3',
    '辞退':        '#F3F3F3',
    'キャンセル':  '#F3F3F3',
    '重複（無効）': '#FBE9E7',
  };
  var rules = Object.keys(colors).map(function (st) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + a1col + '2="' + st + '"')
      .setBackground(colors[st])
      .setRanges([range]).build();
  });
  sh.setConditionalFormatRules(rules);
}

function columnLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

// ───────────────────────────────── 変更履歴
function setupHistorySheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.HISTORY);
  var head = ['日時', '操作者', '受付ID', '項目', '変更前', '変更後', '理由メモ'];
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, head.length).setValues([head]);
  styleHeader_(sh, head.length);
  [150, 120, 90, 160, 240, 240, 300].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

// ───────────────────────────────── 区画
function setupSpacesSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.SPACES);
  var head = ['区画番号', 'X', 'Y', '割当受付ID', '備考'];
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, head.length).setValues([head]);
  styleHeader_(sh, head.length);

  var total = configNumber('区画総数') || 50;
  var existing = sh.getLastRow() - 1;
  if (existing < total) {
    // 環状（円形一列）に配置した初期座標。図面到着後はこのXYを書き換えるだけで
    // マップの描画が変わる（コードは触らない）。
    var rows = [];
    for (var i = existing + 1; i <= total; i++) {
      var t = (i - 1) / total * Math.PI * 2 - Math.PI / 2;
      rows.push([i, Math.round(Math.cos(t) * 1000) / 1000, Math.round(Math.sin(t) * 1000) / 1000, '', '']);
    }
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
  }
  sh.getRange('B1').setNote('マップ描画用の座標（単位円上の値）。会場図面が届いたらここを実測値に置き換えます。');
  return sh;
}
