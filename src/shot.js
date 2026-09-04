/**
 * スマホ幅の撮影ツール（開発用。成果物には含まれない）。
 *
 *   node src/shot.js index.html 430          … 430px幅で全体を撮る
 *   node src/shot.js index.html 430 1500     … 上から1500pxぶんだけ撮る
 *
 * ■ なぜ iframe に入れるのか
 *   Windows の Chrome はウィンドウを約504pxより細くできない。
 *   --window-size=430 と指定しても、実際には 489px 幅で組んだうえで
 *   左から430pxぶんを切り取った画像が出てくる。
 *   つまり「右が切れている」画像ができるが、それはページの不具合ではなく撮影の跡。
 *   実際にこれで存在しない横あふれを追いかけた。
 *
 *   そこで、広いウィンドウの中に指定幅の iframe を置き、その中でページを組ませる。
 *   こうすれば 430px は本当に 430px になる。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const B = require('./build-pdf.js');

const target = process.argv[2] || 'index.html';
const width = Number(process.argv[3] || 430);
const height = Number(process.argv[4] || 0);   // 0 なら中身の高さぶん全部
const top    = Number(process.argv[5] || 0);   // 何px目から撮るか（下の方を見たいとき）

const targetPath = path.isAbsolute(target) ? target : path.join(ROOT, target);
if (!fs.existsSync(targetPath)) {
  console.error('見つかりません: ' + targetPath);
  process.exit(1);
}

const outName = path.basename(targetPath, path.extname(targetPath))
  + '-' + width + (top ? '-at' + top : '') + '.png';
const out = path.join(ROOT, 'build', outName);
const frame = path.join(ROOT, 'build', '.shot-frame.html');

// 撮影用の枠。ページ本体には一切手を入れない
fs.writeFileSync(frame, [
  '<!doctype html><meta charset="utf-8">',
  '<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}',
  '#clip{overflow:hidden;width:' + width + 'px}',
  'iframe{display:block;border:0;width:' + width + 'px;margin-top:-' + top + 'px}</style>',
  '<div id="clip"><iframe id="f" src="'
    + 'file:///' + targetPath.split(path.sep).join('/') + '"></iframe></div>',
].join(''), 'utf8');

// iframe の中身の高さは組んでみないと分からないので、まず高さだけ測る
const probe = frame.replace('.shot-frame.html', '.shot-probe.html');
fs.writeFileSync(probe, fs.readFileSync(frame, 'utf8').replace('</style>',
  '</style><script>window.addEventListener("load",function(){setTimeout(function(){'
  + 'var d=document.getElementById("f").contentDocument;'
  + 'document.title="H"+d.documentElement.scrollHeight+"W"+d.documentElement.scrollWidth;'
  + '},700);});</script>'), 'utf8');

const profile = path.join(ROOT, 'build', '.chrome-shot');
function chrome(args) {
  return execFileSync(B.findChrome(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    // file:// の中の iframe は既定では中身を読めない（別オリジン扱い）。
    // 高さを測るために、この撮影用プロファイルに限って許可する
    '--allow-file-access-from-files',
    '--user-data-dir=' + profile,
  ].concat(args), { encoding: 'utf8', maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] });
}

const dom = chrome(['--window-size=900,1200', '--virtual-time-budget=15000', '--dump-dom',
  'file:///' + probe.split(path.sep).join('/')]);
const m = dom.match(/<title>H(\d+)W(\d+)<[/]title>/);
if (!m) { console.error('高さを測れませんでした'); process.exit(1); }

const innerH = Number(m[1]);
const innerW = Number(m[2]);

// 中身が指定幅より広いなら、それは本物の横あふれ。黙って撮らずに知らせる
if (innerW > width + 1) {
  console.error('✖ 横にあふれています: 中身 ' + innerW + 'px > 指定 ' + width + 'px');
  process.exit(1);
}

const shotH = height || innerH;
fs.writeFileSync(frame, fs.readFileSync(frame, 'utf8')
  .replace('width:' + width + 'px;margin-top',
           'width:' + width + 'px;height:' + innerH + 'px;margin-top'), 'utf8');

chrome(['--window-size=' + width + ',' + shotH, '--virtual-time-budget=15000',
  '--screenshot=' + out, 'file:///' + frame.split(path.sep).join('/')]);

console.log('撮影 : ' + path.relative(ROOT, out) + '  (' + width + ' x ' + shotH
  + (top ? ' / ' + top + 'px 目から' : '')
  + ' / 中身の総高 ' + innerH + 'px、横あふれなし)');
