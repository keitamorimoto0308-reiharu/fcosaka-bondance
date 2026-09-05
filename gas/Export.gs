// ─────────────────────────────────────────── 書き出し（①②で共通）
/**
 * 表を Excel（xlsx）にして、**Base64 で画面に返す**。
 *
 * 仕様は docs/internal/design_timetable.md §6-2・§6-3。
 * ①制作スケジュール表と②タイムスケジュールの**両方がここを通る**。
 * 写しを2つ書くと、片方だけ直したときに気づけない。
 *
 * ■ ライブラリは入れない
 *   GAS上でスプレッドシートを組み立て、Google の /export?format=xlsx を叩く。
 *   これなら色分けも列幅もそのまま Excel に乗る。
 *
 * ■ **Drive に置いたリンクは返さない**
 *   資料フォルダは全共有になっている。
 *   Drive は「共有フォルダの中だけを制限付きにする」ができないので、
 *   置いた時点で誰でも開ける可能性がある。
 *   引き継ぎ書§6「**分けられないものは外に出す**」
 *   （応募企業の提出物をリンク共有フォルダから出した件）と同じ判断。
 *
 * ■ **一時ファイルの消し忘れは、静かな事故**
 *   Driveが散らかるだけでなく、**台帳の中身がそのまま残る**。
 *   だから成功しても失敗しても、finally で必ず消す。
 *   消すのに失敗したときは、書き出しは返したうえで `leftover` で伝える
 *   （消せなかったことを理由に書き出しを止めると、
 *     「使えるのに使えない」状態になる）。
 */

/** 1回に書き出せる行数の上限。桁を打ち間違えても被害を頭打ちにする */
var EXPORT_MAX_ROWS = 2000;

/**
 * ファイル名に使えない文字を落とす。
 *
 * Windows は `\ / : * ? " < > |` を受けない。
 * 残したままだと、ダウンロードした時点で名前が変わるか、保存に失敗する。
 */
function exportSafeName_(s) {
  return String(s == null ? '' : s)
    .replace(/[\\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || '書き出し';
}

/**
 * 表を1枚以上まとめて xlsx にする。
 *
 * @param {string} name   ファイル名のもと（「進行表」など）
 * @param {Array<{name:string, headers:Array, rows:Array<Array>, widths:Array}>} sheets
 * @return {{ok:boolean, base64?:string, filename?:string, rows?:number,
 *           leftover?:boolean, message?:string}}
 */
function exportXlsx_(name, sheets) {
  if (!Array.isArray(sheets) || !sheets.length) {
    return { ok: false, message: '書き出す表がありません。' };
  }
  var total = 0;
  for (var i = 0; i < sheets.length; i++) {
    var n = (sheets[i] && Array.isArray(sheets[i].rows)) ? sheets[i].rows.length : 0;
    total += n;
  }
  if (total > EXPORT_MAX_ROWS) {
    return { ok: false,
      message: '一度に書き出せるのは' + EXPORT_MAX_ROWS + '行までです（' + total + '行）。' };
  }

  var ss = null;
  /*
   * 返すものを**変数に持っておく**。
   *
   * `return { ... leftover: leftover }` と書くと、
   * **finally が走る前に中身が組み立て終わっている**ので、
   * finally で leftover を立てても返り値には入らない
   * （2026-09-05、実際にそうなっていた。検査が捕まえた）。
   * 同じ入れ物に後から書き込めば、呼び出し側にも届く。
   */
  var out = null;
  try {
    // 一時ファイル。**名前で分かるようにしておく**（万一残ったときに拾えるように）
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    try {
      ss = SpreadsheetApp.create('[書き出し中] ' + exportSafeName_(name) + ' ' + stamp);
    } catch (e) {
      logError_('exportXlsx_:create', e);
      return { ok: false,
        message: '書き出し用の一時ファイルを作れませんでした。'
               + 'Driveの空き容量と権限をご確認ください。' };
    }

    exportFillSheets_(ss, sheets);
    SpreadsheetApp.flush();

    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId()
            + '/export?format=xlsx';
    var res;
    try {
      res = UrlFetchApp.fetch(url, {
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true,
      });
    } catch (e2) {
      logError_('exportXlsx_:fetch', e2);
      return { ok: false,
        message: 'Excelの書き出しに失敗しました。少し待ってから、もう一度お試しください。' };
    }
    if (res.getResponseCode() !== 200) {
      return { ok: false,
        message: 'Excelの書き出しに失敗しました（' + res.getResponseCode() + '）。'
               + '少し待ってから、もう一度お試しください。' };
    }

    out = {
      ok: true,
      base64: Utilities.base64Encode(res.getBlob().getBytes()),
      filename: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
                + '_' + exportSafeName_(name) + '.xlsx',
      rows: total,
      leftover: false,
    };
    return out;
  } finally {
    /*
     * **必ず消す。**成功しても失敗しても、途中で例外が出ても。
     * 消し漏れは Driveが散らかるだけでなく、**中身が残る**。
     */
    if (ss) {
      try { DriveApp.getFileById(ss.getId()).setTrashed(true); }
      catch (e3) {
        // 消せなかったことを理由に書き出しを止めない（使えるのに使えなくなる）。
        // 代わりに **人に伝える**。黙って残すのがいちばん危ない
        if (out) out.leftover = true;
        logError_('exportXlsx_:片づけ', e3);
      }
    }
  }
}

/** 表を、一時スプレッドシートに流し込む */
function exportFillSheets_(ss, sheets) {
  sheets.forEach(function (spec, i) {
    var sh = (i === 0) ? ss.getActiveSheet() : ss.insertSheet(exportSafeName_(spec.name));
    if (i === 0 && sh.setName) {
      try { sh.setName(exportSafeName_(spec.name)); } catch (e) {}
    }
    var headers = Array.isArray(spec.headers) ? spec.headers : [];
    var rows = Array.isArray(spec.rows) ? spec.rows : [];
    var cols = Math.max(headers.length, 1);

    if (headers.length) {
      sh.getRange(1, 1, 1, headers.length)
        .setValues([headers.map(function (h) { return safeCellText_(h); })]);
      if (sh.getRange(1, 1, 1, headers.length).setFontWeight) {
        sh.getRange(1, 1, 1, headers.length)
          .setFontWeight('bold').setBackground('#EEEEEE');
      }
    }
    if (rows.length) {
      // **数式になりうる文字で始まる値を、そのままセルに入れない。**
      // Excel でも先頭の = は数式として解釈される
      var body = rows.map(function (r) {
        var line = [];
        for (var c = 0; c < cols; c++) line.push(safeCellText_(r[c]));
        return line;
      });
      sh.getRange(2, 1, body.length, cols).setValues(body);
    }
    (spec.widths || []).forEach(function (w, c) {
      if (sh.setColumnWidth) { try { sh.setColumnWidth(c + 1, w); } catch (e) {} }
    });
    if (sh.setFrozenRows) { try { sh.setFrozenRows(1); } catch (e) {} }
  });
}
