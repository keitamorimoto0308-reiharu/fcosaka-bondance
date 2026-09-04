/**
 * 募集要項PDF（A4・2枚）を生成する。
 *
 *   src/content.js … 文言（フォームと同じ単一の正）
 *   src/theme.js   … デザイントークンとアイコン
 *   src/qr.js      … 応募フォームのQRコード
 *        └──▶ build/boshu-yoko.html ──(Chrome headless)──▶ assets/boshu-yoko.pdf
 *
 * ■ なぜHTMLから作るのか
 *   PDFを別に手書きすると、フォームの記載とPDFの記載が必ずずれる。
 *   「PDFには17:30と書いてあるのにフォームは17:00」は実際によく起きる事故で、
 *   一度配ってしまうと回収できない。だから content.js から生成する。
 *
 * ■ ページからあふれたときに黙って切り捨てないこと
 *   .page の高さを固定して overflow:hidden にすると、はみ出した文章が
 *   静かに消える。ここでは min-height にして、あふれたら3ページ目ができるようにし、
 *   生成後にページ数が2であることを検査して落とす。壊れるなら音を立てて壊す。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const C = require('./content.js');
const { TOKENS: T, icon } = require('./theme.js');
const { qrSvg } = require('./qr.js');

const OUT_HTML = path.join(ROOT, 'build', 'boshu-yoko.html');
const OUT_PDF = path.join(ROOT, 'assets', 'boshu-yoko.pdf');
const EXPECTED_PAGES = 2;
// Webフォントの読み込み待ち。書体検査・PNG・PDFで同じ値を使う。
// 検査だけ長く待つと「検査は通ったのに本番はフォールバック書体」が起きる。
const FONT_WAIT_MS = 20000;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const yen = n => {
  // 単価が抜けたまま ¥NaN と印刷して配ってしまうのを止める
  if (n == null || !Number.isFinite(Number(n))) {
    throw new Error('単価が設定されていません（src/content.js の PRICES）: ' + n);
  }
  return '¥' + Number(n).toLocaleString('ja-JP');
};

/**
 * どの節をどのページに置くか。content.js の OUTLINE のタイトルで指定する。
 * 節を増やしたのにここへ足し忘れると、PDFから黙って消える。それを防ぐため
 * 「OUTLINE にあってページ計画に無い」場合はビルドを止める。
 */
const PAGE_PLAN = [
  // 1枚目＝「どんなイベントで、当日どう動くか」
  ['開催概要', '出店者特典', '当日の運営'],
  // 2枚目＝「いくらか、何が要るか、どう申し込むか」
  ['区画とレンタル備品', 'ご確認いただきたいこと'],
];

function planSections() {
  const byTitle = new Map(C.OUTLINE.map(g => [g.title, g]));
  const planned = PAGE_PLAN.flat();
  const missing = planned.filter(t => !byTitle.has(t));
  if (missing.length) {
    throw new Error('PAGE_PLAN に content.js の OUTLINE に無い節があります: ' + missing.join(', '));
  }
  const dropped = C.OUTLINE.map(g => g.title).filter(t => !planned.includes(t));
  if (dropped.length) {
    throw new Error('OUTLINE の節が PDF に載っていません: ' + dropped.join(', ')
      + ' → src/build-pdf.js の PAGE_PLAN に追加してください。');
  }
  return PAGE_PLAN.map(titles => titles.map(t => byTitle.get(t)));
}

// ────────────────────────────────────────────────────── CSS
function css() {
  return `
@page { size: A4; margin: 0; }
*,*::before,*::after{ box-sizing:border-box }
html,body{ margin:0; padding:0 }
body{
  font-family:${T.fontJa};
  color:${T.ink};
  background:${T.white};
  font-size:8.5pt;
  line-height:1.68;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
  font-feature-settings:"palt" 1;
}
.num{ font-family:${T.fontDisp}; font-weight:400; letter-spacing:.01em }

/* ── ページ。高さは固定しない（冒頭のコメント参照） */
.page{
  width:210mm; min-height:297mm; padding:11mm 13mm 13mm;
  position:relative; background:${T.white};
  page-break-after:always; break-after:page;
}
.page:last-child{ page-break-after:auto; break-after:auto }

/* ── ヘッダー：白地。FC大阪ロゴが黒一色のため濃色の面には置けない */
.ph{ display:flex; align-items:flex-end; justify-content:space-between;
     gap:8mm; padding-bottom:2.4mm; border-bottom:1.2pt solid ${T.ink} }
/* 本ロゴは横組みの中に3行入っている。46mm幅だと最下段が約1.6mmになり、
   印刷では潰れて読めない。56mm（＝高さ19.5mm）を下限とする。
   広げた分の場所は、右の主催表記からロゴを外して確保している
   （新ロゴが FC大阪 と みんな電力 を含むため、並べると同じ社章が2回出る）。 */
.ph-logo img{ width:56mm; height:auto; display:block }
.ph-sup{ display:flex; align-items:center; gap:2.4mm; padding-bottom:1.6mm }
.ph-sup .lbl{ font-size:7pt; font-weight:700; letter-spacing:.14em; color:${T.inkMuted}; white-space:nowrap }
.ph-sup .sep{ color:${T.inkFaint} }
.ph-sup .updater{ font-size:8pt; font-weight:700; letter-spacing:.06em; color:${T.ink} }

/* ── タイトル */
.titleblk{ padding-top:2.6mm }
.eyebrow{ margin:0 0 2mm; display:inline-block;
  background:${T.ink}; color:${T.brand};
  font-size:7.4pt; font-weight:700; letter-spacing:.24em;
  padding:1.3mm 3.4mm 1.1mm }
.t-main{ display:block; font-size:11pt; font-weight:500; letter-spacing:.22em; color:${T.inkMuted} }
.t-sub{ display:block; font-size:19pt; font-weight:900; letter-spacing:.02em; line-height:1.18; margin-top:1mm }
h1{ margin:0 }
.presented{ margin:1.2mm 0 0; font-size:8pt; letter-spacing:.1em; color:${T.inkMuted} }
.rule{ margin-top:1.6mm; width:22mm; height:2.2pt; background:${T.accent} }

.lead{ margin:2.8mm 0 0; font-size:8.6pt; line-height:1.62; max-width:158mm }
.notice{ margin:2mm 0 0; font-size:7.4pt; color:${T.inkMuted};
  border-left:1.2pt solid ${T.brand}; padding-left:3mm }

/* ── ファクト帯：濃色の面に水色の数字。紙面で一番強い場所 */
.facts{ margin-top:3.6mm; display:grid; grid-template-columns:repeat(3,1fr);
  background:${T.ink}; color:${T.white} }
.fact{ padding:2.2mm 3.6mm; border-left:.5pt solid rgba(255,255,255,.22) }
/* 3列なので、各段の左端だけ縦罫を消す。2段目の上には横罫を引く */
.fact:nth-child(3n+1){ border-left:0 }
.fact:nth-child(n+4){ border-top:.5pt solid rgba(255,255,255,.22) }
.fact .lab{ font-size:6.2pt; letter-spacing:.14em; color:${T.brand}; margin-bottom:.8mm }
.fact .big{ font-size:15pt; line-height:1; color:${T.brand} }
.fact .sml{ font-size:7.6pt; margin-left:1mm; color:${T.white} }
/* text-wrap:balance で行の長さを揃える。これが無いと注記の最後の1文字だけが
   次の行に落ちて、配る紙面としてだらしなく見える */
.fact .note{ font-size:6.2pt; color:rgba(255,255,255,.72); margin-top:1mm; line-height:1.45;
  text-wrap:balance }

/* ── 節 */
/* 節の間隔。2.6mm から 2.2mm へ（2026-09-02）。
   包材の条文を紙面に戻したぶん、A4 2枚に収まらなくなった。
   文字を削るより、間隔を 0.4mm 詰めるほうが情報を失わない。
   これ以上詰めると節の区切りが読めなくなるので、次に足すときは文字を削ること。 */
.sec{ margin-top:2.2mm; break-inside:avoid }
.sec-h{ display:flex; align-items:center; gap:2.2mm; margin-bottom:1.4mm;
  border-bottom:.7pt solid ${T.border}; padding-bottom:.9mm }
.sec-h .ic{ color:${T.brandDeep}; width:4.4mm; height:4.4mm; stroke-width:1.9 }
.sec-h h2{ margin:0; font-size:11pt; font-weight:700; letter-spacing:.04em }

.rows{ display:grid; grid-template-columns:26mm 1fr; row-gap:0.75mm; column-gap:4mm; margin:0 }
.rows dt{ font-size:7.9pt; font-weight:700; color:${T.inkMuted}; padding-top:.2mm }
.rows dd{ margin:0; font-size:8.5pt }
.rows dd.emph{ border-left:3pt solid ${T.accent}; padding-left:2.6mm; font-weight:500 }

/* ── 料金表 */
.tbl{ width:100%; border-collapse:collapse; margin-top:3mm; font-size:8.4pt }
.tbl th{ background:${T.brandPale}; color:${T.ink}; text-align:left;
  font-size:7.4pt; letter-spacing:.08em; padding:1.1mm 3mm; border-bottom:.7pt solid ${T.brandDeep} }
.tbl th.r,.tbl td.r{ text-align:right }
.tbl td{ padding:1.2mm 3mm; border-bottom:.5pt solid ${T.border} }
.tbl td.r{ font-family:${T.fontDisp}; font-size:11pt; letter-spacing:.02em }
.tbl td .u{ font-family:${T.fontJa}; font-size:7.8pt; color:${T.ink}; margin-left:1mm }
.pricenote{ margin:2mm 0 0; font-size:7.4pt; line-height:1.6; color:${T.ink};
  background:${T.accentPale}; border:.6pt solid ${T.accent}; border-left:3pt solid ${T.accent};
  padding:1.7mm 3mm }

/* ── 応募ブロック（濃色の面。ページ2で一番強い場所） */
.apply{ margin-top:5mm; background:${T.ink}; color:${T.white};
  display:flex; align-items:center; gap:6mm; padding:4.5mm 6mm }
.apply .qr{ background:${T.white}; padding:2.2mm; flex:none }
.apply .qr svg{ width:25mm; height:25mm; display:block }
.apply h2{ margin:0 0 1.6mm; font-size:12pt; color:${T.brand}; letter-spacing:.04em }
.apply p{ margin:0; font-size:8.2pt; color:rgba(255,255,255,.86); line-height:1.7 }
.apply .url{ display:inline-block; margin-top:2.4mm; font-family:${T.fontDisp};
  font-size:15pt; letter-spacing:.03em; color:${T.brand}; word-break:break-all }
.apply .dl{ margin-top:2.6mm; font-size:8.4pt; color:${T.white} }
.apply .dl b{ color:${T.brand}; font-family:${T.fontDisp}; font-size:12pt; letter-spacing:.02em }
.apply .dl .full{ display:block; font-size:7.6pt; color:rgba(255,255,255,.7); margin-top:.6mm }

/* ── 2枚目の走りヘッダー。抜き刷りで1枚だけ渡っても何の書類か分かるようにする */
.rh{ display:flex; align-items:center; justify-content:space-between; gap:6mm;
  padding-bottom:2mm; border-bottom:.7pt solid ${T.ink}; margin-bottom:1mm }
.rh .t{ font-size:8.6pt; font-weight:700; letter-spacing:.04em }
.rh .t span{ font-weight:400; color:${T.inkMuted}; margin-left:2.5mm; font-size:7.6pt }
.rh .updater{ font-size:7.6pt; font-weight:700; letter-spacing:.06em; color:${T.ink} }
.rh .sep{ color:${T.inkFaint} }
.rh .r{ display:flex; align-items:center; gap:3mm }

/* ── 問い合わせ・フッター */
.contact{ margin-top:3.4mm; border:.7pt solid ${T.border}; padding:2.4mm 4mm; font-size:8.2pt;
  display:flex; align-items:baseline; gap:4mm; flex-wrap:wrap }
.contact .h{ font-size:7.4pt; font-weight:700; letter-spacing:.12em; color:${T.inkMuted}; white-space:nowrap }
/* メールアドレスに Bebas Neue は使えない。大文字しか持たない書体のため
   fcosaka_bondance@ が FCOSAKA_BONDANCE@ と表示される。
   ドメインは大文字小文字を区別しないがローカル部は区別しうるので、実物どおりに出す。 */
.contact .mail{ font-size:10.5pt; font-weight:700; letter-spacing:.01em }
.pf{ position:absolute; left:13mm; right:13mm; bottom:6mm;
  display:flex; justify-content:space-between; align-items:baseline;
  font-size:6.6pt; color:${T.inkFaint}; border-top:.5pt solid ${T.border}; padding-top:1.8mm }
.pf .pg{ font-family:${T.fontDisp}; font-size:9pt; color:${T.inkMuted} }
`;
}

// ────────────────────────────────────────────────────── パーツ
function header() {
  // 本ロゴはラスター（PNG）なので、そのまま <img> で置ける。
  // 暫定ロゴはSVGの文字組みだったため、外部フォントが効かない <img> を避けて
  // インライン展開していた。その制約はもう無い。
  return `<header class="ph">
  <div class="ph-logo"><img src="../${esc(C.BRAND.logoWide)}" alt="${esc(C.EVENT.name)}"></div>
  <div class="ph-sup">
    <span class="lbl">${esc(C.BRAND.orgLabel)}</span>
    ${C.BRAND.sponsors.map((sp, i) => (i ? '<span class="sep">／</span>' : '')
      + `<span class="updater">${esc(sp.name)}</span>`).join('')}
  </div>
</header>`;
}

function facts() {
  return `<div class="facts">${C.FACTS.map(f => `
    <div class="fact">
      <div class="lab">${esc(f.label)}</div>
      <div><span class="big num">${esc(f.big)}</span>${f.small ? `<span class="sml">${esc(f.small)}</span>` : ''}</div>
      <div class="note">${f.note ? esc(f.note) : '&nbsp;'}</div>
    </div>`).join('')}</div>`;
}

function priceTable() {
  const rows = C.RENTALS.map(r => {
    const price = r.key ? C.PRICES[r.key] : r.price;
    return `
    <tr><td>${esc(r.label)}</td>
        <td class="r">${yen(price)}<span class="u">/ ${esc(r.unit)}</span></td></tr>`;
  }).join('');
  return `<table class="tbl">
    <thead><tr><th>レンタル備品</th><th class="r">単価（税込）</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="pricenote">${esc(C.PDF.priceNote)}</p>`;
}

function section(g) {
  // 紙面から外す行は2種類ある。
  //   omitRows        … ファクト帯に同じ文言が出ているので重複を省く（情報は残る）
  //   afterAcceptRows … 応募判断には要らないので、採択後の案内で伝える（紙面からは消える）
  const omit = ((C.PDF.omitRows && C.PDF.omitRows[g.title]) || [])
    .concat((C.PDF.afterAcceptRows && C.PDF.afterAcceptRows[g.title]) || []);
  const rows = g.body.filter(([label]) => !omit.includes(label)).map(([label, text, opt]) => {
    const cls = opt && opt.emphasis ? ' class="emph"' : '';
    return `<dt>${esc(label)}</dt><dd${cls}>${esc(text)}</dd>`;
  }).join('\n      ');
  const extra = g.body.some(b => b[2] && b[2].priceNote) ? priceTable() : '';
  return `<section class="sec">
  <div class="sec-h">${icon(g.icon, 18)}<h2>${esc(g.title)}</h2></div>
  <dl class="rows">
      ${rows}
  </dl>${extra}
</section>`;
}

async function applyBlock() {
  return `<div class="apply">
  <div class="qr">${await qrSvg(C.SITE.url)}</div>
  <div>
    <h2>ご応募はこちらから</h2>
    <p>${esc(C.PDF.applyNote)}</p>
    <span class="url">${esc(C.SITE.urlShown)}</span>
    <div class="dl">応募締切　<b>${esc(C.DEADLINE.short)} ${esc(C.DEADLINE.time)}</b>
      <span class="full">${esc(C.DEADLINE.full)}</span></div>
  </div>
</div>`;
}

/**
 * 2枚目の走りヘッダー。抜き刷りで1枚だけ渡っても何の書類か分かるようにする。
 *
 * ここは1ページ目のヘッダーと同じく、ロゴではなく社名の文字で出す。
 * 以前は FC大阪のワードマーク画像を貼っていたが、
 *   ・1ページ目には本ロゴの中の「F.C.☆OSAKA」（イベント書体）が出る
 *   ・2ページ目には旧クラブワードマーク（別書体）が出る
 * となり、同じPDFの中に書体の違うFC大阪の表記が2つ並んでいた。
 * 加えて画像は 155×29px で、4.2mm に刷ると約175dpi。印刷では眠くなる。
 */
function runningHeader() {
  return `<div class="rh">
    <div class="t">${esc(C.EVENT.name)}<span>出店者募集要項</span></div>
    <div class="r">
      ${C.BRAND.sponsors.map((sp, i) => (i ? '<span class="sep">／</span>' : '')
        + `<span class="updater">${esc(sp.name)}</span>`).join('')}
    </div>
  </div>`;
}

function contact() {
  return `<div class="contact">
  <div class="h">お問い合わせ</div>
  <div><b>${esc(C.CONTACT.name)}</b></div>
  <div class="mail">${esc(C.CONTACT.email)}</div>
</div>`;
}

function footer(n) {
  return `<div class="pf">
    <span>${esc(C.EVENT.name)}　出店者募集要項</span>
    <span class="pg">${n} / ${EXPECTED_PAGES}</span>
  </div>`;
}

// ────────────────────────────────────────────────────── ページ
function doc(pages) {
  return `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="utf-8">
<title>${esc(C.EVENT.name)} 出店者募集要項</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;500;700;900&display=swap">
<style>${css()}</style>
</head><body>
${pages.join('\n')}
</body></html>`;
}

async function pages() {
  const [p1, p2] = planSections();
  return [
`<div class="page">
  ${header()}
  <div class="titleblk">
    <span class="eyebrow">出店者募集のご案内</span>
    <h1><span class="t-main">${esc(C.EVENT.titleMain)}</span><span class="t-sub">${esc(C.EVENT.titleSub)}</span></h1>
    <p class="presented">${esc(C.EVENT.presented)}</p>
    <div class="rule"></div>
  </div>
  <p class="lead">${esc(C.PDF.lead)}</p>
  <p class="notice">${esc(C.NOTICE)}</p>
  ${facts()}
  ${p1.map(section).join('\n')}
  ${footer(1)}
</div>`,
`<div class="page">
  ${runningHeader()}
  ${p2.map(section).join('\n')}
  ${await applyBlock()}
  ${contact()}
  ${footer(2)}
</div>`,
  ];
}

async function html() { return doc(await pages()); }

// ────────────────────────────────────────────────────── PDF化
function findChrome() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('PDF化に使うChrome／Edgeが見つかりません');
  return found;
}

function toPdf(chrome, htmlPath, pdfPath) {
  const profile = path.join(ROOT, 'build', '.chrome-profile');
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + profile,
    '--virtual-time-budget=' + FONT_WAIT_MS,      // Webフォントの読み込みを待つ
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--print-to-pdf=' + pdfPath,
    pathToFileURL(htmlPath).href,
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
}

/**
 * 各ページをPNGにも書き出す。
 * PDFのままだと中身を目で確認する手段が無く、「組んだつもり」で配ってしまう。
 * けいたへ送る確認用HTMLにもこの画像を使う（PDFを開かせずにスマホで見られる）。
 *
 * A4 = 210×297mm。CSSの96dpi換算で 794×1123px。倍率2で書き出す。
 */
const PAGE_W = 794, PAGE_H = 1123;

function shot(chrome, htmlPath, pngPath, height) {
  const profile = path.join(ROOT, 'build', '.chrome-profile');
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + profile,
    '--hide-scrollbars', '--force-device-scale-factor=2',
    '--virtual-time-budget=' + FONT_WAIT_MS,
    '--window-size=' + PAGE_W + ',' + (height || PAGE_H),
    '--screenshot=' + pngPath,
    pathToFileURL(htmlPath).href,
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
}

/** ページごとの単票HTMLとPNGを build/ に置く。diag=true で紙面より縦長に撮り、あふれを見る */
async function previews(chrome, diag) {
  const list = await pages();
  const out = [];
  list.forEach((body, i) => {
    const h = path.join(ROOT, 'build', 'page-' + (i + 1) + '.html');
    const png = path.join(ROOT, 'build', 'page-' + (i + 1) + (diag ? '-diag' : '') + '.png');
    fs.writeFileSync(h, doc([body]), 'utf8');
    shot(chrome, h, png, diag ? 1600 : PAGE_H);
    out.push(png);
  });
  return out;
}

/**
 * 書体が本当に読み込まれたかを確かめる。
 *
 * 見出しの Bebas Neue と本文の Noto Sans JP は Google Fonts から取得している。
 * 回線が落ちていても Chrome はエラーを出さず、システムのゴシックで
 * 「それらしく」組んでしまう。PDFを開いても気づきにくい、いちばん質の悪い壊れ方なので、
 * 実際に使われたかを Chrome に聞いてから確定させる。
 */
const REQUIRED_FONTS = ['Noto Sans JP', 'Bebas Neue'];

function verifyFonts(chrome, htmlPath) {
  // 読み込みが済んでから document.fonts.check() で1書体ずつ確かめ、
  // 結果を body に書き出して --dump-dom で読み取る。
  // 目印の文字列はスクリプト側で連結して作る。そのまま書くと、
  // --dump-dom が返すスクリプト本文のほうに正規表現が先に当たってしまう。
  const check = [
    '<script>window.addEventListener("load", function () {',
    '  setTimeout(function () {',
    '    var need = ' + JSON.stringify(REQUIRED_FONTS) + ';',
    '    var r = need.map(function (f) {',
    '      return f + "=" + (document.fonts.check(\'12pt "\' + f + \'"\') ? "ok" : "NG");',
    '    });',
    '    document.body.textContent = "FONT" + "CHECK " + r.join(" | ");',
    '  }, 700);',
    '});</scr' + 'ipt>',
  ].join('\n');

  const tmp = path.join(ROOT, 'build', 'fontcheck.html');
  fs.writeFileSync(tmp, fs.readFileSync(htmlPath, 'utf8').replace('</head>', check + '</head>'), 'utf8');

  const dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--user-data-dir=' + path.join(ROOT, 'build', '.chrome-profile'),
    '--virtual-time-budget=' + FONT_WAIT_MS, '--dump-dom',
    pathToFileURL(tmp).href,
  ], { encoding: 'utf8', maxBuffer: 1e8 });

  const m = dom.match(/FONTCHECK ([^<]*)/);
  if (!m) throw new Error('書体の確認ができませんでした（Chromeの応答が想定と違います）');
  const bad = m[1].trim().split(" | ").filter(x => x.endsWith('=NG'));
  if (bad.length) {
    throw new Error('指定した書体が読み込まれていません: ' + bad.join(', ')
      + ' — Google Fonts に接続できていない可能性があります。'
      + ' このまま作るとシステム書体で組まれたPDFができ、見た目だけが静かに変わります。');
  }
  return m[1].trim();
}

async function verify(pdfPath) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(pdfPath));
  const n = doc.getPageCount();
  const size = doc.getPage(0).getSize();
  const mm = v => Math.round(v / 72 * 25.4);
  if (mm(size.width) !== 210 || mm(size.height) !== 297) {
    throw new Error('用紙がA4ではありません: ' + mm(size.width) + '×' + mm(size.height) + 'mm');
  }
  if (n !== EXPECTED_PAGES) {
    throw new Error('ページ数が ' + n + ' です（想定 ' + EXPECTED_PAGES + '）。'
      + ' 本文があふれて次ページに送られています。build/boshu-yoko.html を開いて確認してください。');
  }
  return { n, mm: mm(size.width) + '×' + mm(size.height) + 'mm' };
}

/**
 * 稼働中の設定シートと、紙面に刷る値が一致しているかを確かめる。
 *
 * ■ なぜ要るか
 *   単価・締切・来場者数の表記は、いま3か所にある。
 *     ① src/content.js（PDFはこれを刷る）
 *     ② gas/Config.gs の既定値
 *     ③ 実際の設定シート（応募フォームは実行時にこれを読む）
 *   けいたが③を直した瞬間、フォームは新しい値・配布済みのPDFは古い値になる。
 *   紙は回収できないので、食い違ったまま刷らせない。
 *
 *   接続できないときも止める。「つながらなかったので確認せずに刷りました」は、
 *   このファイルが避けようとしている静かな劣化そのものだから。
 *   意図して飛ばすときは SKIP_CONFIG_CHECK=1 を明示する。
 */
async function verifyConfig() {
  if (process.env.SKIP_CONFIG_CHECK === '1') {
    console.log('  設定照合 : ⚠ 飛ばしました（SKIP_CONFIG_CHECK=1）');
    return;
  }
  const epFile = path.join(ROOT, 'src', 'endpoint.live.json');
  if (!fs.existsSync(epFile)) {
    console.log('  設定照合 : 稼働中のURLが無いため省略');
    return;
  }
  const url = JSON.parse(fs.readFileSync(epFile, 'utf8')).gasUrl;
  if (!url) return;

  // 3回まで試す。Googleは時折リダイレクトのHTMLを返すことがあり、
  // 一度の失敗で配布物のビルド全体が止まるのは行き過ぎ。
  // **3回とも失敗したら止める**（照合しないまま紙を作らない、が主旨）。
  let live, lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url + '?action=formConfig', { redirect: 'follow' });
      live = await res.json();
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastErr) {
    throw new Error('稼働中の設定シートを、3回試しても読めませんでした（'
      + lastErr.message + '）。'
      + '紙面の値が本番と合っているか確認できないため、ここで止めます。'
      + ' 回線の問題だと分かっている場合は SKIP_CONFIG_CHECK=1 を付けて実行してください。');
  }

  // 台帳の列が定義とずれていると、応募が記録できずエラーになる。
  // 配布物を作る前に必ず止める（§0「応募が届かない事故をゼロに」）。
  if (live.ledgerReady === false) {
    throw new Error([
      '台帳（応募一覧）の列が、いまの項目定義と一致していません。',
      '    この状態で応募が来ると記録できず、応募者にはエラーが表示されます。',
      '    退避シートには残るので応募自体は失われませんが、公開前に必ず直してください。',
      '    直し方：応募一覧のテストデータを消したうえで、Apps Script から setup() を1回実行します。',
    ].join('\n'));
  }

  // 採択後に集めるシートの列。足りないと、事業者が入力した値が
  // **エラーも出さずに消える**。応募一覧と違って例外にならないので、
  // ここで見ておかないと誰も気づけない
  if (live.confirmReady === false) {
    console.log('  ⚠ 出店確定情報シートの列が、いまの項目定義と一致していません。');
    console.log('    このまま採択通知を送ると、事業者が入力した値の一部が消えます。');
    console.log('    Apps Script から setup() を1回実行してください。');
  }

  const diff = [];
  if (live.deadline && live.deadline !== C.DEADLINE.full) {
    diff.push('締切：紙面「' + C.DEADLINE.full + '」／設定シート「' + live.deadline + '」');
  }
  // 来場者数の表記は、2026-09-02 に設定シートから外して content.js 1本にした。
  // 比べる相手がいないので照合しない。
  for (const [key, mine] of Object.entries(C.PRICES)) {
    const theirs = live.prices ? live.prices[key] : undefined;
    if (theirs === undefined) {
      diff.push('単価 ' + key + '：設定シート側にこの項目がありません'
        + '（稼働中のGASが古い可能性。gas/ の変更が本番に反映されていません）');
    } else if (theirs === null) {
      diff.push('単価 ' + key + '：紙面は ' + yen(mine)
        + '／設定シートは未設定。応募フォームは「調整中」と表示します');
    } else if (Number(theirs) !== Number(mine)) {
      diff.push('単価 ' + key + '：紙面 ' + yen(mine) + '／設定シート ' + yen(theirs));
    }
  }

  // 紙面の料金表は静的なので、けいたさんが品目シートに行を足すと**紙だけ古くなる**。
  // 配ったあとでは直せないため、ここで刷るのを止める。
  if (Array.isArray(live.rentalItems) && live.rentalItems.length === 0) {
    // 稼働中のGASは新しいが、まだレンタル品目シートが無い（setup() 未実行）。
    // ここで止めると、それを直すためのデプロイ自体ができなくなるので、
    // 大きく警告して先へ進める。応募フォームには数量の欄が出ない状態。
    console.log('  設定照合 : ⚠ レンタル品目シートがまだありません。'
      + 'Apps Script から setup() を1回実行してください（応募フォームに数量の欄が出ません）');
  } else if (Array.isArray(live.rentalItems)) {
    const paper = C.RENTAL_QTY.map(r => r.label);
    const sheet = live.rentalItems.map(it => it.name);
    sheet.filter(n => !paper.includes(n)).forEach(n => diff.push(
      'レンタル品目「' + n + '」がシートにありますが、紙面の料金表に載っていません'));
    paper.filter(n => !sheet.includes(n)).forEach(n => diff.push(
      'レンタル品目「' + n + '」が紙面にありますが、シートにありません（無効の可能性）'));
    live.rentalItems.forEach(it => {
      const mine = C.RENTAL_QTY.find(r => r.label === it.name);
      if (mine && Number(mine.price) !== Number(it.price)) {
        diff.push('単価「' + it.name + '」：紙面 ' + yen(mine.price) + '／シート ' + yen(it.price));
      }
    });
  }

  if (diff.length) {
    throw new Error('紙面の値が、稼働中の設定シートと食い違っています。\n'
      + diff.map(d => '      ・' + d).join('\n')
      + '\n    このまま刷ると、配ったPDFと応募フォームで違うことを言うことになります。'
      + '\n    設定シートを直すか、src/content.js を直してください。'
      + '\n    承知のうえで刷る場合は SKIP_CONFIG_CHECK=1 を付けて実行してください。');
  }
  console.log('  設定照合 : 稼働中の設定シートと一致');
}

async function main() {
  const diag = process.argv.includes('--diag');
  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.writeFileSync(OUT_HTML, await html(), 'utf8');
  console.log('  組版     : ' + path.relative(ROOT, OUT_HTML));

  const chrome = findChrome();
  if (!diag) await verifyConfig();
  console.log('  書体     : ' + verifyFonts(chrome, OUT_HTML));

  const pngs = await previews(chrome, diag);
  pngs.forEach(p => console.log('  画像     : ' + path.relative(ROOT, p)));
  if (diag) return;   // あふれを見るためのモード。PDF検査は走らせない

  // 検査に通ってから assets/ へ移す。
  // 直接書くと、検査で落ちたときに壊れたPDFが残り、
  // 応募フォームのダウンロードボタンからそれが配られてしまう。
  // Chrome の --print-to-pdf は読み込みに失敗しても終了コード0を返すので、
  // 「例外が出なかった＝正しく作れた」ではない。
  const tmpPdf = path.join(ROOT, 'build', 'boshu-yoko.tmp.pdf');
  toPdf(chrome, OUT_HTML, tmpPdf);
  const info = await verify(tmpPdf);
  fs.mkdirSync(path.dirname(OUT_PDF), { recursive: true });
  fs.renameSync(tmpPdf, OUT_PDF);

  const kb = Math.round(fs.statSync(OUT_PDF).size / 1024);
  console.log('  書き出し : ' + path.relative(ROOT, OUT_PDF)
    + ' (' + info.n + 'ページ / ' + info.mm + ' / ' + kb + 'KB)');
}

if (require.main === module) {
  main().catch(e => { console.error('\n  ✗ ' + e.message + '\n'); process.exit(1); });
}
module.exports = { html, PAGE_PLAN, planSections, EXPECTED_PAGES, findChrome, FONT_WAIT_MS };
