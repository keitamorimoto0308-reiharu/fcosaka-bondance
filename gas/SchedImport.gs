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
  /*
   * **ID列が無ければ断る。**
   *
   * ID は「台帳のどの行か」を指す唯一の手がかり。無いまま取り込むと
   * 全行が「新しい行」として足され、**同じ工程表が2セット並ぶ**。
   * しかも下見は赤ゼロで「追加◯件」と出るので、押すまで気づけない。
   *
   * 2MB超の断り文が「いらない列を消してからお試しください」と案内している以上、
   * ID列を消す人は必ず出る（検証役 2026-09-07）。
   */
  if (headers.indexOf('ID') < 0) {
    return { message: '「ID」の列が見つかりませんでした。'
           + 'ID列は、いまある行を見分けるための番号です。'
           + 'これが無いと、すべての行が新しい行として足されます。'
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
    /*
     * **読んでいる最中に断る。**
     * 上限は取り込むときにしか見ていなかったので、500行のファイルでも
     * 下見は普通に出て、赤を全部直し終えてから「200行までです」と言われた
     * （それまでの直しが丸ごとむだ・検証役 2026-09-07）。
     * それに、読む側に上限が無いと、数十万行の .xlsx で
     * 実行時間の上限に当たる。**そのとき finally は走らないので、
     * 一時ファイルが Drive に残り続ける。**
     */
    if (rows.length > SCHED_IMPORT_ROWS_MAX) {
      return { message: '一度に取り込めるのは' + SCHED_IMPORT_ROWS_MAX + '行までです。'
             + 'Excelを' + SCHED_IMPORT_ROWS_MAX + '行ずつに分けて、'
             + '何回かに分けて取り込んでください。' };
    }
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
  /*
   * **断るときの返り値も out に持つ。**
   * 成功のときだけ out に入れていたので、「タスク名の列が無い」など
   * 断る道を通ると finally の `out.leftover = true` が何もせず、
   * 消せなかった一時ファイルを**黙って残していた**（検証役 2026-09-07）。
   * 「黙って残すのがいちばん危ない」という下の注意と矛盾していた。
   */
  var out = null;
  try {
    id = schedImportUpload_(base64, fileName);
    if (!id) {
      out = { ok: false, leftover: false,
        message: 'Excelを読み取れませんでした。'
               + '.xlsx として保存し直してから、もう一度お試しください。' };
      return out;
    }
    var got = schedImportRows_(SpreadsheetApp.openById(id));
    if (got.message) {
      out = { ok: false, leftover: false, message: got.message };
      return out;
    }

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


// ─────────────────────────────────────────── 照合（§3-3）

/** 一度に取り込める行数の上限。暴走を止める（②の予定と同じ考え方） */
var SCHED_IMPORT_ROWS_MAX = 200;

/**
 * 比べるのは**人が入れる欄だけ**（§3-6）。
 *
 * 更新者・更新日時・並び順・起票者・起票日を比べると、
 * **触れば必ず変わるので、全部が「更新」になる**。
 */
var SCHED_IMPORT_COMPARE_ = ['種類', '日付', '終了日', '領域', '担当会社', '担当者',
                            'タスク名', '詳細', 'ステータス', '備考'];

/** Excel の1行を、validateSchedRow_ が読める形にする */
function schedImportToItem_(r) {
  return {
    kind:      asText_(r['種類']).trim(),
    date:      asText_(r['日付']).trim(),
    endDate:   asText_(r['終了日']).trim(),
    area:      asText_(r['領域']).trim(),
    companies: asText_(r['担当会社']).trim(),
    people:    asText_(r['担当者']).trim(),
    title:     asText_(r['タスク名']).trim(),
    detail:    asText_(r['詳細']).trim(),
    status:    asText_(r['ステータス']).trim(),
    memo:      asText_(r['備考']).trim(),
  };
}

/**
 * 断りの文から、どの欄のことかを当てる。
 * **色を付ける列を決めるためだけ**に使う。当てられなければ空（行ごと色を付ける）。
 */
function schedImportFieldOf_(message) {
  var m = String(message || '');
  /*
   * 「期間には開始日が必要です。」は**日付**のこと。
   * この言い換えを知らなかったので、日付が空なのに
   * **タスク名のセルが赤くなっていた**（検証役 2026-09-07）。
   * 直す場所と、赤いところが違うと、人は直しようがない。
   */
  if (m.indexOf('開始日') >= 0) return '日付';
  var names = ['タスク名', '終了日', '日付', '領域', '種類', '担当会社', '担当者',
               'ステータス', '詳細', '備考'];
  for (var i = 0; i < names.length; i++) {
    if (m.indexOf(names[i]) >= 0) return names[i];
  }
  // 「『田中』は関係者リストにありません」は担当者のこと
  if (m.indexOf('関係者リスト') >= 0) return '担当者';
  return '';
}

/** 台帳の1行を、比べるための文字列にする */
function schedImportLedgerKey_(values, idx) {
  return JSON.stringify(SCHED_IMPORT_COMPARE_.map(function (h) {
    return (h === '日付' || h === '終了日')
      ? schedDate_(values[idx[h]]) : asText_(values[idx[h]]).trim();
  }));
}

/** 検証を通したあとの中身を、同じ形にする */
function schedImportItemKey_(item) {
  return JSON.stringify([
    item.kind, item.date, item.endDate, item.area,
    item.companies.join(', '), item.people.join(', '),
    item.title, item.detail, item.status, item.memo,
  ]);
}

/**
 * 下見を作る。**台帳には1文字も書かない。**
 *
 * @param {Array} rows   schedImportRead_ が返した行
 * @param {Object} people schedPeople_() の結果
 * @return {{items:Array, missing:Array, counts:Object}}
 */
function schedImportPlan_(rows, people) {
  var S = schedRows_();
  var idx = {};
  S.headers.forEach(function (h, i) { idx[h] = i; });

  /*
   * 台帳の行を ID で引けるようにする。
   *
   * **同じIDが2つある台帳を、そのまま扱ってはいけない。**
   * ここは後勝ちで覚え、書くときの schedImportFindRow_ は先勝ちで探していた。
   * このずれのせいで、直したい行は無傷のまま**別の行が丸ごと消え**、
   * それでも「更新1件・成功」が返っていた（検証役・2026-09-07）。
   * SCHED_HEADERS_ のコメントが書いている「甲がBを保存したつもりでCを
   * 上書きし、ok:true が返っていた」事故の、ID経路での再発。
   *
   * 台帳のIDが重複するのは、人がシートで行をコピーすれば起きる。
   * 直しようがないので**取り込みでは触らない**（消さないのが仕様なので、
   * 勝手に採番し直すこともしない）。人にシートで直してもらう。
   */
  var ledger = Object.create(null);
  var dupInLedger = Object.create(null);
  for (var i = 0; i < S.rows.length; i++) {
    var lid = asText_(S.rows[i][idx['ID']]).trim();
    if (!lid) continue;
    if (ledger[lid]) { dupInLedger[lid] = true; continue; }   // 先に見た行を残す
    ledger[lid] = { row: i + 2, values: S.rows[i] };
  }

  // **素の {} にしない**（constructor というIDで「もう見た」になる）
  var seen = Object.create(null);
  var used = Object.create(null);
  var items = [];

  (rows || []).forEach(function (r) {
    var id = asText_(r['ID']).trim();
    var problems = [];

    if (id) {
      // Excel で行をコピーすると ID も複製される。**これは必ず起きる**
      if (seen[id]) {
        problems.push({ field: 'ID', why: '同じIDの行が2つあります。'
          + '新しく足すなら、ID列を空にしてください。' });
      }
      seen[id] = true;
      if (dupInLedger[id]) {
        // 台帳のほうが壊れている。Excel を直しても直らないので、そう書く
        problems.push({ field: 'ID', why: '台帳に同じIDの行が2つあります。'
          + '先にスプレッドシートで片方のID列を空にしてください。' });
      }
      if (!ledger[id]) {
        // **黙って復活させない**
        problems.push({ field: 'ID', why: 'この行は台帳から削除されています。'
          + '新しく足すなら、ID列を空にしてください。' });
      }
    }

    // 検証は画面・シートと**同じ規則**（写しを作らない）
    var v = validateSchedRow_(schedImportToItem_(r), people);
    if (v.message) {
      problems.push({ field: schedImportFieldOf_(v.message), why: v.message });
    }

    var action;
    if (problems.length) {
      action = 'bad';
    } else if (!id) {
      action = 'add';
    } else {
      used[id] = true;
      action = (schedImportItemKey_(v.value)
                === schedImportLedgerKey_(ledger[id].values, idx)) ? 'same' : 'update';
    }
    items.push({ excelRow: r.__row || 0, id: id, action: action,
                 item: v.value || null, problems: problems, raw: r });
  });

  /*
   * 台帳にあって Excel に無いもの。**消さない**が、件数は知らせる（§4-2）。
   * 「Excelで消した」と「知らなかった」の区別がつかないので、消してはいけない。
   */
  var missing = [];
  Object.keys(ledger).forEach(function (lid) {
    if (used[lid]) return;
    var title = asText_(ledger[lid].values[idx['タスク名']]).trim();
    if (!title) return;
    missing.push({ id: lid, title: title });
  });

  var counts = { add: 0, update: 0, same: 0, bad: 0, missing: missing.length };
  items.forEach(function (x) { counts[x.action]++; });
  return { items: items, missing: missing, counts: counts };
}

// ─────────────────────────────────────────── 取り込み

/**
 * 画面が持っている行を受け取って、台帳に入れる。
 *
 * **実行時にサーバーが全部を検証し直す。**下見で通ったことを根拠にしない
 * （画面の変数は守りにならない。一括削除で同じ判断をした）。
 * **1行でも通らなければ、何も書かない。**
 */
function adminSchedImportApply_(auth, payload) {
  var rows = (payload && Array.isArray(payload.rows)) ? payload.rows : null;
  if (!rows) {
    return { ok: false, error: 'bad_value',
      message: '取り込む内容を読み取れませんでした。'
             + '画面を読み込み直してから、もう一度お願いします。' };
  }
  if (!rows.length) {
    return { ok: false, error: 'empty', message: '取り込む行がありません。' };
  }
  if (rows.length > SCHED_IMPORT_ROWS_MAX) {
    return { ok: false, error: 'too_many',
      message: '一度に取り込めるのは' + SCHED_IMPORT_ROWS_MAX + '行までです（'
             + rows.length + '行）。' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return { ok: false, error: 'busy',
             message: 'ほかの方が保存中です。少し待ってから、もう一度お願いします。' };
  }
  try {
    var plan = schedImportPlan_(rows, schedPeople_());

    // **1行でも通らなければ、何も書かない**
    var bad = plan.items.filter(function (x) { return x.action === 'bad'; });
    if (bad.length) {
      return { ok: false, error: 'bad_value',
        message: bad.length + '行に問題があります。直してから取り込んでください。',
        items: plan.items, counts: plan.counts, missing: plan.missing };
    }

    var S = schedRows_();
    var sh = S.sheet;
    var idx = {};
    S.headers.forEach(function (h, i) { idx[h] = i; });
    var today = schedToday_();
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');

    var added = 0, updated = 0;
    var undo = [];        // 書き換えた行の「前」と「後」。変更履歴に1件ずつ残す
    plan.items.forEach(function (x) {
      if (x.action === 'same') return;          // 触らない（更新者も塗り替えない）
      var line = schedImportLine_(x, idx, S, auth, today, now);
      if (x.action === 'add') { sh.appendRow(line); added++; return; }
      // 更新。行はIDで引き直す（下見のあとに並びが変わっていても大丈夫）
      var at = schedImportFindRow_(sh, x.id);
      if (!at) return;
      /*
       * **書き換える行は、前と後の全文を残す。**
       *
       * 設計§7 は「読み込み中に他人が直していても見ない」と決めた理由に
       * 「更新は変更履歴に全文が残るので、あとから追える」を挙げているのに、
       * 取り込みだけ要約1行しか残していなかった（検証役 2026-09-07）。
       * 古い Excel を取り込むと、他人の直しが黙って巻き戻るのに、
       * 何が消えたのかを知る手立てが無い状態だった。
       *
       * 足すのは**更新のときだけ**。追加は前が無いので要約で足りるし、
       * 全行ぶん残すと HISTORY_CELL_MAX に当たる。
       */
      var was = sh.getRange(at, 1, 1, SCHED_HEADERS_.length).getValues()[0];
      sh.getRange(at, 1, 1, SCHED_HEADERS_.length).setValues([line]);
      updated++;
      undo.push({ before: JSON.stringify(schedRowObject_(was)),
                  after: JSON.stringify(schedRowObject_(line)) });
    });
    SpreadsheetApp.flush();

    // 書き換えた行は1件ずつ残す（戻せるのはこれだけ）
    undo.forEach(function (u) {
      appendHistory((auth && auth.person) || '', '（スケジュール）', '取り込みで更新',
                    u.before, u.after, '');
    });

    /*
     * まとめの1行。**何件だったか**はこちらで見る。
     * 戻すのはスプレッドシートの版の履歴か、上の1件ずつの記録。
     */
    if (added || updated) {
      appendHistory((auth && auth.person) || '', '（スケジュール）', '取り込み',
                    '', '追加' + added + '件 ／ 更新' + updated + '件', '');
      lastActionSet_(SCHED_IMPORT_KEY_, (auth && auth.person) || '', new Date().getTime());
    }
    return { ok: true, added: added, updated: updated,
             same: plan.counts.same, missing: plan.missing.length };
  } finally {
    lock.releaseLock();
  }
}

/** 取り込む1行を組み立てる。**起票者と起票日は、更新では引き継ぐ** */
function schedImportLine_(x, idx, S, auth, today, now) {
  var item = x.item;
  var before = null;
  if (x.action === 'update') {
    for (var i = 0; i < S.rows.length; i++) {
      if (asText_(S.rows[i][idx['ID']]).trim() === x.id) { before = S.rows[i]; break; }
    }
  }
  var doneDate = '';
  if (schedSettled_(item.status)) {
    doneDate = (before ? schedDate_(before[idx['完了日']]) : '') || today;
  }
  var person = (auth && auth.person) || '';
  return [
    item.kind, item.date, item.endDate, item.area,
    safeCellText_(item.companies.join(', ')),
    safeCellText_(item.people.join(', ')),
    safeCellText_(item.title), safeCellText_(item.detail),
    item.status, safeCellText_(item.memo),
    doneDate,
    before ? before[idx['並び順']] : S.rows.length + 1,
    before ? safeCellText_(asText_(before[idx['起票者']])) : safeCellText_(person),
    before ? schedDate_(before[idx['起票日']]) : today,
    safeCellText_(person), now,
    x.id || schedNewId_(),
  ];
}

/** IDで行を引き直す。**行番号で指さない**（①が繰り返し刺されてきた形） */
function schedImportFindRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2 || !id) return 0;
  var col = sh.getRange(2, SCHED_ID_COL_, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (asText_(col[i][0]).trim() === id) return i + 2;
  }
  return 0;
}

/**
 * 画面から：下見を返す。**台帳には1文字も書かない。**
 *
 * 入口は2つある：
 *   - `base64` … ファイルを読む（最初の1回）
 *   - `rows`   … 画面が持っている行を、**そのまま見直す**
 *
 * 後者が要るのは、画面で赤い行を直したあと**同じ規則で見直す**ため。
 * 画面側に判定を写すと、サーバーとズレる（この案件が繰り返し避けてきた形）。
 */
function adminSchedImportRead_(auth, payload) {
  // 直したあとの見直し。ファイルは読まない
  if (payload && Array.isArray(payload.rows)) {
    // 見直しの入口にも同じ上限を置く。ここだけ素通しだと、
    // 画面を通さずに何万行でも送れる（①は一般権限でも呼べる）
    if (payload.rows.length > SCHED_IMPORT_ROWS_MAX) {
      return { ok: false, error: 'too_many',
        message: '一度に取り込めるのは' + SCHED_IMPORT_ROWS_MAX + '行までです（'
               + payload.rows.length + '行）。' };
    }
    var again = schedImportPlan_(payload.rows, schedPeople_());
    return { ok: true, items: again.items, counts: again.counts,
             missing: again.missing, leftover: false, message: '' };
  }
  var got = schedImportRead_(payload && payload.base64, payload && payload.fileName);
  if (!got.ok) return got;
  var plan = schedImportPlan_(got.rows, schedPeople_());
  return { ok: true, items: plan.items, counts: plan.counts, missing: plan.missing,
           leftover: got.leftover,
           // **0件でも「0件でした」と返す。**黙って正常を作らない
           message: got.rows.length ? '' : 'Excelに行がありませんでした。' };
}
