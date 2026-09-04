/**
 * 文字が実際に読めるかを、書き出した画面から実測する。
 *
 * ■ なぜテストに入れるか
 *   これまで src/contrast.js は手で叩かないと走らなかった。
 *   「npm test から呼べる形にしてある」とコメントに書いてありながら、
 *   誰も呼んでいなかった（検証役の指摘）。
 *   走らない検査は無いのと同じで、しかも**有ると思い込む分だけ危ない**。
 *
 * ■ 写真の上の文字は、CSSを読んでも分からない
 *   ヒーローは「写真 → 半透明の膜 → 文字」の3枚重ね。
 *   文字の実際の背景色はCSSのどこにも書かれていないので、
 *   静的な検査（色の文字列を見る）では原理的に判定できない。
 *   実際、膜の色を変えずに `.hero-photo{filter:brightness(.45)}` とするだけで
 *   静的な検査は全部通り、実測だけが落ちる。
 *
 * ■ 遅い
 *   Chrome を幅ごとに2回起動するので、1幅あたり10秒前後かかる。
 *   それでも「読めないページを配る」よりは安い。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { measure, DEFAULT_RUNS } = require('../src/contrast.js');

describe('文字が実際に読めるか（画面を組ませて実測）', () => {
  for (const [target, width] of DEFAULT_RUNS) {
    test(`${target} 幅${width}px のコントラストが基準を満たす`, { timeout: 180000 }, () => {
      const r = measure(target, width);
      assert.ok(r.measured > 0,
        '1件も測れていません（検査が働いていない状態です）\n' + r.lines.join('\n'));
      assert.strictEqual(r.failed, 0,
        '\n' + r.lines.join('\n')
        + '\n※ 膜の不透明度か文字色を見直してください（node src/contrast.js で詳細）');
    });
  }
});
