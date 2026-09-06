// ─────────────────────────── ① 制作スケジュール表：Excel の取り込み
/**
 * 書き出した Excel を直して読み込み、台帳に**追加と更新だけ**を反映する。
 *
 * 仕様は docs/internal/design_sched_import.md（gitignore 対象・手元にある）。
 *
 * ■ Excel は「正」ではない
 *   正は台帳（スプレッドシート）。Excel は作業用の写しにすぎない。
 *   だから**画面で直した内容を Excel へ戻さない**し、
 *   **取り込みで台帳の行を消さない**（けいた確定・2026-09-07）。
 *
 * ■ 消さない理由
 *   ①は**全員が触れる**。けいたが Excel を編集しているあいだに他の人が足した行を、
 *   警告なしに消すことになる。Excel には最初から入っていないので、
 *   「消した」と「知らなかった」の区別がつかない。
 *
 * ■ 読み取りは gas/Export.gs（書き出し）の裏返し
 *   Drive に「Googleの表として」上げて変換し、読んで、**finally で必ず消す**。
 *   `UrlFetchApp` ＋ `ScriptApp.getOAuthToken()` の経路は書き出しと同じなので、
 *   **新しい権限も追加サービスも要らない**。
 *
 * ■ 一時ファイルの消し忘れは静かな事故
 *   Drive が散らかるだけでなく、**台帳の中身がそのまま残る**。
 *   消せなかったときは取り込みを止めず、`leftover` で人に伝える
 *   （止めると「使えるのに使えない」状態になる）。
 */

/** 受け取るファイルの上限。工程表の xlsx は数十KB */
var SCHED_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 取り込めるファイルか。**Drive に触る前に見る。**
 *
 * 画面の `accept=".xlsx"` だけに頼らない。守りはサーバー側（仕様書§1）。
 * CSV を受けないのは、文字化けが避けられず
 * 「取り込んだら名前が化けた」を毎回疑うことになるから（設計書§1-4）。
 *
 * @return {string} 断る理由。通るなら空文字
 */
function schedImportReject_(base64, fileName) {
  var b64 = String(base64 || '');
  if (!b64) return 'ファイルを読み取れませんでした。もう一度お選びください。';

  // base64 は元の約1.33倍。**長さから見積もって、先に止める**（Upload.gs と同じ）
  if (b64.length * 0.75 > SCHED_IMPORT_MAX_BYTES) {
    return 'ファイルが大きすぎます（2MBまで）。'
         + '行数を減らすか、いらない列を消してからお試しください。';
  }
  if (!/\.xlsx$/i.test(String(fileName || ''))) {
    return 'Excelのファイル（.xlsx）を選んでください。'
         + 'CSVは受け取れません（文字化けが起きるためです）。';
  }
  return '';
}

/**
 * xlsx を Drive に「Googleの表として」上げて、そのIDを返す。
 *
 * 変換は `mimeType: application/vnd.google-apps.spreadsheet` を指定して行う。
 * `gas/Export.gs` が `/export?format=xlsx` を取っているのと、ちょうど裏返し。
 *
 * @return {string} 一時ファイルのID。作れなければ空文字
 */
function schedImportUpload_(base64, fileName) {
  var boundary = 'bondance-' + Utilities.getUuid();
  var meta = {
    name: '[取り込み中] ' + String(fileName || 'kougyou.xlsx').slice(0, 60) + ' '
        + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    mimeType: 'application/vnd.google-apps.spreadsheet',
  };
  var head = '--' + boundary + '\r\n'
    + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
    + JSON.stringify(meta) + '\r\n'
    + '--' + boundary + '\r\n'
    + 'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n';
  var tail = '\r\n--' + boundary + '--';

  var bytes = Utilities.newBlob(head).getBytes()
    .concat(Utilities.base64Decode(base64))
    .concat(Utilities.newBlob(tail).getBytes());

  var res;
  try {
    res = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
      {
        method: 'post',
        contentType: 'multipart/related; boundary=' + boundary,
        payload: bytes,
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true,
      });
  } catch (e) {
    logError_('schedImportUpload_', e);
    return '';
  }
  if (res.getResponseCode() !== 200) {
    logError_('schedImportUpload_', new Error(res.getResponseCode() + ' ' + res.getContentText()));
    return '';
  }
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e2) { body = null; }
  return (body && body.id) ? String(body.id) : '';
}

/**
 * 変換された表を読む。
 *
 * ■ **1枚目のシートだけ**を読む（書き出しは1枚しか作らない）
 * ■ **列は見出し行で見分ける。並び順では見分けない。**
 *   人は Excel で列を入れ替えるし、余分な列を足す。
 *   「左から3列目が終了日」と決め打ちすると、**黙って別の列を読む**ことになる
 * ■ **タスク名の列が無ければ、その場で断る**（②の ttReadRows_ と同じ判断）
 * ■ 知らない列は無視する
 *
 * @return {{rows:Array}|{message:string}}
 */
function schedImportRows_(ss) {
  var sheets = ss.getSheets();
  var sh = (sheets && sheets.length) ? sheets[0] : ss.getActiveSheet();
  if (!sh || sh.getLastRow() < 1) {
    return { message: 'Excelに中身がありませんでした。' };
  }
  var values = sh.getDataRange().getValues();
  var headers = (values[0] || []).map(function (h) { return asText_(h).trim(); });

  if (headers.indexOf('タスク名') < 0) {
    return { message: '「タスク名」の列が見つかりませんでした。'
           + '「Excelで保存」で書き出したものを直してお使いください。' };
  }

  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var line = values[i] || [];
    var o = { __row: i + 1 };
    var any = false;
    for (var c = 0; c < headers.length; c++) {
      var name = headers[c];
      if (!name) continue;                       // 見出しの無い列は読まない
      if (SCHED_HEADERS_.indexOf(name) < 0) continue;   // 知らない列は無視する
      var v = schedImportCell_(name, line[c]);
      o[name] = v;
      if (v !== '') any = true;
    }
    if (!any) continue;                          // 空の行は飛ばす
    rows.push(o);
  }
  return { rows: rows };
}

/**
 * セルを読む。**日付の列は、Excel から Date で来る。**
 *
 * ①の `schedDate_` が同じ役目を持っているので、それを通す。
 * 読む口を1つにしておかないと、経路によって別の値になる。
 */
function schedImportCell_(name, v) {
  if (name === '日付' || name === '終了日' || name === '完了日' || name === '起票日') {
    return schedDate_(v);
  }
  return asText_(v).trim();
}

/**
 * xlsx を受け取って、読んだ中身を返す。**台帳には1文字も書かない。**
 *
 * @return {{ok:true, rows:Array, leftover:boolean}|{ok:false, message:string}}
 */
function schedImportRead_(base64, fileName) {
  // **Drive に触る前に断る。**大きさと拡張子は、ここで見る
  var why = schedImportReject_(base64, fileName);
  if (why) return { ok: false, message: why };

  var id = '';
  /*
   * 返すものを**変数に持っておく**。
   *
   * `return { …, leftover: leftover }` と書くと、**finally が走る前に
   * 中身が組み立て終わっている**ので、finally で leftover を立てても
   * 返り値には入らない（②の書き出しで実際に踏んだ）。
   * 同じ入れ物に後から書き込めば、呼び出し側にも届く。
   */
  var out = null;
  try {
    id = schedImportUpload_(base64, fileName);
    if (!id) {
      return { ok: false,
        message: 'Excelを読み取れませんでした。'
               + '.xlsx として保存し直してから、もう一度お試しください。' };
    }
    var got = schedImportRows_(SpreadsheetApp.openById(id));
    if (got.message) return { ok: false, message: got.message };

    out = { ok: true, rows: got.rows, leftover: false };
    return out;
  } finally {
    /*
     * **必ず消す。**成功しても、断っても、途中で例外が出ても。
     * 消し忘れると Drive に台帳の中身が残る（資料フォルダは全共有）。
     */
    if (id) {
      try { DriveApp.getFileById(id).setTrashed(true); }
      catch (e) {
        // 消せなかったことを理由に取り込みを止めない（使えるのに使えなくなる）。
        // 代わりに**人に伝える**。黙って残すのがいちばん危ない
        if (out) out.leftover = true;
        logError_('schedImportRead_:片づけ', e);
      }
    }
  }
}
