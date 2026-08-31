/**
 * 設定シートと関係者シートの読み取り。
 *
 * イベント固有の値（締切・単価・区画数・色・パスワード）はすべてここを通す。
 * コードに直書きしないことで、別イベントへの転用がシートの差し替えだけで済む。
 * （仕様書 §0 設計原則）
 */

var SHEET = {
  LEDGER:  '応募一覧',
  HISTORY: '変更履歴',
  SPACES:  '区画',
  CONFIG:  '設定',
  PEOPLE:  '関係者',
};

/** 設定シートの既定値。シートに行が無い場合はこの値が使われる。 */
var CONFIG_DEFAULTS = [
  ['締切日時',            '2026-09-30 18:00', 'この日時を過ぎるとフォームが受付終了になります（両側で制御）'],
  ['管理者パスワード',     '',                 '管理ページの管理者用。空だと管理ページは開けません'],
  ['一般パスワード',       '',                 '管理ページの一般用（FC大阪営業など）'],
  ['問い合わせメール',     'fcosaka_bondance@kreha-c.com', 'フォームとメールに表示する問い合わせ先'],
  ['送信元表示名',         'サステナ盆踊り実行委員会',      'メールの差出人名'],
  ['ReplyTo',             'fcosaka_bondance@kreha-c.com', '返信先。空なら問い合わせメールと同じ'],
  ['単価_テント_S1',       '',                 '間口1間×奥行2間のテント単価（円・税込）。空なら「調整中」表示'],
  ['単価_テント_S2',       '',                 '間口2間×奥行2間のテント単価'],
  ['単価_テント_S3',       '',                 '間口3間×奥行2間のテント単価'],
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

/** 締切日時を Date で返す。未設定なら null（＝締切なし）。 */
function getDeadline() {
  var v = getConfig()['締切日時'];
  if (!v) return null;
  if (v instanceof Date) return v;
  // 「2026-09-30 18:00」形式を Asia/Tokyo として解釈する
  var m = String(v).match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0);
}

function isClosed() {
  var d = getDeadline();
  return d ? (new Date() > d) : false;
}

/** 備品単価をまとめて返す。未設定のものは null。 */
function getPrices() {
  return {
    tentS1: configNumber('単価_テント_S1'),
    tentS2: configNumber('単価_テント_S2'),
    tentS3: configNumber('単価_テント_S3'),
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
