/**
 * PNG の実寸を読む（依存なし）。
 *
 * ■ なぜ要るか
 *   `<img width="689" height="240">` を手で書いていた。
 *   これは飾りではなく、**読み込み前に場所を確保して画面のガタつきを防ぐ**もの。
 *   値が実物とずれると、確保した箱と実際の絵の形が合わず、
 *   読み込んだ瞬間にレイアウトが動く。
 *
 *   2026-09-02 にロゴを差し替えたとき、縦横比が 2.87 から 2.80 に変わった。
 *   5か所の直書きを全部直す必要があり、1か所でも忘れると**そこだけ歪む**。
 *   手で書くのをやめて、ファイルから読む。
 *
 * ■ PNG の実寸は先頭25バイトで分かる
 *   8バイトの署名 → 長さ(4) → 'IHDR'(4) → 幅(4) → 高さ(4)。
 *   画像ライブラリを入れる必要はない。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** リポジトリ相対のパスから { w, h } を返す。読めなければ落とす（黙って0にしない） */
function pngSize(relPath) {
  const file = path.join(ROOT, relPath);
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(24);
    const read = fs.readSync(fd, head, 0, 24, 0);
    if (read < 24 || !head.subarray(0, 8).equals(PNG_SIG)) {
      throw new Error('PNG ではありません: ' + relPath);
    }
    if (head.subarray(12, 16).toString('ascii') !== 'IHDR') {
      throw new Error('PNG の先頭が IHDR ではありません: ' + relPath);
    }
    return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

/** `width="1200" height="428"` の形で返す。HTMLにそのまま埋める */
function sizeAttrs(relPath) {
  const { w, h } = pngSize(relPath);
  return 'width="' + w + '" height="' + h + '"';
}

module.exports = { pngSize, sizeAttrs };
