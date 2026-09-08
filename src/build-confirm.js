/**
 * 出店確定情報フォーム（confirm.html）を生成する。
 *
 *   src/schema.js       … 項目定義（confirmFields）
 *   src/content.js      … 文言（応募フォーム・PDFと同じ単一の正）
 *   src/build-form.js   … css() と fieldHtml() を共有（仕様書§6-3「デザインは共通」）
 *        └──▶ confirm.html
 *
 * ■ このページの入口
 *   採択通知メールのリンクだけ。「confirm.html?id=SB-0001&t=<32桁>」
 *   トークンが合わなければ、何も表示しない。
 *
 * ■ 画面に出す条件は、サーバーが返した値で決める
 *   火気と保険は「飲食を選んだ方だけ」に聞く。その条件は boothTypes という
 *   **応募段階の値**を見る。ページはこれをサーバーの応答から受け取る。
 *   URLやフォームから渡すと、書き換えて必須を回避できる
 *   （サーバー側でも台帳の値で上書きしているので二重の歯止め）。
 *
 * ■ 紙面から外した4件をここにも置く
 *   荒天時の中断／お支払い／区画の場所／包材の指定は、募集要項から外して
 *   「採択後に伝える」ことにした（content.js の PDF.afterAcceptRows）。
 *   採択通知メールに書いてあるが、メールは流れる。
 *   当日の運営を入力するこの画面にも置いて、手元で確認できるようにする。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const S = require('./schema.js');
const C = require('./content.js');
const IMG = require('./imgsize.js');
const { TOKENS: T } = require('./theme.js');
const FORM = require('./build-form.js');

const CONFIRM_FIELDS = S.confirmFields();

const endpointPath = path.join(ROOT, 'src', 'endpoint.json');
const ENDPOINT = fs.existsSync(endpointPath)
  ? JSON.parse(fs.readFileSync(endpointPath, 'utf8')).gasUrl : '';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * 採択後にあらためて伝える事項。
 * content.js の OUTLINE から、PDF.afterAcceptRows で「紙面から外す」と決めた行を拾う。
 * ここで拾えなければビルドを止める（文言を移したのに行き先が消える、を防ぐ）。
 */
function afterAcceptRows() {
  const out = [];
  Object.keys(C.PDF.afterAcceptRows).forEach(secTitle => {
    const sec = C.OUTLINE.find(g => g.title === secTitle);
    if (!sec) throw new Error('OUTLINE に無い節を指しています: ' + secTitle);
    C.PDF.afterAcceptRows[secTitle].forEach(key => {
      const row = sec.body.find(b => b[0] === key);
      if (!row) throw new Error('紙面から外した行が OUTLINE にありません: ' + key);
      out.push({ k: row[0], v: row[1] });
    });
  });
  return out;
}

function extraCss() {
  return `
/* ── 出店確定情報フォーム。応募フォームのCSSに、この画面ぶんだけ足す */
.cf-head{background:var(--white);border-bottom:1px solid var(--border)}
.cf-head .wrap{padding-top:var(--s5);padding-bottom:var(--s5)}
.cf-logo{height:44px;width:auto;display:block;margin-bottom:var(--s4)}
@media (min-width:600px){ .cf-logo{height:56px} }
.cf-head h1{margin:0 0 var(--s2);font-size:22px;font-weight:700;letter-spacing:.01em}
@media (min-width:600px){ .cf-head h1{font-size:26px} }
.cf-head .who{margin:0;font-size:14px;color:var(--ink-muted)}
.cf-head .who b{color:var(--ink);font-size:16px}
/* 期限は一番強く出す。ここが伝わらないと当日の運営が組めない */
.cf-due{margin:var(--s4) 0 0;display:inline-flex;align-items:baseline;gap:var(--s2);
  background:var(--accent-pale);border-left:4px solid var(--accent);
  padding:10px 14px;border-radius:0 var(--r) var(--r) 0;font-size:14px}
.cf-due b{font-size:16px}
.cf-saved{margin:var(--s3) 0 0;font-size:13px;color:var(--ink-muted)}

.cf-gate{padding:var(--s8) 0;text-align:center}
.cf-gate h2{margin:0 0 var(--s3);font-size:19px}
.cf-gate p{margin:0 auto;max-width:32em;font-size:14.5px;line-height:1.9;color:var(--ink-muted)}
.cf-gate .mail{display:inline-block;margin-top:var(--s4);font-weight:700}

/* 採択後にあらためて伝える事項 */
.cf-notes{background:var(--bg-subtle);border-top:1px solid var(--border)}
.cf-notes .wrap{padding-top:var(--s6);padding-bottom:var(--s6)}
.cf-notes h2{margin:0 0 var(--s4);font-size:16px;letter-spacing:.04em}
.cf-notes dl{display:grid;gap:var(--s3);margin:0}
.cf-notes dt{font-size:13px;font-weight:700;color:var(--brand-deep)}
.cf-notes dd{margin:2px 0 0;font-size:14px;line-height:1.85}

.cf-done{padding:var(--s8) 0;text-align:center}
.cf-done .mark{width:56px;height:56px;margin:0 auto var(--s4);border-radius:50%;
  background:var(--brand);display:grid;place-items:center}
.cf-done h2{margin:0 0 var(--s3);font-size:20px}
.cf-done p{margin:0 auto var(--s4);max-width:30em;font-size:14.5px;line-height:1.9}
.cf-busy{opacity:.5;pointer-events:none}`;
}

function renderSections() {
  return S.SECTIONS.map(sec => {
    const fields = CONFIRM_FIELDS.filter(f => f.section === sec.id);
    if (!fields.length) return '';
    return `
    <section class="form-section" data-section="${esc(sec.id)}">
      <h2>${esc(sec.title)}</h2>
      ${fields.map(f => FORM.fieldHtml(f)).join('\n      ')}
    </section>`;
  }).join('');
}

function clientJs() {
  // 画面側で使う項目定義。条件式は文字列にして、応募フォームと同じ関数で判定する
  const fieldsJson = JSON.stringify(CONFIRM_FIELDS);
  return `
var ENDPOINT = ${JSON.stringify(ENDPOINT)};
var FIELDS = ${fieldsJson};
var testCondition = ${S.testCondition.toString()};
var isVisible = ${S.isVisible.toString()};
var isRequired = ${S.isRequired.toString()};

var $ = function(s){ return document.querySelector(s); };
var $$ = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
var STATE = { id:'', t:'', boothTypes:[] };

function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}

function show(which){
  ['cf-gate','cf-form','cf-done'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.hidden = (id !== which);
  });
}

function gate(title, body, showMail){
  $('#gate-title').textContent = title;
  $('#gate-body').textContent = body;
  $('#gate-mail').hidden = !showMail;
  show('cf-gate');
}

/** サーバーへ。応募フォームと同じく text/plain（プリフライトを起こさない） */
function api(payload){
  return fetch(ENDPOINT, {
    method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(payload)
  }).then(function(r){ return r.json(); });
}

// ── 表示・入力

function setValue(f, v){
  if (v === undefined || v === null) return;
  if (f.type === 'checkboxes'){
    $$('[name="' + f.key + '"]').forEach(function(el){
      el.checked = Array.isArray(v) && v.indexOf(el.value) >= 0;
    });
    return;
  }
  if (f.type === 'radio'){
    $$('[name="' + f.key + '"]').forEach(function(el){ el.checked = (el.value === v); });
    return;
  }
  var el = document.getElementById(f.key);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
}

function collect(){
  // 条件判定に使う boothTypes は、サーバーが返した値をそのまま持つ。
  // 画面の入力からは作らない（作れる形にすると、書き換えて必須を回避できる）
  var v = { boothTypes: STATE.boothTypes };
  FIELDS.forEach(function(f){
    if (f.type === 'checkboxes'){
      v[f.key] = $$('[name="' + f.key + '"]:checked').map(function(el){ return el.value; });
      return;
    }
    if (f.type === 'radio'){
      var on = $('[name="' + f.key + '"]:checked');
      v[f.key] = on ? on.value : '';
      return;
    }
    var el = document.getElementById(f.key);
    if (!el) return;
    if (el.type === 'checkbox') v[f.key] = el.checked;
    else if (f.type === 'number') v[f.key] = el.value === '' ? '' : Number(el.value);
    else v[f.key] = el.value.trim();
  });
  return v;
}

/** 条件に合わない項目を隠し、隠したら中身も消す（残すと集計が狂う） */
function applyVisibility(){
  var v = collect();
  FIELDS.forEach(function(f){
    var box = $('[data-field="' + f.key + '"]');
    if (!box) return;
    var on = isVisible(f, v);
    box.hidden = !on;
    if (!on) clearField(f);
    var badge = box.querySelector('.req, .opt');
    if (badge && on){
      var need = isRequired(f, v);
      badge.textContent = need ? '必須' : '任意';
      badge.className = need ? 'req' : 'opt';
    }
  });

  // 中身が全部隠れた節は、節ごと隠す。
  // 「出店内容」は火気と保険だけで、どちらも飲食のときしか出ない。
  // 隠さないと、飲食以外の方には**見出しだけの空箱**が出る。
  $$('[data-section]').forEach(function(sec){
    var any = Array.prototype.slice.call(sec.querySelectorAll('[data-field]'))
      .some(function(b){ return !b.hidden; });
    sec.hidden = !any;
  });
}

function clearField(f){
  if (f.type === 'checkboxes' || f.type === 'radio'){
    $$('[name="' + f.key + '"]').forEach(function(el){ el.checked = false; });
    return;
  }
  var el = document.getElementById(f.key);
  if (el){ if (el.type === 'checkbox') el.checked = false; else el.value = ''; }
}

/** 画面側の検証。**これは親切のためで、守りはサーバー側** */
function validate(v){
  var errs = [];
  FIELDS.forEach(function(f){
    if (!isVisible(f, v)) return;
    var val = v[f.key];
    var empty = (val === undefined || val === null || val === '' ||
                 (Array.isArray(val) && !val.length));
    if (isRequired(f, v) && empty){
      errs.push({ key:f.key, message: f.label + 'を入力してください。' });
      return;
    }
    if (empty) return;
    if (f.type === 'tel' && !/^[0-9+\\-() 　]{8,20}$/.test(String(val))){
      errs.push({ key:f.key, message:'電話番号の形式をご確認ください。' });
    }
    if (f.type === 'number'){
      var n = Number(val);
      if (!isFinite(n)) errs.push({ key:f.key, message: f.label + 'は数字でご入力ください。' });
      else if (f.min !== undefined && n < f.min)
        errs.push({ key:f.key, message: f.label + 'は' + f.min + '以上でご入力ください。' });
      else if (f.max !== undefined && n > f.max)
        errs.push({ key:f.key, message: f.label + 'は' + f.max + '以下でご入力ください。' });
    }
  });
  return errs;
}

function showErrors(errs){
  $$('.err').forEach(function(p){ p.textContent = ''; });
  $$('.field').forEach(function(b){ b.classList.remove('has-err'); });
  errs.forEach(function(e){
    var p = $('[data-err="' + e.key + '"]');
    if (p) p.textContent = e.message;
    var box = $('[data-field="' + e.key + '"]');
    if (box) box.classList.add('has-err');
  });
  if (errs.length){
    var first = $('[data-field="' + errs[0].key + '"]');
    if (first) first.scrollIntoView({ behavior:'smooth', block:'center' });
  }
}

// ── 読み込みと保存

function load(){
  var q = new URLSearchParams(location.search);
  STATE.id = (q.get('id') || '').trim();
  STATE.t = (q.get('t') || '').trim();

  if (!STATE.id || !STATE.t){
    gate('リンクが正しくありません',
      '採択通知メールに記載のリンクを、そのままお開きください。'
      + 'メールソフトによっては、リンクが途中で切れることがあります。', true);
    return;
  }

  api({ action:'confirmLoad', id:STATE.id, t:STATE.t }).then(function(r){
    if (!r || !r.ok){
      gate('ご登録いただけません',
        (r && r.message) || 'このリンクは有効ではありません。', true);
      return;
    }
    STATE.boothTypes = r.boothTypes || [];
    $('#cf-company').textContent = r.company || '';
    $('#cf-receipt').textContent = r.receiptId || '';
    $('#cf-due').textContent = r.deadlineText || '';
    if (r.savedAt){
      $('#cf-saved').hidden = false;
      $('#cf-saved').textContent = 'この内容は ' + r.savedAt
        + ' に登録済みです。書き換えて、もう一度保存できます。';
    }
    FIELDS.forEach(function(f){ setValue(f, (r.values || {})[f.key]); });
    applyVisibility();
    show('cf-form');
  }, function(){
    gate('つながりませんでした',
      '通信に失敗しました。しばらくおいて、もう一度お試しください。', true);
  });
}

function save(){
  var v = collect();
  var errs = validate(v);
  showErrors(errs);
  if (errs.length) return;

  var btn = $('#cf-save');
  btn.disabled = true;
  $('#cf-form').classList.add('cf-busy');
  $('#cf-msg').textContent = '登録しています…';

  // boothTypes は送らない。サーバーが台帳の値で判定する
  delete v.boothTypes;

  api({ action:'confirmSave', id:STATE.id, t:STATE.t, values:v }).then(function(r){
    btn.disabled = false;
    $('#cf-form').classList.remove('cf-busy');
    $('#cf-msg').textContent = '';
    if (!r || !r.ok){
      if (r && r.error === 'validation'){ showErrors(r.fields || []); return; }
      alert((r && r.message) || '登録できませんでした。もう一度お試しください。');
      return;
    }
    $('#done-at').textContent = r.savedAt || '';
    show('cf-done');
    window.scrollTo({ top:0, behavior:'smooth' });
  }, function(){
    btn.disabled = false;
    $('#cf-form').classList.remove('cf-busy');
    $('#cf-msg').textContent = '';
    alert('通信に失敗しました。しばらくおいて、もう一度お試しください。');
  });
}

document.addEventListener('DOMContentLoaded', function(){
  $$('input, select, textarea').forEach(function(el){
    el.addEventListener('change', applyVisibility);
  });
  $('#cf-save').addEventListener('click', save);
  $('#cf-again').addEventListener('click', function(){ show('cf-form'); });
  load();
});`;
}

function page() {
  const notes = afterAcceptRows();
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- 検索に出さない。専用リンクを持つ方だけが開くページ -->
<meta name="robots" content="noindex, nofollow">
<!-- URLにトークンが乗るので、外部へ送らない -->
<meta name="referrer" content="no-referrer">
<title>出店確定情報のご登録 ｜ ${esc(C.EVENT.name)}</title>
<link rel="icon" href="${esc(C.BRAND.favicon)}" sizes="32x32">
<link rel="apple-touch-icon" href="${esc(C.BRAND.faviconLg)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>${FORM.css()}${extraCss()}</style>
</head>
<body>

<header class="cf-head">
  <div class="wrap">
    <img class="cf-logo" src="${esc(C.BRAND.logoText)}" alt="${esc(C.EVENT.name)}"
         ${IMG.sizeAttrs(C.BRAND.logoText)}>
    <h1>出店確定情報のご登録</h1>
    <p class="who"><b id="cf-company"></b><span id="cf-receipt-wrap">　受付ID <span id="cf-receipt"></span></span></p>
    <p class="cf-due">ご提出期限<b id="cf-due"></b></p>
    <p class="cf-saved" id="cf-saved" hidden></p>
  </div>
</header>

<main>

<!-- 入れない場合。何が違うのかは伝えない（受付IDの総当たりの手がかりになる） -->
<section class="wrap cf-gate" id="cf-gate" hidden>
  <h2 id="gate-title"></h2>
  <p id="gate-body"></p>
  <p id="gate-mail" hidden>
    <a class="mail" href="mailto:${esc(C.CONTACT.email)}">${esc(C.CONTACT.email)}</a>
  </p>
</section>

<div id="cf-form" hidden>
  <div class="wrap">
    <p class="lead-note">当日の運営に必要な情報をお伺いします。
      搬入の時間帯や誘導の計画に使わせていただきます。</p>
    ${renderSections()}
    <div class="submit-area">
      <button type="button" class="btn btn-brand" id="cf-save">この内容で登録する</button>
      <span class="msg" id="cf-msg"></span>
      <p class="help">登録後も、同じリンクから何度でも書き換えられます。</p>
    </div>
  </div>

  <!-- 紙面から外して「採択後に伝える」と決めた事項（content.js の afterAcceptRows）。
       メールにも書いてあるが、メールは流れる。入力するこの画面にも置く。 -->
  <section class="cf-notes">
    <div class="wrap">
      <h2>あらためてお伝えする事項</h2>
      <dl>
        ${notes.map(n => `<div><dt>${esc(n.k)}</dt><dd>${esc(n.v)}</dd></div>`).join('\n        ')}
      </dl>
    </div>
  </section>
</div>

<section class="wrap cf-done" id="cf-done" hidden>
  <div class="mark">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#231816"
      stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
  </div>
  <h2>ご登録ありがとうございました</h2>
  <p>登録日時：<span id="done-at"></span><br>
    内容は、採択通知メールの同じリンクからいつでも書き換えられます。</p>
  <button type="button" class="btn btn-ghost-dark" id="cf-again">内容を確認・修正する</button>
</section>

</main>

<footer>
  <div class="wrap">
    <p class="org">${esc(C.EVENT.organizer)}</p>
    <p>お問い合わせ：<a href="mailto:${esc(C.CONTACT.email)}">${esc(C.CONTACT.email)}</a></p>
  </div>
</footer>

<script>${clientJs()}</script>
</body>
</html>
`;
}

function main() {
  const html = page();
  fs.writeFileSync(path.join(ROOT, 'confirm.html'), html, 'utf8');
  console.log('  書き出し : confirm.html (' + Math.round(html.length / 1024) + 'KB)');
}

if (require.main === module) main();
module.exports = { page, afterAcceptRows };
