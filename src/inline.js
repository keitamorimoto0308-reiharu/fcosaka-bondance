/**
 * 画像を data URI として埋め込み、1ファイルで完結するHTMLを作る。
 *
 * 目的は「その場で開いて確認できること」。相対パスの画像を参照したままだと、
 * ファイル単体を別の場所で開いたときにロゴが表示されない。
 *   node src/inline.js <入力.html> <出力.html>
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const MIME = { '.png': 'image/png', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.jpg': 'image/jpeg' };

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.error('使い方: node src/inline.js 入力 出力'); process.exit(1); }

let html = fs.readFileSync(path.isAbsolute(inFile) ? inFile : path.join(ROOT, inFile), 'utf8');
let count = 0, missing = [];

html = html.replace(/src="(assets\/[^"]+)"/g, (m, rel) => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { missing.push(rel); return m; }
  const ext = path.extname(file).toLowerCase();
  const b64 = fs.readFileSync(file).toString('base64');
  count++;
  return `src="data:${MIME[ext] || 'application/octet-stream'};base64,${b64}"`;
});

fs.writeFileSync(path.isAbsolute(outFile) ? outFile : path.join(ROOT, outFile), html, 'utf8');
console.log(`  ${outFile}: 画像${count}件を埋め込み (${Math.round(html.length / 1024)}KB)`);
if (missing.length) console.log('  ⚠ 見つからない画像:', missing.join(', '));
