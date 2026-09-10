/**
 * 搬入の時間割：混み具合の集計と、時刻の配り方。
 *
 * 仕様は docs/internal/design_loadin.md。
 *
 * ── なぜ画面の外に置くか ──
 * 画面（`src/build-admin.js`）の中に書くと、テストから呼べない。
 * この機能の心臓部は「区画の順に並べて、枠に詰める」計算で、
 * 端の場合（上限ちょうど・未割当・1台が上限を超える）が実際に起きる。
 * **形を見る検査では、この振る舞いは捕まえられない**（引き継ぎ書 §9）。
 *
 * ── 埋め込み方（src/timetable-rules.js と同じ方式）──
 * `loadinSource()` が返す文字列を `src/build-admin.js` が画面に書き出す。
 * **`.toString()` は関数の外側のスコープを失う**ので、
 * ここの関数は「自分の引数と、この中の関数」だけで完結していなければならない。
 *
 *   - モジュール変数（定数）を参照しない。**数は引数で受け取る**
 *   - `require` したものを参照しない
 *   - 互いに呼び合うのはよい（まとめて1つの塊として書き出すため）
 *
 * ── 正規表現を使わない ──
 * 書き出し先は `clientJs()` のテンプレートリテラルの中。
 * そこで `\d` と書くと**バックスラッシュが1層落ちて `d` になり、
 * エラーも出さずに何にもマッチしなくなる**（引き継ぎ書 §8。実地で9回踏んでいる）。
 */

/** 「9:30」→ 570。読めなければ null（**空文字も null**） */
function loadinToMin(t) {
  var s = String(t == null ? '' : t).trim();
  var i = s.indexOf(':');
  if (i < 1) return null;
  var hs = s.slice(0, i), ms = s.slice(i + 1);
  if (hs.length > 2 || ms.length !== 2) return null;
  // Number('') は 0 になる。空を 0 時と読ませない
  if (hs.length === 0) return null;
  // 数字だけでできているか。**正規表現を使わない**（このファイルの決まり）。
  // Number('1e1') は 10 を返すので、桁を1文字ずつ見るのがいちばん確実
  if (!loadinAllDigits(hs) || !loadinAllDigits(ms)) return null;
  var h = Number(hs), m = Number(ms);
  if (!isFinite(h) || !isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** 全部が半角数字か（空は偽） */
function loadinAllDigits(s) {
  var t = String(s == null ? '' : s);
  if (t.length === 0) return false;
  for (var i = 0; i < t.length; i++) {
    if ('0123456789'.indexOf(t.charAt(i)) < 0) return false;
  }
  return true;
}

/** 570 → 「9:30」。読めない値では空を返す（'NaN:NaN' のような表示を作らない） */
function loadinToHhmm(n) {
  var v = Math.floor(Number(n));
  if (!isFinite(v) || v < 0) return '';
  var h = Math.floor(v / 60), m = v % 60;
  return h + ':' + (m < 10 ? '0' + m : String(m));
}

/**
 * その社の車両台数。
 *
 * ■ 「まだ答えていない」と「0台と答えた」を区別する
 *   - **未提出（空欄）は 1 とみなす。** 0 にすると、確定情報がまだの社が多い
 *     あいだ「空いている」に見えてしまう。既定値は混雑を**多めに**見せる側へ倒す
 *   - **0 と答えた社は 0。** 徒歩搬入は正当な回答で（応募項目の既定値も 0）、
 *     それを1台に数えると「全体で入りきりません」が誤って点灯する
 *     （2026-09-09、検証役の指摘）
 */
function loadinCarsOf(row) {
  var raw = (row || {})['確定：搬入車両台数'];
  if (raw === '' || raw === null || raw === undefined) return 1;   // まだ答えていない
  var n = Number(raw);
  if (!isFinite(n) || n < 0) return 1;                              // 読めない値も安全側へ
  return Math.floor(n);                                             // 0 と答えたなら 0
}

/**
 * 枠ごとの混み具合。
 *
 * 返すもの：
 *   slots     … [{ at:分, hhmm:'9:30', n:社数, cars:台数, over:上限超え }]
 *   undecided … 搬入予定時刻が入っていない社
 *   outside   … 窓の外の時刻が入っている社
 *   cap       … のべ何台まで入るか
 *   cars      … いま何台あるか（未定・窓の外も含む）
 */
function loadinBuckets(rows, fromMin, toMin, stepMin, capPerSlot) {
  var slots = [], i;
  for (i = fromMin; i < toMin; i += stepMin) {
    slots.push({ at: i, hhmm: loadinToHhmm(i), n: 0, cars: 0, over: false });
  }
  var undecided = { n: 0, cars: 0 };
  var outside = { n: 0, cars: 0 };

  (rows || []).forEach(function (x) {
    var cars = loadinCarsOf(x);
    var t = loadinToMin(x['搬入予定時刻']);
    if (t === null) { undecided.n++; undecided.cars += cars; return; }
    if (t < fromMin || t >= toMin) { outside.n++; outside.cars += cars; return; }
    var k = Math.floor((t - fromMin) / stepMin);
    if (k < 0 || k >= slots.length) { outside.n++; outside.cars += cars; return; }
    slots[k].n++; slots[k].cars += cars;
  });

  var cars = undecided.cars + outside.cars;
  slots.forEach(function (s) {
    s.over = s.cars > capPerSlot;
    cars += s.cars;
  });

  return {
    slots: slots, undecided: undecided, outside: outside,
    cap: slots.length * capPerSlot, cars: cars,
  };
}

/**
 * 時刻を配る。
 *
 * ■ 並べ方は**区画番号の順**
 *   搬入は会場の入口から順に埋めるのが現実の動き。受付ID順に配ると、
 *   隣どうしの区画がばらばらの時間に来て、車両がすれ違う。
 *   区画が未割当の社は**後ろにまわす**（番号が無いので順を決められない）。
 *
 * ■ 1枠の上限を超えたら、次の枠へ
 *   ただし**枠を空のまま飛ばさない**。1社で上限を超える大型車が来ても、
 *   その社はその枠に入れる（次に送っても同じことが起きるだけ）。
 *
 * ■ 窓の外へはみ出しても、ここでは止めない
 *   「報せるが、止めない」（design_loadin.md §2-1）。
 *   はみ出すことは、呼んだ側が最後の時刻を見て人に伝える。
 */
function loadinPlan(rows, fromMin, stepMin, capPerSlot, occupied) {
  var list = (rows || []).slice();
  // すでにその枠にいる台数（{分: 台数}）。渡されなければ空とみなす。
  // **これが無いと、既にいる社を数えずに詰めてしまい、
  //   「押す前に見せた計画」と実際の混み具合が食い違う**（2026-09-09 の指摘）
  var used0 = occupied || {};

  list.sort(function (a, b) {
    var sa = Number(a['割当開始区画']), sb = Number(b['割当開始区画']);
    var na = isFinite(sa) && sa > 0, nb = isFinite(sb) && sb > 0;
    if (na && nb) {
      if (sa !== sb) return sa - sb;
      return String(a['受付ID']).localeCompare(String(b['受付ID']));
    }
    if (na) return -1;
    if (nb) return 1;
    return String(a['受付ID']).localeCompare(String(b['受付ID']));
  });

  var num = function (v) { var n = Number(v); return (isFinite(n) && n > 0) ? n : 0; };

  var out = [], at = fromMin, used = num(used0[fromMin]);
  list.forEach(function (x) {
    var cars = loadinCarsOf(x);
    // used > 0 の条件が要る。これが無いと、1社で上限を超える車が来たとき
    // **空の枠を延々と飛ばし続ける**
    if (used > 0 && used + cars > capPerSlot) {
      at += stepMin;
      used = num(used0[at]);          // 次の枠にも、すでにいるかもしれない
    }
    out.push({ id: x['受付ID'], at: loadinToHhmm(at), name: x['企業名'] || x['受付ID'] });
    used += cars;
  });
  return out;
}

/**
 * 枠ごとの「すでにいる台数」を作る（`loadinPlan` の `occupied` に渡す形）。
 *
 * **これから入れる相手（除外リスト）は数えない。**
 * 上書きするなら、その社の分は空くため。
 */
function loadinOccupied(rows, fromMin, stepMin, exceptIds) {
  var skip = {};
  (exceptIds || []).forEach(function (id) { skip[String(id)] = true; });
  var out = {};
  (rows || []).forEach(function (x) {
    if (skip[String(x['受付ID'])]) return;
    var t = loadinToMin(x['搬入予定時刻']);
    if (t === null) return;
    var k = fromMin + Math.floor((t - fromMin) / stepMin) * stepMin;
    out[k] = (out[k] || 0) + loadinCarsOf(x);
  });
  return out;
}

/**
 * 画面に書き出す文字列。**ここに並べた関数だけが画面から呼べる。**
 *
 * `src/build-admin.js` がこれをテンプレートに埋め込む。
 */
function loadinSource() {
  return [loadinToMin, loadinAllDigits, loadinToHhmm, loadinCarsOf,
          loadinBuckets, loadinPlan, loadinOccupied]
    .map(function (fn) { return fn.toString(); })
    .join(String.fromCharCode(10) + String.fromCharCode(10));
}

module.exports = {
  loadinToMin: loadinToMin,
  loadinAllDigits: loadinAllDigits,
  loadinOccupied: loadinOccupied,
  loadinToHhmm: loadinToHhmm,
  loadinCarsOf: loadinCarsOf,
  loadinBuckets: loadinBuckets,
  loadinPlan: loadinPlan,
  loadinSource: loadinSource,
};
