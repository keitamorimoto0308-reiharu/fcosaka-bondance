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
  ensureFcosakaStaff_(ss);   // FC大阪の担当社員（2026-09-02 小谷様のご指定）
  setupRentalSheet_(ss);
  setupTodoSheet_(ss);
  setupLedgerSheet_(ss);
  setupConfirmSheet_(ss);
  setupHistorySheet_(ss);
  setupSpacesSheet_(ss);
  setupMailTemplateSheet_(ss);
  setupSchedSheet_(ss);   // 制作スケジュール（確認事項の移行を含む）
  setupTimetableSheet_(ss);   // タイムスケジュール（当日の時間割）
  ensureDocsFolders_();       // 資料フォルダの区分と、提出物フォルダ（社外秘）
  cleanupOldPriceRows_(ss);   // 単価を移したあとに、設定シートの古い行を片づける
  removeDefaultSheet_(ss);
  SpreadsheetApp.flush();

  /*
   * 結果は**ログにも出す**。
   *
   * Apps Script の実行ログに出るのは Logger.log / console.log だけで、
   * **戻り値は誰の目にも触れない**。
   * 2026-09-04、けいたが setup() を実行したのに「完了しました」が出ないため、
   * 成功したのか分からなくなった（実際は成功していた）。
   * 「黙って正常」を作らない、と自分で書いておきながら破っていた箇所。
   */
  var msg = '台帳の構築が完了しました：'
       + [SHEET.LEDGER, SHEET.CONFIRM, SHEET.HISTORY, SHEET.SPACES, SHEET.CONFIG,
          SHEET.PEOPLE, SHEET.RENTAL, SHEET.SCHED, SHEET.TIMETABLE,
          SHEET.MAILTPL].join(' / ');
  console.log(msg);
  return msg;
}

/**
 * 採択・不採択のメール文面。管理ページから直せる（けいた指示・2026-09-03）。
 *
 * **中身は入れない。** 空の行のままなら、コードが持つ既定の文面が使われる。
 * ここに既定を書き込むと、あとで既定を直したときに
 * 「コードは直したのにシートが古いまま」という二重管理になる。
 */
function setupMailTemplateSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.MAILTPL);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, MAILTPL_HEAD.length).setValues([MAILTPL_HEAD]);
  }
  styleHeader_(sh, MAILTPL_HEAD.length);
  sh.setColumnWidth(1, 80);    // 種類
  sh.setColumnWidth(2, 320);   // 件名
  sh.setColumnWidth(3, 640);   // 本文
  sh.setColumnWidth(4, 130);   // 更新日時
  sh.setColumnWidth(5, 120);   // 更新者
  // 本文は長い。折り返さないと、シートを開いた人が中身を確かめられない
  try { sh.getRange(2, 3, Math.max(sh.getMaxRows() - 1, 1), 1).setWrap(true); } catch (e) {}
  return sh;
}

function getOrCreate_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** 「シート1」など初期シートが空のまま残っていれば消す */
function removeDefaultSheet_(ss) {
  var names = [SHEET.LEDGER, SHEET.CONFIRM, SHEET.HISTORY, SHEET.SPACES,
               SHEET.CONFIG, SHEET.PEOPLE];
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
  // 空欄のままの項目に既定値を入れる（運用者が入力した値は触らない）
  ['単価_テント_小', '単価_テント_大', '単価_長机', '単価_パイプ椅子'].forEach(function (key) {
    var row = findConfigRow_(sh, key);
    if (!row) return;
    if (String(sh.getRange(row, 2).getValue()).trim() !== '') return;
    var def = CONFIG_DEFAULTS.filter(function (d) { return d[0] === key; })[0];
    if (def) { sh.getRange(row, 2).setValue(def[1]); console.log('設定「' + key + '」に ' + def[1] + ' を入れました。'); }
  });
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
/**
 * 応募一覧に、足りない列だけを差し込む。データは動かさない。
 *
 * ■ なぜ要るか
 *   それまでは、列が1つ増えるだけで setup() が止まっていた。
 *   項目を1つ足すたびに「応募一覧を空にしてください」と頼むことになり、
 *   **FC大阪がテストを始めたあとは、項目を足せなくなる**。
 *
 * ■ 「増えただけ」を厳密に見る
 *   いまの見出しが、新しい見出しの**部分列**（順序どおり）であること。
 *   並べ替え・改名・削除が混ざっていたら false を返し、呼び出し側が止める。
 *   列を動かすと、どの値がどの列のものか分からなくなる。
 *
 * ■ 左から順に差し込む
 *   右から入れると、後の位置がずれる。
 */
function insertMissingLedgerColumns_(sh, current, headers) {
  // 末尾の空見出しは、列だけ余っている状態。比較から外す
  var cur = current.slice();
  while (cur.length && String(cur[cur.length - 1]).trim() === '') cur.pop();

  // 見出しが1つも読めない。ここに来ている時点で**データ行は入っている**
  //（呼び出し側が sh.getLastRow() > 1 のときだけ呼ぶ）ので、
  // 見出しの行だけが消えている状態。
  // このまま進むと「知っている見出しが1つも無い」＝「全部足りない」と読み、
  // **データの左側に列を全部差し込んで、値をまるごと横へずらす**。
  // 受付IDの列に企業名が入るような壊れ方をするので、触らずに人へ返す
  if (!cur.length) return false;

  var i = 0;
  for (var k = 0; k < headers.length && i < cur.length; k++) {
    if (cur[i] === headers[k]) i++;
  }
  if (i !== cur.length) return false;      // 並べ替え・改名・削除が混ざっている

  var live = cur.slice();
  for (var c = 0; c < headers.length; c++) {
    if (live[c] === headers[c]) continue;
    sh.insertColumnBefore(c + 1);
    sh.getRange(1, c + 1).setValue(headers[c]);
    live.splice(c, 0, headers[c]);
    console.log('応募一覧に列を足しました：' + headers[c]);
  }
  return true;
}

function setupLedgerSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.LEDGER);
  var headers = ledgerHeaders();

  var current = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String)
    : [];

  if (current.join('\t') !== headers.join('\t')) {
    if (sh.getLastRow() > 1) {
      // 既にデータがあるときは、**列が増えただけ**なら差し込んで残す。
      // 並べ替え・改名・削除が混ざっていたら、今までどおり止めて人に判断させる。
      if (!insertMissingLedgerColumns_(sh, current, headers)) {
        throw new Error(
          '応募一覧の列構成が定義と異なりますが、既にデータが入っています。\n' +
          '列の並べ替え・改名・削除が含まれるため、自動では移行できません。\n' +
          '手動でバックアップを取ってから対応してください。\n' +
          '（現在 ' + current.length + ' 列 / 定義 ' + headers.length + ' 列）'
        );
      }
    } else {
      // データが無いときは、まるごと書き直す。
      // **こちらもログを残す。** 2026-09-03、けいたが setup() を実行したのに
      // 「列を足しました」が出ず、効いたかどうか分からなかった。
      // 実際は空だったのでこちらを通っていた。**黙って正常**は、
      // 人には失敗と見分けがつかない。
      sh.clear();
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      console.log('応募一覧の見出しを作り直しました（' + headers.length + '列）。'
        + 'データが無かったため、差し込みではなく書き直しています。');
    }
  }

  styleHeader_(sh, headers.length);
  sh.setFrozenColumns(3); // 受付ID・受付日時・企業名 を固定

  var n = Math.max(sh.getMaxRows() - 1, 1);

  // 以前の列構成のときに付いた入力規則を、まず全部消す。
  // sh.clear() は中身と書式は消すが、**入力規則は残る**。
  // その結果、列の並びが変わったあとも古い列に規則が居座り、
  // 「主形態の列にステータスの選択肢しか入らない」といった状態になる。
  // 新規の応募は appendRow なので素通りするが、
  // **セル単位の書き込み（管理ページの更新・応募者による修正）だけが弾かれる**。
  // 原因が分かりにくいので、貼り直す前に必ず消す。
  sh.getRange(2, 1, n, Math.max(sh.getMaxColumns(), headers.length)).clearDataValidations();

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

// ───────────────────────────────── レンタル品目
/**
 * レンタル品目シート。1行＝1品目。
 *
 * ■ ここに行を足すと、応募フォームのレンタル欄が増える
 *   単価を設定シートに1行ずつ足していた頃は、品目を増やすたびに
 *   コード側にもキー（単価_長机 など）を足す必要があった。
 *
 * ■ 初回だけ、設定シートの旧単価から引き継ぐ
 *   既に入っている 15000/30000/1000/500 を捨てない。
 *   引き継いだあと、設定シートの古い単価行は掃除する（けいたさん指摘の
 *   「テントの古い3パターンが残っている」もここで消える）。
 */
function setupRentalSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.RENTAL);
  var head = ['並び順', '種別', '品目', '単価(円)', '単位', '最大数', '間口(m)', '奥行(m)', '有効', '説明'];

  var isNew = (sh.getLastRow() === 0);
  if (isNew) sh.getRange(1, 1, 1, head.length).setValues([head]);
  styleHeader_(sh, head.length);

  // 中身が無いときだけ、設定シートの旧単価から作る。
  // 既に運用が始まっていたら触らない（人が入れた値を上書きしない）
  if (sh.getLastRow() < 2) {
    var cfg = ss.getSheetByName(SHEET.CONFIG);
    var pick = function (key, fallback) {
      if (!cfg) return fallback;
      var row = findConfigRow_(cfg, key);
      if (!row) return fallback;
      var v = Number(String(cfg.getRange(row, 2).getValue()).replace(/[^0-9.]/g, ''));
      return (isFinite(v) && v > 0) ? v : fallback;
    };
    var seed = [
      [1, 'テント（1区画）', 'レンタルテント 間口1.5間×奥行2間（約2.7m×3.6m）',
       pick('単価_テント_小', 15000), '張', 1, 2.7, 3.6, '有効', '1区画に収まるサイズです'],
      [2, 'テント（2区画）', 'レンタルテント 間口3間×奥行2間（約5.4m×3.6m）',
       pick('単価_テント_大', 30000), '張', 1, 5.4, 3.6, '有効', '2区画をお申し込みの場合のみ'],
      [3, '数量', '長机（1800×450）', pick('単価_長机', 1000), '台', 20, '', '', '有効', ''],
      [4, '数量', 'パイプ椅子',       pick('単価_パイプ椅子', 500), '脚', 40, '', '', '有効', ''],
    ];
    sh.getRange(2, 1, seed.length, head.length).setValues(seed);
    console.log('レンタル品目シートを作り、設定シートの単価を引き継ぎました。');
  }

  var n = Math.max(sh.getMaxRows() - 1, 1);
  setDropdown_(sh, 2, 2, n, ['テント（1区画）', 'テント（2区画）', '数量']);
  setDropdown_(sh, 9, 2, n, ['有効', '無効']);

  [70, 130, 280, 90, 60, 70, 80, 80, 70, 260]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange('B1').setNote(
    'テント（1区画）／テント（2区画）… 区画に紐づくもの。単価だけをここで持ちます。'
    + '各1行にしてください。' + String.fromCharCode(10)
    + '数量 … 個数を入れて頼むもの。ここに行を足すと、応募フォームの欄が増えます。');
  sh.getRange('D1').setNote('空欄・0円のあいだは、その品目は応募フォームに出ません。'
    + '単価が決まってから入れてください。');
  sh.getRange('F1').setNote('応募フォームで入力できる上限。'
    + '空欄・0のあいだは、その品目は応募フォームに出ません。');
  sh.getRange('I1').setNote('「無効」にすると応募フォームから消えます。行は消さないでください（過去の応募が参照しています）。');
  return sh;
}

/**
 * 設定シートに残った、もう読んでいない単価行を片づける。
 *
 * 単価はレンタル品目シートへ移した。設定シートに古い行が残っていると、
 * **そちらを直したのに反映されない**という一番たちの悪い勘違いを生む。
 * 値の引き継ぎ（setupRentalSheet_）が終わったあとに呼ぶこと。
 */
/** レンタル品目シートへ移した、もう読んでいない設定キー */
var OLD_PRICE_KEYS_ = [
  '単価_テント_小', '単価_テント_大', '単価_長机', '単価_パイプ椅子',
  // 以前の設計で使っていたテント3パターン（けいたさん指摘の「古い3パターン」）
  '単価_テント_A', '単価_テント_B', '単価_テント_C',
  '単価_テント', '単価_机', '単価_椅子',
];

function cleanupOldPriceRows_(ss) {
  var cfg = ss.getSheetByName(SHEET.CONFIG);
  var rental = ss.getSheetByName(SHEET.RENTAL);
  if (!cfg || !rental || rental.getLastRow() < 2) return 0;   // 移行前は触らない

  var last = cfg.getLastRow();
  if (last < 2) return 0;
  var keys = cfg.getRange(2, 1, last - 1, 1).getValues();

  var removed = [];
  for (var i = keys.length - 1; i >= 0; i--) {     // 下から消す（行番号がずれないように）
    var key = String(keys[i][0]).trim();
    // 完全一致で消す。前方一致にすると、将来「単価改定メモ」のような行まで
    // 次の setup() で黙って消える
    if (OLD_PRICE_KEYS_.indexOf(key) < 0) continue;
    cfg.deleteRow(i + 2);
    removed.push(key);
  }
  if (removed.length) {
    console.log('設定シートから古い単価行を削除しました：' + removed.join(' / '));
  }
  return removed.length;
}

// ───────────────────────────────── 確認事項（ToDo）
/**
 * 決めきれていないこと・持ち帰った宿題を置く場所。
 *
 * 打ち合わせで出た「これは確認します」が、誰の手元にも残らずに消えるのを防ぐ。
 * 誰が挙げたか・誰が持つか・いつまでか の3つが無いと、結局は誰も動かない。
 */
function setupSchedSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.SCHED);
  var head = SCHED_HEADERS_;
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, head.length).setValues([head]);
  styleHeader_(sh, head.length);

  var n = Math.max(sh.getMaxRows() - 1, 1);
  setDropdown_(sh, 1, 2, n, SCHED_KINDS_);
  setDropdown_(sh, 4, 2, n, SCHED_AREAS_);
  setDropdown_(sh, 9, 2, n, SCHED_STATUSES_);

  // 曜日の列は作らない。表示形式で見せる（列を足すよりずれようがない）
  sh.getRange(2, 2, n, 1).setNumberFormat('m/d(ddd)');
  sh.getRange(2, 3, n, 1).setNumberFormat('m/d(ddd)');
  sh.getRange(2, 11, n, 1).setNumberFormat('m/d(ddd)');

  [90, 110, 110, 80, 140, 140, 300, 340, 90, 220, 110, 70, 100, 100, 100, 130, 90]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('B1').setNote('タスクは期日、期間は開始日、マイルストーンはその日を入れます。');
  sh.getRange('C1').setNote('期間のときだけ入れます。ほかの種類では空のままです。');
  sh.getRange('K1').setNote('完了・見送りにすると自動で入ります。手で直した値は上書きしません。');

  // 確認事項の行を移す。元シートは消さず、名前を変えるだけ
  schedMigrateTodos_(ss);
  return sh;
}

// ───────────────────────────────── ② タイムスケジュール（当日の時間割）
/**
 * 当日（10/24）の進行の時間割。
 *
 * ■ 開始時刻の列に、時刻の表示形式を付けない
 *   付けると Sheets が値を時刻として持ち、GAS では **Date として読まれて
 *   タイムゾーンで化ける**（design_timetable.md §2-1）。
 *   ①では日付列に `m/d(ddd)` を付けたせいで `2026-09-20 00:00` になった。
 *   ここは**書式なしのテキスト**で持ち、読む口は ttCellTime_ ひとつにする。
 *
 * ■ 版番号の行を、設定シートに用意しておく
 *   無くても ttVersion_() は 0 に落ちて動くが、
 *   人が設定シートを見たときに「これは何だ」と分かる説明を1行残しておきたい。
 */
function setupTimetableSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.TIMETABLE);
  var head = TT_HEADERS_;
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, head.length).setValues([head]);
  styleHeader_(sh, head.length);

  var n = Math.max(sh.getMaxRows() - 1, 1);
  setDropdown_(sh, 2, 2, n, TT_LANES_);

  // 開始の列は**書式を「書式なしテキスト」に固定する**。
  // 既定のままだと、人が 11:00 と打った瞬間に Sheets が時刻値にしてしまう
  sh.getRange(2, 3, n, 1).setNumberFormat('@');

  [90, 90, 70, 70, 300, 220, 340, 70, 70]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('C1').setNote('「11:00」の形のテキストです。時刻の書式にしないでください'
                          + '（GASが読むとタイムゾーンで化けます）。');
  sh.getRange('D1').setNote('0 は「時刻だけの目印」です（ゲートオープンなど）。');
  sh.getRange('A1').setNote('行を見分ける印です。手で変えないでください。');

  // 版番号の行を用意しておく。**設定タブには出さない**（人が触るものではない）
  var cfg = ss.getSheetByName(SHEET.CONFIG);
  if (cfg && !findConfigRow_(cfg, TT_VERSION_KEY_)) {
    cfg.appendRow([TT_VERSION_KEY_, 0,
      'タイムスケジュールの保存がぶつかっていないかを見るための番号です。手で変えないでください']);
  }

  /*
   * **0件でも必ずログに出す。**
   * 2026-09-04、setup() の戻り値がログに出ないせいで、
   * けいたが実行できたのか分からなくなった。「黙って正常」を作らない。
   */
  console.log('タイムスケジュールのシートを用意しました（いまの予定は '
    + Math.max(sh.getLastRow() - 1, 0) + ' 件です）。');
  return sh;
}

function setupTodoSheet_(ss) {
  /*
   * **移行が済んでいたら、作り直さない。**
   * setup() は setupTodoSheet_ → setupSchedSheet_ の順に走る。
   * ここで作り直すと、2回目の setup() で
   * 「確認事項」と「確認事項（移行済み）」が並び、一本化が破れる
   * （新しく書いた行は制作スケジュールに来なくなる）。
   * 2026-09-04 の検証で見つかった。
   */
  if (schedTodoMigrated_(ss)) return null;

  var sh = getOrCreate_(ss, SHEET.TODO);
  var head = ['状態', '内容', '担当', '期日', '起票者', '起票日', '完了日', 'メモ'];
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, head.length).setValues([head]);
  styleHeader_(sh, head.length);

  var n = Math.max(sh.getMaxRows() - 1, 1);
  setDropdown_(sh, 1, 2, n, ['未着手', '確認中', '完了']);

  [80, 380, 120, 110, 120, 110, 110, 260]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('B1').setNote('何を確認するのかを、一文で書いてください。');
  sh.getRange('D1').setNote('期日を過ぎたものは、ダッシュボードで赤く出ます。空欄でも構いません。');
  return sh;
}

// ───────────────────────────────── 資料フォルダ
/**
 * Drive の区分フォルダを用意する。
 * 失敗しても setup() 全体は止めない（台帳の構築は済ませたい）。
 * 資料フォルダIDが未設定・権限不足のときは、その旨をログに残す。
 */
function ensureDocsFolders_() {
  try {
    ensureSubfolders_();
  } catch (e) {
    logError_('ensureDocsFolders_', e);
  }
  // 提出物フォルダは**資料フォルダの外**に作る（共有フォルダに入れない）。
  // 人に「フォルダを作ってIDを貼って」と頼むと、そこで運用が止まるうえ、
  // 貼り間違えれば共有フォルダに戻ってしまう。ここで作りきる
  try {
    var f = submissionsFolder_();
    console.log('出店者の提出物：' + f.getName() + '（共有しないでください）');
    console.log('  ' + f.getUrl());
  } catch (e) {
    logError_('ensureDocsFolders_:提出物', e);
  }
}

// ───────────────────────────────── 出店確定情報（採択後に集める）
/**
 * 採択された事業者だけが書き込むシート。
 *
 * ■ 応募一覧と分けている理由
 *   応募一覧は、応募が1件でも入ると列構成を変えられない（setupLedgerSheet_ が止める）。
 *   採択後に聞く項目は「当日どう運営するか」なので、
 *   会場の条件が固まるにつれて増える。別シートなら運用開始後でも足せる。
 *
 * ■ ここは列が増えても壊れない作りにする
 *   応募一覧は「見出しが定義と完全一致」を要求するが、こちらは
 *   **足りない列を後ろに足すだけ**にする。既に回答が入っている状態で
 *   項目を1つ増やしたときに、回答を捨てずに済ませるため。
 */
function setupConfirmSheet_(ss) {
  var sh = getOrCreate_(ss, SHEET.CONFIRM);
  var headers = confirmHeaders();

  var current = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String)
    : [];

  if (!current.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // 既にある列の順番は変えない。定義に増えたぶんだけ後ろに足す。
    // 並べ替えると、既に入っている回答と列がずれる。
    var add = headers.filter(function (h) { return current.indexOf(h) < 0; });
    if (add.length) {
      sh.getRange(1, current.length + 1, 1, add.length).setValues([add]);
    }
  }

  var cols = Math.max(sh.getLastColumn(), headers.length);
  styleHeader_(sh, cols);
  sh.setFrozenColumns(2);   // 受付ID・企業名

  headers.forEach(function (h, i) {
    var w = 130;
    if (h === '備考') w = 300;
    if (h === '受付ID') w = 90;
    if (h === '企業名') w = 200;
    if (h === '生データ(JSON)') w = 220;
    sh.setColumnWidth(i + 1, w);
  });
  sh.getRange('A1').setNote('採択された事業者さまが、専用リンクから記入します。'
    + 'ここを手で編集すると、ご本人の画面と食い違います。');
  return sh;
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

// ───────────────────────────────── FC大阪の担当社員
//
// 2026-09-02 FC大阪（小谷様）より
//   「小谷、成田、田中、木口、阿部、その他 にて表記お願いします」
// けいた指示：フルネームではなく**苗字だけ**。メールは次の返事でヒアリングするので、
// いったん人物として登録だけしておく。
//
// ■ なぜ setup() でやるか
//   「関係者シートに5行足してください」と頼むと、そこで運用が止まる。
//   包材の項目追加で setup() はどのみち1回押してもらうので、そこに乗せる。
//
// ■ メールが空でも壊れない
//   getNotifyRecipients はメールの無い人を飛ばし、管理者（通知ON）には届く。
//   ただし**担当者本人には届かない**ので、メールが分かったら入れること。

/** 応募フォームに出すFC大阪の担当社員。ここが唯一の正 */
var FCOSAKA_STAFF = ['小谷', '成田', '田中', '木口', '阿部'];

/** フルネームで登録されていた人を、苗字だけに直す */
var STAFF_RENAME = { '小谷　成太': '小谷', '小谷 成太': '小谷' };

function ensureFcosakaStaff_(ss) {
  var sh = ss.getSheetByName(SHEET.PEOPLE);
  if (!sh || sh.getLastRow() < 1) return;

  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var iName = head.indexOf('氏名');
  var iOrg  = head.indexOf('所属');
  var iForm = head.indexOf('フォーム表示');
  if (iName < 0 || iOrg < 0 || iForm < 0) {
    console.log('関係者シートの見出しが想定と違うため、担当社員の整理を飛ばしました。');
    return;
  }

  var last = sh.getLastRow();
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, head.length).getValues() : [];
  var changed = [];

  // 1) フルネーム → 苗字
  rows.forEach(function (r, i) {
    var to = STAFF_RENAME[String(r[iName]).trim()];
    if (!to) return;
    sh.getRange(i + 2, iName + 1).setValue(to);
    changed.push('氏名を「' + String(r[iName]).trim() + '」→「' + to + '」に');
    r[iName] = to;
  });

  // 2) 足りない人を足す（既にいる人は触らない。メール・役割はそのまま）
  var have = {};
  rows.forEach(function (r) {
    if (String(r[iOrg]).trim() === 'FC大阪') have[String(r[iName]).trim()] = true;
  });
  FCOSAKA_STAFF.forEach(function (name) {
    if (have[name]) return;
    var row = new Array(head.length).fill('');
    row[iName] = name;
    row[iOrg]  = 'FC大阪';
    row[iForm] = '有効';
    var iRole = head.indexOf('役割');
    var iUse  = head.indexOf('管理ページ利用');
    var iNote = head.indexOf('通知');
    if (iRole >= 0) row[iRole] = '一般';
    if (iUse  >= 0) row[iUse]  = '無';
    if (iNote >= 0) row[iNote] = 'OFF';
    sh.appendRow(row);
    changed.push('「' + name + '」を追加（メールは未登録）');
  });

  // 3) フォームに出すのは、上の5名だけにする。
  //    項目名が「FC大阪の担当社員」なので、他社の方が並ぶと意味が通らない。
  //    **消していない**ので、必要なら関係者タブで「有効」に戻せる。
  last = sh.getLastRow();
  rows = last >= 2 ? sh.getRange(2, 1, last - 1, head.length).getValues() : [];
  rows.forEach(function (r, i) {
    var name = String(r[iName]).trim();
    if (!name) return;
    var want = (String(r[iOrg]).trim() === 'FC大阪'
                && FCOSAKA_STAFF.indexOf(name) >= 0) ? '有効' : '無効';
    if (String(r[iForm]).trim() === want) return;
    sh.getRange(i + 2, iForm + 1).setValue(want);
    changed.push('「' + name + '」のフォーム表示を ' + want + ' に');
  });

  if (changed.length) {
    console.log('担当社員を整理しました：');
    changed.forEach(function (c) { console.log('  ・' + c); });
    console.log('  ※ メールが空の方には、その方あての通知が届きません。'
              + '分かりしだい関係者タブでご登録ください。');
  }
}
