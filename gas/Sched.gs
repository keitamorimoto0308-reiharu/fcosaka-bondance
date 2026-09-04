// ─────────────────────────────────────────── ① 制作スケジュール表
/**
 * 本番日（2026-10-24）までの工程を、1本の時間軸に並べる。
 * 仕様は docs/internal/design_schedule_plan.md（gitignore 対象・手元にある）。
 *
 * ■ 誰が触れるか
 *   **全員**（けいた確定・2026-09-03）。追加も編集も削除もできる。
 *   `adminOnly` には入れない。管理者だけにすると、結局シートを直接開くことになって
 *   形骸化する（確認事項タブで同じ判断をしている）。
 *   代わりに「誰が起票したか・誰が最後に触ったか」を必ず残し、
 *   **削除は変更履歴に行の全文を残す**。それが唯一の復元手段になる。
 *
 * ■ 確認事項タブはここに一本化する
 *   2か所に期日つきの宿題があると、必ず片方が腐る。
 *   既存の行は setup() のときに移す（gas/Setup.gs の setupSchedSheet_）。
 */

/**
 * 選択肢は**ここが正**。画面は adminSched_ が返した配列から組む。
 *
 * 配列にしてあるのは意図的で、照合は indexOf で行う。
 * 素のオブジェクトのキー照合にすると、`constructor` と書くだけで真になる
 * （2026-09-02 に UPLOAD_ALLOWED が素の {} だったため .exe が置けた）。
 */
var SCHED_KINDS_    = ['タスク', '期間', 'マイルストーン'];
var SCHED_AREAS_    = ['全体', '会議', '企画', '営業', '制作', '運営'];
var SCHED_STATUSES_ = ['未着手', '進行中', '確認中', '完了', '停滞中', '見送り'];

/** 仕様書 §2-1 の列。曜日の列は作らない（シートの表示形式 m/d(ddd) で見せる） */
var SCHED_HEADERS_ = [
  '種類', '日付', '終了日', '領域', '担当会社', '担当者', 'タスク名', '詳細',
  'ステータス', '備考', '完了日', '並び順', '起票者', '起票日', '更新者', '更新日時',
];

var SCHED_TITLE_MAX  = 200;
var SCHED_DETAIL_MAX = 1000;
var SCHED_MEMO_MAX   = 500;

/** サーバーの今日。端末の時計はずれるので、遅れの判定はこれで行う（§3-1） */
function schedToday_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

function schedSheet_() {
  return sheet_(SHEET.SCHED);
}

function schedRows_() {
  var sh = schedSheet_();
  if (sh.getLastRow() < 2) return { sheet: sh, headers: [], rows: [] };
  var values = sh.getDataRange().getValues();
  return { sheet: sh,
           headers: values[0].map(function (h) { return String(h).trim(); }),
           rows: values.slice(1) };
}

/**
 * 全角の数字と記号を半角に直す。
 *
 * **これは「黙って別の値になる」変換ではない。** 日本語IMEでは「２０２６」が普通に出るので、
 * 文字の書き分けを揃えているだけで、値は同じ。
 * 禁じているのは `Number('５')` のように**読めないものを勝手に数にする**ほうで
 * （それで -500 が 500 に、０．５ が 0 になった）、こちらは別もの。
 */
function schedHalfWidth_(v) {
  return asText_(v)
    .replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[－ー―‐]/g, '-')
    .replace(/／/g, '/');
}

/** カンマ区切りの欄を配列にする。空は落とす */
function schedList_(v) {
  return asText_(v).split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

/** この案件に関わる会社。自由入力も受けるが、候補としてはこの3つを先に出す */
var SCHED_COMPANIES_ = ['FC大阪', 'UPDATER', 'LOP'];

/**
 * 関係者シートから「氏名 → 所属」を引けるようにする。
 *
 * **親を持たない入れ物にする。** 素の {} だと、担当者に `constructor` と書くだけで
 * 「実在する人」として通る（2026-09-02 に .exe が置けた穴と同じ形）。
 */
function schedPeople_() {
  var byName = Object.create(null);
  var byCompany = Object.create(null);
  var sh = sheet_(SHEET.PEOPLE);
  if (sh.getLastRow() < 2) return { byName: byName, byCompany: byCompany };

  var values = sh.getDataRange().getValues();
  var idx = {};
  values[0].forEach(function (h, i) { idx[String(h).trim()] = i; });

  for (var i = 1; i < values.length; i++) {
    var name = asText_(values[i][idx['氏名']]).trim();
    if (!name) continue;
    var company = asText_(values[i][idx['所属']]).trim();
    byName[name] = company;
    if (company) {
      if (!byCompany[company]) byCompany[company] = [];
      byCompany[company].push(name);
    }
  }
  return { byName: byName, byCompany: byCompany };
}

/**
 * 入力を検証して、シートに書ける形に整える。
 * **通らないものは理由を添えて断る。**黙って既定値に落とさない
 * （「単価が空欄なら0円」で無料受注が起きた件と同じ轍）。
 */
function validateSchedRow_(item, people) {
  item = item || {};
  people = people || { byName: Object.create(null) };

  var kind = asText_(item.kind).trim() || 'タスク';
  if (SCHED_KINDS_.indexOf(kind) < 0) {
    return { message: '種類が正しくありません。' };
  }

  var area = asText_(item.area).trim();
  if (SCHED_AREAS_.indexOf(area) < 0) {
    return { message: '領域が正しくありません。' };
  }

  // asText_ を必ず通してから長さを見る。
  // 先に item.title.length を見ると、**配列で制限を回避できる**
  // （検証役が実際に見つけた抜け道）。
  var title = asText_(item.title).trim();
  if (!title) return { message: 'タスク名をご記入ください。' };
  if (title.length > SCHED_TITLE_MAX) {
    return { message: 'タスク名は' + SCHED_TITLE_MAX + '文字までです。' };
  }

  var detail = asText_(item.detail).trim();
  if (detail.length > SCHED_DETAIL_MAX) {
    return { message: '詳細は' + SCHED_DETAIL_MAX + '文字までです。' };
  }
  var memo = asText_(item.memo).trim();
  if (memo.length > SCHED_MEMO_MAX) {
    return { message: '備考は' + SCHED_MEMO_MAX + '文字までです。' };
  }

  var date = normalizeDue_(schedHalfWidth_(item.date));
  if (date.message) return { message: date.message };

  // 終了日は**期間のときだけ**持つ。ほかの種類で送られてきたら落とす。
  // 断らずに落とすのは、画面が誤って送っても人の作業を止めないため。
  var endDate = '';
  if (kind === '期間') {
    if (!date.value) return { message: '期間には開始日が必要です。' };
    var end = normalizeDue_(schedHalfWidth_(item.endDate));
    if (end.message) return { message: end.message };
    if (!end.value) return { message: '期間には終了日が必要です。' };
    // 「2026-09-30」の形にそろえてあるので、文字列のまま比べられる
    if (end.value < date.value) {
      return { message: '終了日が開始日より前になっています。' };
    }
    endDate = end.value;
  }

  // ステータスを持つのはタスクだけ。期間とマイルストーンには「完了」がありえない。
  var status = '';
  if (kind === 'タスク') {
    status = asText_(item.status).trim() || '未着手';
    if (SCHED_STATUSES_.indexOf(status) < 0) {
      return { message: 'ステータスが正しくありません。' };
    }
  }

  /*
   * 担当者は、関係者シートに実在する人だけ。
   * 名前を自由入力にすると「小谷」「小谷さん」「コタニ」が並び、
   * 「自社の担当だけ」の絞り込みが効かなくなる。
   * 断るときは**誰が問題なのか**を書く（「担当者が正しくありません」では直せない）。
   */
  var chosen = [];
  var list = Array.isArray(item.people) ? item.people : schedList_(item.people);
  for (var i = 0; i < list.length; i++) {
    var name = asText_(list[i]).trim();
    if (!name) continue;
    if (!(name in people.byName)) {
      return { message: '「' + name + '」は関係者リストにありません。'
                      + '先に「関係者」タブで登録してください。' };
    }
    if (chosen.indexOf(name) < 0) chosen.push(name);
  }

  /*
   * 担当会社は、書かれたものに**担当者の所属を足す**。
   * 「担当者は小谷さん（FC大阪）なのに担当会社はUPDATERだけ」を作れなくする。
   * 逆（会社を選んだら人が入る）はやらない。
   * 人を勝手に割り当てると、本人が知らない担当が生まれる。
   */
  var companies = [];
  var given = Array.isArray(item.companies) ? item.companies : schedList_(item.companies);
  given.forEach(function (c) {
    var name = asText_(c).trim().slice(0, 60);
    if (name && companies.indexOf(name) < 0) companies.push(name);
  });
  chosen.forEach(function (p) {
    var c = people.byName[p];
    if (c && companies.indexOf(c) < 0) companies.push(c);
  });

  return { value: {
    kind: kind, date: date.value, endDate: endDate, area: area,
    companies: companies, people: chosen,
    title: title, detail: detail, status: status, memo: memo,
  } };
}

/** 完了・見送りは「決着した」とみなす。完了日はこのときだけ入る */
function schedSettled_(status) {
  return status === '完了' || status === '見送り';
}

/** 全行を返す。絞り込みはしない（40〜80行なので画面側で足りる） */
function adminSched_(auth) {
  var S = schedRows_();
  var idx = {};
  S.headers.forEach(function (h, i) { idx[h] = i; });

  var out = [];
  for (var i = 0; i < S.rows.length; i++) {
    var r = S.rows[i];
    var title = asText_(r[idx['タスク名']]).trim();
    if (!title) continue;               // 空行は無いものとして扱う
    out.push({
      row: i + 2,
      kind:      asText_(r[idx['種類']]).trim() || 'タスク',
      date:      asText_(r[idx['日付']]).trim(),
      endDate:   asText_(r[idx['終了日']]).trim(),
      area:      asText_(r[idx['領域']]).trim(),
      companies: schedList_(r[idx['担当会社']]),
      people:    schedList_(r[idx['担当者']]),
      title:     title,
      detail:    asText_(r[idx['詳細']]).trim(),
      status:    asText_(r[idx['ステータス']]).trim(),
      memo:      asText_(r[idx['備考']]).trim(),
      doneDate:  asText_(r[idx['完了日']]).trim(),
      order:     Number(r[idx['並び順']]) || 0,
      author:    asText_(r[idx['起票者']]).trim(),
      createdAt: asText_(r[idx['起票日']]).trim(),
      updatedBy: asText_(r[idx['更新者']]).trim(),
      updatedAt: asText_(r[idx['更新日時']]).trim(),
    });
  }

  /*
   * 会社の候補は「決まっている3社 ＋ 関係者の所属 ＋ すでに使われた自由入力」。
   * 候補を出さないと「FC大阪」「FC大阪株式会社」「fc大阪」が並ぶ。
   */
  var people = schedPeople_();
  var companies = SCHED_COMPANIES_.slice();
  var addCompany = function (c) {
    if (c && companies.indexOf(c) < 0) companies.push(c);
  };
  Object.keys(people.byCompany).forEach(addCompany);
  out.forEach(function (r) { r.companies.forEach(addCompany); });

  return {
    ok: true,
    rows: out,
    areas: SCHED_AREAS_.slice(),
    statuses: SCHED_STATUSES_.slice(),
    kinds: SCHED_KINDS_.slice(),
    companies: companies,
    peopleByCompany: people.byCompany,
    me: { person: auth && auth.person, company: auth && auth.company },
    today: schedToday_(),
  };
}

/** 1行の追加または更新。row が無ければ追加 */
function adminSchedSave_(auth, payload) {
  var row = Number(payload && payload.row) || 0;   // 0 なら新規
  var v = validateSchedRow_(payload && payload.item, schedPeople_());
  if (v.message) return { ok: false, error: 'bad_value', message: v.message };
  var item = v.value;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var S = schedRows_();
    var sh = S.sheet;
    var today = schedToday_();
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');

    // 既存行なら、先に読む。完了日と起票者は**前の値を引き継ぐ**必要がある
    var before = null;
    if (row) {
      if (row < 2 || row > sh.getLastRow()) return { ok: false, error: 'not_found' };
      before = sh.getRange(row, 1, 1, SCHED_HEADERS_.length).getValues()[0];
    }

    /*
     * 完了日は自動で入る。ただし**空のときだけ**。
     * 人が手で直した日付を、保存のたびに今日で塗り替えてはいけない
     * （あとから記録することがある）。決着から戻したときは空に戻す。
     */
    var doneDate = '';
    if (schedSettled_(item.status)) {
      var prev = before ? asText_(before[10]).trim() : '';
      doneDate = prev || today;
    }

    var line = [
      item.kind, item.date, item.endDate, item.area,
      safeCellText_(item.companies.join(', ')),
      safeCellText_(item.people.join(', ')),
      safeCellText_(item.title), safeCellText_(item.detail),
      item.status, safeCellText_(item.memo),
      doneDate,
      sh.getLastRow(),                     // 並び順（末尾に追加）
      safeCellText_(auth.person), today,   // 起票者・起票日は名乗らせない
      safeCellText_(auth.person), now,
    ];

    if (!row) {
      sh.appendRow(line);
      SpreadsheetApp.flush();
      appendHistory(auth.person, '（スケジュール）', '追加', '', item.title, '');
      return { ok: true, added: true };
    }

    line[11] = before[11];                 // 並び順は変えない
    line[12] = asText_(before[12]);        // 起票者も変えない
    line[13] = asText_(before[13]);        // 起票日も変えない
    sh.getRange(row, 1, 1, SCHED_HEADERS_.length).setValues([line]);
    SpreadsheetApp.flush();
    return { ok: true, added: false };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 1行の削除。
 *
 * ■ なぜ全員に許すか
 *   ①は全員が編集できる（けいた確定）。削除だけ管理者にすると、
 *   間違えて入れた行が残り続けて、表が信用されなくなる。
 *
 * ■ 代わりに、変更履歴に**行の全文**を残す
 *   これが唯一の復元手段になる。要約（タスク名だけ）では戻せない。
 *   画面には押す前に「元に戻すには変更履歴から手で入れ直すことになります」と出す。
 */
function adminSchedDelete_(auth, payload) {
  var row = Number(payload && payload.row) || 0;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var sh = schedSheet_();
    // 1行目は見出し。2行目より前と、最終行より後は受け付けない
    if (row < 2 || row > sh.getLastRow()) return { ok: false, error: 'not_found' };

    var before = sh.getRange(row, 1, 1, SCHED_HEADERS_.length).getValues()[0];
    var full = {};
    SCHED_HEADERS_.forEach(function (h, i) { full[h] = asText_(before[i]); });

    sh.deleteRow(row);
    SpreadsheetApp.flush();
    appendHistory(auth.person, '（スケジュール）', '削除',
                  JSON.stringify(full), '', '');
    return { ok: true, title: full['タスク名'] };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 確認事項シートの行を、制作スケジュールへ移す。setup() から呼ぶ。
 *
 * ■ なぜ一本化するか
 *   2か所に期日つきの宿題があると、必ず片方が腐る。
 *   確認事項の8列は、この表の列に丸ごと含まれる。
 *
 * ■ 元のシートは消さない
 *   名前を「確認事項（移行済み）」に変えるだけ。
 *   消すと、移行に失敗した行があったときに取り返せない。
 *   名前が変わるので、2回目以降は見つからず、**二重に移らない**。
 *
 * ■ 0件でも必ずログに出す
 *   2026-09-03 に「列を足しました」のログが出ない道があって、
 *   けいたが実行できたか分からなくなった。
 *   2026-09-04 には setup() の戻り値がログに出ないことで、また同じ迷いが起きた。
 *   **「黙って正常」を作らない。**
 *
 * @return {number} 移した件数
 */
function schedMigrateTodos_(ss) {
  var src = ss.getSheetByName(SHEET.TODO);
  var moved = 0;

  if (src && src.getLastRow() >= 2) {
    var values = src.getDataRange().getValues();
    var idx = {};
    values[0].forEach(function (h, i) { idx[String(h).trim()] = i; });

    var people = schedPeople_();
    var dst = sheet_(SHEET.SCHED);

    for (var i = 1; i < values.length; i++) {
      var text = asText_(values[i][idx['内容']]).trim();
      if (!text) continue;                       // 空行は移さない

      var memo = asText_(values[i][idx['メモ']]).trim();
      var owner = asText_(values[i][idx['担当']]).trim();
      var person = '', company = '';
      if (owner && (owner in people.byName)) {
        person = owner;
        company = people.byName[owner] || '';
      } else if (owner) {
        /*
         * 関係者リストに無い名前は、担当者に入れない。
         * 入れてしまうと、その行は**画面から二度と保存できなくなる**
         * （保存のたびに「関係者リストにありません」で断られる）。
         * かといって名前を捨てるわけにもいかないので、備考に残す。
         */
        memo = (memo ? memo + ' / ' : '') + '担当（移行時）：' + owner;
      }

      var status = asText_(values[i][idx['状態']]).trim();
      if (SCHED_STATUSES_.indexOf(status) < 0) status = '未着手';

      var due = normalizeDue_(schedHalfWidth_(values[i][idx['期日']]));
      var done = normalizeDue_(schedHalfWidth_(values[i][idx['完了日']]));

      dst.appendRow([
        'タスク',                       // 種類
        due.value || '',                // 日付
        '',                             // 終了日
        '会議',                         // 領域（打ち合わせの宿題なので）
        safeCellText_(company),
        safeCellText_(person),
        safeCellText_(text),            // タスク名
        '',                             // 詳細
        status,
        safeCellText_(memo),
        done.value || '',               // 完了日
        dst.getLastRow(),               // 並び順
        safeCellText_(asText_(values[i][idx['起票者']]).trim()),
        asText_(values[i][idx['起票日']]).trim(),
        '',                             // 更新者（移行では触っていない）
        '',                             // 更新日時
      ]);
      moved++;
    }

    if (moved) src.setName(SHEET.TODO + '（移行済み）');
  }

  console.log('確認事項から制作スケジュールへ ' + moved + ' 件を移しました'
    + (moved ? '。元のシートは「' + SHEET.TODO + '（移行済み）」として残しています。'
             : '（移すものはありませんでした）。'));
  return moved;
}
