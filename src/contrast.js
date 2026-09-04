/**
 * 書き出した画面から、文字と背景のコントラスト比を実測する。
 *
 *   node src/contrast.js index.html 430
 *   node src/contrast.js               … 既定の組み合わせを全部（npm test から呼ばれる）
 *
 * ■ なぜ要るか
 *   ヒーローは「写真 → 半透明の膜 → 文字」の3枚重ねになっている。
 *   このとき文字の実際の背景色は、CSSのどこにも書かれていない。
 *   写真の明るいところと暗いところで違う値になり、
 *   「空の部分だけ 4.5:1 を割る」といったムラは、目では捕まえられない。
 *
 * ■ どう測るか（v2。初版は測り方が間違っていた）
 *   1. ページを組ませ、対象の**文字が実際に占めている矩形**を採る
 *      （要素の枠ではなく Range の行ボックス。段落の右側の空白まで
 *        背景として数えてしまうのを避けるため）
 *   2. 同じページを、対象の文字だけ `color:transparent` にしてもう一度撮る。
 *      **枠線と地は残したまま、字だけを消す**のが要点。
 *      要素ごと隠すと、ボタンの白い地まで消えて「写真を測る」ことになる。
 *   3. その画像の矩形から背景を採り、**いちばん条件の悪い側**で判定する。
 *
 *   初版は「文字色から遠い側25%」を背景としていた。濃い文字に対して
 *   遠い側＝**いちばん明るい画素**なので、ムラがあるとき必ず
 *   「いちばん読みやすい場所」の値を返していた。**検出したいものと向きが逆**だった。
 *
 * ■ 測れなかったものを「合格」にしない
 *   初版は要素が無い・画面の外にあると黙って飛ばし、
 *   それでも「すべて基準を満たしています」と出していた。
 *   実際 360px 幅で「PDFを保存」が測られないまま合格していた。
 *   **測れなかったことは、通ったことではない。**
 *
 * ■ 判定
 *   通常の文字 4.5:1 ／ 大きい文字 3.0:1（24px以上、または太字18.66px以上）
 *   判定には「悪い側25%の平均」を使う。1画素の外れ値で落とさないため。
 *   参考として最悪の1画素も出す。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { findChrome, FONT_WAIT_MS } = require('./build-pdf.js');

/** 検査する場所。ヒーローは膜の上なので全部見る */
const TARGETS = [
  '.hero .en', '.hero .yomi', '.hero .place', '.hero .match',
  '.hero .eyebrow', '.hero .btn-dl', '.hero .supported',
  '.hero-cta .btn',
];

/** 引数なしで呼ばれたときに回す組み合わせ。狭い方と広い方の両方を見る */
const DEFAULT_RUNS = [['index.html', 360], ['index.html', 430], ['index.html', 900]];

/** 相対輝度（WCAG 2.x） */
function luminance(rgb) {
  const f = v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function ratio(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(css) {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
  return (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) ? [p[0], p[1], p[2]] : null;
}

const ENT = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&amp;': '&' };
/** HTMLの実体参照を戻す。&amp; は最後（先に戻すと二重に解ける） */
function unescapeHtml(s) {
  return String(s).replace(/&(?:lt|gt|quot|#39|nbsp|amp);/g, m => ENT[m]);
}

/**
 * 画面の中を調べるスクリプト。
 *
 * 文字を持つ末端まで降りるのが要点。`.hero .match` は中に <b>（水色の面＋濃色文字）を
 * 抱えていて、親の色だけ見ていると **バッジの中の文字が一度も検査されない**。
 */
function probeScript() {
  // 引数 D は調べる対象のドキュメント（iframe の contentDocument）。
  // 親のドキュメントと取り違えると、何も見つからないまま「要素がありません」になる。
  return `function(D){
    var out = [], targets = ${JSON.stringify(TARGETS)};
    function rectsOfText(el){
      var rs = [];
      for (var i = 0; i < el.childNodes.length; i++){
        var n = el.childNodes[i];
        if (n.nodeType !== 3 || !n.nodeValue.replace(/\\s/g, '')) continue;
        var range = D.createRange();
        range.selectNodeContents(n);
        var list = range.getClientRects();
        for (var j = 0; j < list.length; j++){
          var r = list[j];
          if (r.width >= 2 && r.height >= 2) {
            rs.push({ x: Math.round(r.left + D.defaultView.scrollX),
                      y: Math.round(r.top + D.defaultView.scrollY),
                      w: Math.round(r.width), h: Math.round(r.height) });
          }
        }
      }
      return rs;
    }
    targets.forEach(function(sel){
      var els;
      try { els = D.querySelectorAll(sel); }
      catch (e) { out.push({ sel: sel, error: String((e && e.message) || e) }); return; }
      if (!els.length) { out.push({ sel: sel, missing: true }); return; }
      var found = 0;
      Array.prototype.forEach.call(els, function(root, idx){
        var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
        all.forEach(function(el){
          var cs = D.defaultView.getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          var rs = rectsOfText(el);
          if (!rs.length) return;
          found++;
          out.push({
            sel: sel + (els.length > 1 ? '[' + idx + ']' : '')
                 + (el === root ? '' : '>' + el.tagName.toLowerCase()),
            color: cs.color, fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight,
            rects: rs
          });
        });
      });
      if (!found) out.push({ sel: sel, hidden: true });
    });
    document.title = 'PROBE' + JSON.stringify({
      items: out, docHeight: D.documentElement.scrollHeight });
  }`;
}

function chrome(args) {
  return execFileSync(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  ].concat(args), { encoding: 'utf8', maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * 1つの幅について測る。
 * @returns {{lines:string[], failed:number, measured:number}}
 */
function measure(target, width) {
  const targetPath = path.join(ROOT, target);
  if (!fs.existsSync(targetPath)) throw new Error('見つかりません: ' + targetPath);

  // プロファイルと一時ファイルはプロセスごとに分ける。
  // 検証役のエージェントと同時に走ると同じプロファイルを取り合い、
  // Chrome が status 21 で落ちる（原因の分かりにくい形で失敗する）。
  const tag = process.pid + '-' + width;
  const profile = path.join(ROOT, 'build', '.chrome-contrast-' + tag);
  // 画像の相対パス（assets/…）を解決させるため、調べ用のコピーはリポジトリ直下に置く。
  // build/ に置くと assets が1階層ずれて、写真の無い画面を測ることになる。
  const probeAtRoot = path.join(ROOT, '.contrast-probe-' + tag + '.html');
  const shotBg = path.join(ROOT, 'build', 'contrast-bg-' + tag + '.png');

  const lines = [];
  let failed = 0, measured = 0;

  try {
    // ■ 指定した幅で本当に組ませるには、iframe に閉じ込めるしかない
    //   Windows の Chrome はウィンドウを約504pxより細くできない。
    //   --window-size=360 と指定しても **504pxで組んでから360px分を切り取る**ので、
    //   そのまま測ると「誰も見ない組版」の値が出る。
    //   初版はこれに気づかず、360px幅の測定値だと思って504pxの値を出していた。
    //   src/shot.js が同じ理由で iframe を使っている（引き継ぎ書§8）。
    const pageUrl = 'file:///' + targetPath.split(path.sep).join('/');
    const hideCss = '.__ct,.__ct *{color:transparent !important;'
      + 'text-shadow:none !important;-webkit-text-fill-color:transparent !important}';

    // 親から iframe の中を触る。file:// の中の iframe は既定では別オリジン扱いなので、
    // この検査用プロファイルに限って --allow-file-access-from-files を付ける。
    const frame = (ver, h) => [
      '<!doctype html><meta charset="utf-8">',
      '<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}',
      '#clip{overflow:hidden;width:' + width + 'px}',
      'iframe{display:block;border:0;width:' + width + 'px;height:' + h + 'px}</style>',
      '<div id="clip"><iframe id="f" src="' + pageUrl + '"></iframe></div>',
      '<script>window.addEventListener("load",function(){setTimeout(function(){',
      'var D=document.getElementById("f").contentDocument;',
      'var st=D.createElement("style");st.textContent=' + JSON.stringify(hideCss) + ';',
      'D.head.appendChild(st);',
      ver === 'hide'
        ? JSON.stringify(TARGETS) + '.forEach(function(s){try{'
          + 'Array.prototype.forEach.call(D.querySelectorAll(s),function(e){'
          + 'e.classList.add("__ct")})}catch(err){}});document.title="READY";'
        : '(' + probeScript().split('\n').join(' ') + ')(D);',
      '},900)});</script>',
    ].join('');

    const write = (ver, h) => fs.writeFileSync(probeAtRoot, frame(ver, h), 'utf8');
    const url = 'file:///' + probeAtRoot.split(path.sep).join('/');
    const flags = ['--user-data-dir=' + profile, '--allow-file-access-from-files',
                   '--virtual-time-budget=' + FONT_WAIT_MS];

    // 1) 位置と文字色を採る（iframe の中の座標。iframe は親の (0,0) にあるので、
    //    そのまま撮影画像の座標として使える）
    write('probe', 1400);
    const dom = chrome(flags.concat(['--window-size=900,1200', '--dump-dom', url]));
    const m = dom.match(/<title>PROBE(.*?)<\/title>/s);
    if (!m) throw new Error('画面から情報を取れませんでした（iframe の中を読めていません）');
    const info = JSON.parse(unescapeHtml(m[1]));

    // ページ全体が入る高さで撮る。固定高だと、狭い幅でヒーローが伸びたときに
    // 下の要素が「画面の外」になり、測らないまま合格していた。
    const height = Math.min(Math.max(info.docHeight, 1400), 16000);

    // 2) 字だけ消した画面（枠線と地は残る）を、同じ幅・同じ高さで撮る
    write('hide', height);
    chrome(flags.concat(['--window-size=' + width + ',' + height,
                         '--screenshot=' + shotBg, url]));

    const { PNG } = require('pngjs');
    const png = PNG.sync.read(fs.readFileSync(shotBg));

    info.items.forEach(it => {
      const fail = why => { failed++; lines.push('  ✖  ' + it.sel.padEnd(26) + why); };

      if (it.error)   return fail('セレクタが不正です：' + it.error);
      if (it.missing) return fail('要素がありません（検査できていません）');
      if (it.hidden)  return fail('この幅では文字が出ていません（意図的なら TARGETS から外すこと）');

      const fg = parseColor(it.color);
      if (!fg) return fail('文字色を読み取れません：' + it.color);

      const px = [];
      let outside = false;
      it.rects.forEach(r => {
        if (r.y + r.h > png.height || r.x + r.w > png.width) outside = true;
        for (let y = r.y; y < Math.min(r.y + r.h, png.height); y++) {
          for (let x = r.x; x < Math.min(r.x + r.w, png.width); x++) {
            const i = (png.width * y + x) << 2;
            px.push([png.data[i], png.data[i + 1], png.data[i + 2]]);
          }
        }
      });
      if (!px.length) return fail(outside ? '画面の外にあり、測れていません'
                                          : '文字の矩形を採れませんでした');

      // **悪い側**で判定する。ここを「良い側」にすると、ムラがあるとき
      // 必ず一番読みやすい場所の値が出る（初版の誤り）。
      const byRatio = px.map(p => ({ p, r: ratio(fg, p) })).sort((a, b) => a.r - b.r);
      const worst = byRatio.slice(0, Math.max(1, Math.floor(byRatio.length * 0.25)));
      const got = worst.reduce((s, o) => s + o.r, 0) / worst.length;
      const min = byRatio[0].r;
      const bg = [0, 1, 2].map(c => Math.round(
        worst.reduce((s, o) => s + o.p[c], 0) / worst.length));

      const big = it.fontSize >= 24 || (it.fontSize >= 18.66 && Number(it.fontWeight) >= 700);
      const need = big ? 3.0 : 4.5;
      const ok = got >= need;
      if (!ok) failed++;
      measured++;

      const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      lines.push('  ' + (ok ? '✓' : '✖') + '  ' + it.sel.padEnd(26)
        + got.toFixed(2).padStart(6) + ':1  (要 ' + need.toFixed(1) + ')'
        + '  最悪 ' + min.toFixed(2).padStart(5)
        + '  文字' + hex(fg) + ' / 背景' + hex(bg)
        + '  ' + it.fontSize + 'px' + (big ? '・大' : ''));
    });
  } finally {
    // 途中で落ちてもリポジトリ直下に残さない
    try { fs.rmSync(probeAtRoot, { force: true }); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(shotBg, { force: true }); } catch (e) {}
  }

  return { lines, failed, measured };
}

function main() {
  const runs = process.argv[2]
    ? [[process.argv[2], Number(process.argv[3] || 430)]]
    : DEFAULT_RUNS;

  let failed = 0;
  runs.forEach(([target, width]) => {
    console.log('コントラストの実測  ' + target + '  幅' + width + 'px'
      + '  （通常 4.5:1／大きい文字 3.0:1／悪い側25%で判定）');
    const r = measure(target, width);
    r.lines.forEach(l => console.log(l));
    if (!r.measured) { console.log('  ✖  1件も測れていません'); failed++; }
    failed += r.failed;
    console.log('');
  });

  if (failed) {
    console.error('✖ ' + failed + '件が基準を満たしていないか、測れていません。');
    process.exit(1);
  }
  console.log('すべて基準を満たしています');
}

if (require.main === module) main();
module.exports = { luminance, ratio, parseColor, unescapeHtml, measure, TARGETS, DEFAULT_RUNS };
