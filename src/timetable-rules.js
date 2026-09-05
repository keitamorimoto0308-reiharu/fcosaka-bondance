/**
 * ② タイムスケジュールの規則：ずらし・共存・ロック。
 *
 * 仕様は docs/internal/design_timetable.md §5（手順4）。
 *
 * ── なぜ画面の外に置くか ──
 * 画面（`src/build-admin.js`）の中に書くと、テストから呼べない。
 * `src/schema.js` が条件判定を文字列化してブラウザとGASの両方に埋め込んでいるのと
 * 同じ考え方で、**規則を1か所に置いて、画面とテストの両方が同じものを呼ぶ**。
 *
 * ── 埋め込み方（src/linkify.js と同じ方式）──
 * `rulesSource()` が返す文字列を `src/build-admin.js` が画面に書き出す。
 * **`.toString()` は関数の外側のスコープを失う**ので、
 * ここの関数は「自分の引数と、この中の関数」だけで完結していなければならない。
 *
 *   - モジュール変数（定数）を参照しない。**数は関数の中に書く**
 *   - `require` したものを参照しない
 *   - 互いに呼び合うのはよい（まとめて1つの塊として書き出すため）
 *
 * ①では `esc` を引数で受け取ることでこれを解決した。ここでは
 * **レーンの一覧を引数で受け取る**（正は `gas/Timetable.gs` の `TT_LANES_`）。
 *
 * ── この規則が答えないこと ──
 * 「どこを使うか（ステージ／広場／控室）」は持たない（§5-4）。
 * だから重なりを見るのは**同じレーンの中だけ**。
 */

/**
 * `11:00` → 660。**読めなければ null。0 に倒さない。**
 *
 * `Number('')` が 0 になって単価が「0円」になった件と同じ倒し方をしない。
 * サーバー側の `hhmmToMin_`（gas/Timetable.gs）と同じ答えを返すこと。
 * GAS は require できないので写しを避けられないぶん、
 * `test/timetable-rules.test.js` が2つを突き合わせている。
 */
function ttMinutes(hhmm) {
  var m = String(hhmm === null || hhmm === undefined ? '' : hhmm)
    .match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 660 → `11:00`。読めない値は空文字（勝手に 00:00 にしない） */
function ttHhmm(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0 || n !== Math.floor(n)) return '';
  var h = Math.floor(n / 60), mi = n % 60;
  return ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
}

/** 予定の終わり（分）。読めない行は null */
function ttEnd(row) {
  var s = ttMinutes(row && row.start);
  if (s === null) return null;
  var d = Number(row.min);
  if (!isFinite(d) || d < 0) d = 0;
  return s + Math.floor(d);
}

/** 行を浅く写す（元の配列を書き換えない。取り消し（Ctrl+Z）が壊れる） */
function ttCopy(rows) {
  return (rows || []).map(function (r) {
    var o = {};
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) o[k] = r[k];
    return o;
  });
}

/**
 * 「隙間なく続いている一連のもの」を、指定の時刻から順にずらす。
 *
 * ■ 止まる条件は3つ（§5-1・§5-3）
 *   - 隙間がある（1分でも空いていれば、そこで止まる）
 *   - ロックされている（押し出さない）
 *   - ずらすと翌日にはみ出す
 *
 * ■ ずらすのは**同じレーンの中だけ**
 *   オープニングを10分伸ばしても、ゲートオープン（全体）も
 *   会場入り（備考）も動かない。
 *
 * @param {Array} rows   写し済みの行（この中身を書き換える）
 * @param {string} lane  対象のレーン
 * @param {number} from  この分から始まる予定を探す
 * @param {number} delta ずらす分
 * @param {string} skipId 自分自身は動かさない
 * @return {{moved:Array, stopped:string}} stopped は '' / 'gap' / 'locked' / 'day'
 */
function ttPushChain(rows, lane, from, delta, skipId) {
  var moved = [];
  var at = from;
  var guard = 0;
  while (guard++ < 500) {
    var next = null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.id === skipId || r.lane !== lane) continue;
      if (ttMinutes(r.start) !== at) continue;
      // 同じ時刻に2つあるときは、先に見つかったほうを追う。
      // どちらを追っても「隙間なく続いている」の判定は変わらない
      next = r;
      break;
    }
    // そこから始まる予定が無い＝隙間がある。1分でも空いていれば止まる（§5-1）
    if (!next) return { moved: moved, stopped: 'gap' };
    // ロックは「押し出さない」印。ここで止める（§5-3）
    if (next.locked) return { moved: moved, stopped: 'locked' };

    var end = ttEnd(next);
    if (end === null) return { moved: moved, stopped: 'gap' };
    // ずらした結果が翌日にかかるなら、**ずらさずに止める**。
    // 24:00 に丸めると、黙って別の値になる
    if (at + delta < 0 || end + delta > 24 * 60) {
      return { moved: moved, stopped: 'day' };
    }
    next.start = ttHhmm(at + delta);
    moved.push(next.id);
    at = end;
  }
  return { moved: moved, stopped: '' };
}

/**
 * 所要時間を変える（下端をドラッグ・§4-1）。
 *
 * 「伸ばす」＝進行が押した → **後ろが押し出されるのが自然**。
 *
 * @return {{rows:Array, moved:Array, stopped:string}}
 */
function ttResize(rows, id, newMin) {
  var out = ttCopy(rows);
  var target = null;
  for (var i = 0; i < out.length; i++) if (out[i].id === id) target = out[i];
  if (!target) return { rows: out, moved: [], stopped: 'notfound' };

  var start = ttMinutes(target.start);
  if (start === null) return { rows: out, moved: [], stopped: 'badtime' };

  var want = Number(newMin);
  if (!isFinite(want) || want < 0 || want !== Math.floor(want)) {
    return { rows: out, moved: [], stopped: 'badvalue' };
  }
  // 自分自身が翌日にはみ出す長さは受けない（§3-4 と同じ線引き）
  if (start + want > 24 * 60) return { rows: out, moved: [], stopped: 'day' };

  var oldEnd = ttEnd(target);
  var delta = want - (oldEnd - start);
  target.min = want;
  if (delta === 0) return { rows: out, moved: [], stopped: '' };

  var pushed = ttPushChain(out, target.lane, oldEnd, delta, id);
  return { rows: out, moved: pushed.moved, stopped: pushed.stopped };
}

/**
 * 予定を差し込む（空いている時間をクリック・§4-1）。
 * その時刻から始まる一連のものが、差し込んだぶんだけ後ろへずれる。
 */
function ttInsert(rows, item) {
  var out = ttCopy(rows);
  out.push(item);
  var start = ttMinutes(item && item.start);
  if (start === null) return { rows: out, moved: [], stopped: 'badtime' };

  var d = Number(item.min);
  if (!isFinite(d) || d <= 0) return { rows: out, moved: [], stopped: '' };

  var pushed = ttPushChain(out, item.lane, start, Math.floor(d), item.id);
  return { rows: out, moved: pushed.moved, stopped: pushed.stopped };
}

/**
 * 予定を動かす（ドラッグ・§4-1）。**後ろをずらさない**（§5-1）。
 *
 * 「動かす」＝置き場所を変えた → そこに入れたいだけ。
 * かぶれば半分幅で共存して警告が出る（`ttLayout` / `ttWarnings`）。
 *
 * @param {Array} lanes レーンの一覧。**渡さなければレーンは変えない**
 *   （規則にレーン名を直書きしないため。正は gas/Timetable.gs の TT_LANES_）
 */
function ttMove(rows, id, lane, start, lanes) {
  var out = ttCopy(rows);
  var target = null;
  for (var i = 0; i < out.length; i++) if (out[i].id === id) target = out[i];
  if (!target) return { rows: out, moved: [], stopped: 'notfound' };

  var at = ttMinutes(start);
  if (at === null) return { rows: out, moved: [], stopped: 'badtime' };

  var d = Number(target.min);
  if (!isFinite(d) || d < 0) d = 0;
  if (at + Math.floor(d) > 24 * 60) return { rows: out, moved: [], stopped: 'day' };

  if (lane !== undefined && lane !== null && lane !== target.lane) {
    var ok = false;
    if (lanes && lanes.length) {
      for (var k = 0; k < lanes.length; k++) if (lanes[k] === lane) ok = true;
    }
    if (!ok) {
      // 時刻だけは動かす。レーンが違うだけで操作を丸ごと捨てると、
      // 使う人には「動かなかった」としか見えない
      target.start = ttHhmm(at);
      return { rows: out, moved: [], stopped: 'lane' };
    }
    target.lane = lane;
  }
  target.start = ttHhmm(at);
  return { rows: out, moved: [], stopped: '' };
}

/**
 * 重なりを見て、共存の幅を決める（§5-2）。
 *
 * ■ 重なりは**同じレーンの中だけ**（§5-4）
 *
 * ■ 「隣り合っている」は重なりではない
 *   終わりと始まりが同じ分なら、重なっていない。
 *   これを重なりにすると、隙間なく組んだ時間割が全部警告になる。
 *
 * ■ 0分の予定（時刻だけの目印）は重なりにしない
 *   ゲートオープンは**点であって帯ではない**。帯として扱うと、
 *   その時刻に始まる予定と必ず重なって、警告が意味を失う。
 *
 * @return {Object} id → { col, cols, overlap }
 */
function ttLayout(rows) {
  var out = {};
  var byLane = {};
  var i, r;
  for (i = 0; i < (rows || []).length; i++) {
    r = rows[i];
    out[r.id] = { col: 0, cols: 1, overlap: false };
    var s = ttMinutes(r.start);
    if (s === null) continue;                 // 読めない行は、重なりを見ない
    var e = ttEnd(r);
    if (e === null || e <= s) continue;        // 0分の目印は帯にしない
    if (!byLane[r.lane]) byLane[r.lane] = [];
    byLane[r.lane].push({ id: r.id, s: s, e: e });
  }

  for (var lane in byLane) {
    if (!Object.prototype.hasOwnProperty.call(byLane, lane)) continue;
    var list = byLane[lane].slice().sort(function (a, b) {
      return a.s - b.s || a.e - b.e || (a.id < b.id ? -1 : 1);
    });
    // 重なりの塊（クラスタ）ごとに幅を等分する。Googleカレンダーと同じ
    var cluster = [];
    var clusterEnd = -1;
    for (i = 0; i <= list.length; i++) {
      var item = list[i];
      if (item && cluster.length && item.s < clusterEnd) {
        cluster.push(item);
        if (item.e > clusterEnd) clusterEnd = item.e;
        continue;
      }
      if (item && !cluster.length) {
        cluster.push(item); clusterEnd = item.e;
        continue;
      }
      // 塊が閉じた
      if (cluster.length) {
        for (var c = 0; c < cluster.length; c++) {
          out[cluster[c].id].col = c;
          out[cluster[c].id].cols = cluster.length;
          out[cluster[c].id].overlap = cluster.length > 1;
        }
      }
      cluster = item ? [item] : [];
      clusterEnd = item ? item.e : -1;
    }
  }
  return out;
}

/**
 * 重なっている組を返す（上に出す警告帯の文面のため・§5-2）。
 *
 * **警告は帯で出す。トーストにしない**（数秒で消えると
 * 「保存されたつもり」になる。それがいちばん危ない）。
 */
function ttWarnings(rows) {
  var L = ttLayout(rows);
  var groups = {};
  var i, r;
  for (i = 0; i < (rows || []).length; i++) {
    r = rows[i];
    if (!L[r.id] || !L[r.id].overlap) continue;
    if (!groups[r.lane]) groups[r.lane] = [];
    groups[r.lane].push(r);
  }
  var out = [];
  for (var lane in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, lane)) continue;
    var list = groups[lane];
    // 同じレーンの重なりを、つながっている塊ごとにまとめる
    var sorted = list.slice().sort(function (a, b) {
      return ttMinutes(a.start) - ttMinutes(b.start);
    });
    var run = [];
    var runEnd = -1;
    for (i = 0; i <= sorted.length; i++) {
      var it = sorted[i];
      if (it && run.length && ttMinutes(it.start) < runEnd) {
        run.push(it);
        if (ttEnd(it) > runEnd) runEnd = ttEnd(it);
        continue;
      }
      if (it && !run.length) { run = [it]; runEnd = ttEnd(it); continue; }
      if (run.length > 1) {
        out.push({
          lane: lane,
          ids: run.map(function (x) { return x.id; }),
          titles: run.map(function (x) { return x.title; }),
          start: run[0].start,
        });
      }
      run = it ? [it] : [];
      runEnd = it ? ttEnd(it) : -1;
    }
  }
  return out;
}

/**
 * 画面に書き出す文字列。**ここに並べた関数だけが画面から呼べる。**
 *
 * `src/build-admin.js` がこれをテンプレートに埋め込む。
 * 関数どうしは呼び合ってよい（同じ塊として1つのスコープに出るため）が、
 * このファイルのモジュール変数は**失われる**。
 */
function rulesSource() {
  return [ttMinutes, ttHhmm, ttEnd, ttCopy, ttPushChain,
          ttResize, ttInsert, ttMove, ttLayout, ttWarnings]
    .map(function (fn) { return fn.toString(); })
    .join(String.fromCharCode(10) + String.fromCharCode(10));
}

module.exports = {
  ttMinutes: ttMinutes, ttHhmm: ttHhmm, ttEnd: ttEnd,
  ttPushChain: ttPushChain, ttResize: ttResize, ttInsert: ttInsert,
  ttMove: ttMove, ttLayout: ttLayout, ttWarnings: ttWarnings,
  rulesSource: rulesSource,
};
