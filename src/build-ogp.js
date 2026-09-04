/**
 * OGP画像（SNS・メール・LINEにURLを貼ったときに出るカード）を作る。
 *
 *   src/content.js … 文言（フォーム・PDFと同じ単一の正）
 *   src/theme.js   … デザイントークン
 *        └──▶ build/ogp.html ──(Chrome headless)──▶ assets/ogp.png
 *
 * ■ なぜ要るか
 *   営業がこのURLをメールやチャットで送る。そこに出る画像が
 *   「ただのスタジアム写真」だと、何のイベントかが1行も伝わらない。
 *   受け取った側は本文を読まないと判断できず、転送されるほど劣化する。
 *
 * ■ 濃色の面なので、ロゴタイプは置けない
 *   支給ロゴのロゴタイプ（F.C.☆OSAKA）は墨色 #221816 で、暗い写真の上では消える。
 *   ここに置けるのは mark（エンブレム単体）だけ。文字は本文として組む。
 *   ※ ヒーローと同じ考え方（src/build-form.js のコメント参照）
 *
 * ■ 縮小されて出ることを前提に組む
 *   多くのアプリはこの画像を 300〜500px 幅で表示する。
 *   1200pxで「ちょうどいい」大きさに組むと、実際に見えるときには読めない。
 *   文字は大きく、要素は少なく。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const C = require('./content.js');
const { TOKENS: T } = require('./theme.js');
const { findChrome } = require('./build-pdf.js');

const OUT_HTML = path.join(ROOT, 'build', 'ogp.html');
const OUT_PNG = path.join(ROOT, 'assets', 'ogp.png');
const W = 1200, H = 630;
const FONT_WAIT_MS = 20000;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 画像はファイルURLで読ませる（build/ から見た相対だと Chrome の解決先がぶれる） */
const fileUrl = rel => 'file:///' + path.join(ROOT, rel).split(path.sep).join('/');

function html() {
  return `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;700;900&display=swap">
<style>
*,*::before,*::after{ box-sizing:border-box }
html,body{ margin:0; padding:0 }
body{ width:${W}px; height:${H}px; overflow:hidden;
  font-family:${T.fontJa}; color:${T.white}; background:${T.ink};
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
  font-feature-settings:"palt" 1 }
.card{ position:relative; width:${W}px; height:${H}px; overflow:hidden; isolation:isolate }
.photo{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:-2 }
/* 黒の膜。左を濃く（文字が乗る）、右を薄く（スタジアムが見える） */
.card::before{ content:''; position:absolute; inset:0; z-index:-1;
  background:linear-gradient(100deg,
    rgba(20,14,13,.94) 0%, rgba(20,14,13,.88) 46%,
    rgba(20,14,13,.66) 74%, rgba(20,14,13,.52) 100%) }
.inner{ position:relative; z-index:1; height:100%;
  padding:54px 60px; display:flex; flex-direction:column; justify-content:center }
.top{ display:flex; align-items:center; gap:26px; margin-bottom:26px }
.mark{ width:132px; height:132px; flex:none; display:block }
.eyebrow{ display:inline-block; align-self:flex-start;
  background:${T.brand}; color:${T.ink};
  font-size:20px; font-weight:700; letter-spacing:.2em; padding:8px 18px }
.en{ font-family:${T.fontDisp}; font-size:22px; letter-spacing:.3em;
  color:${T.brand}; opacity:.9; margin:0 0 8px }
h1{ margin:0; font-size:74px; font-weight:900; letter-spacing:.01em;
  line-height:1.1; color:${T.brand} }
h1 .sub{ display:block; font-size:44px; margin-top:10px; color:${T.white} }
.meta{ margin-top:26px; font-size:27px; font-weight:700; line-height:1.5 }
.meta .sep{ color:${T.brand}; margin:0 14px }
.pres{ margin-top:14px; font-size:20px; color:rgba(255,255,255,.74); letter-spacing:.06em }
</style></head><body>
<div class="card">
  <img class="photo" src="${fileUrl('assets/stadium.webp')}" alt="">
  <div class="inner">
    <div class="top">
      <img class="mark" src="${fileUrl(C.BRAND.mark)}" alt="">
      <div>
        <p class="en">${esc(C.EVENT.nameEn)}</p>
        <span class="eyebrow">出店者募集</span>
      </div>
    </div>
    <h1>${esc(C.EVENT.titleMain)}<span class="sub">${esc(C.EVENT.titleSub)}</span></h1>
    <p class="meta">${esc(C.EVENT.date)}<span class="sep">／</span>${esc(C.EVENT.venueShort)}</p>
    <p class="pres">${esc(C.EVENT.presented)}　主催：${esc(C.EVENT.organizerNote)}</p>
  </div>
</div>
</body></html>`;
}

function main() {
  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.writeFileSync(OUT_HTML, html(), 'utf8');
  console.log('  組版     : ' + path.relative(ROOT, OUT_HTML));

  const profile = path.join(ROOT, 'build', '.chrome-ogp');
  execFileSync(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--user-data-dir=' + profile,
    '--window-size=' + W + ',' + H,
    '--virtual-time-budget=' + FONT_WAIT_MS,
    '--screenshot=' + OUT_PNG,
    'file:///' + OUT_HTML.split(path.sep).join('/'),
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  // 書き出せていない・寸法が違うまま配るのを止める。
  // OGPは自分の画面には出ないので、壊れていても本人には見えない。
  if (!fs.existsSync(OUT_PNG)) throw new Error('OGP画像を書き出せませんでした');
  const size = fs.statSync(OUT_PNG).size;
  const dim = pngSize(OUT_PNG);
  if (dim.w !== W || dim.h !== H) {
    throw new Error('OGP画像の寸法が違います: ' + dim.w + 'x' + dim.h + '（想定 ' + W + 'x' + H + '）');
  }
  console.log('  書き出し : ' + path.relative(ROOT, OUT_PNG)
    + ' (' + dim.w + '×' + dim.h + ' / ' + Math.round(size / 1024) + 'KB)');
}

/** PNGヘッダーから寸法を読む（依存を増やさない） */
function pngSize(file) {
  const b = fs.readFileSync(file).subarray(0, 33);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('PNGではありません: ' + file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

if (require.main === module) main();
module.exports = { html, pngSize, W, H };
