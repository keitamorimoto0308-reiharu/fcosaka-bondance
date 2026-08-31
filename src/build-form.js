/**
 * 応募フォームのHTMLを生成する。
 *
 *   src/schema.js  … 入力項目の定義（応募段階のみを描画する）
 *   src/content.js … イベント概要の文言
 *   src/theme.js   … デザイントークンとアイコン
 *        └──▶ index.html（単一ファイル・依存ライブラリなし）
 *
 * 条件表示と必須判定のロジックは schema.js の関数をそのまま埋め込む。
 * ブラウザとGASが同じコードで判定するため、「画面では通ったのにサーバーで弾かれる」が起きない。
 *
 * ■ 構成（ui-ux-pro-max の「Event/Conference Landing × Hero-Centric」に
 *   FC大阪のブランド制約を上書きしたもの）
 *     1. ヒーロー     … 水色の面＋和文様のキービジュアル。イベント名と日付
 *     2. ファクト帯   … 数字を大きく4つだけ。濃色の面に水色の数字
 *     3. 募集要項     … カードのアコーディオン。見出しだけ見え、押すと全文が開く
 *     4. 応募フォーム … セクション分割
 *     5. 追従CTA      … ヒーローを過ぎたら出て、フォームに入ると消える
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const S = require('./schema.js');
const C = require('./content.js');
const { TOKENS: T, icon } = require('./theme.js');

// 応募フォームに出す項目（採択後に聞く confirm 段階は除く）
const APPLY_FIELDS = S.applyFields();

const endpointPath = path.join(ROOT, 'src', 'endpoint.json');
const ENDPOINT = fs.existsSync(endpointPath)
  ? JSON.parse(fs.readFileSync(endpointPath, 'utf8'))
  : { gasUrl: '' };

// 募集要項PDFは実体があるときだけリンクを出す。押しても何も出ないボタンは
// 「壊れている」と受け取られて離脱に直結する。
const PDF_FILE = 'boshu-yoko.pdf';
const PDF_EXISTS = fs.existsSync(path.join(ROOT, 'assets', PDF_FILE));

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 麻の葉文様。ヒーローの地紋に使う（白の細線）
const ASANOHA = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='70' viewBox='0 0 40 70'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='1.1'%3E%3Cpath d='M20 0v70M0 17.5l20 11.7 20-11.7M0 52.5l20-11.7 20 11.7M0 0l20 17.5M40 0L20 17.5M0 70l20-17.5M40 70L20 52.5'/%3E%3C/g%3E%3C/svg%3E\")";

// ─────────────────────────────────────────── CSS
function css() {
  return `
:root{
  --brand:${T.brand}; --brand-deep:${T.brandDeep}; --brand-pale:${T.brandPale};
  --ink:${T.ink}; --ink-muted:${T.inkMuted}; --ink-faint:${T.inkFaint}; --white:${T.white};
  --accent:${T.accent}; --accent-pale:${T.accentPale};
  --bg:${T.bg}; --bg-subtle:${T.bgSubtle}; --border:${T.border}; --error:${T.error};
  --s1:${T.s1}; --s2:${T.s2}; --s3:${T.s3}; --s4:${T.s4}; --s5:${T.s5};
  --s6:${T.s6}; --s7:${T.s7}; --s8:${T.s8}; --s9:${T.s9};
  --r:${T.radius}; --r-lg:${T.radiusLg};
  --asanoha:${ASANOHA};
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:${T.fontJa};font-size:16px;line-height:1.8;overflow-wrap:anywhere}
img,svg{max-width:100%;display:block}
.wrap{max-width:760px;margin:0 auto;padding:0 var(--s4)}
.ic{flex:none;stroke:currentColor}

/* ── ヘッダー（薄く。主役はヒーロー） */
.site-header{background:var(--white);border-bottom:1px solid var(--border)}
.site-header .wrap{display:flex;align-items:center;justify-content:space-between;gap:var(--s4);
  padding-top:var(--s3);padding-bottom:var(--s3);flex-wrap:wrap}
.logo-main-img{height:40px;width:auto}
.supported{display:flex;align-items:center;gap:var(--s3)}
.supported .label{font-size:10px;letter-spacing:.14em;color:var(--ink-faint);white-space:nowrap}
.supported img{height:22px;width:auto}
.supported .textlogo{height:15px}
.supported .updater{font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--ink)}

/* ── 1. ヒーロー：水色の面。ブランドカラーを最大面積で使う場所 */
.hero{position:relative;background:var(--brand);overflow:hidden;isolation:isolate}
/* 写真。ブランド水色の膜をかぶせるので、下地として質感だけが残る */
.hero-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}
/* 水色の膜。上を薄く（スタジアムの空が見える）、下を濃く（文字が乗る）。
   濃い側で #7FCAF1 相当まで寄せるので、濃色文字のコントラストは 9.58:1 を保てる */
.hero::before{content:'';position:absolute;inset:0;z-index:-1;
  background:linear-gradient(180deg,
    rgba(127,202,241,.34) 0%, rgba(127,202,241,.72) 46%,
    rgba(127,202,241,.92) 78%, rgba(127,202,241,.97) 100%)}
/* 和文様。写真を潰さないよう、ごく薄く重ねるだけ */
.hero::after{content:'';position:absolute;inset:0;z-index:-1;opacity:.10;
  background-image:var(--asanoha);background-size:40px 70px}
.hero-inner{position:relative;z-index:1;padding:var(--s7) 0 var(--s6)}
.hero .eyebrow{display:inline-block;font-size:11px;letter-spacing:.18em;font-weight:700;
  background:var(--ink);color:var(--white);padding:6px 12px;border-radius:99px;margin:0 0 var(--s4)}
.hero h1{margin:0 0 var(--s3);font-size:30px;line-height:1.35;font-weight:700;letter-spacing:.01em}
.hero .en{font-family:${T.fontDisp};font-size:15px;letter-spacing:.34em;color:var(--ink);
  opacity:.62;margin:0 0 var(--s2)}
.hero .place{margin:0;font-size:15px;font-weight:700}
.hero .match{margin:var(--s1) 0 0;font-size:13px;color:#1A4A63}
.hero-cta{display:flex;gap:var(--s3);flex-wrap:wrap;margin-top:var(--s5)}

/* ── 2. ファクト帯：数字が主役。濃色の面に水色の数字（コントラスト 8:1） */
.facts{background:var(--ink);color:var(--white)}
.facts-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:rgba(255,255,255,.14)}
.fact{background:var(--ink);padding:var(--s5) var(--s3);text-align:center}
.fact .lb{font-size:11px;letter-spacing:.12em;color:#B9B3B0;margin:0 0 var(--s2)}
.fact .bg{font-family:${T.fontDisp};font-size:38px;line-height:1;color:var(--brand);
  letter-spacing:.02em;font-variant-numeric:tabular-nums}
.fact .sm{font-family:${T.fontDisp};font-size:16px;color:var(--brand);opacity:.85;margin-left:2px}
.fact .nt{font-size:11px;color:#B9B3B0;margin:var(--s2) 0 0;line-height:1.6}

/* ── 3. 募集要項：アコーディオン */
.section{padding:var(--s8) 0}
.sec-head{display:flex;align-items:baseline;gap:var(--s3);margin:0 0 var(--s5)}
.sec-head h2{margin:0;font-size:22px;font-weight:700;letter-spacing:.02em}
.sec-head .en{font-family:${T.fontDisp};font-size:13px;letter-spacing:.2em;color:var(--ink-faint)}
.notice-closed{margin:0 0 var(--s5);font-size:12.5px;line-height:1.8;color:var(--ink-muted);
  border-left:3px solid var(--brand);padding-left:var(--s3)}

.acc{border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin:0 0 var(--s3);
  background:var(--white)}
.acc-btn{width:100%;display:flex;align-items:center;gap:var(--s3);text-align:left;cursor:pointer;
  background:var(--white);border:0;padding:var(--s4);font-family:inherit;color:var(--ink);
  min-height:56px;transition:background .18s ease}
.acc-btn:hover{background:var(--brand-pale)}
.acc-btn:focus-visible{outline:3px solid var(--brand-deep);outline-offset:-3px}
.acc-mark{width:36px;height:36px;border-radius:10px;background:var(--brand-pale);color:var(--brand-deep);
  display:grid;place-items:center;flex:none}
.acc-txt{flex:1;min-width:0}
.acc-txt .t{display:block;font-size:16px;font-weight:700;line-height:1.5}
.acc-txt .l{display:block;font-size:12.5px;color:var(--ink-muted);line-height:1.7;margin-top:2px}
.acc-chev{flex:none;color:var(--ink-faint);transition:transform .22s ease}
.acc.open .acc-chev{transform:rotate(180deg)}
.acc-body{border-top:1px solid var(--border);padding:var(--s4);background:var(--bg-subtle);display:none}
.acc.open .acc-body{display:block}
.kv{margin:0}
.kv>div{display:grid;grid-template-columns:104px 1fr;gap:2px var(--s4);padding:var(--s3) 0;
  border-top:1px solid var(--border)}
.kv>div:first-child{border-top:0;padding-top:0}
.kv dt{margin:0;font-size:12.5px;color:var(--ink-muted);font-weight:700}
.kv dd{margin:0;font-size:14.5px;line-height:1.85}
.kv dd.em{font-weight:700}
.pending{font-size:12px;color:var(--accent);margin:var(--s2) 0 0}

/* ── ボタン */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--s2);
  min-height:52px;padding:0 var(--s5);border-radius:var(--r);border:0;cursor:pointer;
  font-family:inherit;font-size:16px;font-weight:700;text-decoration:none;
  transition:transform .15s ease,box-shadow .15s ease,background .15s ease,filter .15s ease}
.btn:active{transform:scale(.985)}
.btn-primary{background:var(--ink);color:var(--white);box-shadow:0 2px 0 rgba(0,0,0,.25)}
.btn-primary:hover{background:#3A2B28}
.btn-ghost{background:rgba(255,255,255,.92);color:var(--ink);box-shadow:0 1px 0 rgba(0,0,0,.12)}
.btn-brand{background:var(--brand);color:var(--ink);box-shadow:0 2px 0 var(--brand-deep)}
.btn-brand:hover{filter:brightness(1.05)}
.btn:focus-visible{outline:3px solid var(--brand-deep);outline-offset:2px}
.btn:disabled{background:#D6D1CE;color:#8A8481;box-shadow:none;cursor:not-allowed}

/* ── 5. 追従CTA */
.sticky-cta{position:fixed;left:0;right:0;bottom:0;z-index:50;
  padding:var(--s3) var(--s4) calc(var(--s3) + env(safe-area-inset-bottom));
  background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-top:1px solid var(--border);
  transform:translateY(115%);transition:transform .26s cubic-bezier(.2,.7,.3,1);
  display:flex;justify-content:center}
.sticky-cta.show{transform:translateY(0)}
.sticky-cta .btn{width:100%;max-width:420px}
body.cta-on{padding-bottom:88px}

/* ── 4. フォーム */
.form-section{border:1px solid var(--border);border-radius:var(--r);padding:var(--s5);
  margin:0 0 var(--s4);background:var(--white)}
.form-section>h3{display:flex;align-items:center;gap:var(--s3);margin:0 0 var(--s4);
  font-size:17px;font-weight:700}
.form-section>h3::before{content:'';width:4px;height:20px;border-radius:2px;background:var(--brand)}
.form-section .sec-desc{font-size:13px;color:var(--ink-muted);margin:-8px 0 var(--s4)}
.field{margin:0 0 var(--s5)}
.field:last-child{margin-bottom:0}
label.q{display:block;font-weight:700;font-size:15px;margin:0 0 var(--s2);line-height:1.6}
.req,.opt{font-size:11px;padding:2px 7px;border-radius:4px;margin-left:6px;vertical-align:2px;
  font-weight:700;white-space:nowrap}
.req{background:var(--accent);color:var(--white)}
.opt{background:rgba(35,24,22,.08);color:var(--ink-muted)}
.help{font-size:13px;color:var(--ink-muted);margin:0 0 var(--s2);line-height:1.75}
input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],textarea,select{
  width:100%;min-height:52px;padding:14px;font-size:16px;font-family:inherit;line-height:1.6;
  border:1px solid #B9B3B0;border-radius:10px;background:var(--white);color:var(--ink)}
textarea{min-height:auto;resize:vertical}
input:focus,textarea:focus,select:focus{outline:3px solid var(--brand);outline-offset:1px;
  border-color:var(--brand-deep)}
.choices{display:flex;flex-direction:column;gap:var(--s2)}
.choice{display:flex;gap:var(--s3);align-items:flex-start;padding:14px;min-height:52px;
  border:1px solid #D6D1CE;border-radius:10px;cursor:pointer;background:var(--white);
  transition:border-color .15s ease,background .15s ease}
.choice:has(input:checked){border-color:var(--brand-deep);background:var(--brand-pale)}
.choice input{margin:3px 0 0;width:22px;height:22px;flex:none;accent-color:var(--brand-deep)}
.choice span{font-size:15px;line-height:1.6}
.choice .rental-price{margin-top:2px}
.inline-note{font-size:13px;color:var(--ink-muted);margin-top:var(--s2)}
.err{color:var(--error);font-size:13px;font-weight:700;margin-top:var(--s2);display:none}
.field.invalid .err{display:block}
.field.invalid input,.field.invalid textarea,.field.invalid select{border-color:var(--error);background:#FDF4F3}
.hidden{display:none !important}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}

/* ── 備品 */
.rental-row{display:grid;grid-template-columns:1fr 112px;gap:var(--s3);align-items:center;
  padding:var(--s3) 0;border-top:1px solid var(--border)}
.rental-row:first-of-type{border-top:0}
.rental-name{font-size:15px;font-weight:700}
.rental-price{font-size:12px;color:var(--ink-muted);font-weight:400;display:block;line-height:1.7}
.rental-total{display:flex;justify-content:space-between;align-items:baseline;margin-top:var(--s4);
  padding-top:var(--s4);border-top:2px solid var(--ink);font-weight:700}
.rental-total .amount{font-size:24px;font-family:${T.fontDisp}}

/* ── 送信 */
.submit-area{text-align:center;padding:var(--s2) 0 var(--s8)}
.submit-area .btn{width:100%;max-width:440px;min-height:58px;font-size:17px}
.submit-note{font-size:13px;color:var(--ink-muted);margin:var(--s3) 0 0}
.form-error{display:none;background:#FDF4F3;border:1px solid var(--error);color:var(--error);
  border-radius:10px;padding:var(--s4);margin:0 0 var(--s4);font-size:14px;font-weight:700}
.form-error.show{display:block}
#confirm-box{background:var(--brand-pale);border:1px solid var(--brand);border-radius:var(--r);
  padding:var(--s4);margin:0 0 var(--s3)}
#confirm-box h4{margin:0 0 var(--s3);font-size:14px}

/* ── 完了・受付終了 */
.notice-page{padding:var(--s8) 0;text-align:center}
.notice-page .mark{width:64px;height:64px;border-radius:50%;background:var(--brand);
  margin:0 auto var(--s4);display:grid;place-items:center;color:var(--ink)}
.notice-page h2{font-size:21px;margin:0 0 var(--s3)}
.receipt{display:inline-block;margin:var(--s4) 0;padding:var(--s4) var(--s6);background:var(--bg-subtle);
  border-radius:var(--r);border:2px solid var(--brand)}
.receipt .num{font-family:${T.fontDisp};font-size:36px;letter-spacing:.06em;display:block;line-height:1.1}
.receipt .cap{font-size:11px;color:var(--ink-muted);letter-spacing:.12em}

footer{background:var(--ink);color:#CFC9C6;padding:var(--s6) 0 var(--s7);font-size:13px}
footer a{color:var(--brand)}
footer .org{color:var(--white);font-weight:700;margin:0 0 var(--s2)}

@media (min-width:600px){
  .hero h1{font-size:38px}
  .hero-inner{padding:var(--s8) 0 var(--s7)}
  .facts-grid{grid-template-columns:repeat(4,1fr)}
  .fact .bg{font-size:44px}
}
@media (max-width:380px){
  .hero h1{font-size:25px}
  .fact .bg{font-size:32px}
  .kv>div{grid-template-columns:1fr;gap:0}
}
@media print{.form-section,.submit-area,.sticky-cta,.hero-cta{display:none}.acc-body{display:block!important}}`;
}

// ─────────────────────────────────────────── 各パート
function renderHero() {
  return `
  <section class="hero">
    <img class="hero-photo" src="assets/stadium.webp" alt="" width="1920" height="1005" fetchpriority="high">
    <div class="wrap hero-inner">
      <span class="eyebrow">出店者募集</span>
      <p class="en">${esc(C.EVENT.nameEn)}</p>
      <h1>${esc(C.EVENT.name)}</h1>
      <p class="place">${esc(C.EVENT.date)}／${esc(C.EVENT.venueShort)}</p>
      <p class="match">${esc(C.EVENT.match)}　KICK OFF 14:00</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#form-area" data-scroll>応募フォームへ</a>
        ${PDF_EXISTS ? `<a class="btn btn-ghost" href="assets/${PDF_FILE}" download>募集要項（PDF）</a>` : ''}
      </div>
    </div>
  </section>`;
}

function renderFacts() {
  const cells = C.FACTS.map(f => `
      <div class="fact">
        <p class="lb">${esc(f.label)}</p>
        <div><span class="bg"${f.fromConfig ? ` data-fact="${esc(f.fromConfig)}"` : ''}>${esc(f.big)}</span>${
          f.small ? `<span class="sm">${esc(f.small)}</span>` : ''}</div>
        ${f.note ? `<p class="nt">${esc(f.note)}</p>` : ''}
      </div>`).join('');
  return `
  <section class="facts">
    <div class="wrap"><div class="facts-grid">${cells}
    </div></div>
  </section>`;
}

function renderOutline() {
  const items = C.OUTLINE.map((g, i) => {
    const rows = g.body.map(row => {
      const [k, v, o] = row;
      const opt = o || {};
      return `
        <div>
          <dt>${esc(k)}</dt>
          <dd class="${opt.emphasis ? 'em' : ''}"${opt.fromConfig ? ` data-config="${esc(opt.fromConfig)}"` : ''}>${esc(v)}</dd>
        </div>`;
    }).join('');
    const price = g.body.some(b => b[2] && b[2].priceNote)
      ? `\n          <p class="pending" data-price-note>単価：調整中（確定しだいご案内します）</p>` : '';
    const pend = g.placeholder ? `\n          <p class="pending">※ 内容は確定しだい更新します</p>` : '';
    return `
      <div class="acc" data-acc>
        <button class="acc-btn" type="button" aria-expanded="false" aria-controls="acc-${i}">
          <span class="acc-mark">${icon(g.icon, 20)}</span>
          <span class="acc-txt">
            <span class="t">${esc(g.title)}</span>
            ${g.lead ? `<span class="l">${esc(g.lead)}</span>` : ''}
          </span>
          <svg class="acc-chev" width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="acc-body" id="acc-${i}">
          <dl class="kv">${rows}
          </dl>${price}${pend}
        </div>
      </div>`;
  }).join('');

  return `
  <section class="section" id="outline">
    <div class="wrap">
      <div class="sec-head"><h2>募集要項</h2><span class="en">GUIDELINES</span></div>
      <p class="notice-closed">${esc(C.NOTICE)}</p>
      ${items}
    </div>
  </section>`;
}

// ─────────────────────────────────────────── 入力欄
function fieldHtml(f) {
  if (f.type === 'honeypot') {
    return `<div class="hp"><label>${esc(f.label)}<input type="text" name="${f.key}" tabindex="-1" autocomplete="off" aria-hidden="true"></label></div>`;
  }
  const cond = !!f.required && typeof f.required === 'object';
  const badge = (f.required === true || cond) ? '<span class="req">必須</span>' : '<span class="opt">任意</span>';
  const help = f.help ? `<p class="help" id="${f.key}-help">${esc(f.help)}</p>` : '';
  const desc = f.help ? ` aria-describedby="${f.key}-help"` : '';
  let control = '';

  switch (f.type) {
    case 'textarea':
      control = `<textarea id="${f.key}" name="${f.key}" rows="${f.rows || 4}"${f.maxLength ? ` maxlength="${f.maxLength}"` : ''}${desc}></textarea>`;
      break;
    case 'number':
      control = `<input type="number" inputmode="numeric" id="${f.key}" name="${f.key}"`
        + `${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}`
        + `${f.default !== undefined ? ` value="${f.default}"` : ''}${desc}>`;
      if (f.unknownCheckbox) {
        control += `<label class="choice" style="margin-top:8px">`
          + `<input type="checkbox" id="${f.unknownCheckbox.key}" name="${f.unknownCheckbox.key}">`
          + `<span>${esc(f.unknownCheckbox.label)}</span></label>`;
      }
      break;
    case 'radio':
      control = `<div class="choices" role="radiogroup" aria-labelledby="${f.key}-label">`
        + (f.options || []).map(o => {
            const val = typeof o === 'object' ? o.value : o;
            const lab = typeof o === 'object' ? o.label : o;
            return `<label class="choice"><input type="radio" name="${f.key}" value="${esc(val)}"><span>${esc(lab)}</span></label>`;
          }).join('') + `</div>`;
      break;
    case 'checkboxes':
      control = `<div class="choices">`
        + (f.options || []).map(o =>
            `<label class="choice"><input type="checkbox" name="${f.key}" value="${esc(o)}"><span>${esc(o)}</span></label>`
          ).join('') + `</div>`;
      break;
    case 'select':
      control = `<input type="text" id="${f.key}-search" class="hidden" placeholder="お名前の一部で絞り込めます" autocomplete="off">`
        + `<select id="${f.key}" name="${f.key}"${desc}><option value="">選択してください</option></select>`;
      break;
    case 'consent':
      return `<div class="field" data-field="${f.key}">
        <label class="choice"><input type="checkbox" id="${f.key}" name="${f.key}"><span>${esc(f.label)}${f.required === true ? ' <span class="req">必須</span>' : ''}</span></label>
        ${f.help ? `<p class="help">${esc(f.help)}</p>` : ''}
        <p class="err" data-err="${f.key}"></p>
      </div>`;
    default:
      control = `<input type="${f.type}" id="${f.key}" name="${f.key}"`
        + `${f.maxLength ? ` maxlength="${f.maxLength}"` : ''}`
        + `${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ''}${desc}>`;
  }

  return `<div class="field" data-field="${f.key}">
        <label class="q" id="${f.key}-label" for="${f.key}">${esc(f.label)}${badge}</label>
        ${help}${control}
        <p class="err" data-err="${f.key}"></p>
      </div>`;
}

function renderRentalSection(sec) {
  const items = APPLY_FIELDS.filter(f => f.section === sec.id);
  const rows = items.map(f => {
    // テントのサイズは、選択肢ごとに単価を添えて出す
    if (f.key === 'tentSize') {
      const opts = f.options.map(o =>
        `<label class="choice"><input type="radio" name="${f.key}" value="${esc(o.value)}">`
        + `<span>${esc(o.label)}<span class="rental-price" data-price="${o.priceKey}">単価：調整中</span></span></label>`
      ).join('');
      return `<div class="field" data-field="${f.key}">
        <label class="q" id="${f.key}-label">${esc(f.label)}<span class="req">必須</span></label>
        <div class="choices" role="radiogroup" aria-labelledby="${f.key}-label">${opts}</div>
        <p class="err" data-err="${f.key}"></p>
      </div>`;
    }
    if (f.type === 'number' && f.priceKey) {
      return `<div class="rental-row">
          <div><span class="rental-name">${esc(f.label)}</span>
            <span class="rental-price" data-price="${f.priceKey}">単価：調整中</span></div>
          <input type="number" id="${f.key}" name="${f.key}" min="${f.min}" max="${f.max}" value="${f.default}" inputmode="numeric" aria-label="${esc(f.label)}の数量">
        </div>`;
    }
    return fieldHtml(f); // テントの重り（条件表示のラジオ）
  }).join('\n      ');

  return `<section class="form-section" data-section="${sec.id}">
      <h3>${esc(sec.title)}</h3>
      <p class="sec-desc">${esc(sec.desc)}</p>
      ${rows}
      <div class="rental-total"><span>お見積り合計</span><span class="amount" data-rental-total>—</span></div>
      <p class="inline-note" data-rental-note>単価が確定しだい、合計金額が表示されます。</p>
    </section>`;
}

function renderForm() {
  return S.SECTIONS.map(sec => {
    const fields = APPLY_FIELDS.filter(f => f.section === sec.id);
    if (!fields.length) return '';
    if (sec.id === 'rental') return renderRentalSection(sec);
    return `<section class="form-section" data-section="${sec.id}">
      <h3>${esc(sec.title)}</h3>
      ${sec.desc ? `<p class="sec-desc">${esc(sec.desc)}</p>` : ''}
      ${fields.map(fieldHtml).join('\n      ')}
    </section>`;
  }).filter(Boolean).join('\n    ');
}

// ─────────────────────────────────────────── クライアントJS
function clientJs() {
  return `
// 条件判定は schema.js の関数をそのまま使う（GAS側と同一のコード）
${S.testCondition.toString()}
${S.isVisible.toString()}
${S.isRequired.toString()}

var FIELDS = ${JSON.stringify(APPLY_FIELDS)};
var GAS_URL = ${JSON.stringify(ENDPOINT.gasUrl || '')};
var CFG = { prices:{}, closed:false, deadline:'', contact:'', staff:[] };
var submissionId = (function(){
  try { return crypto.randomUUID(); }
  catch(e){ return 'sid-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
})();

var $  = function(s,r){ return (r||document).querySelector(s); };
var $$ = function(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };

/* ── アコーディオン：タイトルだけ見せ、押すと全文を開く */
function wireAccordion(){
  $$('[data-acc]').forEach(function(acc){
    var btn = acc.querySelector('.acc-btn');
    btn.addEventListener('click', function(){
      var open = acc.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
}

/* ── 追従CTA：ヒーローを過ぎたら出し、フォームに入ったら消す
   スクロール量の計算ではなく IntersectionObserver で判定する。
   要素が見えているかをブラウザ自身に教えてもらう形なので、
   スクロール位置の取り違えが起きず、毎フレームの計算も要らない。 */
function wireStickyCta(){
  var cta = $('#sticky-cta'), hero = $('.hero'), form = $('#form-area');
  if (!cta || !hero || !form) return;

  var heroVisible = true, formVisible = false;

  function apply(){
    var show = !heroVisible && !formVisible && !CFG.closed;
    cta.classList.toggle('show', show);
    document.body.classList.toggle('cta-on', show);
  }

  if (!('IntersectionObserver' in window)){ return; } // 非対応環境では出さない

  new IntersectionObserver(function(es){
    heroVisible = es[0].isIntersecting; apply();
  }, { threshold: 0 }).observe(hero);

  // フォームが画面下から1/4ほど入ってきたら隠す（ボタンが2つ並ぶのを避ける）
  new IntersectionObserver(function(es){
    formVisible = es[0].isIntersecting; apply();
  }, { rootMargin: '0px 0px -25% 0px', threshold: 0 }).observe(form);

  apply();
}

function wireSmoothScroll(){
  $$('[data-scroll]').forEach(function(a){
    a.addEventListener('click', function(e){
      var target = $(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  });
}

/** 画面の入力値をスキーマのキーで集める */
function collect(){
  var v = {};
  FIELDS.forEach(function(f){
    if (f.type === 'checkboxes'){
      v[f.key] = $$('input[name="'+f.key+'"]:checked').map(function(el){ return el.value; });
    } else if (f.type === 'radio'){
      var r = $('input[name="'+f.key+'"]:checked');
      v[f.key] = r ? r.value : '';
    } else if (f.type === 'consent'){
      var c = document.getElementById(f.key);
      v[f.key] = !!(c && c.checked);
    } else {
      var el = document.getElementById(f.key) || $('[name="'+f.key+'"]');
      v[f.key] = el ? el.value : '';
    }
    if (f.unknownCheckbox){
      var u = document.getElementById(f.unknownCheckbox.key);
      v[f.unknownCheckbox.key] = !!(u && u.checked);
    }
  });
  return v;
}

/** 条件付き表示の反映。値が変わるたびに呼ぶ */
function applyVisibility(){
  var v = collect();
  FIELDS.forEach(function(f){
    var wrap = $('[data-field="'+f.key+'"]');
    if (!wrap || !f.showIf) return;
    var show = isVisible(f, v);
    wrap.classList.toggle('hidden', !show);
    if (!show) clearField(f);
  });
  updateRequiredBadges(v);
}

function clearField(f){
  if (f.type === 'radio' || f.type === 'checkboxes'){
    $$('input[name="'+f.key+'"]').forEach(function(el){ el.checked = false; });
  } else if (f.type === 'consent'){
    var c = document.getElementById(f.key); if (c) c.checked = false;
  } else {
    var el = document.getElementById(f.key); if (el) el.value = (f.default !== undefined ? f.default : '');
  }
  if (f.unknownCheckbox){
    var u = document.getElementById(f.unknownCheckbox.key); if (u) u.checked = false;
  }
  var w = $('[data-field="'+f.key+'"]'); if (w) w.classList.remove('invalid');
}

/** 条件付き必須は、条件を満たしたときだけ「必須」バッジを出す */
function updateRequiredBadges(v){
  FIELDS.forEach(function(f){
    if (f.required === true || !f.required) return;
    var wrap = $('[data-field="'+f.key+'"]'); if (!wrap) return;
    var badge = wrap.querySelector('.req, .opt'); if (!badge) return;
    var need = isRequired(f, v);
    badge.className = need ? 'req' : 'opt';
    badge.textContent = need ? '必須' : '任意';
  });
}

/** 画面側の検証。サーバー側と同じ規則。 */
function validate(v){
  var errs = [];
  FIELDS.forEach(function(f){
    if (f.type === 'honeypot') return;
    if (!isVisible(f, v)) return;
    var val = v[f.key];
    var empty = (val === undefined || val === null || val === '' ||
                 (Array.isArray(val) && !val.length) || val === false);
    if (f.unknownCheckbox && v[f.unknownCheckbox.key]) empty = false;

    if (isRequired(f, v) && empty){
      errs.push({ key:f.key, message: f.type === 'consent' ? 'チェックをお願いします。' : f.label + 'を入力してください。' });
      return;
    }
    if (empty) return;
    if (f.type === 'email' && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val))
      errs.push({ key:f.key, message:'メールアドレスの形式をご確認ください。' });
    if (f.type === 'tel' && !/^[0-9+\\-() 　]{8,20}$/.test(val))
      errs.push({ key:f.key, message:'電話番号の形式をご確認ください。' });
    if (f.type === 'number'){
      var n = Number(val);
      if (isNaN(n)) errs.push({ key:f.key, message: f.label+'は数字でご入力ください。' });
      else if (f.min !== undefined && n < f.min) errs.push({ key:f.key, message: f.label+'は'+f.min+'以上でご入力ください。' });
      else if (f.max !== undefined && n > f.max) errs.push({ key:f.key, message: f.label+'は'+f.max+'以下でご入力ください。' });
    }
  });
  return errs;
}

function showErrors(errs){
  $$('.field').forEach(function(el){ el.classList.remove('invalid'); });
  errs.forEach(function(e){
    var w = $('[data-field="'+e.key+'"]'); if (!w) return;
    w.classList.add('invalid');
    var p = w.querySelector('[data-err]'); if (p) p.textContent = e.message;
  });
  var box = $('.form-error');
  if (errs.length){
    box.textContent = '入力内容に' + errs.length + '件の不備があります。赤く表示された項目をご確認ください。';
    box.classList.add('show');
    var first = $('[data-field="'+errs[0].key+'"]');
    if (first){
      first.scrollIntoView({ behavior:'smooth', block:'center' });
      var input = first.querySelector('input,textarea,select');
      if (input) setTimeout(function(){ try{ input.focus({ preventScroll:true }); }catch(e){} }, 320);
    }
  } else {
    box.classList.remove('show');
  }
}

/** 備品の小計・合計。単価未設定なら「調整中」のままにする。 */
function updateRental(){
  var p = CFG.prices || {};
  var v = collect();
  var map = { tentT1: p.tentT1, tentT2: p.tentT2, table: p.table, chair: p.chair };

  $$('[data-price]').forEach(function(el){
    var unit = map[el.getAttribute('data-price')];
    el.textContent = (unit == null) ? '単価：調整中'
      : '単価：' + Number(unit).toLocaleString('ja-JP') + '円';
  });

  var known = true, total = 0, any = false;
  // テントはレンタルを選び、サイズを選んだときだけ金額に乗せる
  if (v.tentChoice === 'レンタルする' && v.tentSize){
    any = true;
    var tu = map[v.tentSize === 'T1' ? 'tentT1' : 'tentT2'];
    if (tu == null) known = false; else total += tu;
  }
  [['rentalTable','table'],['rentalChair','chair']].forEach(function(t){
    var qty = Number(v[t[0]] || 0);
    if (!qty) return;
    any = true;
    var unit = map[t[1]];
    if (unit == null){ known = false; return; }
    total += unit * qty;
  });

  var el = $('[data-rental-total]'), note = $('[data-rental-note]');
  if (!el) return;
  if (!any){ el.textContent = '—'; note.textContent = 'レンタルをご希望の備品を選択してください。'; }
  else if (!known){ el.textContent = '—'; note.textContent = '単価が確定しだい、合計金額が表示されます。'; }
  else { el.textContent = total.toLocaleString('ja-JP') + '円'; note.textContent = '概算です。確定金額は別途ご案内します。'; }
}

/** 担当社員プルダウン。取得に失敗してもフォームは止めない。 */
var STAFF_FALLBACK = 'わからない／FC大阪以外からの紹介';
var SEARCH_THRESHOLD = 12;

function setupStaff(list){
  var sel = document.getElementById('fcosakaStaff');
  var box = document.getElementById('fcosakaStaff-search');
  if (!sel) return;
  var opts = (list && list.length ? list.map(function(s){ return s.label; }) : []);
  if (box) box.classList.toggle('hidden', opts.length < SEARCH_THRESHOLD);

  function render(filter){
    var f = (filter || '').trim();
    var keep = sel.value;
    var hits = opts.filter(function(o){ return !f || o.indexOf(f) !== -1; });
    sel.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = (f && !hits.length) ? '該当する担当者が見つかりません' : '選択してください';
    sel.appendChild(first);
    hits.concat([STAFF_FALLBACK]).forEach(function(o){
      var op = document.createElement('option');
      op.value = o; op.textContent = o; sel.appendChild(op);
    });
    if (keep && Array.prototype.some.call(sel.options, function(o){ return o.value === keep; })) sel.value = keep;
  }
  render('');
  if (box) box.addEventListener('input', function(){ render(box.value); });

  try {
    var want = new URLSearchParams(location.search).get('staff');
    if (want){
      var hit = opts.filter(function(o){ return o === want || o.indexOf(want) === 0; })[0];
      if (hit) sel.value = hit;
    }
  } catch(e){}
}

/** 起動時に設定を取りに行く。失敗してもフォームは表示したまま進める。 */
function loadConfig(){
  if (!GAS_URL){ setupStaff([]); updateRental(); return; }
  fetch(GAS_URL + '?action=formConfig', { method:'GET' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || !d.ok) throw new Error('bad config');
      CFG = d;
      if (d.closed){ showClosed(); return; }
      if (d.deadline){
        var m = d.deadline.match(/(\\d+)年(\\d+)月(\\d+)日.*?(\\d+:\\d+)/);
        if (m){
          $$('[data-fact="deadline"]').forEach(function(el){
            el.textContent = Number(m[2]) + '.' + Number(m[3]);
            var sm = el.parentNode.querySelector('.sm');
            if (sm) sm.textContent = m[4];
          });
        }
      }
      $$('[data-config]').forEach(function(el){
        var k = el.getAttribute('data-config');
        if (d[k]) el.textContent = d[k];
      });
      if (d.contact) $$('[data-contact]').forEach(function(el){
        el.textContent = d.contact;
        if (el.tagName === 'A') el.href = 'mailto:' + d.contact;
      });
      setupStaff(d.staff);
      updateRental();
    })
    .catch(function(){ setupStaff([]); updateRental(); });
}

function showClosed(){
  $('#form-area').classList.add('hidden');
  $('#closed-area').classList.remove('hidden');
  var cta = $('#sticky-cta'); if (cta) cta.classList.remove('show');
  document.body.classList.remove('cta-on');
}

function showDone(receiptId, mailWarning){
  $('#form-area').classList.add('hidden');
  $('#intro-area').classList.add('hidden');
  var cta = $('#sticky-cta'); if (cta) cta.classList.remove('show');
  document.body.classList.remove('cta-on');
  $('#done-area').classList.remove('hidden');
  $('#receipt-number').textContent = receiptId;
  if (mailWarning) $('#mail-warning').classList.remove('hidden');
  window.scrollTo({ top:0, behavior:'smooth' });
}

/**
 * 入力内容の自動保存。
 * 店の営業中にスマホで少しずつ入力する方を想定している。
 * 途中で画面を閉じたら企業名から打ち直し、では二度目はやってもらえない。
 */
var DRAFT_KEY = 'bondance_draft_v2';

function saveDraft(){
  try {
    var v = collect();
    delete v.website2;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ t: Date.now(), v: v }));
  } catch(e){}
}

function restoreDraft(){
  var d;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch(e){ return; }
  if (!d || !d.v) return;
  if (Date.now() - (d.t || 0) > 1000*60*60*24*30){ clearDraft(); return; }
  FIELDS.forEach(function(f){
    var val = d.v[f.key];
    if (val === undefined) return;
    if (f.type === 'checkboxes' && Array.isArray(val)){
      $$('input[name="'+f.key+'"]').forEach(function(el){ el.checked = val.indexOf(el.value) !== -1; });
    } else if (f.type === 'radio'){
      $$('input[name="'+f.key+'"]').forEach(function(el){ el.checked = (el.value === val); });
    } else if (f.type === 'consent'){
      var c = document.getElementById(f.key); if (c) c.checked = !!val;
    } else if (f.type !== 'honeypot'){
      var el2 = document.getElementById(f.key); if (el2) el2.value = val;
    }
    if (f.unknownCheckbox && d.v[f.unknownCheckbox.key] !== undefined){
      var u = document.getElementById(f.unknownCheckbox.key);
      if (u) u.checked = !!d.v[f.unknownCheckbox.key];
    }
  });
  var note = $('#draft-note');
  if (note){ note.textContent = '前回の入力内容を復元しました'; note.classList.remove('hidden'); }
}

function clearDraft(){ try { localStorage.removeItem(DRAFT_KEY); } catch(e){} }

/** 送信直前の確認。スマホでは「上記の内容」が画面の外にあって見えない。 */
function renderConfirm(){
  var box = $('#confirm-box'); if (!box) return;
  var v = collect();
  var pick = ['companyName','boothName','contactName','contactEmail','contactPhone',
              'boothTypes','boothSize','power','tentChoice','tentSize','fcosakaStaff'];
  var rows = pick.map(function(k){
    var f = FIELDS.filter(function(x){ return x.key === k; })[0];
    if (!f || !isVisible(f, v)) return '';
    var val = v[k];
    if (Array.isArray(val)) val = val.join('、');
    if (f.options && f.options.length && typeof f.options[0] === 'object'){
      f.options.forEach(function(o){ if (o.value === val) val = o.label; });
    }
    if (!val) val = '（未入力）';
    return '<div><dt>' + f.label + '</dt><dd>' + String(val).replace(/[<>&]/g,'') + '</dd></div>';
  }).join('');
  box.innerHTML = '<h4>この内容で送信します</h4><dl class="kv">' + rows + '</dl>'
    + '<p class="inline-note">その他の項目も含めて送信されます。'
    + '送信後、ご記入のメールアドレスに全文の控えをお送りします。</p>';
}

/** 「使用しない」と他の選択肢が同時に選ばれた状態を作らせない */
function wireExclusive(){
  FIELDS.filter(function(f){ return f.exclusiveOption; }).forEach(function(f){
    $$('input[name="'+f.key+'"]').forEach(function(el){
      el.addEventListener('change', function(){
        if (!el.checked) return;
        $$('input[name="'+f.key+'"]').forEach(function(o){
          if (el.value === f.exclusiveOption ? o !== el : o.value === f.exclusiveOption) o.checked = false;
        });
      });
    });
  });
}

function submitForm(){
  var btn = $('#submit-btn');
  var v = collect();
  var errs = validate(v);
  showErrors(errs);
  if (errs.length) return;

  btn.disabled = true;
  btn.textContent = '送信しています…';

  if (!GAS_URL){
    btn.disabled = false; btn.textContent = 'この内容で応募する';
    $('.form-error').textContent = 'これは表示確認用のページです。送信は行われません。';
    $('.form-error').classList.add('show');
    return;
  }

  var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = setTimeout(function(){ if (ac) ac.abort(); }, 60000);

  fetch(GAS_URL, {
    method:'POST',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' }, // プリフライトを避ける
    body: JSON.stringify({ action:'submit', submissionId: submissionId, values: v }),
    signal: ac ? ac.signal : undefined
  })
  .then(function(r){ clearTimeout(timer); return r.json(); })
  .then(function(d){
    if (d && d.ok){ clearDraft(); showDone(d.receiptId, d.mailWarning); return; }
    if (d && d.error === 'validation'){ showErrors(d.fields || []); }
    else if (d && d.error === 'closed'){ showClosed(); return; }
    else {
      $('.form-error').textContent = (d && d.message) ||
        '送信できませんでした。お手数ですが、もう一度お試しください。';
      $('.form-error').classList.add('show');
    }
    btn.disabled = false; btn.textContent = 'この内容で応募する';
  })
  .catch(function(){
    clearTimeout(timer);
    $('.form-error').textContent =
      '通信に失敗しました。電波の良い場所で、もう一度お試しください。'
      + '繰り返し失敗する場合はお手数ですがメールでご連絡ください。';
    $('.form-error').classList.add('show');
    btn.disabled = false; btn.textContent = 'この内容で応募する';
  });
}

document.addEventListener('DOMContentLoaded', function(){
  wireAccordion();
  wireStickyCta();
  wireSmoothScroll();
  wireExclusive();
  restoreDraft();
  applyVisibility();
  updateRental();
  renderConfirm();
  loadConfig();

  document.addEventListener('change', function(){
    applyVisibility(); updateRental(); renderConfirm(); saveDraft();
  });
  var typeTimer = null;
  document.addEventListener('input', function(e){
    if (e.target && e.target.type === 'number') updateRental();
    clearTimeout(typeTimer);
    typeTimer = setTimeout(function(){ renderConfirm(); saveDraft(); }, 800);
  });
  $('#submit-btn').addEventListener('click', function(e){ e.preventDefault(); submitForm(); });
});
`;
}

// ─────────────────────────────────────────── ページ全体
function page() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="format-detection" content="telephone=no">
<title>出店者募集｜${esc(C.EVENT.name)}</title>
<meta name="description" content="${esc(C.EVENT.date)}、${esc(C.EVENT.venue)}で開催する${esc(C.EVENT.name)}の出店者募集ページです。出店料無料。">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(C.EVENT.name)}">
<meta property="og:title" content="${esc(C.EVENT.name)}｜出店者募集">
<meta property="og:description" content="${esc(C.EVENT.date)}／${esc(C.EVENT.venueShort)}。出店料無料。FC大阪のホームゲーム開催日にあわせた場外イベントです。">
<meta property="og:image" content="https://bondance.kreha-c.com/assets/ogp.png">
<meta property="og:url" content="https://bondance.kreha-c.com/">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>${css()}</style>
</head>
<body>

<header class="site-header">
  <div class="wrap">
    <!-- ロゴは assets/logo/ の SVG を差し替えるだけで入れ替わる -->
    <img class="logo-main-img" src="assets/logo/logo-main.svg" alt="${esc(C.EVENT.organizer)}" width="230" height="90">
    <div class="supported">
      <span class="label">主催</span>
      <img src="assets/fcosaka_emblem.png" alt="FC大阪" width="22" height="22">
      <img class="textlogo" src="assets/fcosaka_textlogo.png" alt="FC OSAKA" width="80" height="15">
      <span class="updater">UPDATER</span>
    </div>
  </div>
</header>

<main>
<div id="intro-area">
  ${renderHero()}
  ${renderFacts()}
  ${renderOutline()}
</div>

<div class="wrap section" id="form-area">
  <div class="sec-head"><h2>応募フォーム</h2><span class="en">ENTRY</span></div>
  <p class="help">所要時間の目安は5分です。
    入力内容はこの端末に自動保存されるので、途中で閉じても続きから入力できます。</p>
  <div class="form-error" role="alert"></div>
  <form id="entry" novalidate autocomplete="on">
    ${renderForm()}
    <div id="confirm-box"></div>
    <p class="inline-note hidden" id="draft-note"></p>
    <div class="submit-area">
      <button type="submit" class="btn btn-brand" id="submit-btn">この内容で応募する</button>
      <p class="submit-note">送信後、ご記入のメールアドレスに受付確認メールをお送りします。</p>
    </div>
  </form>
</div>

<div class="wrap notice-page hidden" id="done-area">
  <div class="mark">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
  </div>
  <h2>ご応募ありがとうございました</h2>
  <div class="receipt"><span class="cap">受付ID</span><span class="num" id="receipt-number">SB-0000</span></div>
  <p>ご記入いただいたメールアドレスに、受付確認メールをお送りしました。<br>
     内容の控えとしてご確認ください。</p>
  <p>出店の可否は、応募締切後3営業日以内にメールでご連絡いたします。</p>
  <p class="hidden" id="mail-warning" style="color:var(--error);font-weight:700">
     ※ 確認メールの送信に失敗しました。応募自体は受け付けております。
     お手数ですが <a data-contact href="#">お問い合わせ先</a> までご一報ください。</p>
  <p class="submit-note">メールが届かない場合は、迷惑メールフォルダをご確認のうえ、
     <a data-contact href="#">お問い合わせ先</a> までご連絡ください。</p>
</div>

<div class="wrap notice-page hidden" id="closed-area">
  <h2>応募の受付は終了しました</h2>
  <p>たくさんのご応募をありがとうございました。<br>
     お問い合わせは <a data-contact href="#">こちら</a> までお願いいたします。</p>
</div>
</main>

<footer>
  <div class="wrap">
    <p class="org">${esc(C.CONTACT.name)}</p>
    <p>主催：${esc(C.EVENT.organizerNote)}</p>
    <p>お問い合わせ：<a data-contact href="#">—</a></p>
  </div>
</footer>

<div class="sticky-cta" id="sticky-cta">
  <a class="btn btn-brand" href="#form-area" data-scroll>応募はこちら</a>
</div>

<script>${clientJs()}</script>
</body>
</html>
`;
}

function main() {
  const html = page();
  fs.writeFileSync(path.join(ROOT, 'index.html'), html, 'utf8');
  console.log('  書き出し : index.html (' + Math.round(html.length / 1024) + 'KB)');
}

if (require.main === module) main();
module.exports = { page };
