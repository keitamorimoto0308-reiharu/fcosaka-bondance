/**
 * 配布キット（成果物②）を作る。
 *
 * 仕様書§7：FC大阪の営業が「コピーして送るだけ」の状態にする。
 *
 *   src/content.js の KIT / SITE / EVENT
 *        ├──▶ assets/kit/haifu-kit.html   … 営業が開く1枚。文例をコピーボタンで取る
 *        ├──▶ assets/kit/qr.svg           … QR（ベクター。拡大しても劣化しない）
 *        ├──▶ assets/kit/qr-1024.png      … QR（画面共有・スライド貼り込み用）
 *        ├──▶ assets/kit/qr-meishi.pdf    … 名刺サイズのQRカード（A4に10枚。切って使う）
 *        ├──▶ assets/kit/qr-a4.pdf        … A4掲示用
 *        └──▶ assets/kit/fcosaka-shanai.pdf … FC大阪社内向け説明資料（A4・1枚）
 *
 * ■ 文例の中の【　】について
 *   締切・URL・問い合わせ先は、ここで自動的に実際の値へ置き換える。
 *   文例に直接書いてしまうと、日程が動いたときに文例だけ古いまま配られる。
 *   置き換えずに残る【　】は「営業が埋める場所」だけになる。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const C = require('./content.js');
const { TOKENS: T } = require('./theme.js');
const { qrSvg, qrPng } = require('./qr.js');

const OUT = path.join(ROOT, 'assets', 'kit');
const BUILD = path.join(ROOT, 'build', 'kit');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 締切は content.js の DEADLINE から導出する。曜日を手で書くと必ず間違える
const deadline = () => C.DEADLINE.full;

/** 自動で埋まる差し込み。ここに無い【　】は営業が埋める */
const FILL = {
  '【締切】': deadline(),
  '【URL】': C.SITE.url,
  '【問い合わせ先】': C.CONTACT.email,
};
/** 営業が埋める場所。キットの画面上で目立たせる */
const MANUAL = ['【会社名】', '【お名前】', '【担当者名】', '【署名】'];

/**
 * 【 】で囲んであるが差し込みではなく、そのまま送る文字。
 * ここに挙げていない【 】が残っていたら、差し込み漏れとしてテストが落ちる。
 */
const LITERAL = ['【再送】'];

function fill(line) {
  let out = line;
  for (const [k, v] of Object.entries(FILL)) out = out.split(k).join(v);
  return out;
}

/** 差し込み済みのプレーンテキスト（コピーされるのはこれ） */
function mailText(m) {
  return m.body.map(fill).join('\n');
}

/** 件名も同じく差し込む。本文だけ置き換えていて、件名に【締切】が残っていた */
function mailSubject(m) {
  return fill(m.subject);
}

/** 画面表示用。営業が埋める箇所だけ色を付ける */
function mailHtml(m) {
  let h = esc(mailText(m));
  for (const k of MANUAL) h = h.split(esc(k)).join('<mark>' + esc(k) + '</mark>');
  return h;
}

// ──────────────────────────────────────────── 印刷物の共通CSS
function printCss() {
  return `
@page { size: A4; margin: 0; }
*,*::before,*::after{ box-sizing:border-box }
html,body{ margin:0; padding:0 }
body{ font-family:${T.fontJa}; color:${T.ink}; background:${T.white};
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
  font-feature-settings:"palt" 1; line-height:1.7 }
.page{ width:210mm; min-height:297mm; position:relative; background:${T.white};
  page-break-after:always; break-after:page }
.page:last-child{ page-break-after:auto; break-after:auto }
.num{ font-family:${T.fontDisp} }`;
}

// ──────────────────────────────────────────── A4掲示用
async function posterHtml() {
  const f = C.FACTS.find(x => x.fromConfig === 'deadline');
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>${esc(C.EVENT.name)} 出店者募集（掲示用）</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;500;700;900&display=swap">
<style>${printCss()}
.page{ padding:20mm 18mm; display:flex; flex-direction:column }
.hd{ display:flex; align-items:flex-end; justify-content:space-between;
  border-bottom:1.4pt solid ${T.ink}; padding-bottom:4mm }
.hd .logo img{ width:58mm; height:auto; display:block }
.hd .org{ font-size:9pt; font-weight:700; letter-spacing:.1em }
.hd .org{ display:flex; align-items:center; gap:3mm }
.hd .org span{ color:${T.inkMuted}; font-weight:400 }
.hd .org img{ height:6mm; width:auto; display:block }
.hd .org .sep{ color:${T.inkFaint} }
.eyebrow{ margin:14mm 0 4mm; display:inline-block; background:${T.ink}; color:${T.brand};
  font-size:11pt; font-weight:700; letter-spacing:.3em; padding:2.4mm 6mm 2mm; align-self:flex-start }
h1{ margin:0; font-size:19pt; font-weight:500; letter-spacing:.2em; color:${T.inkMuted} }
h1 b{ display:block; font-size:44pt; font-weight:900; letter-spacing:.02em;
  color:${T.ink}; margin-top:2mm; line-height:1.15 }
.presented{ margin-top:3mm; font-size:11pt; letter-spacing:.1em; color:${T.inkMuted} }
.facts{ margin-top:12mm; display:grid; grid-template-columns:repeat(3,1fr); background:${T.ink} }
.fact{ padding:7mm 6mm; border-left:.5pt solid rgba(255,255,255,.22) }
.fact:first-child{ border-left:0 }
.fact .lab{ font-size:8.5pt; letter-spacing:.16em; color:${T.brand}; margin-bottom:2mm }
.fact .big{ font-family:${T.fontDisp}; font-size:32pt; line-height:1; color:${T.brand} }
.fact .sml{ font-size:13pt; margin-left:2mm; color:${T.white} }
.fact .note{ font-size:8.5pt; color:rgba(255,255,255,.72); margin-top:2mm }
.qrblk{ margin-top:auto; display:flex; align-items:center; gap:12mm;
  border:1.4pt solid ${T.ink}; padding:10mm }
.qrblk svg{ width:62mm; height:62mm; display:block; flex:none }
.qrblk .t{ font-size:16pt; font-weight:700; letter-spacing:.04em }
.qrblk .u{ font-family:${T.fontDisp}; font-size:26pt; color:${T.brandDeep};
  letter-spacing:.02em; margin-top:3mm; word-break:break-all }
.qrblk .d{ margin-top:5mm; font-size:12pt }
.qrblk .d b{ font-family:${T.fontDisp}; font-size:20pt; color:${T.ink}; margin-left:2mm }
.qrblk .d .full{ display:block; font-size:9.5pt; color:${T.inkMuted}; margin-top:1mm }
.foot{ margin-top:7mm; display:flex; justify-content:space-between; align-items:baseline;
  font-size:9pt; color:${T.inkMuted}; border-top:.7pt solid ${T.border}; padding-top:3mm }
.foot .mail{ font-weight:700; color:${T.ink} }
</style></head><body>
<div class="page">
  <div class="hd">
    <div class="logo">${logoImg()}</div>
    <div class="org"><span>${esc(C.BRAND.orgLabel)}</span>${C.BRAND.sponsors.map((sp, i) =>
      (i ? '<span class="sep">／</span>' : '')
      + esc(sp.name)).join('')}</div>
  </div>
  <span class="eyebrow">出店者募集</span>
  <h1>${esc(C.EVENT.titleMain)}<b>${esc(C.EVENT.titleSub)}</b></h1>
  <div class="presented">${esc(C.EVENT.presented)}</div>
  <div class="facts">
    <div class="fact"><div class="lab">開催日</div>
      <div><span class="big">10.24</span><span class="sml">SAT</span></div>
      <div class="note">2026年 ／ ${esc(C.EVENT.hours)}</div></div>
    <div class="fact"><div class="lab">会場</div>
      <div><span class="big">HANAZONO</span></div>
      <div class="note">${esc(C.EVENT.venueShort)}</div></div>
    <div class="fact"><div class="lab">出店料</div>
      <div><span class="big">¥0</span></div>
      <div class="note">売上歩合なし／備品は別途</div></div>
  </div>
  <div class="qrblk">
    ${await qrSvg(C.SITE.url)}
    <div>
      <div class="t">応募はこちらから</div>
      <div class="u">${esc(C.SITE.urlShown)}</div>
      <div class="d">応募締切<b>${esc(C.DEADLINE.short)} ${esc(C.DEADLINE.time)}</b>
        <span class="full">${esc(C.DEADLINE.full)}</span></div>
    </div>
  </div>
  <div class="foot">
    <span>${esc(C.EVENT.organizer)}</span>
    <span class="mail">${esc(C.CONTACT.email)}</span>
  </div>
</div></body></html>`;
}

// ──────────────────────────────────────────── 名刺サイズのQRカード（A4に10枚）
async function meishiHtml() {
  const qr = await qrSvg(C.SITE.url);
  const card = `<div class="card">
    <div class="q">${qr}</div>
    <div class="tx">
      <div class="ev">${esc(C.EVENT.titleMain)}<br>${esc(C.EVENT.titleSub)}</div>
      <div class="dt">${esc(C.EVENT.dateBig)} <span>SAT</span></div>
      <div class="vn">${esc(C.EVENT.venueShort)}</div>
      <div class="cta">出店者募集</div>
      <div class="url">${esc(C.SITE.urlShown)}</div>
      <div class="dl">締切 ${esc(C.DEADLINE.label)}</div>
    </div>
  </div>`;
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>${esc(C.EVENT.name)} QRカード（名刺サイズ）</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;500;700;900&display=swap">
<style>${printCss()}
/* 名刺サイズ 91×55mm を2列×5行。A4（210×297）に対し
   左右余白 (210-182)/2=14mm、上下 (297-275)/2=11mm */
.page{ padding:11mm 14mm; display:grid;
  grid-template-columns:repeat(2,91mm); grid-template-rows:repeat(5,55mm) }
.card{ width:91mm; height:55mm; border:.3pt dashed ${T.border};
  display:flex; align-items:center; gap:4mm; padding:5mm }
.card .q{ flex:none }
.card .q svg{ width:32mm; height:32mm; display:block }
.card .ev{ font-size:11pt; font-weight:900; letter-spacing:.01em; line-height:1.25 }
.card .dt{ font-family:${T.fontDisp}; font-size:13pt; color:${T.ink}; margin-top:1.2mm }
.card .vn{ font-size:7.4pt; color:${T.inkMuted}; margin-top:.3mm; line-height:1.4 }
.card .dt span{ font-size:9pt }
.card .cta{ display:inline-block; margin-top:2mm; background:${T.ink}; color:${T.brand};
  font-size:7.5pt; font-weight:700; letter-spacing:.2em; padding:1mm 2.6mm .8mm }
.card .url{ font-family:${T.fontDisp}; font-size:11pt; color:${T.brandDeep}; margin-top:2mm }
.card .dl{ font-size:7.5pt; color:${T.inkMuted}; margin-top:.8mm }
</style></head><body>
<div class="page">${card.repeat(10)}</div></body></html>`;
}

// ──────────────────────────────────────────── FC大阪社内向け説明資料（A4・1枚）
function shanaiHtml() {
  const f = C.FACTS.find(x => x.fromConfig === 'deadline');
  // 管理ページはPhase 2。実体ができるまで、その節は出さない。
  // 「準備中」と書いた節を配ると、資料そのものが作りかけに見えるため。
  const kanri = fs.existsSync(path.join(ROOT, 'assets', 'kit', '.kanri-ready'));
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<title>${esc(C.EVENT.name)} 社内向けご説明（FC大阪）</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;500;700;900&display=swap">
<style>${printCss()}
body{ font-size:8pt; line-height:1.5 }
.page{ padding:9mm 14mm; display:flex; flex-direction:column }
.hd{ display:flex; align-items:flex-end; justify-content:space-between;
  border-bottom:1.2pt solid ${T.ink}; padding-bottom:3mm }
.hd .logo img{ width:50mm; height:auto; display:block }
.hd .org{ font-size:8pt; font-weight:700; letter-spacing:.1em }
.hd .org{ display:flex; align-items:center; gap:2.5mm }
.hd .org span{ color:${T.inkMuted}; font-weight:400 }
.hd .org img{ height:4.4mm; width:auto; display:block }
.hd .org .sep{ color:${T.inkFaint} }
.eyebrow{ margin:3mm 0 1.6mm; display:inline-block; align-self:flex-start; background:${T.ink}; color:${T.brand};
  font-size:8pt; font-weight:700; letter-spacing:.24em; padding:1.4mm 3.6mm 1.2mm }
h1{ margin:0; font-size:13pt; font-weight:900; letter-spacing:.02em; line-height:1.32 }
.sub{ margin-top:1.2mm; font-size:8.8pt; color:${T.inkMuted} }
.facts{ margin-top:2.8mm; display:grid; grid-template-columns:repeat(3,1fr); background:${T.ink} }
.fact{ padding:1.3mm 2.6mm; border-left:.5pt solid rgba(255,255,255,.22) }
.fact:nth-child(3n+1){ border-left:0 }
.fact:nth-child(n+4){ border-top:.5pt solid rgba(255,255,255,.22) }
.fact .lab{ font-size:6pt; letter-spacing:.14em; color:${T.brand}; margin-bottom:.6mm }
.fact .big{ font-family:${T.fontDisp}; font-size:13pt; line-height:1; color:${T.brand} }
.fact .sml{ font-size:8pt; margin-left:1mm; color:${T.white} }
.fact .note{ font-size:6pt; color:rgba(255,255,255,.72); margin-top:.7mm; line-height:1.4 }
h2{ margin:2mm 0 1mm; font-size:10pt; font-weight:700; letter-spacing:.04em;
  border-bottom:.7pt solid ${T.border}; padding-bottom:1mm }
h2 .n{ font-family:${T.fontDisp}; font-size:14pt; color:${T.brandDeep}; margin-right:2.5mm }
p{ margin:1.2mm 0 }
.ask{ display:grid; grid-template-columns:repeat(3,1fr); gap:3.4mm; margin-top:2mm }
.ask .c{ border:.7pt solid ${T.border}; border-top:2pt solid ${T.brand}; padding:1.7mm 2.2mm }
.ask .c .k{ font-family:${T.fontDisp}; font-size:13pt; color:${T.brandDeep}; line-height:1 }
.ask .c .t{ font-size:8.8pt; font-weight:700; margin:1.2mm 0 .8mm }
.ask .c .d{ font-size:7.1pt; color:${T.inkMuted}; line-height:1.44 }
.flow{ display:flex; gap:3mm; margin-top:2.4mm; align-items:stretch }
.flow .s{ flex:1; background:${T.bgSubtle}; border-left:2pt solid ${T.brandDeep}; padding:1.4mm 2.2mm }
.flow .s .k{ font-size:6.6pt; letter-spacing:.16em; color:${T.inkFaint} }
.flow .s .t{ font-size:8.4pt; font-weight:700; margin-top:.8mm }
.flow .s .d{ font-size:7.1pt; color:${T.inkMuted}; margin-top:.6mm; line-height:1.44 }
.kit{ margin-top:2.4mm; width:100%; border-collapse:collapse; font-size:8.1pt }
.kit th{ background:${T.brandPale}; text-align:left; font-size:7.2pt; letter-spacing:.08em;
  padding:1.1mm 3mm; border-bottom:.7pt solid ${T.brandDeep} }
.kit td{ padding:.6mm 3mm; line-height:1.24; border-bottom:.5pt solid ${T.border} }
.kit td:first-child{ font-weight:700; width:52mm }
.qrline{ margin-top:2.6mm; display:flex; align-items:center; gap:4mm;
  background:${T.ink}; color:${T.white}; padding:2.2mm 4mm }
.qrline .q{ background:${T.white}; padding:2mm; flex:none }
.qrline .q svg{ width:20mm; height:20mm; display:block }
.qrline .t{ font-size:10.5pt; font-weight:700; color:${T.brand} }
.qrline .u{ font-family:${T.fontDisp}; font-size:14pt; color:${T.brand}; margin-top:1.5mm }
.qrline .d{ font-size:8.4pt; margin-top:1.5mm; color:rgba(255,255,255,.86) }
.foot{ margin-top:auto; padding-top:1.6mm; display:flex; justify-content:space-between;
  font-size:7pt; color:${T.inkFaint}; border-top:.5pt solid ${T.border} }
.foot b{ color:${T.ink} }
</style></head><body>
<div class="page">
  <div class="hd">
    <div class="logo">${logoImg()}</div>
    <div class="org"><span>${esc(C.BRAND.orgLabel)}</span>${C.BRAND.sponsors.map((sp, i) =>
      (i ? '<span class="sep">／</span>' : '')
      + esc(sp.name)).join('')}</div>
  </div>
  <span class="eyebrow">社内向けご説明</span>
  <h1>場外エリアの出店者募集にあたり、<br>取引先へのご案内をお願いします。</h1>
  <div class="sub">${esc(C.EVENT.date)}　${esc(C.EVENT.venue)}　／　${esc(C.EVENT.organizer)}</div>

  <div class="facts">
    ${C.FACTS.map(x => `<div class="fact">
      <div class="lab">${esc(x.label)}</div>
      <div><span class="big">${esc(x.big)}</span>${x.small ? `<span class="sml">${esc(x.small)}</span>` : ''}</div>
      <div class="note">${x.note ? esc(x.note) : '&nbsp;'}</div></div>`).join('')}
  </div>

  <h2><span class="n">01</span>どんなイベントか</h2>
  <p>${esc(C.PDF.lead)}<br>
  不特定多数への公募ではなく、<b>FC大阪およびUPDATERからご案内を差し上げた企業さま向けの募集</b>です。
  そのため、皆さまからのご案内が、そのまま応募数になります。</p>

  <h2><span class="n">02</span>お願いしたいこと</h2>
  <div class="ask">
    <div class="c"><div class="k">01</div><div class="t">案内メールを送る</div>
      <div class="d">配布キットに文例があります。会社名・お名前・担当者名を入れ、募集要項PDFを添付して送るだけです。</div></div>
    <div class="c"><div class="k">02</div><div class="t">対面のときはQRを見せる</div>
      <div class="d">名刺サイズのQRカードと、A4の掲示用をご用意しています。その場で読み取っていただけます。</div></div>
    <div class="c"><div class="k">03</div><div class="t">締切前にひと声かける</div>
      <div class="d">リマインドの短文も用意しています。9月23日ごろの送付を想定しています。</div></div>
  </div>

  <h2><span class="n">03</span>応募があったあとの流れ</h2>
  <div class="flow">
    <div class="s"><div class="k">STEP 1</div><div class="t">応募</div>
      <div class="d">事業者がフォームに入力。応募時に「ご紹介いただいた社員」を選ぶ欄があります。</div></div>
    <div class="s"><div class="k">STEP 2</div><div class="t">受付</div>
      <div class="d">事業者に受付確認メールが自動で届き、実行委員会にも通知が入ります。</div></div>
    <div class="s"><div class="k">STEP 3</div><div class="t">選考・ご連絡</div>
      <div class="d">応募多数の場合は選考のうえ、締切後3営業日以内にメールでご回答します。</div></div>
  </div>
  <p>皆さまにお手数をおかけするのは <b>02 のご案内まで</b>です。
  受付と確認メールの送信、応募一覧への記録は自動で行われます。</p>

  <h2><span class="n">04</span>配布キットの中身</h2>
  <table class="kit">
    <thead><tr><th>ファイル</th><th>使う場面</th></tr></thead>
    <tbody>
      <tr><td>案内メール文例（3種）</td><td>初回のご案内／締切前のリマインド／訪問・電話の直後</td></tr>
      <tr><td>募集要項（A4・2枚のPDF）</td><td>メールに添付する。単独でも読めます</td></tr>
      <tr><td>QRカード（名刺サイズ・A4に10枚）</td><td>切り取って名刺と一緒に。対面での紹介に</td></tr>
      <tr><td>QR掲示用（A4）</td><td>事務所・会場・受付に貼る</td></tr>
      <tr><td>QR画像（PNG・SVG）</td><td>画面共有、社内資料やスライドへの貼り込み</td></tr>
      ${kanri ? '<tr><td>管理ページ</td><td>ご自身がご紹介した企業の状況を確認できます</td></tr>' : ''}
    </tbody>
  </table>

  <div class="qrline">
    <div class="q">__QR__</div>
    <div>
      <div class="t">応募フォーム（この場でご確認いただけます）</div>
      <div class="u">${esc(C.SITE.urlShown)}</div>
      <div class="d">応募締切 ${esc(f.big)} ${esc(f.small)}　／　ご不明な点は ${esc(C.CONTACT.email)} まで</div>
    </div>
  </div>

  <div class="foot">
    <span>${esc(C.EVENT.name)}　社内向けご説明</span>
    <span><b>${esc(C.EVENT.organizer)}</b>　${esc(C.CONTACT.email)}</span>
  </div>
</div></body></html>`;
}

// ──────────────────────────────────────────── 営業が開く配布キット本体
function kitHtml() {
  const mails = [
    ['① 初回のご案内', C.KIT.intro, 'intro'],
    ['② 締切前のリマインド', C.KIT.remind, 'remind'],
    ['③ 訪問・電話の直後に', C.KIT.followup, 'followup'],
  ];
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(C.EVENT.name)} 配布キット（営業ご担当者さま用）</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;500;700;900&display=swap">
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:${T.bgSubtle};color:${T.ink};
  font-family:${T.fontJa};font-size:15px;line-height:1.8;font-feature-settings:"palt" 1}
.wrap{max-width:840px;margin:0 auto;padding-left:20px;padding-right:20px}
.top{background:${T.ink};color:#fff}
.top .wrap{padding-top:26px;padding-bottom:26px}
.top .k{font-size:11px;letter-spacing:.24em;color:${T.brand};margin-bottom:8px}
.top h1{margin:0;font-size:23px;font-weight:900;line-height:1.35}
.top .m{margin-top:10px;font-size:13px;color:rgba(255,255,255,.72)}
section{padding-top:32px}
h2{font-size:17px;margin:0 0 10px;border-bottom:2px solid ${T.ink};padding-bottom:8px}
h2 .n{font-family:${T.fontDisp};font-size:21px;color:${T.brandDeep};margin-right:8px}
.card{background:#fff;border:1px solid ${T.border};margin:14px 0}
.card .h{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 16px;border-bottom:1px solid ${T.border};flex-wrap:wrap}
.card .h .t{font-weight:700;font-size:15px}
.card .subj{padding:10px 16px;background:${T.brandPale};font-size:13.5px;
  border-bottom:1px solid ${T.border}}
.card .subj b{font-size:11px;letter-spacing:.14em;color:${T.inkMuted};margin-right:10px}
.card pre{margin:0;padding:16px;font-family:${T.fontJa};font-size:13.5px;line-height:1.85;
  white-space:pre-wrap;word-break:break-word}
.card .note{padding:10px 16px;border-top:1px solid ${T.border};
  font-size:12.5px;color:${T.inkMuted};background:${T.bgSubtle}}
mark{background:${T.accentPale};color:${T.accent};font-weight:700;padding:0 2px}
button{font-family:${T.fontJa};font-size:13px;font-weight:700;cursor:pointer;
  background:${T.ink};color:#fff;border:0;padding:8px 16px;letter-spacing:.06em}
button:hover{background:${T.brandDeep}}
button.done{background:${T.brandDeep}}
.files{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin-top:14px}
.files a{display:block;background:#fff;border:1px solid ${T.border};
  border-top:3px solid ${T.brand};padding:14px 16px;text-decoration:none;color:${T.ink}}
.files a:hover{border-color:${T.brandDeep}}
.files .t{font-weight:700;font-size:14.5px}
.files .d{font-size:12.5px;color:${T.inkMuted};margin-top:4px;line-height:1.6}
.files .x{font-family:${T.fontDisp};font-size:12px;color:${T.brandDeep};letter-spacing:.08em;margin-top:6px}
.hint{background:#fff;border:1px solid ${T.border};border-left:4px solid ${T.accent};
  padding:14px 16px;margin-top:16px;font-size:13.5px}
.hint b{color:${T.accent}}
footer{margin-top:44px;background:${T.ink};color:rgba(255,255,255,.7);font-size:12.5px}
footer .wrap{padding-top:20px;padding-bottom:24px}
footer b{color:${T.brand}}
</style></head><body>
<div class="top"><div class="wrap">
  <div class="k">配布キット ／ FC大阪 営業ご担当者さま用</div>
  <h1>${esc(C.EVENT.titleSub)}<br>出店者募集のご案内にお使いください</h1>
  <div class="m">${esc(C.EVENT.date)}　${esc(C.EVENT.venueShort)}　／　応募締切 ${esc(deadline())}</div>
</div></div>
<div class="wrap">

<section>
  <h2><span class="n">01</span>案内メールの文例</h2>
  <p style="margin:0;font-size:14px;color:${T.inkMuted}">
  「コピー」を押すとメール本文がそのままコピーされます。
  <mark>この色の箇所</mark>だけ、ご自身で書き換えてください。
  日付・URL・問い合わせ先はすでに入っています。</p>
  ${mails.map(([label, m, id]) => `
  <div class="card">
    <div class="h"><span class="t">${esc(label)}</span>
      <button data-copy="${id}">本文をコピー</button></div>
    <div class="subj"><b>件名</b>${esc(mailSubject(m))}
      <button style="margin-left:10px;padding:4px 10px;font-size:11px" data-copy="${id}-subj">件名をコピー</button></div>
    <pre id="${id}">${mailHtml(m)}</pre>
    <textarea id="${id}-subj" style="display:none">${esc(mailSubject(m))}</textarea>
    <div class="note">${esc(m.note)}</div>
  </div>`).join('')}
</section>

<section>
  <h2><span class="n">02</span>いっしょにお使いいただくもの</h2>
  <div class="files">
    <a href="../boshu-yoko.pdf" download><div class="t">募集要項</div>
      <div class="d">A4・2枚。メールに添付してください</div><div class="x">PDF</div></a>
    <a href="qr-meishi.pdf" download><div class="t">QRカード（名刺サイズ）</div>
      <div class="d">A4に10枚。切り取って名刺と一緒にお渡しください</div><div class="x">PDF</div></a>
    <a href="qr-a4.pdf" download><div class="t">QR掲示用</div>
      <div class="d">A4・1枚。事務所や受付に貼ってお使いください</div><div class="x">PDF</div></a>
    <a href="fcosaka-shanai.pdf" download><div class="t">社内向けご説明</div>
      <div class="d">A4・1枚。社内で共有される際にお使いください</div><div class="x">PDF</div></a>
    <a href="qr-1024.png" download><div class="t">QR画像</div>
      <div class="d">スライドや社内資料への貼り込み用</div><div class="x">PNG 1024px</div></a>
    <a href="qr.svg" download><div class="t">QR画像（ベクター）</div>
      <div class="d">どれだけ拡大しても粗くなりません</div><div class="x">SVG</div></a>
  </div>
  <div class="hint">
    <b>QRコードの読み取りについて</b><br>
    誤り訂正レベルを高く設定してあるため、多少の汚れや折れがあっても読み取れます。
    ただし、<b>幅20mm（名刺のQRの大きさ）より小さくしないでください。</b>
    縮小すると読み取れなくなります。
  </div>
</section>

<section>
  <h2><span class="n">03</span>お問い合わせ</h2>
  <p>ご案内の内容についてご不明な点、また取引先さまからのご質問で答えにくいものがありましたら、
  実行委員会までお知らせください。<br>
  <b style="font-size:17px">${esc(C.CONTACT.email)}</b></p>
</section>

</div>
<footer><div class="wrap">
  <b>${esc(C.EVENT.name)}</b>　${esc(C.EVENT.organizer)}<br>
  応募フォーム ${esc(C.SITE.url)}
</div></footer>
<script>
document.querySelectorAll('button[data-copy]').forEach(function (b) {
  b.addEventListener('click', function () {
    var el = document.getElementById(b.getAttribute('data-copy'));
    var text = el.tagName === 'TEXTAREA' ? el.value : el.innerText;
    navigator.clipboard.writeText(text).then(function () {
      var was = b.textContent;
      b.textContent = 'コピーしました';
      b.classList.add('done');
      setTimeout(function () { b.textContent = was; b.classList.remove('done'); }, 1800);
    });
  });
});
</script>
</body></html>`;
}

// ──────────────────────────────────────────── 出力
/**
 * 本ロゴ（ラスター）。配布キットは assets/kit/ に置かれるので、2つ上へ戻る。
 * 暫定ロゴはSVGの文字組みで、<img> だと外部フォントが効かないためインラインにしていた。
 * 本ロゴは図案なので、その制約はもう無い。
 */
function logoImg() {
  return `<img src="../../${C.BRAND.logoWide}" alt="${esc(C.EVENT.name)}">`;
}

function findChrome() {
  const c = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
  if (!c) throw new Error('Chrome／Edgeが見つかりません');
  return c;
}

function toPdf(chrome, htmlPath, pdfPath) {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + path.join(ROOT, 'build', '.chrome-profile'),
    '--virtual-time-budget=15000', '--no-pdf-header-footer', '--print-to-pdf-no-header',
    '--print-to-pdf=' + pdfPath,
    'file:///' + htmlPath.replace(/\\/g, '/'),
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
}

function shot(chrome, htmlPath, pngPath, w, h) {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--user-data-dir=' + path.join(ROOT, 'build', '.chrome-profile'),
    '--hide-scrollbars', '--force-device-scale-factor=2', '--virtual-time-budget=15000',
    '--window-size=' + w + ',' + h, '--screenshot=' + pngPath,
    'file:///' + htmlPath.replace(/\\/g, '/'),
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
}

/** 生成したPDFが想定どおりのページ数・用紙かを確かめる */
async function check(pdfPath, pages) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(pdfPath));
  const n = doc.getPageCount();
  const { width, height } = doc.getPage(0).getSize();
  const mm = v => Math.round(v / 72 * 25.4);
  if (n !== pages) {
    throw new Error(path.basename(pdfPath) + ' が ' + n + 'ページです（想定 ' + pages + '）。'
      + ' 内容があふれています。build/kit/ のHTMLを開いて確認してください。');
  }
  if (mm(width) !== 210 || mm(height) !== 297) {
    throw new Error(path.basename(pdfPath) + ' がA4ではありません');
  }
  return mm(width) + '×' + mm(height) + 'mm';
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(BUILD, { recursive: true });
  const chrome = findChrome();

  // QR（画像そのもの）
  const svg = await qrSvg(C.SITE.url);
  fs.writeFileSync(path.join(OUT, 'qr.svg'),
    svg.replace('<svg ', '<svg width="1024" height="1024" '), 'utf8');
  fs.writeFileSync(path.join(OUT, 'qr-1024.png'), await qrPng(C.SITE.url, 1024));
  console.log('  QR       : assets/kit/qr.svg, qr-1024.png');

  // 印刷物
  const jobs = [
    ['qr-a4', await posterHtml(), 1],
    ['qr-meishi', await meishiHtml(), 1],
    ['fcosaka-shanai', shanaiHtml().replace('__QR__', await qrSvg(C.SITE.url)), 1],
  ];
  for (const [name, html, pages] of jobs) {
    const h = path.join(BUILD, name + '.html');
    const p = path.join(OUT, name + '.pdf');
    fs.writeFileSync(h, html, 'utf8');
    // 画像を先に撮る。検査で落ちたときに「何があふれたのか」を見られるように
    shot(chrome, h, path.join(BUILD, name + '.png'), 794, 1123);
    toPdf(chrome, h, p + '.tmp');
    const size = await check(p + '.tmp', pages);
    fs.renameSync(p + '.tmp', p);
    console.log('  印刷物   : assets/kit/' + name + '.pdf (' + pages + 'ページ / ' + size + ')');
  }

  // 営業が開く1枚
  fs.writeFileSync(path.join(OUT, 'haifu-kit.html'), kitHtml(), 'utf8');
  console.log('  配布キット: assets/kit/haifu-kit.html');
}

if (require.main === module) {
  main().catch(e => { console.error('\n  ✗ ' + e.message + '\n'); process.exit(1); });
}
module.exports = { mailText, mailSubject, kitHtml, FILL, MANUAL, LITERAL, deadline };
