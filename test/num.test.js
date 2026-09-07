/**
 * 人が打ち込んだ「数」の読み取り（gas/Num.gs）。
 *
 * ■ なぜ独立した検査が要るか
 *   単価（レンタル）・枚数（確定情報）・合計（ダッシュボード）で
 *   同じことを3回書いていた。**揃っていないことに誰も気づいていなかった。**
 *
 *   2026-09-04、点検役が3つを並べて同じ入力を流したところ、合計だけが前方一致で：
 *     「3-5」→3 ／「10〜15」→10 ／「12abc」→12 ／「-5」→-5 ／「０．５」→0
 *   しかも全部「入力済み」に数えていた。
 *   ＝**「未提出」にも出ず、ダッシュボードの合計だけが静かにずれる。**
 *
 *   同じ入力を3つに流して突き合わせる検査が無かったから、見つからなかった。
 *   ここがその検査。
 *
 * ■ 「読めないものは 0 にしない」
 *   0 は「0名」「無料」という意味を持つ。読めなければ null を返す。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const N = (() => {
  const box = { String, Number, RegExp, isFinite };
  vm.createContext(box);
  vm.runInContext(read('gas/Num.gs'), box);
  return box;
})();

describe('読めないものは、読めないと言う', () => {
  // 点検役が実際に流した入力。**ここに1つでも数が返ってはいけない**
  const 読めない = ['3-5', '10〜15', '2または3', '2/3', '12abc', '1e3', '2枚2',
                    'abc', '', '   ', '－5', '-5', '1.2.3', '５〜10', '未定',
                    '10名程度', '約20', '1 0', '10 20', '　1　0'];

  読めない.forEach(v => {
    test('「' + (v.trim() || '（空）') + '」は読めない', () => {
      assert.strictEqual(N.numCount_(v), null,
        '枚数として ' + N.numCount_(v) + ' を返しました');
      assert.strictEqual(N.numAmount_(v), null,
        '単価・合計として ' + N.numAmount_(v) + ' を返しました');
    });
  });

  test('読めなかった理由を、打ち直せる言葉で返す', () => {
    assert.ok(/マイナス/.test(N.numWhy_('-5')), N.numWhy_('-5'));
    assert.ok(/空白/.test(N.numWhy_('1 0')), N.numWhy_('1 0'));
    assert.ok(/読み取れません/.test(N.numWhy_('')), N.numWhy_(''));
    assert.ok(N.numWhy_('abc').includes('abc'), '何を断ったのか分かりません');
  });
});

describe('読めるものは、正しく読む', () => {
  const 読める = [
    ['5', 5, 5],
    ['０', 0, 0],
    ['１２００', 1200, 1200],
    ['1,200', 1200, 1200],
    ['1,200円', 1200, 1200],
    ['¥1,200', 1200, 1200],
    ['10 000', 10000, 10000],
    ['12名', 12, 12],
    ['3枚', 3, 3],
    ['　7　', 7, 7],
  ];
  読める.forEach(([v, count, amount]) => {
    test('「' + v + '」は ' + amount, () => {
      assert.strictEqual(N.numCount_(v), count, '枚数として読めていません');
      assert.strictEqual(N.numAmount_(v), amount, '単価・合計として読めていません');
    });
  });

  test('小数は、単価では読めて、枚数では読めない', () => {
    // 「2.5名」に意味は無いが、「2.5m」や単価の端数はありうる
    assert.strictEqual(N.numAmount_('0.5'), 0.5);
    assert.strictEqual(N.numAmount_('０．５'), 0.5, '全角の小数点を直していません');
    assert.strictEqual(N.numCount_('2.5'), null, '枚数で小数を受けています');
  });

  test('0 は「読めた0」として返す（null と区別する）', () => {
    assert.strictEqual(N.numCount_('0'), 0);
    assert.strictEqual(N.numAmount_('0'), 0);
  });
});

describe('3つの読み取りが、同じ入口を通っているか', () => {
  // ここが揃っていなかったのが、そもそもの発端
  const 使う場所 = [
    ['gas/Rental.gs', 'rentalNumber_', 'numAmount_'],
    ['gas/Confirm.gs', 'confirmCount_', 'numCount_'],
    ['gas/Admin.gs', 'aggregateNumber_', 'numAmount_'],
  ];

  使う場所.forEach(([file, fnName, want]) => {
    test(file + ' の ' + fnName + ' が ' + want + ' を通っている', () => {
      const src = read(file);
      const i = src.indexOf('function ' + fnName);
      assert.ok(i >= 0, fnName + ' がありません');
      const body = src.slice(i, src.indexOf(String.fromCharCode(10) + '}', i));
      assert.ok(body.includes(want + '('),
        fnName + ' が ' + want + ' を通っていません（写しに戻っています）');
      // **ここで読み取りを書き直していないこと。** 書き直した瞬間に揃わなくなる
      assert.ok(!/replace\(/.test(body),
        fnName + ' の中で読み取りを書き直しています：' + body.trim());
    });
  });

  test('禁じた「拾って捨てる」読み方が、どこにも残っていない', () => {
    // 「数字以外を落として Number() に渡す」は、黙って別の数を作る。
    //   -500 → 500（符号が消える）／１２００ → 0（全部捨てて Number('')）
    // 単価で1度直したのに、**合計消費電力に同じ書き方が残っていた**
    //（2026-09-04 の点検で発見）。名前で探すのではなく、書き方そのものを禁じる。
    const 見る = ['gas/Api.gs', 'gas/Config.gs', 'gas/Confirm.gs', 'gas/Admin.gs',
                  'gas/Rental.gs', 'gas/Ledger.gs', 'gas/Num.gs', 'src/mock.js'];
    見る.forEach(f => {
      const src = read(f);
      // gas/Num.gs だけは、正しい形の中で文字を落とす（区切り・単位）
      const 例外 = (f === 'gas/Num.gs');
      const bad = src.split(String.fromCharCode(10))
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => /replace\(\/\[\^0-9/.test(l) && /Number/.test(l))
        .filter(() => !例外);
      assert.deepStrictEqual(bad.map(([i, l]) => f + ':' + i + ' ' + l.trim()), [],
        '「数字以外を捨てて Number()」が残っています');
    });
  });

  test('人が打った数を読む入口が、すべて共通の読み取りを通っている', () => {
    // 応募者・出店者・運用者が数を入れる経路を、名指しで押さえる。
    // ここに無い経路が生えたら、上の「拾って捨てる」の検査が拾う
    const 入口 = [
      ['gas/Api.gs', "case 'number':", 'numAmount_', '応募・確定情報の数の項目'],
      ['gas/Api.gs', 'var n = numCount_(qty[name]);', 'numCount_', 'レンタルの数量'],
      ['gas/Admin.gs', "if (def.type === 'int')", 'numCount_', '設定の整数'],
      ['gas/Config.gs', 'function configNumber', 'numAmount_', '設定の数値'],
      ['gas/Config.gs', "var price = (rawPrice === '')", 'numAmount_', 'レンタルの単価'],
      ['gas/Admin.gs', 'var w = numAmount_(get(r, COL.watt));', 'numAmount_', '合計消費電力'],
    ];
    入口.forEach(([file, anchor, want, label]) => {
      const src = read(file);
      const i = src.indexOf(anchor);
      assert.ok(i >= 0, label + ' の場所が見つかりません（' + file + '：' + anchor + '）');
      assert.ok(src.slice(i, i + 400).includes(want + '('),
        label + ' が ' + want + ' を通っていません');
    });
  });


  test('模擬も、同じソースを借りている', () => {
    // 模擬が写しを持つと、「模擬では通るのに本番で弾かれる」がまた起きる
    const mock = read('src/mock.js');
    assert.ok(mock.includes("'Num.gs'"), '模擬が gas/Num.gs を読んでいません');
    /*
     * **「NUM.numCount_ がどこかにあるか」では足りない。**
     * 模擬の別の場所（制作スケジュールの一括削除など）でも使うようになったので、
     * 写しに戻した箇所があっても、ほかの1件で真になってしまう
     * （2026-09-07、実際にこの壊し検査が働かなくなった）。
     * **借りている当人**を名指しで見る。
     */
    assert.match(mock, /const confirmCount = t => NUM\.numCount_\(t\);/,
      '模擬が numCount_ を使っていません');
    ['numCount_', 'numAmount_'].forEach(fn => {
      assert.ok(mock.includes('NUM.' + fn), '模擬が ' + fn + ' を使っていません');
    });
    assert.ok(!/^function (confirmCount|aggregateNumber|rentalNumber)\(/m.test(mock),
      '模擬に読み取りの写しが残っています');
  });
});
