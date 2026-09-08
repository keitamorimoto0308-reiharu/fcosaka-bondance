/**
 * 素材アップロードページ（upload.html）を生成する。
 *
 *   src/content.js      … 文言（応募フォーム・PDFと同じ単一の正）
 *   src/build-form.js   … css() を共有（仕様書§6-3「デザインは共通」）
 *        └──▶ upload.html
 *
 * ■ 入口
 *   採択通知メールのリンクだけ。「upload.html?id=SB-0001&t=<32桁>」
 *   鍵は出店確定情報フォームと同じ（同じメールに両方のリンクが載るので、
 *   分けても守りは増えない）。
 *
 * ■ 送る前に断る
 *   GASのウェブアプリはPOSTの本文に上限があり、base64は元のファイルを
 *   約1.33倍に膨らませる。超えると**送信を押しても無反応**という
 *   一番たちの悪い形で失敗する。
 *   ここで大きさと種類を先に見て、送らずに断る。サーバー側でも同じ値で止める。
 *
 * ■ 1件ずつ送る
 *   まとめて送ると、1つ大きいものが混ざっただけで全部落ちる。
 *   1件ずつ送り、1件ずつ結果を出す。途中で失敗しても、そこまでは残る。
 *
 * ■ 消す操作は置かない
 *   間違えて消したときに復旧できない。同じ名前で出し直せば新しい版が並ぶ。
 *   本当に消す必要があるときは、管理ページ（管理者のみ）から行う。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const C = require('./content.js');
const IMG = require('./imgsize.js');
const FORM = require('./build-form.js');

const endpointPath = path.join(ROOT, 'src', 'endpoint.json');
const ENDPOINT = fs.existsSync(endpointPath)
  ? JSON.parse(fs.readFileSync(endpointPath, 'utf8')).gasUrl : '';

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function extraCss() {
  return `
/* ── 素材アップロード。応募フォームのCSSに、この画面ぶんだけ足す */
.up-head{background:var(--white);border-bottom:1px solid var(--border)}
.up-head .wrap{padding-top:var(--s5);padding-bottom:var(--s5)}
.up-logo{height:44px;width:auto;display:block;margin-bottom:var(--s4)}
@media (min-width:600px){ .up-logo{height:56px} }
.up-head h1{margin:0 0 var(--s2);font-size:22px;font-weight:700;letter-spacing:.01em}
@media (min-width:600px){ .up-head h1{font-size:26px} }
.up-head .who{margin:0;font-size:14px;color:var(--ink-muted)}
.up-head .who b{color:var(--ink);font-size:16px}

.up-gate{padding:var(--s8) 0;text-align:center}
.up-gate h2{margin:0 0 var(--s3);font-size:19px}
.up-gate p{margin:0 auto;max-width:32em;font-size:14.5px;line-height:1.9;color:var(--ink-muted)}
.up-gate .mail{display:inline-block;margin-top:var(--s4);font-weight:700}

/* 置き場。押しても、ドラッグしても入る */
.up-drop{margin:var(--s5) 0 0;border:2px dashed var(--border);border-radius:var(--r-lg);
  background:var(--bg-subtle);padding:var(--s7) var(--s5);text-align:center;
  cursor:pointer;transition:border-color .15s ease,background .15s ease}
.up-drop:hover,.up-drop.over{border-color:var(--brand-deep);background:var(--brand-pale)}
.up-drop .big{margin:0 0 var(--s2);font-size:16px;font-weight:700}
.up-drop .sub{margin:0;font-size:13px;color:var(--ink-muted);line-height:1.8}
.up-drop input{display:none}

/* 送信中・結果 */
.up-queue{margin:var(--s5) 0 0;display:grid;gap:var(--s2)}
.up-item{display:grid;grid-template-columns:1fr auto;gap:var(--s3);align-items:center;
  border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;font-size:13.5px}
.up-item .nm{overflow-wrap:anywhere}
.up-item .sz{font-size:12px;color:var(--ink-muted)}
.up-item .st{font-size:12.5px;font-weight:700;white-space:nowrap}
.up-item.ok{border-color:#9BD4A8;background:#F2FAF4}
.up-item.ok .st{color:#2F7D46}
.up-item.ng{border-color:var(--error);background:#FDF2F0}
.up-item.ng .st{color:var(--error)}
.up-item .why{grid-column:1/-1;font-size:12.5px;color:var(--error);line-height:1.7}

/* 提出済みの一覧 */
.up-list{margin:var(--s6) 0 0}
.up-list h2{margin:0 0 var(--s3);font-size:16px;letter-spacing:.04em}
.up-list ul{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2)}
.up-list li{display:grid;grid-template-columns:1fr auto;gap:var(--s3);align-items:baseline;
  border-bottom:1px solid var(--border);padding:10px 2px;font-size:13.5px}
.up-list .meta{font-size:12px;color:var(--ink-muted);white-space:nowrap}
.up-list .nm{overflow-wrap:anywhere}
.up-empty{margin:0;padding:var(--s5) 0;font-size:14px;color:var(--ink-muted)}

/* 送信中は置き場を触らせない。
   このクラスは build-confirm.js 側にしか無く、ここでは効いていなかった。
   回線の細いお店で10枚送っている間、押しても何も起きず「壊れた」と読まれる */
.cf-busy{opacity:.5;pointer-events:none}

/* リンクの色と下線の位置。
   既定の #0000EE のままだと他ページと揃わない。下線がアンダースコアに重なって
   「店舗ロゴ_大阪」が「店舗ロゴ 大阪」に見え、メールアドレスを見て打つと届かない */
.up-gate a,.up-note a{color:var(--brand-deep);text-underline-offset:3px}
.up-gate .mail{text-decoration:none;color:var(--brand-deep)}

/* 提出期限。確定情報フォームと同じ見た目にそろえる */
.up-due{margin:var(--s5) 0 0;background:#FBF6EC;border:1px solid #E4D6BC;
  border-radius:var(--r);padding:12px 16px;font-size:14px;line-height:1.8}
.up-due b{color:#7A5A20}

/* 一括で送ったあとの総括。赤い箱が並ぶだけでは何件通ったか読み取れない */
.up-sum{margin:var(--s4) 0 0;font-size:14px;font-weight:700;line-height:1.8}
.up-sum.ng{color:var(--error)}

.up-note{margin:var(--s6) 0 0;background:var(--bg-subtle);border-left:4px solid var(--brand);
  padding:14px 16px;border-radius:0 var(--r) var(--r) 0;font-size:13.5px;line-height:1.9}
.up-note b{display:block;margin-bottom:4px}`;
}

function clientJs() {
  return `
var ENDPOINT = ${JSON.stringify(ENDPOINT)};
var $ = function(s){ return document.querySelector(s); };
var $$ = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
var STATE = { id:'', t:'', max:0, maxFiles:0, allowed:[], count:0, busy:false };

/**
 * 拡張子からの種類の割り出し。
 *
 * ブラウザは、知らない拡張子だと File.type を**空文字**にする。
 * Illustrator（.ai）とiPhoneの写真（.heic）がまさにそれで、
 * 「この種類はお預かりできません（不明）」と断られていた。
 * .ai はロゴ入稿でいちばん多く、.heic は iPhone の既定の写真形式。
 * ダイアログの accept には .ai を入れているので、
 * **選ばせておいて断る**という一番よくない形になっていた。
 */
var EXT_MIME = {
  ai:'application/illustrator', eps:'application/postscript',
  heic:'image/heic', heif:'image/heic',
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif',
  webp:'image/webp', svg:'image/svg+xml', pdf:'application/pdf', zip:'application/zip',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

/** 受け取れる形の案内。サーバー側の文言と同じにする */
var KINDS = '画像（JPEG・PNG・GIF・WebP・HEIC・SVG）、PDF、Word、PowerPoint、'
          + 'Illustrator、ZIP をお送りください。';

var DROP_MSG = 'ここを押すか、ファイルをドラッグしてください';

function pickMime(f){
  if (f.type && STATE.allowed.indexOf(f.type) >= 0) return f.type;
  var m = /\\.([A-Za-z0-9]{1,12})$/.exec(f.name || '');
  var byExt = m ? EXT_MIME[m[1].toLowerCase()] : '';
  if (byExt && STATE.allowed.indexOf(byExt) >= 0) return byExt;
  return '';
}

function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}

function show(which){
  ['up-gate','up-main'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.hidden = (id !== which);
  });
}

function gate(title, body){
  $('#gate-title').textContent = title;
  $('#gate-body').textContent = body;
  // 会社名が空のまま「受付ID」というラベルだけが残ると、
  // 「エラー画面まで壊れている」ように見える
  var who = $('#up-who');
  if (who) who.hidden = true;
  show('up-gate');
}

function api(payload){
  return fetch(ENDPOINT, {
    method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify(payload)
  }).then(function(r){ return r.json(); });
}

function sizeText(n){
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return Math.round(n/1024) + ' KB';
  return (Math.round(n/1024/1024*10)/10) + ' MB';
}

// ── 提出済みの一覧

/**
 * 提出済みの一覧。
 *
 * ■ ファイル名をリンクにしない
 *   リンク先はDriveのファイルURLで、そのファイルは主催側にしか共有されていない。
 *   事業者が押すとGoogleの「アクセス権のリクエスト」画面に飛び、
 *   壊れているように見える（「リンクが開けません」の電話になる）。
 *   控えとしては、名前・大きさ・日時が読めれば足りる。
 */
function renderFiles(files){
  STATE.count = files.length;
  var box = $('#up-files');
  var h = $('#up-files-h');
  if (h) h.textContent = files.length
    ? 'ご提出いただいたもの（' + files.length + '件／' + STATE.maxFiles + '件まで）'
    : 'ご提出いただいたもの';
  if (!files.length){
    box.innerHTML = '<p class="up-empty">まだご提出はありません。</p>';
    return;
  }
  box.innerHTML = '<ul>' + files.map(function(f){
    return '<li><span class="nm">' + esc(f.name) + '</span>'
      + '<span class="meta">' + esc(f.sizeText) + '　' + esc(f.updated) + '</span></li>';
  }).join('') + '</ul>';
}

// ── 送信

/**
 * 1件ずつ順番に送る。
 * まとめて送ると、1つ大きいものが混ざっただけで全部落ちる。
 * 途中で失敗しても、そこまでの提出は残る。
 */
function handleFiles(fileList){
  if (STATE.busy) return;
  var files = Array.prototype.slice.call(fileList);
  if (!files.length) return;

  var queue = $('#up-queue');
  queue.innerHTML = '';
  $('#up-sum').hidden = true;
  var rows = files.map(function(f){
    var el = document.createElement('div');
    el.className = 'up-item';
    el.innerHTML = '<div><div class="nm">' + esc(f.name) + '</div>'
      + '<div class="sz">' + sizeText(f.size) + '</div></div>'
      + '<div class="st">待機中</div>';
    queue.appendChild(el);
    return el;
  });

  STATE.busy = true;
  $('#up-drop').classList.add('cf-busy');
  $('#up-drop-msg').textContent = '送信中です。そのままお待ちください。';

  var done = 0, failed = 0;
  var i = 0;
  function next(){
    if (i >= files.length){
      STATE.busy = false;
      $('#up-drop').classList.remove('cf-busy');
      $('#up-drop-msg').textContent = DROP_MSG;

      // 赤い箱が並ぶだけでは、何件通ったのかが読み取れない
      var sum = $('#up-sum');
      sum.hidden = false;
      sum.className = 'up-sum' + (failed ? ' ng' : '');
      sum.textContent = failed
        ? done + '件をお預かりしました。' + failed + '件は送れませんでした（上の赤い行をご確認ください）。'
        : done + '件をお預かりしました。ありがとうございます。';
      // 送り終わったら一覧を取り直す（こちらで積み上げると、
      // 失敗した分まで並べてしまう）
      api({ action:'uploadInfo', id:STATE.id, t:STATE.t }).then(function(r){
        if (r && r.ok) renderFiles(r.files || []);
      });
      return;
    }
    var f = files[i], row = rows[i];
    var st = row.querySelector('.st');

    // ■ 送る前に断る
    var bad = '';
    var mime = pickMime(f);
    if (!mime){
      // 生の種別（application/vnd.openxmlformats-…）は出さない。
      // 商店会の方には意味が通らず、「システムが壊れた」と読まれる。
      // 代わりに「では何を送ればよいか」を書く
      bad = 'この形のファイルはお預かりできません。' + KINDS;
    } else if (f.size > STATE.max){
      bad = '大きすぎます（1つあたり ' + sizeText(STATE.max) + ' まで）';
    } else if (STATE.count + 1 > STATE.maxFiles){
      bad = 'ご提出は' + STATE.maxFiles + '件までです';
    }
    if (bad){
      row.classList.add('ng');
      st.textContent = '送っていません';
      var why = document.createElement('div');
      why.className = 'why';
      why.textContent = bad;
      row.appendChild(why);
      failed++; i++; next(); return;
    }

    st.textContent = '送信中…';
    var reader = new FileReader();
    reader.onerror = function(){
      row.classList.add('ng'); st.textContent = '読めません';
      failed++; i++; next();
    };
    reader.onload = function(){
      // data:...;base64,XXXX の XXXX だけを送る
      var data = String(reader.result || '');
      var comma = data.indexOf(',');
      data = comma >= 0 ? data.slice(comma + 1) : '';

      api({ action:'uploadFile', id:STATE.id, t:STATE.t,
            name:f.name, mime:mime, data:data }).then(function(r){
        if (r && r.ok){
          row.classList.add('ok'); st.textContent = '完了';
          STATE.count++; done++;
        } else {
          row.classList.add('ng'); st.textContent = '失敗';
          failed++;
          var w = document.createElement('div');
          w.className = 'why';
          w.textContent = (r && r.message) || '保存できませんでした。';
          row.appendChild(w);
        }
        i++; next();
      }, function(){
        row.classList.add('ng'); st.textContent = '失敗';
        failed++;
        var w = document.createElement('div');
        w.className = 'why';
        w.textContent = '通信に失敗しました。しばらくおいて、もう一度お試しください。';
        row.appendChild(w);
        i++; next();
      });
    };
    reader.readAsDataURL(f);
  }
  next();
}

// ── 読み込み

function load(){
  var q = new URLSearchParams(location.search);
  STATE.id = (q.get('id') || '').trim();
  STATE.t = (q.get('t') || '').trim();

  if (!STATE.id || !STATE.t){
    gate('リンクが正しくありません',
      '採択通知メールに記載のリンクを、そのままお開きください。'
      + 'メールソフトによっては、リンクが途中で切れることがあります。');
    return;
  }

  api({ action:'uploadInfo', id:STATE.id, t:STATE.t }).then(function(r){
    if (!r || !r.ok){
      gate('ご提出いただけません', (r && r.message) || 'このリンクは有効ではありません。');
      return;
    }
    STATE.max = r.maxBytes;
    STATE.maxFiles = r.maxFiles;
    STATE.allowed = r.allowed || [];
    $('#up-company').textContent = r.company || '';
    $('#up-receipt').textContent = r.receiptId || '';
    $('#up-limit').textContent = '1つあたり ' + r.maxSizeText + ' まで／'
      + r.maxFiles + '件まで';
    // 期限が設定されていなければ枠ごと出さない（空の枠は不安にさせる）
    if (r.deadline){
      $('#up-due').hidden = false;
      $('#up-due-text').textContent = r.deadline;
    }
    renderFiles(r.files || []);
    show('up-main');
  }, function(){
    gate('つながりませんでした',
      '通信に失敗しました。しばらくおいて、もう一度お試しください。');
  });
}

document.addEventListener('DOMContentLoaded', function(){
  var drop = $('#up-drop'), input = $('#up-input');
  drop.addEventListener('click', function(){ if (!STATE.busy) input.click(); });
  input.addEventListener('change', function(){
    handleFiles(input.files);
    input.value = '';     // 同じファイルをもう一度選べるようにする
  });
  ['dragenter','dragover'].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave','drop'].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function(e){
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });
  load();
});`;
}

function page() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- 検索に出さない。専用リンクを持つ方だけが開くページ -->
<meta name="robots" content="noindex, nofollow">
<!-- URLにトークンが乗るので、外部へ送らない -->
<meta name="referrer" content="no-referrer">
<title>素材のご提出 ｜ ${esc(C.EVENT.name)}</title>
<link rel="icon" href="${esc(C.BRAND.favicon)}" sizes="32x32">
<link rel="apple-touch-icon" href="${esc(C.BRAND.faviconLg)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>${FORM.css()}${extraCss()}</style>
</head>
<body>

<header class="up-head">
  <div class="wrap">
    <img class="up-logo" src="${esc(C.BRAND.logoText)}" alt="${esc(C.EVENT.name)}"
         ${IMG.sizeAttrs(C.BRAND.logoText)}>
    <h1>素材のご提出</h1>
    <p class="who" id="up-who"><b id="up-company"></b>　受付ID <span id="up-receipt"></span></p>
  </div>
</header>

<main>

<section class="wrap up-gate" id="up-gate" hidden>
  <h2 id="gate-title"></h2>
  <p id="gate-body"></p>
  <p><a class="mail" href="mailto:${esc(C.CONTACT.email)}">${esc(C.CONTACT.email)}</a></p>
</section>

<div id="up-main" hidden>
  <div class="wrap">
    <p class="lead-note">当日の告知や実施報告に使わせていただく素材をお預かりします。
      お店のロゴ、商品やブースの写真などをご提出ください。</p>

    <p class="up-due" id="up-due" hidden><b>ご提出期限：<span id="up-due-text"></span></b><br>
      告知物の準備がありますので、期限までにお願いいたします。</p>

    <div class="up-drop" id="up-drop">
      <p class="big">ファイルを選ぶ</p>
      <p class="sub" id="up-drop-msg">ここを押すか、ファイルをドラッグしてください</p>
      <p class="sub"><span id="up-limit"></span></p>
      <input type="file" id="up-input" multiple
             accept="image/*,.heic,.heif,application/pdf,.ai,.eps,.zip,.docx,.pptx">
    </div>

    <div class="up-queue" id="up-queue"></div>
    <p class="up-sum" id="up-sum" hidden></p>

    <section class="up-list">
      <h2 id="up-files-h">ご提出いただいたもの</h2>
      <div id="up-files"></div>
    </section>

    <p class="up-note">
      <b>ご提出後について</b>
      いただいた素材は、本イベントの運営、および告知・実施報告での紹介に使わせていただきます。
      間違えてご提出された場合は、正しいものをあらためてお送りください（新しいものとして並びます）。
      削除が必要な場合は、担当までご連絡ください。
    </p>
  </div>
</div>

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
  fs.writeFileSync(path.join(ROOT, 'upload.html'), html, 'utf8');
  console.log('  書き出し : upload.html (' + Math.round(html.length / 1024) + 'KB)');
}

if (require.main === module) main();
module.exports = { page };
