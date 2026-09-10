/**
 * 書き出したページが、**ソースより古くないか。**
 *
 * ■ なぜ要るか（2026-09-10、検証役の指摘）
 *   この案件の検査は、2つの向きが混ざっている：
 *
 *     - **生成物を読む検査**（画面の構文・公開物の中身）
 *     - **ソースを読む検査**（画面の性質・壊し検査の目印）
 *
 *   `src/build-admin.js` を直して**ビルドし忘れる**と、
 *   前者は**古いページを検査して「OK」と言う**。
 *   後者は新しいソースを見るので通る。
 *   **両者が食い違っていることに、誰も気づけない。**
 *
 *   §5 の「画面コードの構文」検査がまさにこれで、
 *   構文エラーがあると**1行も動かず、しかもエラーも出ない**画面が
 *   「検査済み」として公開されうる。
 *
 *   `assets/ogp.png`（test/assets.test.js:97）と
 *   `assets/boshu-yoko.pdf`（test/pdf.test.js:188）には
 *   同じ鮮度の検査が**すでにある**。4ページにだけ無かった。
 *
 * ■ 直し方
 *   落ちたら `npm run build` を実行するだけ。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);

const at = f => {
  const p = path.join(ROOT, f);
  return fs.existsSync(p) ? fs.statSync(p).mtimeMs : null;
};

/**
 * 書き出したページと、その素になるもの。
 *
 * **素を足したら、ここにも足すこと。**
 * `src/loadin.js` は 2026-09-09 に足した（画面へ .toString() で書き出す）。
 */
const PAGES = [
  { out: 'admin.html', srcs: [
    'src/build-admin.js', 'src/content.js', 'src/schema.js', 'src/theme.js',
    'src/linkify.js', 'src/timetable-rules.js', 'src/loadin.js', 'src/imgsize.js',
  ] },
  { out: 'index.html', srcs: [
    'src/build-form.js', 'src/build.js', 'src/content.js', 'src/schema.js', 'src/theme.js',
  ] },
  { out: 'confirm.html', srcs: [
    'src/build-confirm.js', 'src/content.js', 'src/schema.js', 'src/theme.js',
  ] },
  { out: 'upload.html', srcs: [
    'src/build-upload.js', 'src/content.js', 'src/theme.js',
  ] },
];

describe('書き出したページが、ソースより古くないか', () => {

  test('見る素が実在する（この検査が空振りしていないこと）', () => {
    const missing = [];
    for (const p of PAGES) {
      for (const s of p.srcs) if (at(s) === null) missing.push(s);
    }
    assert.deepStrictEqual(missing, [],
      NL + '素になるファイルが見つかりません：' + missing.join('、') + NL
      + '→ 名前を変えたなら、この検査の PAGES も直してください'
      + '（**素が消えると、鮮度を見ているつもりで何も見ていない**状態になります）');
  });

  for (const p of PAGES) {
    test(p.out + ' が、素より新しい', () => {
      const t = at(p.out);
      assert.ok(t !== null,
        p.out + ' がありません。`npm run build` を実行してください');

      const stale = p.srcs.filter(s => at(s) > t)
        .map(s => s + '（' + Math.round((at(s) - t) / 1000) + '秒 新しい）');

      assert.deepStrictEqual(stale, [],
        NL + p.out + ' が古いままです。素のほうが新しい：' + NL + stale.join(NL) + NL
        + '→ **`npm run build` を実行してください。**' + NL
        + '  このまま進むと、生成物を読む検査が**古いページを検査して「OK」と言います**'
        + '（画面の構文検査など）。ソースを読む検査は通るので、'
        + '**食い違いに誰も気づけません。**');
    });
  }
});
