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
  RENTAL:     'レンタル品目',
  TODO:       '確認事項',
  // 採択後に集める情報。応募一覧とは**別シート**にしてある。
  // 応募が始まったあとでも列を足せるようにするため（仕様書の二段階収集）。
  CONFIRM:    '出店確定情報',
  QUARANTINE: '退避', // 台帳に書けなかった応募の受け皿。通常は空のまま
  // 採択・不採択のメール文面。管理ページから直せる（けいた指示・2026-09-03）。
  // 空なら gas/MailTemplate.gs が持つ既定の文面を使うので、消えても壊れない。
  MAILTPL:    'メール文面',
};

/** 設定シートの既定値。シートに行が無い場合はこの値が使われる。 */
var CONFIG_DEFAULTS = [
  ['締切日時',            '2026-09-30 18:00', 'この日時を過ぎるとフォームが受付終了になります（両側で制御）'],
  ['管理者パスワード',     '',                 '管理ページの管理者用。空だと管理ページは開けません'],
  ['一般パスワード',       '',                 '管理ページの一般用（FC大阪営業など）'],
  ['問い合わせメール',     'fcosaka_bondance@kreha-c.com', 'フォームとメールに表示する問い合わせ先'],
  // 管理ページの中で「ここから先は事務局にご相談ください」と案内する先。
  // 以前は画面に個人名だけが直書きされていて、**新しく入った営業には誰か分からず、
  // 連絡先も書いていなかった**（2026-09-03 の検証で指摘）。
  // けいた確定（2026-09-03）：森本啓太＋募集ページのフッターと同じアドレス
  ['事務局の連絡先',       '実行委員会事務局（森本啓太／fcosaka_bondance@kreha-c.com）',
                          '管理ページで「事務局にご連絡ください」と案内するときに、そのまま出す文字列'],
  // 差出人は問い合わせ先とは別キーにする。同じ値を共用すると、問い合わせ先を
  // FC大阪の担当者に変えた瞬間に差出人まで静かに変わってしまう。
  ['送信元アドレス',       'fcosaka_bondance@kreha-c.com', 'メールの差出人。Gmailにエイリアス登録が必要'],
  ['送信元表示名',         'FC大阪サステナ盆踊り実行委員会', 'メールの差出人名。メール署名とフォームの主催表記にも使われます'],
  ['ReplyTo',             'fcosaka_bondance@kreha-c.com', '返信先。空なら問い合わせメールと同じ'],
  // 単価は「レンタル品目」シートへ移した。ここに残すと、setup() が
  // 足しては消す（cleanupOldPriceRows_ が削除する）空回りになる。
  ['区画総数',            '50',               'マップに描く区画の数。図面到着後に調整'],
  ['目標出店社数',         '',                 'ダッシュボードで「◯件／目標◯件」と出すための分母。空なら表示しません'],
  // 既定値は空にしておくこと。ここに書くと**公開リポジトリに入る**。
  // このフォルダには応募企業の提出物が入るので、IDが知られると
  // 共有設定しだいで中身を読まれる。設定シートだけで持つ。
  ['資料フォルダID',       '', 'Drive「サステナ盆踊り_資料」のID'],
  // 出店者の提出物は、資料フォルダの**外**に置く。
  // 資料フォルダはリンク共有しているので、そこへ入れるとIDを知る誰でも読める。
  // Drive は共有フォルダの中だけを制限付きにできない（親の共有が子に及ぶ）ため、
  // 外に出すしかない。この行は setup() が自動で埋める。
  ['提出物フォルダID',     '', '（自動）出店者の提出物を置くフォルダ。**共有しないこと**'],
  // 公開前にテストデータを消すための鍵。ふだんはOFF。
  // 実行すると自動でOFFに戻る（1回ぶんの鍵）。
  ['テストデータの削除',   'OFF',              'ONにすると、出店者一覧に一括削除が出ます。実行すると自動でOFFに戻ります'],
  ['担当社員への結果通知',  'ON',               '採択・不採択に変わったとき担当社員にも通知するか（ON/OFF）'],
  ['要対応_経過日数',      '3',                '審査中のまま何日経過したら「要対応」に出すか'],
  ['マップ背景画像',       '',                 '会場図面の画像URL。設定するとマップの下敷きになります'],
  ['管理ページURL',        'https://bondance.kreha-c.com/admin.html', '応募通知メールに載せる管理ページのリンク'],
  // 採択通知メールに載せるリンク。受付IDとトークンを付けて各社に配る
  // ⚠ 既定値は**空**にしておくこと。
  //   ここに値を入れると、adminNotifySend_ の「リンクの無い通知は送らない」検査が
  //   一度も発火しない。ページを公開する前に既定値だけが入っていると、
  //   50社に「出店決定」と 404 のリンクを配ってから気づくことになる。
  ['確定情報フォームURL',   '',                 '採択通知に載せる「出店確定情報フォーム」のURL。公開してから入れること'],
  ['素材アップロードURL',   '',                 '採択通知に載せる「素材アップロード」のURL（未作成の間は空でよい）'],
  // けいた確定 B11／G17：可否連絡から5営業日
  ['確定情報の回収期限',    '',                 '出店確定情報フォームの提出期限（例 2026-10-10）。空なら「可否連絡から5営業日以内」と表記します'],
  ['素材の提出期限',        '',                 '告知素材（ロゴ・写真）の提出期限（例 2026-10-20）。空なら「なるべくお早めに」と表記します'],
  ['色_飲食',             '#F2A65A',          '出店形態の色分け（マップ・一覧）'],
  ['色_ワークショップ',    '#7FCAF1',          ''],
  ['色_展示',             '#9BD4A8',          ''],
  ['色_体験コンテンツ',    '#C9A6D8',          ''],
  ['色_その他',           '#B8B8B8',          ''],
  // ⚠ 2026-09-02 で使わなくなった。文言は src/content.js が唯一の正。
  //   シートに残っていても、どこからも読まれない（既存の行は消さなくてよい）。
  //   二重管理をやめた理由：片方だけ直しても表示が変わらず、
  //   食い違いに気づくのが「ビルドが止まったとき」だけだった。
  ['来場者数の表記',       '', '※使っていません。文言は開発側（content.js）が正です'],
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
  // 読み取りは gas/Num.gs に寄せる（全角・カンマも読める）。
  // 読めなければ null＝「調整中」のまま。0にしない
  return numAmount_(v);
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

/**
 * 備品単価をまとめて返す。未設定のものは null。
 *
 * レンタル品目シートへの移行中は、こちらが正のまま。
 * 先に消してしまい、応募フォームの設定取得ごと落とした（本番で確認）。
 * 移行が終わるまでは、この関数を消さないこと。
 */
function getPrices() {
  var items = getRentalItems({ activeOnly: true });
  var byKind = function (kind) {
    var hit = items.filter(function (it) { return it.kind === kind; });
    return hit.length ? hit[0].price : null;
  };
  var t1 = byKind(RENTAL_KIND.T1);
  var t2 = byKind(RENTAL_KIND.T2);

  // 品目シートがまだ無い／空のときだけ、設定シートの旧キーを控えとして読む。
  // ただし setup() は旧キーの行を削除するので、**一度 setup() を回したあとは
  // この控えは働かない**（移行の途中でだけ意味がある）。
  // 移行後にテントの単価が消えると、フォームは「調整中」と表示する。
  return {
    tentT1: (t1 === null || t1 === undefined) ? configNumber('単価_テント_小') : t1,
    tentT2: (t2 === null || t2 === undefined) ? configNumber('単価_テント_大') : t2,
  };
}

/** フォームに出す「数量で頼む品目」。単価が未設定のものは出さない */
function getRentalQtyItems() {
  return getRentalItems({ activeOnly: true })
    .filter(function (it) { return it.kind === RENTAL_KIND.QTY; })
    // 単価が決まっていないものは出さない。0円で受注する事故を作らない
    .filter(function (it) { return typeof it.price === 'number' && it.price > 0; })
    .filter(function (it) { return it.max > 0; })
    .map(function (it) {
      return { name: it.name, price: it.price, unit: it.unit,
               max: it.max, note: it.note };
    });
}

/**
 * レンタル品目シートを読む。
 *
 * ■ なぜ設定シートから分けたか
 *   単価を「設定」に1行ずつ足していくと、品目が増えるたびに
 *   コード側にもキー（単価_長机 など）を足す必要があった。
 *   別シートにして1行＝1品目にすれば、行を足すだけで品目が増える。
 *
 * ■ 台帳の形は品目に連動させない
 *   品目ごとに台帳の列を作ると、応募が集まったあとに品目を足したとき、
 *   それ以前の応募だけ列が空になり、台帳の整合検査が壊れる。
 *   台帳は「レンタル明細」と「レンタル合計(円)」の2列に固定し、
 *   品目をいくつ足しても形が変わらないようにしている。
 *
 * 種別は3つだけ：
 *   テント（1区画） … 区画に紐づく構造物。単価だけをここで持つ
 *   テント（2区画） … 同上
 *   数量           … 個数を入れて頼むもの。ここに行を足すと、フォームの欄が増える
 *
 * テントを「数量」にしないのは、区画の大きさと不可分だから。
 * 会場の区画割りが変わらない限り、増減する種類のものではない。
 */
var RENTAL_KIND = { T1: 'テント（1区画）', T2: 'テント（2区画）', QTY: '数量' };
var _rentalCache = null;   // 1回の実行のあいだだけ持つ。応募1件でシートを5回読んでいた

function getRentalItems(opt) {
  opt = opt || {};
  if (!_rentalCache) _rentalCache = readRentalSheet_();
  var out = _rentalCache;
  if (opt.activeOnly) out = out.filter(function (it) { return it.active; });
  return out;
}

function readRentalSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(SHEET.RENTAL);
  if (!sh || sh.getLastRow() < 2) return [];

  var rows = sh.getDataRange().getValues();
  var idx = {};
  rows[0].forEach(function (h, i) { idx[String(h).trim()] = i; });

  // 列見出しが変わっている／消えているだけで、全品目が0円になりうる。
  // 黙って続けず、ここで止める。
  var need = ['種別', '品目', '単価(円)'];
  for (var k = 0; k < need.length; k++) {
    if (idx[need[k]] === undefined) {
      throw new Error('レンタル品目シートに「' + need[k] + '」の列がありません。'
        + '見出しを直すか、setup() を実行してください。');
    }
  }

  var cell = function (r, key) {
    var i = idx[key];
    return (i === undefined || r[i] === null || r[i] === undefined) ? '' : String(r[i]).trim();
  };

  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var name = cell(r, '品目');
    if (!name) continue;

    // 空欄は「0円」ではなく「未定」。0円で受注してしまうと、
    // 応募者の画面にも台帳にも 0 と出て整合するので、誰も気づけない。
    var rawPrice = cell(r, '単価(円)').replace(/[^0-9.]/g, '');
    // シートは運用者が直接触る前提。全角で打たれても読めるようにする
    // （読めなければ null＝「調整中」。0にはしない）
    var price = (rawPrice === '') ? null : numAmount_(rawPrice);
    if (!isFinite(price) || price < 0) price = null;

    // 既定値は「出さない側」に倒す。空欄の行がそのまま公開されないように。
    var kind = cell(r, '種別');
    var maxRaw = numCount_(cell(r, '最大数'));

    out.push({
      order:  numCount_(cell(r, '並び順')) === null
                ? (i + 100) : numCount_(cell(r, '並び順')),
      kind:   kind,
      name:   name,
      price:  price,
      unit:   cell(r, '単位') || '個',
      max:    (isFinite(maxRaw) && maxRaw > 0) ? Math.floor(maxRaw) : 0,
      w:      numAmount_(cell(r, '間口(m)')) || 0,
      d:      numAmount_(cell(r, '奥行(m)')) || 0,
      // 許可リストで判定する。「有功」のような打ち間違いを有効と読まない
      active: cell(r, '有効') === '有効',
      note:   cell(r, '説明'),
      row:    i + 1,
    });
  }
  out.sort(function (a, b) { return a.order - b.order; });
  return out;
}

/** 品目名から、いま有効な1件を引く。単価は必ずここから取る（画面の値は信じない） */
function findRentalItem_(name) {
  var hit = getRentalItems({ activeOnly: true }).filter(function (it) {
    return it.name === String(name || '').trim();
  });
  return hit.length ? hit[0] : null;
}

/**
 * 関係者シートを読む。
 * @param {Object} opt - { formVisibleOnly: true } でフォーム表示＝有効の行だけ
 *                       { canLoginOnly: true } で管理ページ利用＝有の行だけ
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
    if (opt.canLoginOnly && !p.canLogin) continue;   // 管理ページ利用＝有 の人だけ
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

/**
 * 応募通知の宛先。
 *
 *   通知ON  … すべての応募が届く
 *   通知OFF … 自分が担当社員として選ばれた応募だけ届く
 *
 * ■ 役割（管理者／一般）では絞らない
 *   2026-09-02 まで「管理者かつ通知ON」だった。
 *   一般権限の人がONにしても**何も届かない**ので、
 *   スイッチが嘘をつく状態だった（けいた指摘）。
 *   一般権限でも出店者一覧は全部見られるので、
 *   通知だけ止めても守っているものが無い。
 *
 * ■ メールが未登録の人には届かない
 *   ONにしていても、関係者にメールアドレスが無ければ宛先に入らない。
 *   ここで弾かないと、GmailApp が不正な宛先で落ちて**通知が全員に届かなくなる**。
 */
function getNotifyRecipients(staffLabel) {
  var people = getPeople();
  var set = {};

  people.forEach(function (p) {
    if (p.notify && p.email) set[p.email] = true;
  });

  if (staffLabel) {
    people.forEach(function (p) {
      var label = p.name + ' - ' + (p.dept || p.org);
      if (label === staffLabel && p.email) set[p.email] = true;
    });
  }
  return Object.keys(set);
}
