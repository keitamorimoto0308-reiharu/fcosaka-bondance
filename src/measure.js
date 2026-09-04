/**
 * 紙面の実測ツール（開発用。成果物には含まれない）。
 *
 *   node src/measure.js                       … 募集要項PDF
 *   node src/measure.js build/kit/xxx.html    … 任意の組版HTML
 *
 * 「たぶん5mm縮むはず」で当てにいくと何周もするので、
 * Chrome に実際に組ませて各ブロックの高さをmmで出す。
 * A4は297mm。.page の総高がこれを超えていたら、その分だけ確実にあふれている。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const B = require('./build-pdf.js');

const PROBE = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var mm = function (px) { return (px / 96 * 25.4).toFixed(1); };
    var out = [];
    document.querySelectorAll('.page').forEach(function (p, i) {
      var h = p.getBoundingClientRect().height;
      out.push('=== PAGE ' + (i + 1) + '  総高 ' + mm(h) + 'mm  (A4=297.0 / 超過 '
        + mm(Math.max(0, h - 297 / 25.4 * 96)) + 'mm)');
      p.querySelectorAll(':scope > *').forEach(function (el) {
        var r = el.getBoundingClientRect();
        var mt = parseFloat(getComputedStyle(el).marginTop) || 0;
        var h2 = el.querySelector('h2');
        var lbl = h2 ? h2.textContent.trim()
                     : (el.className || el.tagName) + ' | ' + (el.textContent || '').trim().slice(0, 16);
        out.push('   ' + ('     ' + mm(r.height)).slice(-6) + 'mm  余白上' + ('    ' + mm(mt)).slice(-5) + 'mm   ' + lbl);
      });
    });
    document.body.textContent = out.join('\\n');
  }, 800);
});
</script>`;

// Chromeの探索は build-pdf.js と共有する（候補が食い違うのを防ぐ）
const chrome = B.findChrome;

(async () => {
  const arg = process.argv[2];
  const src = arg
    ? fs.readFileSync(path.isAbsolute(arg) ? arg : path.join(ROOT, arg), 'utf8')
    : await B.html();
  const file = path.join(ROOT, 'build', 'measure.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, src.replace('</head>', PROBE + '</head>'), 'utf8');

  const dom = execFileSync(chrome(), [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + path.join(ROOT, 'build', '.chrome-profile'),
    '--virtual-time-budget=20000', '--dump-dom',
    'file:///' + file.replace(/\\/g, '/'),
  ], { encoding: 'utf8', maxBuffer: 1e8 });

  const m = dom.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  console.log(m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '(取得できませんでした)');
})();
