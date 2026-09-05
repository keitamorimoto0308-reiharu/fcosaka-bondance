/**
 * ② タイムスケジュールの規則（`src/timetable-rules.js`）。
 *
 * ずらし・共存・ロックの規則だけを、**画面と切り離して**確かめる
 * （design_timetable.md §9 の手順4。ここを飛ばさないこと）。
 *
 * ■ なぜ画面の外に出すか
 *   画面の中に書くと、テストから呼べない。
 *   `src/schema.js` が条件判定を文字列化してブラウザとGASの両方に埋め込んでいるのと
 *   同じ考え方で、**規則を1か所に置いて、画面とテストの両方が同じものを呼ぶ**。
 *
 * ■ この検査は「埋め込んだ形」で動かす
 *   画面には `fn.toString()` で書き出す（①の src/linkify.js と同じ方式）。
 *   **`.toString()` は関数の外側のスコープを失う。**
 *   require したものだけを試すと、外側の定数を参照していても通ってしまい、
 *   **画面でだけ落ちる**。だから、ここでは書き出した文字列を
 *   まっさらな箱で評価して、そこから呼ぶ。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const RULES = require('../src/timetable-rules.js');

/**
 * 画面に書き出すのと**まったく同じ文字列**を、外に何も無い箱で評価する。
 * ここで落ちるなら、画面でも落ちる。
 */
const SANDBOX = (() => {
  const box = { Math, Number, String, Array, Object, JSON, isFinite };
  vm.createContext(box);
  vm.runInContext(RULES.rulesSource(), box);
  return box;
})();

/** 箱の中の規則を呼ぶ（画面と同じ経路） */
function call(name, ...args) {
  SANDBOX.__args = JSON.parse(JSON.stringify(args));
  return JSON.parse(JSON.stringify(
    vm.runInContext(name + '.apply(null, __args)', SANDBOX)));
}

/**
 * レーンの一覧は、本来サーバー（`adminTimetable` の `lanes`）が返すもの。
 * 規則には直書きしないので、呼ぶ側が渡す。
 */
const LANES = ['全体', 'イベント', '備考'];

/** 見やすく書くための短縮。lane / start / min / locked */
function ev(id, lane, start, min, locked) {
  return { id: id, lane: lane, start: start, min: min, locked: !!locked,
           title: id, casts: [], detail: '' };
}

/** 結果を「id 開始 所要」の並びにして比べる */
function shape(rows) {
  return rows.map(r => r.id + ' ' + r.start + ' ' + r.min).join(' / ');
}

describe('②の規則：時刻の読み書き', () => {

  test('11:00 は 660 分', () => {
    assert.strictEqual(call('ttMinutes', '11:00'), 660);
  });

  test('読めない時刻は null（0 に倒さない）', () => {
    ['', '25:00', '11:60', 'あ', '1100', null].forEach(bad => {
      assert.strictEqual(call('ttMinutes', bad), null, JSON.stringify(bad));
    });
  });

  test('660 分は 11:00', () => {
    assert.strictEqual(call('ttHhmm', 660), '11:00');
    assert.strictEqual(call('ttHhmm', 0), '00:00');
    assert.strictEqual(call('ttHhmm', 1439), '23:59');
  });

  test('サーバーの hhmmToMin_ と、同じ答えを返す', () => {
    /*
     * **同じ規則が2か所にある**（ブラウザ用と GAS 用）。
     * GAS は require できないので写しを避けられない。
     * だから「ズレていないこと」を検査で押さえる。
     * ここが落ちたら、片方だけ直したということ。
     */
    const gas = fs.readFileSync(path.join(ROOT, 'gas', 'Timetable.gs'), 'utf8')
      .split('\r\n').join('\n');
    const s = gas.indexOf('function hhmmToMin_(');
    const e = gas.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s) + 3;
    assert.ok(e > s, 'hhmmToMin_ を切り出せませんでした');
    const box = { String, Number };
    vm.createContext(box);
    vm.runInContext(gas.slice(s, e), box);

    const samples = ['00:00', '9:00', '09:00', '11:00', '23:59', '24:00', '', '25:00',
                     '11:60', '1:5', 'あ', '11:00 ', ' 11:00'];
    samples.forEach(s2 => {
      box.__v = s2;
      const a = vm.runInContext('hhmmToMin_(__v)', box);
      const b = call('ttMinutes', s2);
      assert.strictEqual(b, a, '「' + s2 + '」でズレています（画面 ' + b + ' / サーバー ' + a + '）');
    });
  });
});

describe('②の規則：所要時間を変える（§5-1・§7-3 の 7〜9）', () => {

  /** 隙間なく3つ並んだイベント。11:00-11:10 / 11:10-11:40 / 11:40-12:10 */
  function run() {
    return [
      ev('a', 'イベント', '11:00', 10),
      ev('b', 'イベント', '11:10', 30),
      ev('c', 'イベント', '11:40', 30),
    ];
  }

  test('7. 伸ばすと、隙間なく続く後ろがずれる', () => {
    const r = call('ttResize', run(), 'a', 20);
    assert.strictEqual(shape(r.rows),
      'a 11:00 20 / b 11:20 30 / c 11:50 30');
  });

  test('7b. 縮めると、後ろが前に詰まる', () => {
    const r = call('ttResize', run(), 'a', 5);
    assert.strictEqual(shape(r.rows),
      'a 11:00 5 / b 11:05 30 / c 11:35 30');
  });

  test('7c. 動かした予定を、画面が言えるように返す', () => {
    const r = call('ttResize', run(), 'a', 20);
    assert.deepStrictEqual(r.moved, ['b', 'c']);
  });

  test('7d. ずらしはレーンをまたがない', () => {
    // オープニングを10分伸ばしても、ゲートオープン（全体）は動かない
    const rows = [
      ev('a', 'イベント', '11:00', 10),
      ev('z', '全体', '11:10', 30),
    ];
    const r = call('ttResize', rows, 'a', 20);
    assert.strictEqual(shape(r.rows), 'a 11:00 20 / z 11:10 30',
      'ずらしがレーンをまたぎました');
    assert.deepStrictEqual(r.moved, [], 'ずらしがレーンをまたぎました');
  });

  test('8. 隙間があると、そこでずらしが止まる', () => {
    // b の終わり 11:40、c の始まり 11:45 → 5分あいている
    const rows = [
      ev('a', 'イベント', '11:00', 10),
      ev('b', 'イベント', '11:10', 30),
      ev('c', 'イベント', '11:45', 30),
    ];
    const r = call('ttResize', rows, 'a', 20);
    assert.strictEqual(shape(r.rows), 'a 11:00 20 / b 11:20 30 / c 11:45 30',
      '隙間があるのにずらしが止まりませんでした');
    assert.deepStrictEqual(r.moved, ['b'], '隙間があるのにずらしが止まりませんでした');
    assert.strictEqual(r.stopped, 'gap');
  });

  test('8b. 1分でも空いていれば、そこで止まる', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 10),
      ev('b', 'イベント', '11:11', 30),
    ];
    const r = call('ttResize', rows, 'a', 20);
    assert.deepStrictEqual(r.moved, []);
  });

  test('9. ロックされた予定は押し出されない', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 10),
      ev('b', 'イベント', '11:10', 30, true),   // ロック
      ev('c', 'イベント', '11:40', 30),
    ];
    const r = call('ttResize', rows, 'a', 20);
    assert.strictEqual(shape(r.rows), 'a 11:00 20 / b 11:10 30 / c 11:40 30',
      'ロックされた予定が押し出されました');
    assert.deepStrictEqual(r.moved, [], 'ロックされた予定が押し出されました');
    assert.strictEqual(r.stopped, 'locked');
  });

  test('9b. ロックの手前までは、ちゃんとずれる', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 10),
      ev('b', 'イベント', '11:10', 30),
      ev('c', 'イベント', '11:40', 30, true),
    ];
    const r = call('ttResize', rows, 'a', 20);
    assert.strictEqual(shape(r.rows), 'a 11:00 20 / b 11:20 30 / c 11:40 30');
    assert.deepStrictEqual(r.moved, ['b']);
  });

  test('9c. ロックされた予定自身の所要時間は変えられる（止めない）', () => {
    // ロックは「うっかり動かさない」ための印。動かせないものではない（§5-3）
    const rows = [ev('a', 'イベント', '11:00', 10, true)];
    const r = call('ttResize', rows, 'a', 20);
    assert.strictEqual(shape(r.rows), 'a 11:00 20');
  });

  test('翌日にはみ出すずらしは、そこで止める', () => {
    const rows = [
      ev('a', 'イベント', '23:00', 30),
      ev('b', 'イベント', '23:30', 30),
    ];
    const r = call('ttResize', rows, 'a', 60);
    // b を30分ずらすと 24:30 になる。ずらさずに止め、理由を返す
    assert.strictEqual(shape(r.rows), 'a 23:00 60 / b 23:30 30');
    assert.strictEqual(r.stopped, 'day');
  });

  test('自分自身が翌日にはみ出す長さは受けない', () => {
    const r = call('ttResize', [ev('a', 'イベント', '23:30', 10)], 'a', 60);
    assert.strictEqual(r.stopped, 'day');
    assert.strictEqual(shape(r.rows), 'a 23:30 10');
  });

  test('知らないIDなら、何も変えない', () => {
    const r = call('ttResize', run(), 'zzz', 20);
    assert.strictEqual(shape(r.rows), shape(run()));
  });
});

describe('②の規則：差し込みと移動（§5-1・§7-3 の 10）', () => {

  test('差し込むと、その時刻から後ろがずれる', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 10),
      ev('b', 'イベント', '11:10', 30),
    ];
    const r = call('ttInsert', rows, ev('n', 'イベント', '11:10', 15));
    assert.strictEqual(shape(r.rows),
      'a 11:00 10 / b 11:25 30 / n 11:10 15');
    assert.deepStrictEqual(r.moved, ['b']);
  });

  test('空いているところに差し込んでも、誰も動かない', () => {
    const rows = [ev('a', 'イベント', '11:00', 10)];
    const r = call('ttInsert', rows, ev('n', 'イベント', '14:00', 30));
    assert.deepStrictEqual(r.moved, []);
  });

  test('10. ドラッグで動かしたときは、後ろがずれない', () => {
    // 「伸ばす」＝進行が押した → 後ろが押し出されるのが自然。
    // 「動かす」＝置き場所を変えた → そこに入れたいだけ（§5-1）
    const rows = [
      ev('a', 'イベント', '11:00', 10),
      ev('b', 'イベント', '11:10', 30),
      ev('c', 'イベント', '11:40', 30),
    ];
    const r = call('ttMove', rows, 'a', 'イベント', '11:10');
    assert.strictEqual(shape(r.rows),
      'a 11:10 10 / b 11:10 30 / c 11:40 30');
    assert.deepStrictEqual(r.moved, []);
  });

  test('10b. レーンをまたいで動かせる', () => {
    const rows = [ev('a', 'イベント', '11:00', 10)];
    const r = call('ttMove', rows, 'a', '備考', '11:00', LANES);
    assert.strictEqual(r.rows[0].lane, '備考');
  });

  test('10c. 翌日にはみ出す位置には動かさない', () => {
    const rows = [ev('a', 'イベント', '11:00', 60)];
    const r = call('ttMove', rows, 'a', 'イベント', '23:30', LANES);
    assert.strictEqual(shape(r.rows), 'a 11:00 60');
    assert.strictEqual(r.stopped, 'day');
  });

  test('10d. 知らないレーンには動かさない', () => {
    /*
     * レーンの一覧は**引数で受け取る**。規則の中に名前を書くと、
     * サーバー（TT_LANES_）と2か所になって、足したときに片方だけ古くなる（§7-5）。
     * ①の linkify が `esc` を引数で受け取っているのと同じ形。
     */
    const rows = [ev('a', 'イベント', '11:00', 10)];
    const r = call('ttMove', rows, 'a', 'ステージ裏', '11:00', LANES);
    assert.strictEqual(r.rows[0].lane, 'イベント');
    assert.strictEqual(r.stopped, 'lane');
  });

  test('10e. レーンの一覧を渡さなければ、レーンは変えない（勝手に通さない）', () => {
    const rows = [ev('a', 'イベント', '11:00', 10)];
    const r = call('ttMove', rows, 'a', '備考', '11:00');
    assert.strictEqual(r.rows[0].lane, 'イベント');
  });
});

describe('②の規則：重なりと共存（§5-2・§5-4・§7-3 の 11）', () => {

  test('11. 同じレーンで重なったら、共存の印が付く', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 30),
      ev('b', 'イベント', '11:10', 30),
    ];
    const L = call('ttLayout', rows);
    assert.strictEqual(L.a.cols, 2, JSON.stringify(L));
    assert.strictEqual(L.b.cols, 2);
    assert.notStrictEqual(L.a.col, L.b.col);
    assert.strictEqual(L.a.overlap, true);
  });

  test('11b. 別のレーンなら、重なりとして見ない（§5-4）', () => {
    // 「リハ（イベント）」と「キックオフ（全体）」は見ない。
    // 見るには「どこを使うか」を持たせる必要があり、埋まらない欄が増える
    const rows = [
      ev('a', 'イベント', '11:00', 30),
      ev('z', '全体', '11:10', 30),
    ];
    const L = call('ttLayout', rows);
    assert.strictEqual(L.a.cols, 1);
    assert.strictEqual(L.a.overlap, false);
    assert.strictEqual(L.z.overlap, false);
  });

  test('11c. 3つ以上重なったら、幅を等分する', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 60),
      ev('b', 'イベント', '11:10', 30),
      ev('c', 'イベント', '11:20', 30),
    ];
    const L = call('ttLayout', rows);
    assert.strictEqual(L.a.cols, 3);
    assert.deepStrictEqual([L.a.col, L.b.col, L.c.col].sort(), [0, 1, 2]);
  });

  test('11d. 隣り合っているだけ（終わりと始まりが同じ）は重なりではない', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 10),
      ev('b', 'イベント', '11:10', 30),
    ];
    const L = call('ttLayout', rows);
    assert.strictEqual(L.a.cols, 1, '隣り合っているだけで重なり扱いになりました');
    assert.strictEqual(L.a.overlap, false, '隣り合っているだけで重なり扱いになりました');
  });

  test('11e. 0分の目印は、重なりにしない（点であって帯ではない）', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 30),
      ev('m', 'イベント', '11:10', 0),
    ];
    const L = call('ttLayout', rows);
    assert.strictEqual(L.a.overlap, false, '重なりの印が付いてはいけないものに付きました（0分の目印）');
    assert.strictEqual(L.m.overlap, false, '重なりの印が付いてはいけないものに付きました（0分の目印）');
  });

  test('11f. ロックに重なるものも、置ける（止めない・§5-3）', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 30, true),
      ev('b', 'イベント', '11:10', 30),
    ];
    const L = call('ttLayout', rows);
    assert.strictEqual(L.a.overlap, true);
    assert.strictEqual(L.b.overlap, true);
  });

  test('重なりの一覧が、警告の文面のために返る', () => {
    const rows = [
      ev('a', 'イベント', '11:00', 30),
      ev('b', 'イベント', '11:10', 30),
      ev('z', '全体', '11:00', 30),
    ];
    const w = call('ttWarnings', rows);
    assert.strictEqual(w.length, 1, JSON.stringify(w));
    assert.deepStrictEqual(w[0].ids.slice().sort(), ['a', 'b']);
    assert.strictEqual(w[0].lane, 'イベント');
  });

  test('重なりが無ければ、警告は0件（「0件でした」と返す）', () => {
    assert.deepStrictEqual(call('ttWarnings', [ev('a', 'イベント', '11:00', 30)]), []);
  });

  test('読めない時刻の行があっても、規則は落ちない', () => {
    // 画面がおかしな値を持ってしまっても、**画面全体が固まってはいけない**
    const rows = [ev('a', 'イベント', 'あ', 30), ev('b', 'イベント', '11:00', 30)];
    assert.doesNotThrow(() => call('ttLayout', rows));
    assert.doesNotThrow(() => call('ttWarnings', rows));
    assert.doesNotThrow(() => call('ttResize', rows, 'b', 60));
  });
});

describe('②の規則：画面に埋め込める形になっているか', () => {

  test('書き出した文字列が、外に何も無い箱で読める', () => {
    // `.toString()` は関数の外側のスコープを失う（①の linkify で踏んだ形）。
    // 外側の定数を参照していると、**画面でだけ**落ちる
    assert.doesNotThrow(() => {
      const box = { Math, Number, String, Array, Object, JSON, isFinite };
      vm.createContext(box);
      vm.runInContext(RULES.rulesSource(), box);
    });
  });

  test('require したものと、埋め込んだものが同じ答えを返す', () => {
    const rows = [ev('a', 'イベント', '11:00', 10), ev('b', 'イベント', '11:10', 30)];
    const direct = JSON.parse(JSON.stringify(RULES.ttResize(rows, 'a', 20)));
    assert.deepStrictEqual(call('ttResize', rows, 'a', 20), direct);
  });

  test('レーン名を規則の中に直書きしない（§7-5）', () => {
    // 正は gas/Timetable.gs の TT_LANES_。画面はサーバーが返した配列から組む
    const src = fs.readFileSync(path.join(ROOT, 'src', 'timetable-rules.js'), 'utf8');
    ['全体', 'イベント', '備考'].forEach(name => {
      const body = src.split('*').join('');   // 説明の文からは探さない
      assert.ok(body.indexOf("'" + name + "'") < 0,
        'レーン名「' + name + '」が規則に直書きされています');
    });
  });
});
