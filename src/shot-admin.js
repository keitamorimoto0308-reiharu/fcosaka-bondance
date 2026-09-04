/**
 * 管理ページの画面を画像に残す（開発用）。
 *
 *   node src/mock.js          … 先に模擬サーバーを起動しておく
 *   node src/shot-admin.js    … build/admin/*.png を作る
 *
 * けいたへの確認用と、モニターに見せる材料に使う。
 * 模擬サーバーの ?autologin= を使って入室済みの状態で撮る。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'admin');
const B = require('./build-pdf.js');   // findChrome を共有する
const BASE = 'http://localhost:4174/admin.html?autologin=';

/** 撮りたい画面。tab はページ内のタブ、w/h は画面の大きさ */
const SHOTS = [
  { name: 'dash',       role: 'admin', tab: 'dash', w: 1400, h: 1700 },
  { name: 'list',       role: 'admin', tab: 'list', w: 1400, h: 900 },
  { name: 'map',        role: 'admin', tab: 'map',  w: 1400, h: 1000 },
  { name: 'detail',     role: 'admin', tab: 'list', w: 1400, h: 1100, open: 'SB-0003' },
  { name: 'day',        role: 'admin', tab: 'day',  w: 1400, h: 900 },
  { name: 'day-sp',     role: 'admin', tab: 'day',  w: 390,  h: 1100 },
  { name: 'mail',       role: 'admin', tab: 'mail', w: 1200, h: 1300 },
  // 一般権限では、メール送信タブそのものが出ないことを目で確かめる用
  { name: 'mail-staff', role: 'staff', tab: 'mail', w: 1200, h: 700 },
  { name: 'gate',       role: '',      tab: '',     w: 1000, h: 760 },
  { name: 'dash-sp',    role: 'admin', tab: 'dash', w: 390,  h: 1500 },
  { name: 'list-sp',    role: 'admin', tab: 'list', w: 390,  h: 900 },
];

/**
 * profile を分けられるようにしてある。
 * 入室画面を撮るときに同じプロファイルを使うと、直前の自動入室で
 * localStorage にセッションが残っていて、**入室済みの画面が撮れてしまう**。
 * 実際に一度それでモニターに誤った画像を見せた。
 */
function shot(url, png, w, h, profile) {
  execFileSync(B.findChrome(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + path.join(ROOT, 'build', profile || '.chrome-admin'),
    '--hide-scrollbars', '--force-device-scale-factor=2',
    '--virtual-time-budget=' + B.FONT_WAIT_MS,
    '--window-size=' + w + ',' + h,
    '--screenshot=' + png,
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
}

/**
 * 目的の画面を開いた状態のHTMLを作る。
 * headless Chrome は「開いてからクリック」ができないので、
 * 読み込み後に自分でタブを押す小さなスクリプトを足しておく。
 */
function withScript(role, tab, open) {
  const url = BASE + (role || 'none');
  const js = [
    'window.addEventListener("load", function(){',
    '  setTimeout(function(){',
    tab ? '    var b = document.querySelector(\'.tabs button[data-tab="' + tab + '"]\'); if (b) b.click();' : '',
    open ? '    setTimeout(function(){ var tr = document.querySelector(\'#listBody tr[data-id="' + open + '"]\'); if (tr) tr.click(); }, 1400);' : '',
    '  }, 1600);',
    '});',
  ].join('\n');
  return { url, js };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(ROOT, 'build', 'admin', '_shot.html');

  for (const s of SHOTS) {
    const png = path.join(OUT, s.name + '.png');
    if (!s.role) {
      // 入室画面は、セッションの残っていない別プロファイルで撮る
      const clean = path.join(ROOT, 'build', '.chrome-gate');
      fs.rmSync(clean, { recursive: true, force: true });
      shot('http://localhost:4174/admin.html', png, s.w, s.h, '.chrome-gate');
    } else {
      const { url, js } = withScript(s.role, s.tab, s.open);
      // 模擬サーバーが返すHTMLに、タブを押すスクリプトを足して一時ファイルにする…
      // ではなく、URLに直接スクリプトは渡せないので、
      // 模擬サーバーの自動入室ページをそのまま開き、待ち時間で描画を待つ。
      // タブの切り替えは #hash で行えるようにしておく。
      shot(url + '#' + s.tab + (s.open ? '/' + s.open : ''), png, s.w, s.h);
    }
    console.log('  画像 : build/admin/' + s.name + '.png');
  }
  if (fs.existsSync(tmp)) fs.rmSync(tmp);
}

if (require.main === module) main();
