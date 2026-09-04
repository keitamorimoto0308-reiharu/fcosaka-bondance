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
  { name: 'sched',      role: 'admin', tab: 'sched', w: 1400, h: 1400 },
  { name: 'sched-sp',   role: 'admin', tab: 'sched', w: 390,  h: 1400 },
  { name: 'sched-panel', role: 'admin', tab: 'sched', w: 1400, h: 1000,
    after: 'schOpen(null);' },
  { name: 'sched-efushi', role: 'admin', tab: 'sched', w: 1400, h: 900,
    after: 'schEfushi();' },
  // ステータスの選択肢。resize で閉じる作りなので、撮影の直前に開き直す
  { name: 'sched-status', role: 'admin', tab: 'sched', w: 1400, h: 900,
    after: "var b=document.querySelector('.sch-status[data-sid]'); if(b){b.click();}" },
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
/*
 * ⚠ **スマホ幅（w が 504 未満）の画像は、幅が信用できない。**
 *
 * Windows の Chrome はウィンドウを約504pxより細くできない。
 * --window-size=390 と指定しても 504px で組んだうえで左から390pxを切り取るので、
 * **ページの不具合ではない「右の切れ」**が写る。
 * 2026-09-04、実際にこの画像を見て「スマホではみ出している」と誤診しかけた
 * （実測すると scrollWidth は 390px ちょうどで、はみ出していなかった）。
 *
 * src/shot.js と src/contrast.js は iframe に閉じ込めてこれを避けている。
 * ここは模擬サーバー（別オリジン）を開く必要があってその手が使えないので、
 * **スマホ幅の判断は画像でせず、必ず実測する**こと。
 */

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
      /*
       * タブの切り替えは #hash で足りる。
       * 「パネルを開いた状態」のように**押さないと出ない画面**は、
       * 模擬サーバーの ?probe= に差し込む（開発用の入口。本番のGASには無い）。
       *
       * 以前は withScript() がスクリプトを組み立てていたが、
       * **その戻り値をどこも使っていなかった**（死んだコード）。
       * 「撮れているつもりで撮れていない」形だったので、実際に差し込む形にした。
       */
      let u = BASE + s.role;
      if (s.after){
        u += '&probe=' + encodeURIComponent(
          Buffer.from('setTimeout(function(){try{' + s.after + '}catch(e){}},2400);',
                      'utf8').toString('base64'));
      }
      shot(u + '#' + s.tab + (s.open ? '/' + s.open : ''), png, s.w, s.h);
    }
    console.log('  画像 : build/admin/' + s.name + '.png');
  }
  if (fs.existsSync(tmp)) fs.rmSync(tmp);
}

if (require.main === module) main();
