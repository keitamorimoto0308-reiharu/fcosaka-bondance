/**
 * 搬入の時間割の計算（src/loadin.js）。
 *
 * ■ なぜ「呼べる形」で検査するか
 *   この機能の心臓部は「区画の順に並べて、枠に詰める」計算で、
 *   端の場合（上限ちょうど・未割当・1社で上限超え）が実際に起きる。
 *   **形を見る検査では、この振る舞いは捕まえられない**（引き継ぎ書 §9）。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const L = require('../src/loadin.js');

/** 検査用の1行。実際の一覧の行と同じ形にする */
const row = (id, space, cars, name) => {
  const r = { '受付ID': id, '企業名': name || id };
  if (space !== null && space !== undefined) r['割当開始区画'] = space;
  if (cars !== null && cars !== undefined) r['確定：搬入車両台数'] = cars;
  return r;
};

describe('時刻の読み書き', () => {
  test('「9:30」を分に直せる', () => {
    assert.strictEqual(L.loadinToMin('9:30'), 570);
    assert.strictEqual(L.loadinToMin('10:30'), 630);
    assert.strictEqual(L.loadinToMin('0:00'), 0);
    assert.strictEqual(L.loadinToMin('23:59'), 1439);
  });

  test('前後の空白は無視する', () => {
    assert.strictEqual(L.loadinToMin('  9:30 '), 570);
  });

  /*
   * **空は null。** ここを 0 にすると「未定」の社が 0:00 の枠に積み上がり、
   * 画面では「0時に大量に来る」という、ありえない絵になる。
   * Number('') は 0 なので、素朴に書くと本当にこうなる。
   */
  test('空・null・未定義は、読めない（0時にしない）', () => {
    for (const v of ['', '   ', null, undefined]) {
      assert.strictEqual(L.loadinToMin(v), null, JSON.stringify(v));
    }
  });

  test('ありえない時刻・変な書き方は読めない', () => {
    for (const v of ['25:00', '9:75', '9:3', '930', ':30', '9:', 'あさ',
                     '9:3o', '-1:00', '9:30:00']) {
      assert.strictEqual(L.loadinToMin(v), null, '「' + v + '」を通しています');
    }
  });

  test('分に直して、また戻せる', () => {
    for (const v of ['9:30', '10:00', '0:05', '23:59']) {
      assert.strictEqual(L.loadinToHhmm(L.loadinToMin(v)), v);
    }
  });
});

describe('車両の台数', () => {
  /*
   * **未提出は 0 ではなく 1。**
   * 0 にすると、確定情報がまだの社が多いあいだ「空いている」に見えてしまう。
   * 既定値は、混雑を多めに見せる側へ倒す。
   */
  test('未提出は1台として数える', () => {
    assert.strictEqual(L.loadinCarsOf(row('SB-0001')), 1);
    assert.strictEqual(L.loadinCarsOf(row('SB-0001', 1, '')), 1);
    assert.strictEqual(L.loadinCarsOf(row('SB-0001', 1, 0)), 1);
    assert.strictEqual(L.loadinCarsOf(row('SB-0001', 1, 'たくさん')), 1);
  });

  test('出ていれば、その台数', () => {
    assert.strictEqual(L.loadinCarsOf(row('SB-0001', 1, 3)), 3);
    assert.strictEqual(L.loadinCarsOf(row('SB-0001', 1, '2')), 2);
  });
});

describe('混み具合を数える', () => {
  const F = 570, T = 630, STEP = 10, CAP = 8;   // 9:30〜10:30・10分・8台

  test('枠は、窓を割り切った数だけできる', () => {
    const b = L.loadinBuckets([], F, T, STEP, CAP);
    assert.strictEqual(b.slots.length, 6);
    assert.strictEqual(b.slots[0].hhmm, '9:30');
    assert.strictEqual(b.slots[5].hhmm, '10:20');
    assert.strictEqual(b.cap, 48);
  });

  test('時刻が入っていない社は「未定」に入る', () => {
    const b = L.loadinBuckets([row('SB-0001', 1, 2)], F, T, STEP, CAP);
    assert.strictEqual(b.undecided.n, 1);
    assert.strictEqual(b.undecided.cars, 2);
    assert.strictEqual(b.slots.reduce((a, s) => a + s.n, 0), 0);
  });

  test('枠の中に入る', () => {
    const rows = [
      Object.assign(row('SB-0001', 1, 2), { '搬入予定時刻': '9:30' }),
      Object.assign(row('SB-0002', 2, 1), { '搬入予定時刻': '9:35' }),
      Object.assign(row('SB-0003', 3, 4), { '搬入予定時刻': '9:40' }),
    ];
    const b = L.loadinBuckets(rows, F, T, STEP, CAP);
    assert.strictEqual(b.slots[0].n, 2, '9:30 の枠に2社入っていません');
    assert.strictEqual(b.slots[0].cars, 3);
    assert.strictEqual(b.slots[1].n, 1);
    assert.strictEqual(b.slots[1].cars, 4);
  });

  test('窓の外の時刻は「窓の外」に分ける（枠に混ぜない）', () => {
    const rows = [
      Object.assign(row('SB-0001', 1, 1), { '搬入予定時刻': '7:00' }),
      Object.assign(row('SB-0002', 2, 1), { '搬入予定時刻': '10:30' }),  // 終わりは含まない
      Object.assign(row('SB-0003', 3, 1), { '搬入予定時刻': '11:00' }),
    ];
    const b = L.loadinBuckets(rows, F, T, STEP, CAP);
    assert.strictEqual(b.outside.n, 3, JSON.stringify(b.outside));
    assert.strictEqual(b.slots.reduce((a, s) => a + s.n, 0), 0);
  });

  test('上限を超えた枠に、印が付く', () => {
    const rows = [
      Object.assign(row('SB-0001', 1, 5), { '搬入予定時刻': '9:30' }),
      Object.assign(row('SB-0002', 2, 4), { '搬入予定時刻': '9:30' }),
    ];
    const b = L.loadinBuckets(rows, F, T, STEP, CAP);
    assert.strictEqual(b.slots[0].cars, 9);
    assert.strictEqual(b.slots[0].over, true, '9台なのに上限超えの印が付いていません');
    assert.strictEqual(b.slots[1].over, false);
  });

  test('ちょうど上限は、超えていない', () => {
    const rows = [Object.assign(row('SB-0001', 1, 8), { '搬入予定時刻': '9:30' })];
    const b = L.loadinBuckets(rows, F, T, STEP, CAP);
    assert.strictEqual(b.slots[0].over, false, 'ちょうど上限を「超え」と言っています');
  });

  /*
   * **枠ごとの混雑だけ見ても、全体が無理なことは分からない。**
   * 未定と窓の外も、合計に入れる（その社も当日は来るため）。
   */
  test('合計の台数は、未定と窓の外も数える', () => {
    const rows = [
      Object.assign(row('SB-0001', 1, 2), { '搬入予定時刻': '9:30' }),
      row('SB-0002', 2, 3),                                             // 未定
      Object.assign(row('SB-0003', 3, 4), { '搬入予定時刻': '7:00' }),  // 窓の外
    ];
    const b = L.loadinBuckets(rows, F, T, STEP, CAP);
    assert.strictEqual(b.cars, 9, '未定・窓の外を数えていません：' + b.cars);
  });
});

describe('時刻を配る', () => {
  const F = 570, STEP = 10, CAP = 8;   // 9:30 から・10分・8台

  /*
   * **区画番号の順。** 搬入は会場の入口から順に埋めるのが現実の動き。
   * 受付ID順に配ると、隣どうしの区画がばらばらの時間に来て、車両がすれ違う。
   */
  test('区画番号の順に配る（受付ID順ではない）', () => {
    const rows = [row('SB-0003', 1, 1), row('SB-0001', 3, 1), row('SB-0002', 2, 1)];
    const plan = L.loadinPlan(rows, F, STEP, CAP);
    assert.deepStrictEqual(plan.map(p => p.id), ['SB-0003', 'SB-0002', 'SB-0001'],
      '区画番号の順になっていません');
  });

  test('区画が未割当の社は、後ろにまわす', () => {
    const rows = [row('SB-0001'), row('SB-0002', 5, 1), row('SB-0003')];
    const plan = L.loadinPlan(rows, F, STEP, CAP);
    assert.strictEqual(plan[0].id, 'SB-0002', '区画のある社が先ではありません');
    assert.deepStrictEqual(plan.slice(1).map(p => p.id).sort(),
                           ['SB-0001', 'SB-0003']);
  });

  test('同じ区画番号なら、受付IDの順で安定する', () => {
    const rows = [row('SB-0002', 1, 1), row('SB-0001', 1, 1)];
    const plan = L.loadinPlan(rows, F, STEP, CAP);
    assert.deepStrictEqual(plan.map(p => p.id), ['SB-0001', 'SB-0002']);
  });

  test('上限に収まるあいだは、同じ枠に入れる', () => {
    const rows = [row('SB-0001', 1, 3), row('SB-0002', 2, 3), row('SB-0003', 3, 2)];
    const plan = L.loadinPlan(rows, F, STEP, CAP);
    assert.deepStrictEqual(plan.map(p => p.at), ['9:30', '9:30', '9:30'],
      '8台に収まるのに、枠を分けています');
  });

  test('上限を超えたら、次の枠へ送る', () => {
    const rows = [row('SB-0001', 1, 5), row('SB-0002', 2, 4)];
    const plan = L.loadinPlan(rows, F, STEP, CAP);
    assert.deepStrictEqual(plan.map(p => p.at), ['9:30', '9:40']);
  });

  /*
   * **1社で上限を超える大型車が来ても、その枠に入れる。**
   * 「次の枠へ」を素朴に書くと、`used + cars > cap` が常に真になり、
   * **空の枠を延々と飛ばし続けて、時刻がどこまでも先へ行く**。
   */
  test('1社で上限を超えても、空の枠を飛ばさない', () => {
    const rows = [row('SB-0001', 1, 20), row('SB-0002', 2, 1)];
    const plan = L.loadinPlan(rows, F, STEP, CAP);
    assert.strictEqual(plan[0].at, '9:30', '最初の社が9:30から始まっていません');
    assert.strictEqual(plan[1].at, '9:40', '空の枠を飛ばしています：' + plan[1].at);
  });

  test('台数が未提出でも、1台として詰める', () => {
    const rows = [];
    for (let i = 1; i <= 9; i++) rows.push(row('SB-000' + i, i));
    const plan = L.loadinPlan(rows, F, STEP, CAP);
    assert.strictEqual(plan[7].at, '9:30', '8社目が9:30ではありません');
    assert.strictEqual(plan[8].at, '9:40', '9社目で枠が変わっていません');
  });

  /*
   * 窓からはみ出しても、ここでは止めない（「報せるが、止めない」）。
   * はみ出すことは、呼んだ側が最後の時刻を見て人に伝える。
   */
  test('窓からはみ出しても、止めない', () => {
    const rows = [];
    for (let i = 1; i <= 60; i++) rows.push(row('SB-' + String(i).padStart(4, '0'), i, 8));
    const plan = L.loadinPlan(rows, F, STEP, CAP);
    assert.strictEqual(plan.length, 60);
    assert.strictEqual(plan[59].at, '19:20', '最後の時刻が想定と違います：' + plan[59].at);
  });

  test('渡された配列を、並べ替えない（呼んだ側の順を壊さない）', () => {
    const rows = [row('SB-0003', 1, 1), row('SB-0001', 3, 1)];
    const before = rows.map(r => r['受付ID']);
    L.loadinPlan(rows, F, STEP, CAP);
    assert.deepStrictEqual(rows.map(r => r['受付ID']), before,
      '呼んだ側の配列を並べ替えています');
  });

  test('相手が0件なら、何も返さない', () => {
    assert.deepStrictEqual(L.loadinPlan([], F, STEP, CAP), []);
  });
});

describe('画面へ書き出す塊', () => {
  /*
   * `.toString()` は**関数の外側のスコープを失う**。
   * モジュール変数を参照していると、画面では未定義になって落ちる
   * （しかもブラウザは何も言わない）。
   */
  test('書き出した塊だけで、実際に動く', () => {
    const src = L.loadinSource();
    const fn = new Function(src + '\n;return { loadinPlan: loadinPlan, '
      + 'loadinBuckets: loadinBuckets, loadinToMin: loadinToMin };');
    const api = fn();
    const plan = api.loadinPlan([row('SB-0001', 1, 3), row('SB-0002', 2, 6)],
                                570, 10, 8);
    assert.deepStrictEqual(plan.map(p => p.at), ['9:30', '9:40'],
      '書き出した塊だけでは、正しく動いていません');
    assert.strictEqual(api.loadinToMin('9:30'), 570);
  });

  test('外側のスコープを参照していない', () => {
    // require を消しても動くこと＝このファイルの他の部分に依存していない
    const src = L.loadinSource();
    for (const bad of ['require(', 'module.', 'exports']) {
      assert.ok(!src.includes(bad), '書き出す塊が ' + bad + ' を参照しています');
    }
  });
});
