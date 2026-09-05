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

/**
 * 仕様書 §2-1 の列 ＋ **ID**。曜日の列は作らない（表示形式 m/d(ddd) で見せる）。
 *
 * ■ IDを足した理由（2026-09-04・検証役2体が独立に指摘）
 *   行を「シートの何行目か」だけで指していた。削除は全員に許す仕様なので、
 *   甲がBの編集を開いている間に乙がAを消すと、BとCが1つずつ繰り上がる。
 *   甲が保存すると **Cの中身がBの内容で丸ごと消え、ok:true が返っていた。**
 *   完了日も起票者も引き継がれるので、シートを見ても事故に見えない。
 *
 *   ②タイムスケジュール（design_timetable.md §2-1）は1列目に
 *   「ID：8桁の乱数。行の並べ替えでも変わらない印」を置いている。
 *   ①だけ行番号なのが不整合だった。
 *
 *   **末尾に置く**のは、人がシートを直接開いたときの読む順番を崩さないため。
 */
var SCHED_HEADERS_ = [
  '種類', '日付', '終了日', '領域', '担当会社', '担当者', 'タスク名', '詳細',
  'ステータス', '備考', '完了日', '並び順', '起票者', '起票日', '更新者', '更新日時',
  'ID',
];
var SCHED_ID_COL_ = 17;   // 1始まり。SCHED_HEADERS_ の 'ID' の位置

/** 行を見分ける印。8桁の英数字。行の並べ替えでも変わらない */
function schedNewId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

/**
 * 日付の欄を読む。
 *
 * **シートは日付を Date で返してくる。** 日付列に `m/d(ddd)` の表示形式を
 * 付けているので、Sheets が値を日付として持つため。
 * `asText_` は Date を `yyyy-MM-dd HH:mm` に整形するので、
 * そのまま使うと仕様§3-1 の `date:"2026-09-08"` という約束が破れる
 * （実際に破れていた。代役シートが文字列を返すのでテストでは再現しなかった）。
 *
 * ②の仕様書§2-1 が「シートの時刻値は GAS では Date として読まれ、
 * タイムゾーンで化ける」と書いているのと同じ話。**読む口を1つにする。**
 */
function schedDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return asText_(v).trim();
}

var SCHED_TITLE_MAX  = 200;
var SCHED_DETAIL_MAX = 1000;
var SCHED_MEMO_MAX   = 500;
var SCHED_LIST_MAX   = 20;   // 担当会社・担当者の件数の上限

var SCHED_WARN_DEFAULT_ = 3;

/**
 * 「まもなく期日」と出す日数。設定シートで変えられる（§4-4）。
 *
 * **空欄・読めない値のときは既定の3に落とす。**
 * 0 に倒すと「まもなく」の色が一度も出なくなる
 * （単価が空欄で0円になり、無料で受注した件と同じ倒し方をしない）。
 */
function schedWarnDays_() {
  var n = configNumber('スケジュールの警告日数');
  if (n === null || n === undefined || !(n >= 1) || n !== Math.floor(n)) {
    return SCHED_WARN_DEFAULT_;
  }
  return Math.min(n, 30);
}

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

/**
 * 文字の欄を読む。**読み取れないものは、読み取れないと返す。**
 *
 * `asText_` は何でも `String()` に通すので、`{}` を送ると
 * **「[object Object]」というタスク名の行が台帳に残る**（検証役の指摘・2026-09-04）。
 * 配列での文字数回避は塞いだのに、オブジェクトだけ素通りしていた。
 *
 * 受けるのは文字と数だけ。真偽値・配列・オブジェクト・関数は断る。
 * この案件には既に「配列や文字列で送られてきたら読み取れないと返す」作法がある
 * （`test/apply.test.js` 系）ので、それに揃える。
 */
function schedText_(v, label) {
  if (v === null || v === undefined) return { value: '' };
  var t = typeof v;
  if (t === 'number') {
    if (!isFinite(v)) return { message: label + 'を読み取れませんでした。' };
    return { value: String(v) };
  }
  if (t !== 'string') return { message: label + 'を読み取れませんでした。' };
  return { value: v.trim() };
}

/**
 * 日付の欄を読む。**日付の形のものだけを受ける。**
 *
 * `normalizeDue_` の正規表現には `^…$` が無いので、任意の文字列から
 * 4桁の並びを拾ってしまう（`鈴木2026-09-08です` → `2026-09-08`）。
 * 月末の実在も見ていないので `2026-02-31` が通る。
 * どちらも「読めないものを勝手に別の値にする」ほうで、この案件が禁じてきた形。
 *
 * `normalizeDue_` 自体は確認事項タブも使っているので触らず、
 * **①の入口で厳しくする**。
 */
function schedParseDate_(v, label) {
  var t = schedText_(v, label);
  if (t.message) return t;
  var s = schedHalfWidth_(t.value).trim();
  if (!s) return { value: '' };

  var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (!m) {
    var m2 = s.match(/^(\d{1,2})[-\/.](\d{1,2})$/);   // 「9/8」は今年として扱う
    if (!m2) {
      return { message: label + 'は「2026-09-08」の形でご入力ください。' };
    }
    m = [null, String(new Date().getFullYear()), m2[1], m2[2]];
  }
  var y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  // 実在する日かを、その月の日数で確かめる（2026-02-31 を通さない）
  var days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
              31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (mo < 1 || mo > 12 || da < 1 || da > days[mo - 1]) {
    return { message: label + 'にその日はありません。' };
  }
  return { value: y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + da).slice(-2) };
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
  people = people || { byName: Object.create(null) };

  /*
   * 送られたものが入れ物の形をしているか、先に見る。
   * これを見ずに進むと、payload が null や文字列のときに
   * **「領域が正しくありません。」**と返っていた（検証役の指摘・2026-09-04）。
   * 読んだ人は領域欄を探しに行ってしまう。
   */
  if (item === null || item === undefined || typeof item !== 'object'
      || Array.isArray(item)) {
    return { message: '送信された内容を読み取れませんでした。'
                    + '画面を読み込み直してから、もう一度お願いします。' };
  }

  var kindT = schedText_(item.kind, '種類');
  if (kindT.message) return kindT;
  var kind = kindT.value || 'タスク';
  if (SCHED_KINDS_.indexOf(kind) < 0) {
    return { message: '種類が正しくありません。' };
  }

  var areaT = schedText_(item.area, '領域');
  if (areaT.message) return areaT;
  var area = areaT.value;
  // 「正しくありません」では、選び忘れなのか値が変なのか分からない
  if (!area) return { message: '領域をお選びください。' };
  if (SCHED_AREAS_.indexOf(area) < 0) {
    return { message: '領域が正しくありません。' };
  }

  // 文字と数だけを受ける。**先に長さを見ると配列で制限を回避できる**ので、
  // 必ず schedText_ を通してから length を見る（検証役が見つけた抜け道）
  var titleT = schedText_(item.title, 'タスク名');
  if (titleT.message) return titleT;
  var title = titleT.value;
  if (!title) return { message: 'タスク名をご記入ください。' };
  if (title.length > SCHED_TITLE_MAX) {
    return { message: 'タスク名は' + SCHED_TITLE_MAX + '文字までです。' };
  }

  var detailT = schedText_(item.detail, '詳細');
  if (detailT.message) return detailT;
  var detail = detailT.value;
  if (detail.length > SCHED_DETAIL_MAX) {
    return { message: '詳細は' + SCHED_DETAIL_MAX + '文字までです。' };
  }
  var memoT = schedText_(item.memo, '備考');
  if (memoT.message) return memoT;
  var memo = memoT.value;
  if (memo.length > SCHED_MEMO_MAX) {
    return { message: '備考は' + SCHED_MEMO_MAX + '文字までです。' };
  }

  var date = schedParseDate_(item.date, '日付');
  if (date.message) return { message: date.message };
  // マイルストーンは「その日」を指すもの。日付が無いとどの週にも入らず、
  // 画面から見えなくなる（期間は必須にしてあるのに、ここだけ空で通っていた）
  if (kind === 'マイルストーン' && !date.value) {
    return { message: 'マイルストーンには日付が必要です。' };
  }

  // 終了日は**期間のときだけ**持つ。ほかの種類で送られてきたら落とす。
  // 断らずに落とすのは、画面が誤って送っても人の作業を止めないため。
  var endDate = '';
  if (kind === '期間') {
    if (!date.value) return { message: '期間には開始日が必要です。' };
    var end = schedParseDate_(item.endDate, '終了日');
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
  if (list.length > SCHED_LIST_MAX) {
    return { message: '担当者は' + SCHED_LIST_MAX + '人までです。' };
  }
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
  /*
   * **件数の上限を必ず置く。** タスク名200・詳細1000・備考500 は効いていたのに、
   * ここだけ素通しだった。検証役が3,000件（18万字）を通し、
   * 10万件では重複除去の indexOf が O(n^2) で9分52秒かかることを実測した
   * （GASの実行時間6分を超える）。一般パスワードは営業に広く配る前提。
   */
  if (given.length > SCHED_LIST_MAX) {
    return { message: '担当会社は' + SCHED_LIST_MAX + '件までです。' };
  }
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

/**
 * 1行を、列名つきの入れ物にする。変更履歴に「行の全文」を残すために使う。
 * 更新者・更新日時は除く（触れば必ず変わるので、比べる意味がない）。
 */
function schedRowObject_(values) {
  var o = {};
  SCHED_HEADERS_.forEach(function (h, i) {
    if (h === '更新者' || h === '更新日時') return;
    o[h] = (h === '日付' || h === '終了日' || h === '完了日' || h === '起票日')
      ? schedDate_(values[i]) : asText_(values[i]);
  });
  return o;
}

/**
 * `row` を読む。**読み取れないものを、黙って「新規追加」にしない。**
 *
 * `Number(payload.row) || 0` と書いていたので、`"2abc"` も `{}` も `NaN` も
 * すべて 0 に落ちて「新規」になっていた（検証役の指摘・2026-09-04）。
 * 画面が壊れて row を落とすだけで、編集のたびに重複行が増える。
 * 仕様書自身が「黙って既定値に落とさない」と書いている形。
 *
 * 小数も断る。`getRange(2.5, …)` は原因の分からない例外になる。
 */
function schedRowArg_(payload) {
  var raw = payload ? payload.row : undefined;
  if (raw === undefined || raw === null || raw === '') return { row: 0 };
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return { message: 'どの行かを読み取れませんでした。'
                    + '画面を読み込み直してから、もう一度お願いします。' };
  }
  var n = Number(raw);
  if (!isFinite(n) || n !== Math.floor(n) || n < 0 || String(raw).trim() === '') {
    return { message: 'どの行かを読み取れませんでした。'
                    + '画面を読み込み直してから、もう一度お願いします。' };
  }
  return { row: n };
}

/**
 * 「その行が、画面が編集していた行か」を確かめる。
 *
 * ■ なぜ要るか（2026-09-04・検証役2体が独立に指摘）
 *   行番号だけで指すと、他人が1行消した瞬間に全部が繰り上がる。
 *   甲がBを保存したつもりで、**Cを丸ごと上書きして ok:true が返っていた。**
 *   削除も同じで、押した覚えのないタスクが消えた。
 *
 * ■ 見つからなければ探しに行く
 *   行がずれていても、IDが一致する行があればそれが目的の行。
 *   断って読み直させるより、**そのまま正しい行を直すほうが親切**で、しかも安全。
 *   本当に消えていたときだけ断る。
 *
 * @return {{row:number, values:Array}} または {{error:string, message:string}}
 */
function schedFindRow_(sh, row, id) {
  var n = SCHED_HEADERS_.length;
  var last = sh.getLastRow();
  var reload = '画面を読み込み直してから、もう一度お願いします。';

  // 整数でない行番号を Sheets に渡すと、原因の分からない例外になる
  if (!(row >= 2) || row !== Math.floor(row) || row > last) {
    return { error: 'not_found',
             message: 'その行は見つかりませんでした。' + reload };
  }

  var values = sh.getRange(row, 1, 1, n).getValues()[0];
  var here = asText_(values[SCHED_ID_COL_ - 1]).trim();

  if (id && here === id) return { row: row, values: values };

  // IDを持たない行（人がシートに直接足した行）は、そのまま受ける
  if (!here && !id) return { row: row, values: values };

  if (!id) {
    return { error: 'stale',
             message: 'この行を指し示せませんでした。' + reload };
  }

  // 行がずれただけかもしれない。IDで探し直す
  if (last >= 2) {
    var col = sh.getRange(2, SCHED_ID_COL_, last - 1, 1).getValues();
    for (var i = 0; i < col.length; i++) {
      if (asText_(col[i][0]).trim() === id) {
        return { row: i + 2, values: sh.getRange(i + 2, 1, 1, n).getValues()[0] };
      }
    }
  }
  return { error: 'moved',
           message: 'この行は、ほかの方が削除したようです。' + reload };
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
      id:        asText_(r[idx['ID']]).trim(),
      kind:      asText_(r[idx['種類']]).trim() || 'タスク',
      date:      schedDate_(r[idx['日付']]),
      endDate:   schedDate_(r[idx['終了日']]),
      area:      asText_(r[idx['領域']]).trim(),
      companies: schedList_(r[idx['担当会社']]),
      people:    schedList_(r[idx['担当者']]),
      title:     title,
      detail:    asText_(r[idx['詳細']]).trim(),
      status:    asText_(r[idx['ステータス']]).trim(),
      memo:      asText_(r[idx['備考']]).trim(),
      doneDate:  schedDate_(r[idx['完了日']]),
      order:     Number(r[idx['並び順']]) || 0,
      author:    asText_(r[idx['起票者']]).trim(),
      createdAt: schedDate_(r[idx['起票日']]),
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
    /*
     * **auth は { person, role } しか持たない**（gas/Auth.gs:154）。
     * auth.company を読んでいたので undefined になり、
     * 仕様§4-3 の「自社の担当だけ」が本番で必ず死んでいた。
     * テストが auth を自分で作って company を持たせていたので気づけなかった。
     * 所属は関係者シートから引く。
     */
    warnDays: schedWarnDays_(),
    me: { person: (auth && auth.person) || '',
          company: (auth && people.byName[auth.person]) || '' },
    today: schedToday_(),
  };
}

/**
 * Excel に書き出す（§6-2）。中身は gas/Export.gs（②と共通）。
 * 列は SCHED_HEADERS_ そのまま（人がシートを見るときの並びと同じ）。
 */
function adminSchedExport_(auth) {
  var S = schedRows_();
  var idx = {};
  S.headers.forEach(function (h, i) { idx[h] = i; });

  var body = [];
  for (var i = 0; i < S.rows.length; i++) {
    var r = S.rows[i];
    if (!asText_(r[idx['タスク名']]).trim()) continue;
    body.push(SCHED_HEADERS_.map(function (h) {
      return (h === '日付' || h === '終了日' || h === '完了日' || h === '起票日')
        ? schedDate_(r[idx[h]]) : asText_(r[idx[h]]);
    }));
  }

  var out = exportXlsx_('制作スケジュール', [{
    name: '制作スケジュール',
    headers: SCHED_HEADERS_.slice(),
    rows: body,
    widths: [90, 110, 110, 80, 140, 140, 300, 340, 90, 220, 110, 70, 100, 100, 100, 130, 90],
  }]);
  if (out.ok && !body.length) out.message = '0件でした（見出しだけの表を書き出しました）。';
  return out;
}

/** 1行の追加または更新。row が無ければ追加 */
function adminSchedSave_(auth, payload) {
  var got = schedRowArg_(payload);
  if (got.message) return { ok: false, error: 'bad_value', message: got.message };
  var row = got.row;                                // 0 なら新規

  var v = validateSchedRow_(payload && payload.item, schedPeople_());
  if (v.message) return { ok: false, error: 'bad_value', message: v.message };
  var item = v.value;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return { ok: false, error: 'busy',
             message: 'ほかの方が保存中です。少し待ってから、もう一度お願いします。' };
  }
  try {
    var S = schedRows_();
    var sh = S.sheet;
    var today = schedToday_();
    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');

    // 既存行なら、先に読む。完了日と起票者は**前の値を引き継ぐ**必要がある
    var before = null;
    var id = asText_(payload && payload.id).trim();
    if (row) {
      var found = schedFindRow_(sh, row, id);
      if (found.message) return { ok: false, error: found.error, message: found.message };
      row = found.row;
      before = found.values;
    }

    /*
     * 完了日は自動で入る。ただし**空のときだけ**。
     * 人が手で直した日付を、保存のたびに今日で塗り替えてはいけない
     * （あとから記録することがある）。決着から戻したときは空に戻す。
     */
    var doneDate = '';
    if (schedSettled_(item.status)) {
      var prev = before ? schedDate_(before[10]) : '';
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
      id || schedNewId_(),                 // ID。行がずれても変わらない印
    ];

    if (!row) {
      sh.appendRow(line);
      SpreadsheetApp.flush();
      appendHistory(auth.person, '（スケジュール）', '追加', '', item.title, '');
      return { ok: true, added: true };
    }

    line[11] = before[11];                          // 並び順は変えない
    line[12] = safeCellText_(asText_(before[12]));  // 起票者も変えない
    line[13] = schedDate_(before[13]);              // 起票日も変えない
    line[16] = asText_(before[16]).trim() || schedNewId_();   // IDは引き継ぐ
    sh.getRange(row, 1, 1, SCHED_HEADERS_.length).setValues([line]);
    SpreadsheetApp.flush();

    /*
     * **更新も変更履歴に残す。**
     * 削除は全文を残すのに、上書きは痕跡ゼロだった（検証役2体が指摘・2026-09-04）。
     * 全員が編集できる画面では、他人にタスク名や期日を書き換えられたとき、
     * 削除より復元しにくい状態になっていた。
     *
     * 変わっていないときは残さない。ステータスのチップを押すたびに増えると、
     * 本当の変更が埋もれる（警報を増やしすぎない、と同じ考え方）。
     */
    var beforeText = JSON.stringify(schedRowObject_(before));
    var afterText = JSON.stringify(schedRowObject_(line));
    if (beforeText !== afterText) {
      appendHistory(auth.person, '（スケジュール）', '更新', beforeText, afterText, '');
    }
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
  var got = schedRowArg_(payload);
  if (got.message) return { ok: false, error: 'bad_value', message: got.message };
  var row = got.row;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return { ok: false, error: 'busy',
             message: 'ほかの方が保存中です。少し待ってから、もう一度お願いします。' };
  }
  try {
    var sh = schedSheet_();
    // **行番号だけで消してはいけない。**他人が先に1行消していると、
    // 押した覚えのないタスクが消える（削除の再送・連打でも同じことが起きる）
    var found = schedFindRow_(sh, row, asText_(payload && payload.id).trim());
    if (found.message) return { ok: false, error: found.error, message: found.message };
    row = found.row;

    var before = found.values;
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
var SCHED_TODO_DONE_ = '確認事項（移行済み）';

/**
 * 確認事項の移行が済んでいるか。
 *
 * setup() は setupTodoSheet_ → setupSchedSheet_ の順に走る。
 * これを見ずに2回目を実行すると、**確認事項シートを作り直してしまい**、
 * 「確認事項」と「確認事項（移行済み）」が並んで一本化が破れる。
 */
function schedTodoMigrated_(ss) {
  return !!ss.getSheetByName(SCHED_TODO_DONE_);
}

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

      var due = normalizeDue_(schedHalfWidth_(schedDate_(values[i][idx['期日']])));
      var done = normalizeDue_(schedHalfWidth_(schedDate_(values[i][idx['完了日']])));

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
        schedDate_(values[i][idx['起票日']]),
        '',                             // 更新者（移行では触っていない）
        '',                             // 更新日時
        schedNewId_(),                  // ID
      ]);
      moved++;
    }

    if (moved) {
      /*
       * **同名のシートがあると setName は例外を投げる。**
       * 以前は衝突を考えていなかったので、3回目の setup() がここで止まり、
       * しかも行は追加済みなので押すたびに増え続けた（検証役の指摘・2026-09-04）。
       * 空いている名前を探してから改名する。
       */
      var name = SCHED_TODO_DONE_;
      for (var n = 2; ss.getSheetByName(name); n++) name = SCHED_TODO_DONE_ + n;
      src.setName(name);
    }
  }

  console.log('確認事項から制作スケジュールへ ' + moved + ' 件を移しました'
    + (moved ? '。元のシートは「' + SHEET.TODO + '（移行済み）」として残しています。'
             : '（移すものはありませんでした）。'));
  return moved;
}
