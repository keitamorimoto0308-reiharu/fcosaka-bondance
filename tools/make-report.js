/**
 * けいたに送る「ご確認用」の単一HTMLを作る。
 *
 * スマホで見るので、**画像を data URI で埋め込んで1ファイルにする**
 * （相対パスのままだと、ファイルを別の場所で開いたときに画像が出ない）。
 *
 *   node tools/make-report.js <出力.html> <見出し> <本文.md風テキストのパス>
 *
 * 本文の中に `![説明](build/admin/sched.png)` と書くと、その画像を埋め込む。
 * src/inline.js と同じ考え方だが、あちらは assets/ 配下だけが対象なので分けてある。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
               '.svg': 'image/svg+xml', '.avif': 'image/avif' };

const [, , outFile, title, srcFile] = process.argv;
if (!outFile || !srcFile) {
  console.error('使い方: node tools/make-report.js 出力.html 見出し 本文.txt');
  process.exit(1);
}

const raw = fs.readFileSync(path.isAbsolute(srcFile) ? srcFile
  : path.join(ROOT, srcFile), 'utf8');

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let missing = [];
/** ごく小さな記法だけを扱う。凝った変換はしない（読めればよい） */
function render(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const line of lines) {
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      closeList();
      const file = path.join(ROOT, img[2]);
      if (!fs.existsSync(file)) { missing.push(img[2]); continue; }
      const ext = path.extname(file).toLowerCase();
      const b64 = fs.readFileSync(file).toString('base64');
      out.push('<figure><img src="data:' + (MIME[ext] || 'image/png')
        + ';base64,' + b64 + '" alt="' + esc(img[1]) + '">'
        + (img[1] ? '<figcaption>' + esc(img[1]) + '</figcaption>' : '') + '</figure>');
      continue;
    }
    if (/^###\s/.test(line)) { closeList(); out.push('<h3>' + inline(line.slice(4)) + '</h3>'); continue; }
    if (/^##\s/.test(line))  { closeList(); out.push('<h2>' + inline(line.slice(3)) + '</h2>'); continue; }
    if (/^---\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    if (/^[-・]\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inline(line.slice(2)) + '</li>');
      continue;
    }
    if (!line.trim()) { closeList(); continue; }
    closeList();
    out.push('<p>' + inline(line) + '</p>');
  }
  closeList();
  return out.join('\n');
}
/** **太字** と `コード` だけ。先に esc してから記号を見る（順番が大事） */
function inline(s) {
  return esc(s)
    .split('**').map((p, i) => (i % 2 ? '<b>' + p + '</b>' : p)).join('')
    .split('`').map((p, i) => (i % 2 ? '<code>' + p + '</code>' : p)).join('');
}

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title || 'ご確認')}</title>
<style>
:root{color-scheme:light}
body{margin:0;background:#F7F5F3;color:#231816;
  font-family:"Noto Sans JP","Hiragino Sans","Yu Gothic",system-ui,sans-serif;
  line-height:1.85;font-size:15px}
.wrap{max-width:760px;margin:0 auto;padding:28px 18px 80px}
h1{font-size:21px;margin:0 0 6px;line-height:1.5}
.sub{color:#8C8481;font-size:12.5px;margin:0 0 26px}
h2{font-size:17px;margin:34px 0 10px;padding-top:14px;border-top:1px solid #E3DEDA}
h3{font-size:14.5px;margin:22px 0 8px;color:#2F4858}
p{margin:0 0 12px}
ul{margin:0 0 14px;padding-left:1.2em}
li{margin:0 0 6px}
code{background:#EFEBE9;border-radius:3px;padding:1px 5px;font-size:.88em}
b{font-weight:700}
hr{border:0;border-top:1px solid #E3DEDA;margin:26px 0}
figure{margin:16px 0 22px;background:#fff;border:1px solid #E3DEDA;border-radius:8px;
  padding:10px;overflow:hidden}
figure img{width:100%;height:auto;display:block;border-radius:4px}
figcaption{font-size:11.5px;color:#8C8481;margin-top:8px;text-align:center}
@media (prefers-color-scheme:dark){
  body{background:#1a1614;color:#F2EEEB}
  figure{background:#241f1c;border-color:#3a322e}
  code{background:#3a322e}
  h2{border-top-color:#3a322e}
  h3{color:#9FC3D6}
  .sub,figcaption{color:#A79E99}
}
</style></head><body><div class="wrap">
<h1>${esc(title || 'ご確認')}</h1>
<p class="sub">FC OSAKA×UPDATER サステナ盆踊り 出店応募システム ／ ${new Date().toLocaleDateString('ja-JP')}</p>
${render(raw)}
</div></body></html>`;

const dest = path.isAbsolute(outFile) ? outFile : path.join(ROOT, outFile);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, html, 'utf8');
console.log('  書き出し : ' + outFile + ' (' + Math.round(html.length / 1024) + 'KB)');
if (missing.length) console.log('  ⚠ 見つからない画像: ' + missing.join(', '));
