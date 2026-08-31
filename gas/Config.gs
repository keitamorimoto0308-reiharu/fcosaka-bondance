/**
 * 設定シートと関係者シートの読み取り。
 *
 * イベント固有の値（締切・単価・区画数・色・パスワード）はすべてここを通す。
 * コードに直書きしないことで、別イベントへの転用がシートの差し替えだけで済む。
 * （仕様書 §0 設計原則）
 */

var SHEET = {
  LEDGER:     '応募一覧',
  HISTORY:    '変更履歴',
  SPACES:     '区画',
  CONFIG:     '設定',
  PEOPLE:     '関係者',
  QUARANTINE: '退避', // 台帳に書けなかった応募の受け皿。通常は空のまま
};

/** 設定シートの既定値。シートに行が無い場合はこの値が使われる。 */
var CONFIG_DEFAULTS = [
  ['締切日時',            '2026-09-30 18:00', 'この日時を過ぎるとフォームが受付終了になります（両側で制御）'],
  ['管理者パスワード',     '',                 '管理ページの管理者用。空だと管理ページは開けません'],
  ['一般パスワード',       '',                 '管理ページの一般用（FC大阪営業など）'],
  ['問い合わせメール',     'fcosaka_bondance@kreha-c.com', 'フォームとメールに表示する問い合わせ先'],
  // 差出人は問い合わせ先とは別キーにする。同じ値を共用すると、問い合わせ先を
  // FC大阪の担当者に変えた瞬間に差出人まで静かに変わってしまう。
  ['送信元アドレス',       'fcosaka_bondance@kreha-c.com', 'メールの差出人。Gmailにエイリアス登録が必要'],
  ['送信元表示名',         'FC大阪サステナ盆踊り実行委員会', 'メールの差出人名。メール署名とフォームの主催表記にも使われます'],
  ['ReplyTo',             'fcosaka_bondance@kreha-c.com', '返信先。空なら問い合わせメールと同じ'],
  ['単価_テント_小',       '',                 'レンタルテント 間口1.5間×奥行2間（約2.7m×3.6m）の単価（円・税込）。空なら「調整中」表示'],
  ['単価_テント_大',       '',                 'レンタルテント 間口3間×奥行2間（約5.4m×3.6m）の単価'],
  ['単価_長机',           '',                 '長机1台あたりの単価'],
  ['単価_パイプ椅子',      '',                 'パイプ椅子1脚あたりの単価'],
  ['区画総数',            '50',               'マップに描く区画の数。図面到着後に調整'],
  ['資料フォルダID',       '1o7pykyfL0zMOS6cWdj45N91hjH3ueA9y', 'Drive「サステナ盆踊り_資料」のID'],
  ['担当社員への結果通知',  'ON',               '採択・不採択に変わったとき担当社員にも通知するか（ON/OFF）'],
  ['要対応_経過日数',      '3',                '審査中のまま何日経過したら「要対応」に出すか'],
  ['マップ背景画像',       '',                 '会場図面の画像URL。設定するとマップの下敷きになります'],
  ['管理ページURL',        'https://bondance.kreha-c.com/admin.html', '応募通知メールに載せる管理ページのリンク'],
  ['色_飲食',             '#F2A65A',          '出店形態の色分け（マップ・一覧）'],
  ['色_ワークショップ',    '#7FCAF1',          ''],
  ['色_展示',             '#9BD4A8',          ''],
  ['色_体験コンテンツ',    '#C9A6D8',          ''],
  ['色_その他',           '#B8B8B8',          ''],
  ['来場者数の表記',       'FC大阪ホームゲーム開催日。多くの来場者が場外エリアを通過します', 'フォームと募集要項に載せる文言（けいたの判断待ち・Q3）'],
];

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) throw new Error('シートが見つかりません: ' + name + '（setup() を実行してください）');
  return s;
}

/**
 * 設定シートを { キー: 値 } で返す。
 * 6分の実行時間制限のなかで何度も読むのは無駄なので、1回の実行内でキャッシュする。
 */
var _configCache = null;
function getConfig() {
  if (_configCache) return _configCache;
  var rows = sheet_(SHEET.CONFIG).getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][0]).trim();
    if (!key) continue;
    cfg[key] = rows[i][1];
  }
  _configCache = cfg;
  return cfg;
}

/** 数値として読む。空欄・不正値は null（＝「調整中」扱い）を返す。 */
function configNumber(key) {
  var v = getConfig()[key];
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

function configText(key, fallback) {
  var v = getConfig()[key];
  return (v === '' || v === null || v === undefined) ? (fallback || '') : String(v);
}

function configBool(key) {
  return String(getConfig()[key] || '').toUpperCase() === 'ON';
}

/**
 * 締切日時を Date で返す。
 * 解釈できない書き方（「9/30 18:00」「2026年9月30日 18時」など）は例外にする。
 * ここで null を返して「締切なし」に倒すと、締切を過ぎても受付が続いてしまう。
 */
function getDeadline() {
  var v = getConfig()['締切日時'];
  if (v === '' || v === null || v === undefined) {
    throw new Error('設定シートの「締切日時」が空です。「2026-09-30 18:00」の形式で入力してください。');
  }
  // Sheetsは「2026-09-30 18:00」を日時型に自動変換する。その値をGASが読むと
  // 「スプレッドシートのタイムゾーンでの18:00」という絶対時刻になるため、
  // シートのタイムゾーンが日本時間でないと最大で丸1日ずれる。
  // 型に関わらず「人が入力した見た目の時刻」を取り出し、それを日本時間として解釈し直す。
  var text = (v instanceof Date)
    ? Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm')
    : String(v);

  var m = text.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2}):(\d{2})/);
  if (!m) {
    throw new Error('設定シートの「締切日時」を解釈できません（現在の値：' + v + '）。'
      + '「2026-09-30 18:00」の形式で入力してください。');
  }
  // new Date(y, m, d, h, min) は「実行環境のタイムゾーンの時刻」として解釈される。
  // GASの実行環境はUTCのことがあり、その場合 18:00 が翌日03:00（JST）にずれる。
  // 実行環境に依存しないよう、UTCの絶対時刻として組み立てる（JST = UTC+9）。
  return new Date(Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]) - 9, Number(m[5]), 0
  ));
}

var WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 日本語の曜日つきで日時を整形する。Utilities.formatDate の E は英語になるため自前で持つ。 */
function formatJa(date) {
  if (!date) return '';
  var w = Number(Utilities.formatDate(date, 'Asia/Tokyo', 'u')) % 7; // u: 1=月〜7=日
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy年M月d日')
       + '（' + WEEKDAY_JA[w] + '）'
       + Utilities.formatDate(date, 'Asia/Tokyo', 'HH:mm');
}

/**
 * 締切を過ぎているか。
 * 設定が壊れている場合は「締切済み」に倒す（フェイルクローズ）。
 * 受付を止めすぎる失敗は電話で回復できるが、締切後に受け続ける失敗は回復できない。
 */
function isClosed() {
  try {
    return new Date() > getDeadline();
  } catch (e) {
    console.error('[isClosed] 締切設定が不正なため受付を停止します: ' + e);
    return true;
  }
}

/** 備品単価をまとめて返す。未設定のものは null。 */
function getPrices() {
  return {
    tentT1: configNumber('単価_テント_小'),
    tentT2: configNumber('単価_テント_大'),
    table:  configNumber('単価_長机'),
    chair:  configNumber('単価_パイプ椅子'),
  };
}

/**
 * 関係者シートを読む。
 * @param {Object} opt - { formVisibleOnly: true } でフォーム表示＝有効の行だけ
 */
function getPeople(opt) {
  opt = opt || {};
  var rows = sheet_(SHEET.PEOPLE).getDataRange().getValues();
  var head = rows[0];
  var idx = {};
  head.forEach(function (h, i) { idx[String(h).trim()] = i; });

  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!String(r[idx['氏名']] || '').trim()) continue;
    var p = {
      name:        String(r[idx['氏名']]).trim(),
      org:         String(r[idx['所属']] || '').trim(),
      dept:        String(r[idx['部署']] || '').trim(),
      email:       String(r[idx['メール']] || '').trim(),
      formVisible: String(r[idx['フォーム表示']] || '').trim() === '有効',
      canLogin:    String(r[idx['管理ページ利用']] || '').trim() === '有',
      role:        String(r[idx['役割']] || '一般').trim(),
      notify:      String(r[idx['通知']] || '').trim().toUpperCase() === 'ON',
      row:         i + 1,
    };
    if (opt.formVisibleOnly && !p.formVisible) continue;
    out.push(p);
  }
  return out;
}

/**
 * フォームの担当社員プルダウンに出す一覧。
 * メールアドレスは絶対に含めない（公開ページに社員のアドレスを出さないため）。
 */
function getStaffOptions() {
  return getPeople({ formVisibleOnly: true }).map(function (p) {
    return { name: p.name, dept: p.dept, label: p.name + ' - ' + (p.dept || p.org) };
  });
}

/** 応募通知の宛先：選ばれた担当社員 ＋ 管理者かつ通知ONの全員 */
function getNotifyRecipients(staffLabel) {
  var people = getPeople();
  var set = {};

  people.forEach(function (p) {
    if (p.role === '管理者' && p.notify && p.email) set[p.email] = true;
  });

  if (staffLabel) {
    people.forEach(function (p) {
      var label = p.name + ' - ' + (p.dept || p.org);
      if (label === staffLabel && p.email) set[p.email] = true;
    });
  }
  return Object.keys(set);
}
