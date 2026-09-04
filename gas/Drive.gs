/**
 * Drive の読み書き。素材アップロード（§6-3）と資料置き場（§6-2）で共有する。
 *
 * ■ 置き場所は**2つに分ける**
 *
 *     サステナ盆踊り_資料/            ← リンク共有。主催側の資料
 *       ├ 図面/
 *       ├ 議事録/
 *       └ その他/
 *
 *     サステナ盆踊り_出店者提出物（社外秘）/   ← **共有しない**。別の場所に置く
 *       ├ SB-0001/
 *       └ SB-0002/
 *
 * ■ なぜ分けるのか
 *   資料フォルダは「リンクを知っている全員」で共有している
 *   （FC大阪の方にGoogleアカウントを用意させないため）。
 *   そこへ応募企業のロゴ原本や写真を入れると、**IDを知る誰でも読める**。
 *   資料フォルダのIDは、既定値としてソースに書いてしまっていた時期があり、
 *   公開リポジトリの履歴に残っている。
 *
 *   Drive は**共有フォルダの中だけを制限付きにできない**（親の共有が子に必ず及ぶ）。
 *   だから「中で分ける」ことはできず、**外に出す**しかない。
 *
 *   提出物フォルダは setup() が自動で作る。人に「フォルダを作ってIDを貼って」と
 *   頼むと、そこで運用が止まるうえ、貼り間違えれば共有フォルダに戻ってしまう。
 *
 * ■ 大きさの上限は、送る前に断る
 *   GASのウェブアプリはPOSTの本文に上限があり、base64は元のファイルを
 *   約1.33倍に膨らませる。上限を超えると、**送信を押しても無反応**という
 *   一番たちの悪い形で失敗する（このプロジェクトが何度も踏んだ形）。
 *   画面側で送る前に大きさを測って断り、サーバー側でも同じ値で二重に止める。
 *
 * ■ フォルダIDは、管理ページには出る（出さざるを得ない）
 *   資料置き場の「Driveで開く」リンクにIDが入る。ここは諦めて、
 *   **IDを知られても壊れない作り**にしてある：
 *     ・削除はフォルダを受け付けない（Docs.gs）
 *     ・削除は資料フォルダの中のものだけ（Docs.gs）
 *   出店者に返すのは、その人自身のファイルのリンクだけ。
 *
 * ■ 資料フォルダそのものの共有設定は、コードでは守れない
 *   Drive側で「制限付き」にしておくこと。「リンクを知っている全員」だと、
 *   応募企業の提出物が誰でも読める。設定シートの値なので、
 *   **既定値をソースに書かない**（公開リポジトリに入るため）。
 */

/** 1ファイルの上限（バイト）。base64化した本文はこの約1.33倍になる */
var UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** 1社が提出できる数。無制限にすると、鍵を持つ相手がDriveを埋められる */
var UPLOAD_MAX_FILES = 30;

/**
 * 1社が提出できる合計の大きさ。
 * 1件10MB×30件を50社が出すと15GBになり、けいたのDriveが埋まる。
 * Driveが埋まると**Sheetsへの書き込みも止まり、応募受付ごと落ちる**（仕様書§0）。
 */
var UPLOAD_MAX_TOTAL_BYTES = 80 * 1024 * 1024;

/**
 * 受け取る種類。実行できるものは入れない。
 *
 * **素のオブジェクトにしないこと。** `{}` で書くと `UPLOAD_ALLOWED['constructor']`
 * や `['__proto__']` が Object.prototype のものを拾って**真になる**。
 * 種別に `constructor` と書くだけで種類の制限を素通りできてしまう
 * （検証で実際に .exe を通された）。親を持たない入れ物にして塞ぐ。
 */
var UPLOAD_ALLOWED = (function () {
  var o = Object.create(null);
  o['image/jpeg'] = 'jpg';  o['image/png'] = 'png';   o['image/gif'] = 'gif';
  o['image/webp'] = 'webp'; o['image/heic'] = 'heic'; o['image/svg+xml'] = 'svg';
  o['application/pdf'] = 'pdf';
  o['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] = 'docx';
  o['application/vnd.openxmlformats-officedocument.presentationml.presentation'] = 'pptx';
  o['application/illustrator'] = 'ai';
  o['application/postscript'] = 'ai';
  o['application/zip'] = 'zip';
  return o;
})();

/**
 * その種類で受け取ってよいか。よければ拡張子を返す（だめなら空）。
 * **必ずこれを通すこと。** `UPLOAD_ALLOWED[mime]` を直に書くと、
 * 上の入れ物を素のオブジェクトに戻したときに、静かに穴が開く。
 */
function allowedExt_(mime) {
  var v = UPLOAD_ALLOWED[String(mime || '')];
  return (typeof v === 'string') ? v : '';
}

/**
 * 管理ページから置かせない拡張子。
 * 管理ページは種類を広く受ける（社内で何を置くかは読み切れない）が、
 * **開くと動くものだけは断る**。管理ページの守りは共有パスワード1つで、
 * GASはけいた本人の権限で動く。
 */
var DOCS_DENY_EXT = ['exe', 'bat', 'cmd', 'com', 'scr', 'pif', 'msi', 'msp',
                     'cpl', 'hta', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh',
                     'ps1', 'jar', 'lnk', 'reg', 'dll', 'sh', 'html', 'htm'];

/** 資料フォルダの区分。**出店者提出物はここに含めない**（別の場所に置く） */
var DRIVE_SUBFOLDERS = ['図面', '議事録', 'その他'];

/** 提出物フォルダの名前。人が Drive で見て、中身が想像できる名前にする */
var SUBMISSIONS_FOLDER_NAME = 'サステナ盆踊り_出店者提出物（社外秘）';

/** 資料の親フォルダ。設定が空・IDが違うなら、ここで分かるように落とす */
function rootFolder_() {
  var id = configText('資料フォルダID', '');
  if (!id) throw new Error('設定シートの「資料フォルダID」が空です。');
  try {
    return DriveApp.getFolderById(id);
  } catch (e) {
    throw new Error('資料フォルダを開けませんでした。'
      + '設定シートの「資料フォルダID」をご確認ください。');
  }
}

/** 名前で子フォルダを探す。無ければ作る */
function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** 区分フォルダを用意する。setup() と、初回のアップロードから呼ばれる */
function ensureSubfolders_() {
  var root = rootFolder_();
  var out = {};
  DRIVE_SUBFOLDERS.forEach(function (n) { out[n] = childFolder_(root, n); });
  return out;
}

/**
 * 出店者の提出物を置くフォルダ。**資料フォルダの外**に作る。
 *
 * ここは共有しない。必要な人には、Drive でそのフォルダを個別に共有する
 * （見るのは広報担当など少人数。管理ページからの一覧・削除は
 *  Googleアカウント無しでできるので、大半の人は共有されなくても困らない）。
 *
 * IDは設定シートに控える。控えないと、名前が同じフォルダを人が作ったときに
 * どちらが本物か分からなくなる。
 */
function submissionsFolder_() {
  var id = configText('提出物フォルダID', '');
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { logError_('submissionsFolder_:ID不正', e); }   // 作り直す
  }

  // 同じ名前のものが既にあれば使う（setup() を2回回しても増やさない）
  var folder = null;
  var it = DriveApp.getRootFolder().getFoldersByName(SUBMISSIONS_FOLDER_NAME);
  folder = it.hasNext() ? it.next() : DriveApp.createFolder(SUBMISSIONS_FOLDER_NAME);

  try { rememberConfig_('提出物フォルダID', folder.getId()); }
  catch (e) { logError_('submissionsFolder_:設定に書けず', e); }
  return folder;
}

/**
 * 設定シートの値を書く（起動時に自動で決まるものだけ）。
 * 行が無ければ足す。人が入れた値は上書きしない。
 */
function rememberConfig_(key, value) {
  var sh = sheet_(SHEET.CONFIG);
  var row = findConfigRow_(sh, key);
  if (row) {
    if (String(sh.getRange(row, 2).getValue() || '').trim() === String(value)) return;
    sh.getRange(row, 2).setValue(value);
  } else {
    sh.appendRow([key, value, '（自動）出店者の提出物を置くフォルダ。**共有しないこと**']);
  }
  SpreadsheetApp.flush();
}

/**
 * その文字をファイル名に残してよいか。
 *
 * 落とすもの：
 *   0〜31・127  … 制御文字（DELを忘れると名前に残る）
 *   U+200B〜200F, U+202A〜202E, U+2060〜2064, U+FEFF
 *               … **見えない文字と、書字方向を上書きする文字**。
 *                 U+202E を挟むと `photo<RLO>gnp.exe` が
 *                 Drive でもメールでも `photoexe.png` に見える。
 *                 管理ページの削除確認にもそのまま出るので、
 *                 消す対象の見間違いにも使える。
 *
 * 範囲は正規表現ではなく文字コードで書く。範囲指定を生の文字で書くと、
 * 編集の経路によっては**本物の制御文字がソースに混ざる**（実際にここで起きた）。
 */
function nameCharOk_(ch) {
  var c = ch.charCodeAt(0);
  if (c < 32 || c === 127) return false;
  if (c >= 0x200B && c <= 0x200F) return false;
  if (c >= 0x202A && c <= 0x202E) return false;
  if (c >= 0x2060 && c <= 0x2064) return false;
  if (c === 0xFEFF) return false;
  return true;
}

/**
 * ファイル名を安全にする。
 * Drive はファイル名でコードを実行しないが、
 * 「/」「\」で階層に見えるものや、制御文字・極端に長い名前は避ける。
 * 先頭のドットも外す（隠しファイルに見える）。
 *
 * ■ forceExt を渡すと、拡張子を**こちらで決め直す**
 *   種類（mime）だけ見て名前を見ないと、`invoice.pdf.html` を
 *   `image/png` と申告して置けてしまう。Drive で開くと HTML として動く。
 *   種類の検査を通ったなら、その種類の拡張子を付け直すのが正しい。
 */
function safeFileName_(name, forceExt) {
  var s = String(name || '').split('').filter(nameCharOk_).join('')
                            .replace(/[\/\\:*?"<>|]/g, '_')
                            .replace(/^\.+/, '')
                            .trim();

  if (forceExt) {
    // すでに正しい拡張子なら、綴り（大文字小文字）はそのまま残す。
    // IMG_4821.HEIC を .heic に直すと、出した本人には
    // 「名前が変わってしまった」と映る
    var cur = /\.([A-Za-z0-9]{1,12})$/.exec(s);
    if (cur && cur[1].toLowerCase() === String(forceExt).toLowerCase()) {
      return s.length > 120 ? s.slice(0, 120 - cur[0].length) + cur[0] : s;
    }
    s = s.replace(/\.[A-Za-z0-9]{1,12}$/, '');       // 申告と違う拡張子は捨てる
    if (!s) s = '提出物';
    if (s.length > 120 - forceExt.length - 1) s = s.slice(0, 120 - forceExt.length - 1);
    return s + '.' + forceExt;
  }

  if (!s) s = '提出物';
  if (s.length > 120) {
    var dot = s.lastIndexOf('.');
    var ext = (dot > 0 && s.length - dot <= 12) ? s.slice(dot) : '';
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s;
}

/** ファイル名の拡張子（小文字・ドットなし）。無ければ空 */
function fileExt_(name) {
  var m = /\.([A-Za-z0-9]{1,12})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** 人が読める大きさ */
function humanSize_(bytes) {
  var n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (Math.round(n / 1024 / 1024 * 10) / 10) + ' MB';
}

/** ファイル1つを、画面に返してよい形にする。**フォルダIDは出さない** */
function fileToObject_(f, folderName) {
  return {
    id: f.getId(),
    name: f.getName(),
    size: f.getSize(),
    sizeText: humanSize_(f.getSize()),
    updated: Utilities.formatDate(f.getLastUpdated(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    url: f.getUrl(),
    folder: folderName || '',
  };
}

/**
 * 出店者の提出先フォルダ。受付IDごとに1つ。
 * 作ったら台帳の「素材提出フォルダURL」に書いて、管理ページから辿れるようにする。
 */
function vendorFolder_(receiptId) {
  var folder = childFolder_(submissionsFolder_(), receiptId);

  try {
    var L = readLedger_();
    var idIdx = L.headers.indexOf(COL.id);
    var urlIdx = L.headers.indexOf('素材提出フォルダURL');
    if (idIdx >= 0 && urlIdx >= 0) {
      for (var i = 0; i < L.rows.length; i++) {
        if (String(L.rows[i][idIdx]).trim() !== receiptId) continue;
        if (!String(L.rows[i][urlIdx] || '').trim()) {
          L.sheet.getRange(i + 2, urlIdx + 1).setValue(folder.getUrl());
        }
        break;
      }
    }
  } catch (e) {
    // 台帳に書けなくても、提出そのものは成立させる
    logError_('vendorFolder_:台帳', e);
  }
  return folder;
}
