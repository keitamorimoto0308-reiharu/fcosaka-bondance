/**
 * 資料置き場（仕様書 §6-2）。管理ページから、けいたのDrive内の共有フォルダを扱う。
 *
 *   一覧（全員） … 図面／出店者提出物／議事録／その他 の中身
 *   追加（全員） … 管理ページからアップロード。**メンバーはGoogleアカウント不要**
 *   削除（管理者のみ）
 *
 * ■ なぜ管理ページ経由でアップロードするのか
 *   Driveを直接共有すると、相手にGoogleアカウントが要る。
 *   FC大阪の営業に「まずアカウントを」と言うところで運用が止まる。
 *   管理ページのパスワードだけで置けるようにする。
 *
 * ■ 出店者提出物は、ここでは階層を1つ深く読む
 *   受付IDごとのフォルダに入っているので、一覧は
 *   「どの会社の、どのファイルか」が分かる形にする。
 *
 * ■ 消せるのは管理者だけ（仕様書§6-1の権限表）
 *   一般権限で消せると、営業が誤って図面を消した、が起きる。
 *   消したことは変更履歴に残す。
 */

/** 資料置き場の一覧。件数が多いフォルダは頭打ちにする（画面が固まるため） */
var DOCS_MAX_PER_FOLDER = 200;

function adminDocs_(auth) {
  var out = { ok: true, folders: [], vendor: [], rootUrl: '' };

  var subs, root;
  try {
    subs = ensureSubfolders_();
    root = rootFolder_();
    out.rootUrl = root.getUrl();
  } catch (e) {
    logError_('adminDocs_', e);
    return { ok: false, error: 'no_folder',
      message: String((e && e.message) || '資料フォルダを開けませんでした。') };
  }

  // ■ フォルダの直下に置かれたものも拾う
  //   人は区分フォルダに入れず、いちばん上に置く。
  //   実際、けいたが最初に置いた企画書（.pptx）が直下にあった。
  //   区分を強制するより、拾って見せるほうが現実に合う。
  //   置き場所を移してもらう必要はない（Driveで動かせば次回から区分に入る）。
  var rootFiles = [];
  var rit = root.getFiles();
  var rn = 0;
  while (rit.hasNext() && rn < DOCS_MAX_PER_FOLDER) {
    rootFiles.push(fileToObject_(rit.next(), '（未分類）'));
    rn++;
  }
  if (rootFiles.length) {
    rootFiles.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
    out.folders.push({ name: '（未分類）', url: root.getUrl(),
                       files: rootFiles, more: rit.hasNext(),
                       note: 'フォルダの一番上に置かれているものです。'
                           + '区分に移すと、上の各欄に並びます。' });
  }

  DRIVE_SUBFOLDERS.forEach(function (name) {
    var files = [];
    var it = subs[name].getFiles();
    var n = 0;
    while (it.hasNext() && n < DOCS_MAX_PER_FOLDER) { files.push(fileToObject_(it.next(), name)); n++; }
    files.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
    out.folders.push({ name: name, url: subs[name].getUrl(),
                       files: files, more: it.hasNext() });
  });

  // 出店者提出物は、受付IDごとにまとめる。
  // **資料フォルダの外**にある（共有しないため）ので、別に開く
  var subm;
  try { subm = submissionsFolder_(); }
  catch (e) {
    logError_('adminDocs_:提出物フォルダ', e);
    out.vendor = [];
    out.subfolders = DRIVE_SUBFOLDERS.slice();
    out.maxBytes = UPLOAD_MAX_BYTES;
    out.maxSizeText = humanSize_(UPLOAD_MAX_BYTES);
    return out;
  }
  out.submissionsUrl = subm.getUrl();
  var vit = subm.getFolders();
  var vendors = [];
  while (vit.hasNext()) {
    var vf = vit.next();
    var files = [];
    var fit = vf.getFiles();
    var m = 0;
    while (fit.hasNext() && m < DOCS_MAX_PER_FOLDER) { files.push(fileToObject_(fit.next())); m++; }
    files.sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
    vendors.push({ id: vf.getName(), url: vf.getUrl(), files: files });
  }
  // 受付IDの順に並べる（提出が新しい順だと、探すときに毎回並びが変わる）
  vendors.sort(function (a, b) { return a.id < b.id ? -1 : 1; });

  // 会社名を添える。受付IDだけでは誰の提出か分からない。
  //
  // ■ まだ1件も出していない採択先も、0件の行として並べる
  //   フォルダは初めて画面を開いたときに作られるので、
  //   Driveにあるものだけを並べると**一度も開いていない会社は行が出ない**。
  //   営業がいちばん知りたい「誰がまだ出していないか」が、
  //   この画面では分からなくなる。
  try {
    var L = readLedger_();
    var byId = {};
    var idIdx = L.headers.indexOf(COL.id);
    var coIdx = L.headers.indexOf(COL.company);
    var stIdx = L.headers.indexOf(COL.status);
    if (idIdx >= 0 && coIdx >= 0) {
      var have = {};
      vendors.forEach(function (v) { have[v.id] = true; });
      L.rows.forEach(function (r) {
        var rid = String(r[idIdx] || '').trim();
        if (!rid) return;
        byId[rid] = String(r[coIdx] || '');
        if (stIdx >= 0 && String(r[stIdx] || '').trim() === '採択' && !have[rid]) {
          vendors.push({ id: rid, url: '', files: [], notYet: true });
          have[rid] = true;
        }
      });
      vendors.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    }
    vendors.forEach(function (v) { v.company = byId[v.id] || ''; });
  } catch (e) { logError_('adminDocs_:台帳', e); }

  out.vendor = vendors;
  out.subfolders = DRIVE_SUBFOLDERS.slice();
  out.maxBytes = UPLOAD_MAX_BYTES;
  out.maxSizeText = humanSize_(UPLOAD_MAX_BYTES);
  return out;
}

/**
 * 管理ページからのアップロード。
 * 置き先は図面／議事録／その他のいずれか。
 * **出店者提出物には置かせない**（あそこは事業者本人の提出物の場所で、
 * こちらが混ぜると「誰が出したのか」が分からなくなる）。
 */
function adminDocsUpload_(auth, payload) {
  var folderName = String((payload && payload.folder) || '');
  // 出店者提出物は DRIVE_SUBFOLDERS から外してあるので、ここで自然に弾かれる。
  // 名前で書いた条件は、綴りを変えた瞬間に効かなくなるため残さない
  if (DRIVE_SUBFOLDERS.indexOf(folderName) < 0) {
    return { ok: false, error: 'bad_folder',
      message: '置き先をお選びください（出店者提出物には置けません）。' };
  }

  var name = String((payload && payload.name) || '');
  var mime = String((payload && payload.mime) || '');
  var data = String((payload && payload.data) || '');
  if (!data) return { ok: false, error: 'empty', message: 'ファイルを読み取れませんでした。' };

  // 管理ページは社内なので、種類は事業者向けより広く受ける。
  // ただし**開くと動くもの**は断る。ここの守りは共有パスワード1つで、
  // GASはけいた本人の権限で動くので、1つ漏れると何でも置かれてしまう。
  var fileName = safeFileName_(name, '');
  if (DOCS_DENY_EXT.indexOf(fileExt_(fileName)) >= 0) {
    return { ok: false, error: 'type',
      message: 'この種類のファイルは置けません（' + fileExt_(fileName) + '）。'
             + 'PDFや画像、Officeの書類でお願いします。' };
  }

  // 大きさの上限は事業者向けと同じ（GASのPOSTの上限は同じもの）
  var approx = Math.floor(data.length * 3 / 4);
  if (approx > UPLOAD_MAX_BYTES + 3) {
    return { ok: false, error: 'too_large',
      message: 'ファイルが大きすぎます（1つあたり ' + humanSize_(UPLOAD_MAX_BYTES) + ' まで）。'
             + '大きいものは、Driveで直接お置きください。' };
  }

  try {
    var subs = ensureSubfolders_();

    // 件数の頭打ち。一覧が DOCS_MAX_PER_FOLDER で切れる以上、
    // それを超えて置けると「置いたのに見えない」が起きる
    var have = 0;
    var cit = subs[folderName].getFiles();
    while (cit.hasNext() && have < DOCS_MAX_PER_FOLDER) { cit.next(); have++; }
    if (have >= DOCS_MAX_PER_FOLDER) {
      return { ok: false, error: 'too_many',
        message: 'この区分は' + DOCS_MAX_PER_FOLDER + '件までです。'
               + 'Driveで直接ご整理ください。' };
    }

    var bytes = Utilities.base64Decode(data);
    if (bytes.length > UPLOAD_MAX_BYTES) {
      return { ok: false, error: 'too_large',
        message: 'ファイルが大きすぎます（1つあたり ' + humanSize_(UPLOAD_MAX_BYTES) + ' まで）。' };
    }
    var file = subs[folderName].createFile(
      Utilities.newBlob(bytes, mime || 'application/octet-stream', fileName));

    appendHistory(auth.person, '', '資料', '', folderName + '／' + fileName, '資料の追加');
    SpreadsheetApp.flush();
    return { ok: true, file: fileToObject_(file, folderName) };
  } catch (e) {
    logError_('adminDocsUpload_', e);
    return { ok: false, error: 'server_error',
      message: '保存できませんでした。お手数ですが、もう一度お試しください。' };
  }
}

/**
 * 削除（管理者のみ）。ゴミ箱に入れる（完全には消さない）。
 *
 * ■ 資料フォルダの中のものだけを消す
 *   ファイルIDを受け取って消すので、**このフォルダの外を指されたら断る**。
 *   断らないと、そのIDを知っている相手に、けいたのDrive内の
 *   任意のファイルを消させてしまう。
 */
function adminDocsDelete_(auth, payload) {
  var id = String((payload && payload.fileId) || '').trim();
  if (!id) return { ok: false, error: 'bad_request' };

  try {
    var file;
    try { file = DriveApp.getFileById(id); }
    catch (e) { return { ok: false, error: 'not_found', message: 'ファイルが見つかりません。' }; }

    // **フォルダは消させない。**
    // isInsideDocsRoot_ は親をたどるだけなので、「図面」や「出店者提出物」を
    // 指されると「中にある」と答える。そのまま消すと、
    // **全社の提出物が一撃でゴミ箱に入る**。
    // DriveApp がフォルダIDで File を返すかは版により変わりうるので、
    // その挙動には預けず、ここで明示的に断る。
    if (file.getMimeType() === 'application/vnd.google-apps.folder') {
      return { ok: false, error: 'forbidden',
        message: 'フォルダは、この画面からは削除できません。'
               + 'Driveで直接ご操作ください。' };
    }

    if (!isInsideDocsRoot_(file)) {
      logError_('adminDocsDelete_', new Error('資料フォルダの外を指されました: ' + id));
      return { ok: false, error: 'forbidden',
        message: 'このファイルは資料置き場のものではありません。' };
    }

    var name = file.getName();
    file.setTrashed(true);
    appendHistory(auth.person, '', '資料', name, '（削除）', '資料の削除');
    SpreadsheetApp.flush();
    return { ok: true, name: name };
  } catch (e) {
    logError_('adminDocsDelete_', e);
    return { ok: false, error: 'server_error', message: '削除できませんでした。' };
  }
}

/**
 * そのファイルが、資料フォルダの中にあるか。
 * 親をたどって根に当たるかで見る（受付IDのフォルダは1つ深い）。
 * たどる深さに上限を置く（共有の作りによっては輪になりうる）。
 *
 * **これだけでは足りない。** 親をたどるので、区分フォルダ自身も「中」と答える。
 * フォルダを断る判定は呼び出し側（adminDocsDelete_）にある。
 * 「資料フォルダ自身は？」は、フォルダが自分の親になれない以上ここでは常に
 * 「外」になる（検査で確認済み）。ここで別に見張る必要はない。
 */
function isInsideDocsRoot_(file) {
  var roots = Object.create(null);
  roots[rootFolder_().getId()] = true;
  // 提出物は資料フォルダの外にあるが、管理者は管理ページから消せる必要がある。
  // 開けないときは資料フォルダだけを根とする（消せる範囲が広がることはない）
  try { roots[submissionsFolder_().getId()] = true; } catch (e) {}

  // たどった先を覚える。共有の作りで親が輪になっていると、
  // 覚えないかぎり枝が段ごとに倍々に増える（深さ10で約2000回の問い合わせ）。
  // 止まりはするが、Driveへの問い合わせが無駄に膨らむ
  var seen = Object.create(null);
  var queue = [];
  var it = file.getParents();
  while (it.hasNext()) queue.push(it.next());

  // 深さの上限。閉じる側に倒れる（深く整理すると消せなくなるが、
  // 外のものを消すよりはよい）。10段は実務で足りる
  for (var depth = 0; depth < 10 && queue.length; depth++) {
    var next = [];
    for (var i = 0; i < queue.length; i++) {
      var f = queue[i];
      var fid = f.getId();
      if (roots[fid]) return true;
      if (seen[fid]) continue;
      seen[fid] = true;
      var pit = f.getParents();
      while (pit.hasNext()) next.push(pit.next());
    }
    queue = next;
  }
  return false;
}
