/**
 * 応募フォームのHTMLを生成する。
 *
 *   src/schema.js  … 入力項目の定義
 *   src/content.js … イベント概要の文言
 *   src/themes.js  … デザイン3方向
 *        └──▶ index.html（本番）／ design-a.html, design-b.html, design-c.html（CP2の比較用）
 *
 * 条件表示と必須判定のロジックは schema.js の関数をそのまま埋め込む。
 * ブラウザとGASが同じコードで判定するため、「画面では通ったのにサーバーで弾かれる」が起きない。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const S = require('./schema.js');
const C = require('./content.js');
const { THEMES } = require('./themes.js');

const endpointPath = path.join(ROOT, 'src', 'endpoint.json');
const ENDPOINT = fs.existsSync(endpointPath)
  ? JSON.parse(fs.readFileSync(endpointPath, 'utf8'))
  : { gasUrl: '' };

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ─────────────────────────────────────────── CSS
function css(v) {
  return `
:root{
  --brand:${v.brand}; --brand-deep:${v.brandDeep}; --ink:${v.ink}; --ink-muted:${v.inkMuted};
  --white:${v.white}; --accent:${v.accent}; --accent-pale:${v.accentPale};
  --bg:${v.bodyBg}; --bg-subtle:${v.bgSubtle}; --card-bg:${v.cardBg}; --header-bg:${v.headerBg};
  --error:${v.error}; --radius:${v.radius};
  --gap:${v.sectionGap}; --card-pad:${v.cardPad};
  --rule-w:${v.ruleWeight}; --rule-c:${v.ruleColor};
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:${v.fontBody}; font-size:16px; line-height:1.8;
  overflow-wrap:anywhere;
}
img{max-width:100%;height:auto;display:block}
.wrap{max-width:720px;margin:0 auto;padding:0 16px}

/* ── ヘッダー：サステナ盆踊りロゴを主、FC大阪／UPDATERを supported by で従える */
.site-header{background:var(--header-bg);border-bottom:var(--rule-w) solid var(--rule-c)}
.site-header .wrap{padding-top:18px;padding-bottom:18px}
.logo-main{
  display:inline-block;font-family:${v.fontDisp};font-weight:600;letter-spacing:.04em;
  font-size:20px;line-height:1.3;
  color:${v.headerBg === v.ink ? 'var(--white)' : 'var(--ink)'};
}
.logo-main small{display:block;font-size:11px;letter-spacing:.18em;color:var(--brand);font-weight:400}
.logo-placeholder{
  display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;
  border:1px dashed var(--brand);
}
.supported{display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap}
.supported .label{
  font-size:10px;letter-spacing:.12em;
  color:${v.headerBg === v.ink ? '#B9B3B0' : 'var(--ink-muted)'};
}
.supported img{height:26px;width:auto}
.supported .textlogo{height:20px;image-rendering:auto}
.supported .updater-tmp{
  font-size:11px;padding:3px 8px;border:1px dashed currentColor;border-radius:4px;
  color:${v.headerBg === v.ink ? '#B9B3B0' : 'var(--ink-muted)'};
}

/* ── ヒーロー */
.hero{position:relative;overflow:hidden}
.hero-inner{position:relative;z-index:1;padding:${v.heroStyle === 'hero' ? '34px 0 26px' : '24px 0 18px'}}
.hero h1{
  margin:0 0 6px;font-size:${v.heroStyle === 'hero' ? '26px' : '22px'};line-height:1.45;
  font-weight:700;letter-spacing:.01em;
}
.hero .lead{margin:0;color:var(--ink-muted);font-size:14px}
.hero--pattern::before,.hero--hero::before{
  content:'';position:absolute;inset:0;opacity:${v.patternAlpha};
  background-image:var(--asanoha);background-size:34px 60px;
}
.hero--hero{background:linear-gradient(135deg,var(--brand) 0%,#BFE4F7 55%,var(--accent-pale) 100%)}

/* ── 要約カード */
.summary{
  display:grid;grid-template-columns:repeat(${v.summaryCols},minmax(0,1fr));gap:1px;
  background:var(--brand);border-radius:var(--radius);overflow:hidden;margin:0 0 14px;
}
.summary div{background:var(--white);padding:12px 14px}
.summary dt{font-size:11px;color:var(--ink-muted);letter-spacing:.06em;margin:0 0 2px}
.summary dd{margin:0;font-weight:700;font-size:15px;line-height:1.5}
.cta-row{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 var(--gap)}
.btn-pdf{
  display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:var(--radius);
  background:var(--ink);color:var(--white);text-decoration:none;font-weight:700;font-size:14px;
}
.btn-pdf:hover{opacity:.88}

/* ── セクション */
section{margin:0 0 var(--gap)}
h2{
  font-size:18px;margin:0 0 12px;padding-left:12px;line-height:1.5;
  border-left:var(--rule-w) solid var(--rule-c);
}
.card{background:var(--card-bg);border-radius:var(--radius);padding:var(--card-pad);margin:0 0 12px}
.card h3{font-size:14px;margin:0 0 10px;color:var(--ink);letter-spacing:.04em}
.kv{margin:0}
.kv>div{display:grid;grid-template-columns:96px 1fr;gap:4px 12px;padding:7px 0;border-top:1px solid rgba(35,24,22,.09)}
.kv>div:first-child{border-top:0}
.kv dt{font-size:13px;color:var(--ink-muted);margin:0}
.kv dd{margin:0;font-size:14px}
.kv dd.em{font-weight:700}
.pending{font-size:12px;color:var(--accent);margin-top:6px}

/* ── フォーム */
.form-section{border:1px solid rgba(35,24,22,.14);border-radius:var(--radius);padding:var(--card-pad);margin:0 0 16px;background:var(--white)}
.form-section>h2{border-left-color:var(--brand);margin-bottom:4px}
.form-section .sec-desc{font-size:13px;color:var(--ink-muted);margin:0 0 14px}
.field{margin:0 0 18px}
.field:last-child{margin-bottom:0}
label.q{display:block;font-weight:700;font-size:15px;margin:0 0 6px;line-height:1.6}
.req,.opt{font-size:11px;padding:2px 6px;border-radius:4px;margin-left:6px;vertical-align:2px;font-weight:700;white-space:nowrap}
.req{background:var(--accent);color:var(--white)}
.opt{background:rgba(35,24,22,.08);color:var(--ink-muted)}
.help{font-size:13px;color:var(--ink-muted);margin:0 0 8px;line-height:1.7}
input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],textarea,select{
  width:100%;padding:12px;font-size:16px;font-family:inherit;line-height:1.6;
  border:1px solid #B9B3B0;border-radius:8px;background:var(--white);color:var(--ink);
}
input:focus,textarea:focus,select:focus{outline:3px solid var(--brand);outline-offset:1px;border-color:var(--brand-deep)}
textarea{resize:vertical}
.choices{display:flex;flex-direction:column;gap:8px}
.choice{
  display:flex;gap:10px;align-items:flex-start;padding:11px 12px;
  border:1px solid #D6D1CE;border-radius:8px;cursor:pointer;background:var(--white);
}
.choice:has(input:checked){border-color:var(--brand-deep);background:#F0F8FD}
.choice input{margin:4px 0 0;width:20px;height:20px;flex:none;accent-color:var(--brand-deep)}
.choice span{font-size:15px;line-height:1.6}
.inline-note{font-size:13px;color:var(--ink-muted);margin-top:6px}
.err{color:var(--error);font-size:13px;font-weight:700;margin-top:6px;display:none}
.field.invalid .err{display:block}
.field.invalid input,.field.invalid textarea,.field.invalid select{border-color:var(--error);background:#FDF4F3}
.hidden{display:none !important}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}

/* ── 備品 */
.rental-row{display:grid;grid-template-columns:1fr 108px;gap:10px;align-items:center;padding:10px 0;border-top:1px solid rgba(35,24,22,.09)}
.rental-row:first-of-type{border-top:0}
.rental-name{font-size:15px;font-weight:700}
.rental-price{font-size:12px;color:var(--ink-muted);font-weight:400;display:block}
.rental-total{
  display:flex;justify-content:space-between;align-items:baseline;margin-top:12px;padding-top:12px;
  border-top:2px solid var(--ink);font-weight:700;
}
.rental-total .amount{font-size:20px;font-family:${v.fontDisp}}

/* ── 送信 */
.submit-area{text-align:center;padding:4px 0 40px}
button.submit{
  width:100%;max-width:420px;padding:17px 24px;font-size:17px;font-weight:700;font-family:inherit;
  color:var(--ink);background:var(--brand);border:0;border-radius:var(--radius);cursor:pointer;
  box-shadow:0 2px 0 var(--brand-deep);
}
button.submit:hover{filter:brightness(1.04)}
button.submit:disabled{background:#D6D1CE;box-shadow:none;color:#8A8481;cursor:not-allowed}
.submit-note{font-size:13px;color:var(--ink-muted);margin:12px 0 0}
.form-error{
  display:none;background:#FDF4F3;border:1px solid var(--error);color:var(--error);
  border-radius:8px;padding:14px;margin:0 0 16px;font-size:14px;font-weight:700;
}
.form-error.show{display:block}

/* ── 完了・受付終了 */
.notice{padding:40px 0 60px;text-align:center}
.notice .mark{
  width:56px;height:56px;border-radius:50%;background:var(--brand);margin:0 auto 18px;
  display:grid;place-items:center;font-size:26px;color:var(--ink);
}
.notice h2{border:0;padding:0;font-size:20px;justify-content:center}
.receipt{
  display:inline-block;margin:14px 0;padding:14px 26px;background:var(--bg-subtle);
  border-radius:var(--radius);border:2px solid var(--brand);
}
.receipt .num{font-family:${v.fontDisp};font-size:30px;font-weight:600;letter-spacing:.06em;display:block}
.receipt .cap{font-size:11px;color:var(--ink-muted);letter-spacing:.1em}

/* ── フッター */
footer{background:var(--ink);color:#CFC9C6;padding:26px 0 34px;font-size:13px;margin-top:20px}
footer a{color:var(--brand)}
footer .org{color:var(--white);font-weight:700;margin:0 0 6px}

@media (max-width:380px){
  body{font-size:15px}
  .summary{grid-template-columns:1fr}
  .kv>div{grid-template-columns:1fr;gap:0}
  .hero h1{font-size:20px}
}
@media print{
  .form-section,.submit-area,.cta-row{display:none}
}`;
}

// ─────────────────────────────────────────── 概要部分
function renderSummary() {
  const cells = C.SUMMARY.map(s => `
      <div><dt>${esc(s.label)}</dt><dd${s.fromConfig ? ` data-config="${esc(s.fromConfig)}"` : ''}>${esc(s.value) || '—'}</dd></div>`).join('');
  return `<dl class="summary">${cells}\n    </dl>`;
}

function renderDetails() {
  return C.DETAILS.map(g => `
    <div class="card">
      <h3>${esc(g.group)}</h3>
      <dl class="kv">${g.items.map(i => `
        <div>
          <dt>${esc(i.label)}</dt>
          <dd class="${i.emphasis ? 'em' : ''}"${i.fromConfig ? ` data-config="${esc(i.fromConfig)}"` : ''}>${esc(i.value)}</dd>
        </div>`).join('')}
      </dl>${g.items.some(i => i.priceNote) ? `
      <p class="pending" data-price-note>単価：調整中（確定しだいご案内します）</p>` : ''}${g.placeholder ? `
      <p class="pending">※ 内容は確定しだい更新します</p>` : ''}
    </div>`).join('');
}

// ─────────────────────────────────────────── 入力欄
function fieldHtml(f) {
  if (f.type === 'honeypot') {
    return `<div class="hp"><label>${esc(f.label)}<input type="text" name="${f.key}" tabindex="-1" autocomplete="off"></label></div>`;
  }
  const req = f.required === true;
  const cond = !!f.required && typeof f.required === 'object';
  const badge = (req || cond)
    ? '<span class="req">必須</span>'
    : '<span class="opt">任意</span>';
  const help = f.help ? `<p class="help" id="${f.key}-help">${esc(f.help)}</p>` : '';
  const describedBy = f.help ? ` aria-describedby="${f.key}-help"` : '';
  let control = '';

  switch (f.type) {
    case 'textarea':
      control = `<textarea id="${f.key}" name="${f.key}" rows="${f.rows || 4}"${f.maxLength ? ` maxlength="${f.maxLength}"` : ''}${describedBy}></textarea>`;
      break;
    case 'number':
      control = `<input type="number" inputmode="numeric" id="${f.key}" name="${f.key}"`
        + `${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}`
        + `${f.default !== undefined ? ` value="${f.default}"` : ''}${describedBy}>`;
      if (f.unknownCheckbox) {
        control += `<label class="choice" style="margin-top:8px">`
          + `<input type="checkbox" id="${f.unknownCheckbox.key}" name="${f.unknownCheckbox.key}">`
          + `<span>${esc(f.unknownCheckbox.label)}</span></label>`;
      }
      break;
    case 'radio':
      control = `<div class="choices" role="radiogroup" aria-labelledby="${f.key}-label">`
        + (f.options || []).map((o, i) => {
            const val = typeof o === 'object' ? o.value : o;
            const lab = typeof o === 'object' ? o.label : o;
            return `<label class="choice"><input type="radio" name="${f.key}" value="${esc(val)}"><span>${esc(lab)}</span></label>`;
          }).join('')
        + `</div>`;
      break;
    case 'checkboxes':
      control = `<div class="choices">`
        + (f.options || []).map(o =>
            `<label class="choice"><input type="checkbox" name="${f.key}" value="${esc(o)}"><span>${esc(o)}</span></label>`
          ).join('')
        + `</div>`;
      break;
    case 'select':
      control = `<input type="text" id="${f.key}-search" placeholder="お名前の一部を入力すると絞り込めます" autocomplete="off"${describedBy}>`
        + `<select id="${f.key}" name="${f.key}" size="1" style="margin-top:8px"><option value="">選択してください</option></select>`;
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
        + `${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ''}${describedBy}>`;
  }

  return `<div class="field" data-field="${f.key}">
        <label class="q" id="${f.key}-label" for="${f.key}">${esc(f.label)}${badge}</label>
        ${help}${control}
        <p class="err" data-err="${f.key}"></p>
      </div>`;
}

function renderRentalSection(sec) {
  const items = S.FIELDS.filter(f => f.section === sec.id);
  const rows = items.map(f => {
    if (f.type === 'consent') {
      return `<div class="rental-row">
          <div><span class="rental-name">${esc(f.label)}</span>
            <span class="rental-price" data-price="${f.priceKey}">単価：調整中</span>
            ${f.help ? `<span class="rental-price">${esc(f.help)}</span>` : ''}</div>
          <label class="choice" style="justify-content:center"><input type="checkbox" id="${f.key}" name="${f.key}" data-qty-fixed="1"><span>希望</span></label>
        </div>`;
    }
    return `<div class="rental-row">
          <div><span class="rental-name">${esc(f.label)}</span>
            <span class="rental-price" data-price="${f.priceKey}">単価：調整中</span></div>
          <input type="number" id="${f.key}" name="${f.key}" min="${f.min}" max="${f.max}" value="${f.default}" inputmode="numeric" aria-label="${esc(f.label)}の数量">
        </div>`;
  }).join('');

  return `<section class="form-section" data-section="${sec.id}">
      <h2>${esc(sec.title)}</h2>
      <p class="sec-desc">${esc(sec.desc)}</p>
      ${rows}
      <div class="rental-total"><span>お見積り合計</span><span class="amount" data-rental-total>—</span></div>
      <p class="inline-note" data-rental-note>単価が確定しだい、合計金額が表示されます。</p>
    </section>`;
}

function renderForm() {
  return S.SECTIONS.map(sec => {
    if (sec.id === 'rental') return renderRentalSection(sec);
    const fields = S.FIELDS.filter(f => f.section === sec.id);
    return `<section class="form-section" data-section="${sec.id}">
      <h2>${esc(sec.title)}</h2>
      ${sec.desc ? `<p class="sec-desc">${esc(sec.desc)}</p>` : ''}
      ${fields.map(fieldHtml).join('\n      ')}
    </section>`;
  }).join('\n    ');
}

// ─────────────────────────────────────────── クライアントJS
function clientJs() {
  return `
// 条件判定は schema.js の関数をそのまま使う（GAS側と同一のコード）
${S.testCondition.toString()}
${S.isVisible.toString()}
${S.isRequired.toString()}

var FIELDS = ${JSON.stringify(S.FIELDS)};
var GAS_URL = ${JSON.stringify(ENDPOINT.gasUrl || '')};
var CFG = { prices:{}, closed:false, deadline:'', contact:'', staff:[] };
var submissionId = (function(){
  try { return crypto.randomUUID(); }
  catch(e){ return 'sid-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
})();

var $  = function(s,r){ return (r||document).querySelector(s); };
var $$ = function(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };

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
    if (f.type === 'url' && !/^https?:\\/\\/.+/.test(val))
      errs.push({ key:f.key, message:'URLは http:// または https:// から始めてください。' });
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
    if (first) first.scrollIntoView({ behavior:'smooth', block:'center' });
  } else {
    box.classList.remove('show');
  }
}

/** 備品の小計・合計。単価未設定なら「調整中」のままにする。 */
function updateRental(){
  var p = CFG.prices || {};
  var v = collect();
  var sizeKey = { S1:'tentS1', S2:'tentS2', S3:'tentS3' }[v.boothSize] || null;
  var map = { tent: sizeKey ? p[sizeKey] : null, table: p.table, chair: p.chair };

  $$('[data-price]').forEach(function(el){
    var unit = map[el.getAttribute('data-price')];
    el.textContent = (unit == null) ? '単価：調整中' : '単価：' + Number(unit).toLocaleString('ja-JP') + '円';
  });

  var known = true, total = 0;
  [['rentalTent','tent',1],['rentalTable','table',null],['rentalChair','chair',null]].forEach(function(t){
    var qty = (t[2] !== null) ? (v[t[0]] ? t[2] : 0) : Number(v[t[0]] || 0);
    if (!qty) return;
    var unit = map[t[1]];
    if (unit == null){ known = false; return; }
    total += unit * qty;
  });

  var el = $('[data-rental-total]');
  var note = $('[data-rental-note]');
  if (!known || (!total && !v.rentalTent && !Number(v.rentalTable) && !Number(v.rentalChair))){
    el.textContent = known ? '0円' : '—';
    note.textContent = known ? 'レンタルをご希望の備品を選択してください。'
                             : '単価が確定しだい、合計金額が表示されます。';
  } else {
    el.textContent = total.toLocaleString('ja-JP') + '円';
    note.textContent = '概算です。確定金額は別途ご案内します。';
  }
}

/** 担当社員プルダウン（検索付き）。取得に失敗してもフォームは止めない。 */
function setupStaff(list){
  var sel = document.getElementById('fcosakaStaff');
  var box = document.getElementById('fcosakaStaff-search');
  if (!sel) return;
  var opts = (list && list.length ? list.map(function(s){ return s.label; }) : []);
  var fallback = 'わからない／FC大阪以外からの紹介';
  if (opts.indexOf(fallback) === -1) opts.push(fallback);

  function render(filter){
    var f = (filter || '').trim();
    sel.innerHTML = '<option value="">選択してください</option>';
    opts.filter(function(o){ return !f || o.indexOf(f) !== -1; })
        .forEach(function(o){
          var op = document.createElement('option');
          op.value = o; op.textContent = o; sel.appendChild(op);
        });
  }
  render('');
  if (box) box.addEventListener('input', function(){ render(box.value); });
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
      $$('[data-config]').forEach(function(el){
        var k = el.getAttribute('data-config');
        if (d[k]) el.textContent = d[k];
      });
      if (d.contact) $$('[data-contact]').forEach(function(el){
        el.textContent = d.contact; if (el.tagName === 'A') el.href = 'mailto:' + d.contact;
      });
      setupStaff(d.staff);
      updateRental();
    })
    .catch(function(){
      // 設定が取れなくても応募は受け付けられる。止めない。
      setupStaff([]); updateRental();
    });
}

function showClosed(){
  $('#form-area').classList.add('hidden');
  $('#closed-area').classList.remove('hidden');
}

function showDone(receiptId, mailWarning){
  $('#form-area').classList.add('hidden');
  $('#intro-area').classList.add('hidden');
  $('#done-area').classList.remove('hidden');
  $('#receipt-number').textContent = receiptId;
  if (mailWarning) $('#mail-warning').classList.remove('hidden');
  window.scrollTo({ top:0, behavior:'smooth' });
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
    btn.disabled = false; btn.textContent = '上記の内容で応募する';
    $('.form-error').textContent = '送信先が未設定です（開発中）。';
    $('.form-error').classList.add('show');
    return;
  }

  fetch(GAS_URL, {
    method:'POST',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' }, // プリフライトを避ける
    body: JSON.stringify({ action:'submit', submissionId: submissionId, values: v })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (d && d.ok){ showDone(d.receiptId, d.mailWarning); return; }
    if (d && d.error === 'validation'){ showErrors(d.fields || []); }
    else if (d && d.error === 'closed'){ showClosed(); return; }
    else {
      $('.form-error').textContent = (d && d.message) ||
        '送信できませんでした。お手数ですが、もう一度お試しください。';
      $('.form-error').classList.add('show');
    }
    btn.disabled = false; btn.textContent = '上記の内容で応募する';
  })
  .catch(function(){
    $('.form-error').textContent =
      '通信に失敗しました。電波の良い場所で、もう一度お試しください。'
      + '繰り返し失敗する場合はお手数ですがメールでご連絡ください。';
    $('.form-error').classList.add('show');
    btn.disabled = false; btn.textContent = '上記の内容で応募する';
  });
}

document.addEventListener('DOMContentLoaded', function(){
  applyVisibility();
  updateRental();
  loadConfig();
  document.addEventListener('change', function(){ applyVisibility(); updateRental(); });
  document.addEventListener('input',  function(e){
    if (e.target && e.target.type === 'number') updateRental();
  });
  $('#submit-btn').addEventListener('click', function(e){ e.preventDefault(); submitForm(); });
});
`;
}

// ─────────────────────────────────────────── ページ全体
function page(theme) {
  const v = theme.vars;
  const asanoha = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='34' height='60' viewBox='0 0 34 60'%3E%3Cg fill='none' stroke='%23231816' stroke-width='1'%3E%3Cpath d='M17 0v60M0 15l17 10 17-10M0 45l17-10 17 10M0 0l17 15M34 0L17 15M0 60l17-15M34 60L17 45'/%3E%3C/g%3E%3C/svg%3E\")";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="format-detection" content="telephone=no">
<title>出店応募｜${esc(C.EVENT.name)}</title>
<meta name="description" content="${esc(C.EVENT.date)}、${esc(C.EVENT.venue)}で開催する${esc(C.EVENT.name)}の出店応募フォームです。出店料無料。">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&family=Oswald:wght@400;600&display=swap" rel="stylesheet">
<style>:root{--asanoha:${asanoha}}${css(v)}</style>
</head>
<body>

<header class="site-header">
  <div class="wrap">
    <!-- サステナ盆踊りロゴは制作中。確定後 assets/ の画像に差し替えるだけで入れ替わる -->
    <span class="logo-main logo-placeholder">
      <span>サステナ盆踊り<small>SUSTAINA BON ODORI</small></span>
    </span>
    <div class="supported">
      <span class="label">SUPPORTED BY</span>
      <img src="assets/fcosaka_emblem.png" alt="FC大阪" width="26" height="26">
      <img class="textlogo" src="assets/fcosaka_textlogo.png" alt="FC OSAKA" width="104" height="20">
      <span class="updater-tmp">UPDATER</span>
    </div>
  </div>
</header>

<main>
<div id="intro-area">
  <div class="hero hero--${v.heroStyle}">
    <div class="wrap hero-inner">
      <h1>${esc(C.EVENT.name)}<br>出店者募集</h1>
      <p class="lead">${esc(C.EVENT.date)}／${esc(C.EVENT.venue)}</p>
    </div>
  </div>

  <div class="wrap">
    ${renderSummary()}
    <div class="cta-row">
      <a class="btn-pdf" href="assets/募集要項.pdf" download>募集要項（PDF）をダウンロード</a>
    </div>

    <section>
      <h2>募集要項</h2>
      ${renderDetails()}
    </section>
  </div>
</div>

<div class="wrap" id="form-area">
  <section>
    <h2>応募フォーム</h2>
    <p class="help">＊のついた項目は必ずご入力ください。所要時間の目安は5〜10分です。</p>
  </section>
  <div class="form-error" role="alert"></div>
  <form id="entry" novalidate autocomplete="on">
    ${renderForm()}
    <div class="submit-area">
      <button type="submit" class="submit" id="submit-btn">上記の内容で応募する</button>
      <p class="submit-note">送信後、ご記入のメールアドレスに受付確認メールをお送りします。</p>
    </div>
  </form>
</div>

<div class="wrap notice hidden" id="done-area">
  <div class="mark">✓</div>
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

<div class="wrap notice hidden" id="closed-area">
  <h2>応募の受付は終了しました</h2>
  <p>たくさんのご応募をありがとうございました。<br>
     お問い合わせは <a data-contact href="#">こちら</a> までお願いいたします。</p>
</div>
</main>

<footer>
  <div class="wrap">
    <p class="org">${esc(C.CONTACT.name)}（${esc(C.EVENT.organizerNote)}）</p>
    <p>お問い合わせ：<a data-contact href="#">—</a></p>
  </div>
</footer>

<script>${clientJs()}</script>
</body>
</html>
`;
}

// ─────────────────────────────────────────── 出力
function main() {
  const which = process.argv[2] || 'a';
  const outputs = [];

  Object.keys(THEMES).forEach(id => {
    outputs.push([path.join(ROOT, 'design-' + id + '.html'), page(THEMES[id])]);
  });
  outputs.push([path.join(ROOT, 'index.html'), page(THEMES[which])]);

  outputs.forEach(([file, html]) => {
    fs.writeFileSync(file, html, 'utf8');
    console.log('  書き出し :', path.relative(ROOT, file), '(' + Math.round(html.length / 1024) + 'KB)');
  });
  console.log('  index.html のデザイン :', THEMES[which].name);
}

if (require.main === module) main();
module.exports = { page, THEMES };
