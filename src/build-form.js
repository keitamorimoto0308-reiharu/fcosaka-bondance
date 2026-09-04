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
const IMG = require('./imgsize.js');
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
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
@media (min-width:400px){ .wrap{padding:0 24px} }
/* .wrap と同じ要素に付くクラスは、上下だけを指定すること。
   padding の一括指定は4辺すべてを書き換えるため、左右の余白が0に潰れる。 */
.ic{flex:none;stroke:currentColor}

/* ── 主催表記（ヒーローの右上）
   ヘッダーは廃止した。ヒーローの h1 がロゴそのものになったので、
   上に小さなロゴをもう一枚置いても、同じ絵が2回出るだけだった（けいた判断）。
   ロゴ自体が FC大阪 と みんな電力 を含むので、ここでロゴは再掲しない。
   主催者の正式名（UPDATER）はロゴに入っていないため、文字でだけ補う。 */
/* 区切りの「／」も同じ理由で墨色にする（430px で 4.28:1 だった）。
   小さい文字ほど写真の濃淡に負けやすい。 */
.supported{margin:0;display:flex;align-items:center;gap:var(--s2);
  font-size:11px;color:var(--ink);white-space:nowrap}
/* --ink-faint(#9A928F) は白地で 2.98:1。10px の文字には使えない。
   ヘッダーにあった頃から不足していたが、旧の実測ツールでは見えていなかった */
.supported .label{font-size:10px;letter-spacing:.14em;color:var(--ink-muted)}
.supported b{font-weight:700;color:var(--ink)}

/* ── 1. ヒーロー：白い膜。ロゴそのものを見出しにする面
 *
 * ■ なぜ濃色をやめたか（けいた判断・2026-09-01）
 *   支給ロゴのロゴタイプ（F.C.☆OSAKA）は墨色 #221816 で、濃い面では消える。
 *   濃色のままだとエンブレム単体しか置けず、ロゴの文字部分を
 *   テキストで打ち直すことになっていた（＝同じ文言がロゴと本文で二重）。
 *   膜を白にすると、ロゴをまるごと置けるようになり、打ち直しが要らなくなる。
 *
 * ■ 白にすると、色の役割が全部入れ替わる
 *   ブランド水色 #7FCAF1 は白に対して 1.81:1 しかない（theme.js の注記）。
 *   濃色時代は「水色の文字」で成立していたが、白の上ではまったく読めない。
 *   白の上では **文字は墨色（9.58:1）、水色は面（バッジ・ボタンの地）** に役割を移す。
 *   直下のファクト帯は濃色のままなので、明→暗の対比でリズムも出る。
 *
 * ■ 写真の上の文字は、目分量で決めない
 *   膜の不透明度は「写真が見える」と「文字が読める」の綱引きになる。
 *   空の明るい部分だけ比が落ちる、といったムラは目では捕まえられない。
 *   src/contrast.js が、書き出した画像から実際の背景を拾って比を出す。
 */
.hero{position:relative;background:var(--white);overflow:hidden;isolation:isolate}
.hero-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;
  /* 元の写真は空が明るく芝が濃い。そのまま膜をかけても濃淡が残り、
     文字の背後だけコントラストが落ちる。明度を上げて振れ幅を圧縮しておく */
  filter:brightness(1.12) saturate(.88)}
/* 白の膜。**2枚重ね**にしている（けいた指示：もっと薄く、濃淡のあるグラデーションに）。
 *
 *   1枚目（radial）… 文字が乗る左上を中心にした「光だまり」。
 *                     ここだけ白を濃く保ち、外へ向かって一気に抜く。
 *   2枚目（linear）… 全体にかける薄い霞。写真の色が強く出すぎるのを抑える。
 *
 * 1枚の直線グラデーションだと、「文字の下は濃く」と「右下は抜く」が両立しない。
 * 直線は端から端へ一様に変わるので、右下を抜いた分だけ文字の下も薄くなる。
 * 中心を持てる radial なら、抜きたい角と守りたい面を別々に決められる。
 *
 * ■ 抜ける量は幅で変える必要がある
 *   広い画面は文字が左半分に収まるので、右を大きく抜ける。
 *   狭い画面は文字が幅いっぱいに広がるので、同じだけ抜くと文字の背後が薄くなる。
 *   下の @media で狭い画面用にやり直している。数値は src/contrast.js の実測で決めた。 */
.hero::before{content:'';position:absolute;inset:0;z-index:-1;
  background:
    radial-gradient(148% 128% at 8% 44%,
      rgba(255,255,255,.94) 0%, rgba(255,255,255,.90) 32%,
      rgba(255,255,255,.76) 56%, rgba(255,255,255,.46) 80%,
      rgba(255,255,255,.14) 100%),
    linear-gradient(160deg, rgba(255,255,255,.34) 0%, rgba(255,255,255,.10) 100%)}
/* 和文様。ASANOHA は**白い細線**なので、白い膜の上では文様として成立しない。
   検証役が実測したところ、有りと無しで1画素も差が出なかった。
   濃色ヒーロー時代の資産をそのまま残していた。
   ここでは墨色に染めて、ごく薄く敷く（白線のままなら消したほうがまし）。 */
.hero::after{content:'';position:absolute;inset:0;z-index:-1;opacity:.05;
  background-image:var(--asanoha);background-size:40px 70px;
  filter:invert(1) brightness(.16)}
.hero-inner{position:relative;z-index:1;padding-top:var(--s5);padding-bottom:var(--s6)}
/* ヘッダーを廃したので、この行がページの一番上になる。
   左に「出店者募集」、右に主催表記。狭い画面でも実測で収まる（約210px） */
.hero-top{display:flex;align-items:center;justify-content:space-between;
  gap:var(--s3);flex-wrap:wrap;margin:0 0 var(--s5)}
.hero .eyebrow{display:inline-block;font-size:11px;letter-spacing:.18em;font-weight:700;
  background:var(--brand);color:var(--ink);padding:6px 12px;border-radius:99px;margin:0}

/* ■ ロゴが見出し（h1）そのもの
 *   ロゴの中に「F.C.☆OSAKA／秋のサステナ盆踊り／presented by みんな電力」が
 *   図案として入っている。同じ文言をテキストで隣に置くと二重になる（けいた指摘）。
 *   ただし画像だけの h1 は、検索エンジンにも読み上げにも主題が伝わらない。
 *   **h1 の中に画像を置き、alt にイベント名を持たせる**ことで、
 *   見た目からは文字を消しつつ、機械には残す。
 *
 *   狭い画面は縦組み（エンブレムが上・文字が下／縦横比 0.71）、
 *   広い画面は横組み（エンブレムが左・文字が右／2.87）に入れ替える。
 *   1枚で通すと、どちらかの幅で文字が読めない大きさになる。 */
/* ロゴの背後だけ白を敷く。
   スタジアムの照明塔とスタンド屋根の白い線が、ちょうど「盆踊り」の真後ろを
   通っていた（390〜500px幅）。水色の文字と照明塔の比は 1.23:1 で、
   ロゴが構造物に串刺しにされて見える。
   **ロゴは WCAG の対象外なので、文字のコントラスト実測では検出できない。**
   角のある白いプレートを敷くと箱に見えるので、輪郭の出ない放射状のぼかしにする。
   closest-side なので、ロゴの大きさが変わっても追随する。 */
.hero h1{margin:0 0 var(--s4);width:max-content;max-width:100%;
  background:radial-gradient(closest-side at 50% 50%,
    rgba(255,255,255,.94) 0%, rgba(255,255,255,.88) 62%, rgba(255,255,255,0) 100%)}
.hero h1 img{display:block;height:auto}
/* 380px以上で 228px 固定だと、599px あたりで右の6割が空の写真になって間延びする。
   clamp で中間の幅でも育つようにし、600px の切り替わりの段差も緩める。 */
.hero .logo-stack{width:clamp(196px,46vw,300px)}
/* 「夕照」を「せきしょう」と読まれる。営業が口で言えないと困る（決定 G14）。
   ロゴの中の YŪSHŌ-SAI は小さすぎて読ませられないので、1行だけ添える */
.hero .yomi{margin:0 0 var(--s4);font-size:12px;letter-spacing:.2em;color:var(--ink-muted)}
/* --ink-faint(#9A928F) だと白い膜の上で 2.95:1 しかなく、基準（4.5:1）を割る。
   濃色時代は水色で 8:1 あった文字なので、白に変えた影響がここに出た。
   src/contrast.js の実測で検出。--ink-muted に上げて 5.5:1 前後にする */
.hero .en{font-family:${T.fontDisp};font-size:14px;letter-spacing:.34em;
  color:var(--ink-muted);margin:0 0 var(--s3)}
.hero .place span{display:block}
.hero .place{margin:0;font-size:16px;font-weight:700;color:var(--ink)}
.hero .match b{display:inline-block;background:var(--brand);color:var(--ink);
  font-family:${T.fontDisp};font-size:19px;letter-spacing:.04em;padding:2px 12px;margin-right:10px;
  vertical-align:1px}
.hero .match span{display:inline-block}
/* 膜を薄くした結果、写真の暗い部分にかかる幅（実測430px）で 4.24:1 まで落ちた。
   マスクは薄いまま保ちたいので、文字側を濃くして写真の濃淡に依存しなくする。 */
.hero .match{margin:var(--s2) 0 0;font-size:13px;color:var(--ink)}
/* 白地なので下線リンクも墨色にする。白のままだと消える */
.btn-dl{display:inline-flex;align-items:center;gap:6px;color:var(--ink);font-size:13px;
  text-decoration:underline;text-underline-offset:3px;padding:8px 4px;white-space:nowrap}
.btn-dl:hover{opacity:.7}
.hero-cta{display:flex;gap:var(--s3);flex-wrap:wrap;margin-top:var(--s5)}
@media (min-width:600px){
  /* picture が横組みに差し替わる。縦横比が変わるので幅も指定し直す */
  .hero .logo-stack{width:min(440px,56%)}
  .hero-inner{padding-top:var(--s7);padding-bottom:var(--s7)}
}

/* ── 2. ファクト帯：数字が主役。濃色の面に水色の数字（コントラスト 8:1） */
.facts{background:var(--ink);color:var(--white)}
.facts-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:rgba(255,255,255,.14)}
.egrid{margin:18px 0 0;text-align:left}
.eg-label{display:block;font-size:13px;font-weight:700;margin:14px 0 6px}
#eg-mail{width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:8px;
  font-size:16px;font-family:inherit}
.idblocks{display:flex;align-items:center;gap:8px}
.idprefix{font-family:${T.fontDisp};font-size:22px;letter-spacing:.04em;color:var(--ink-muted)}
.idbox{width:46px;height:56px;text-align:center;font-size:24px;font-family:${T.fontDisp};
  border:1px solid var(--border);border-radius:8px;background:var(--white);color:var(--ink)}
.idbox:focus{outline:2px solid var(--brand);outline-offset:1px;border-color:var(--brand)}
.eg-hint{margin:10px 0 0;font-size:12.5px;color:var(--ink-muted);line-height:1.8}
.edit-entry{margin:14px 0 0;font-size:13px;color:var(--ink-muted);line-height:1.9}
/* フォードの先頭に置くほう。読み飛ばされないよう、面を敷いて区別する */
.edit-entry-top{margin:0 0 16px;padding:11px 14px;background:var(--bg-subtle);
  border-left:3px solid var(--brand);border-radius:0 6px 6px 0}
.linkbtn{background:none;border:0;padding:0;font:inherit;color:var(--link,#2b6f95);
  text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.changed-list{text-align:left;margin:10px auto 0;max-width:32em;font-size:14px;line-height:2}
.editing-banner{background:#B5714C;color:#fff;padding:12px 0}
.editing-banner p{margin:0;font-size:13.5px;line-height:1.9}
.editing-banner .rc{font-weight:700;margin:0 8px}
.applied-banner{background:var(--ink);color:#fff;padding:12px 0}
.applied-banner p{margin:0;font-size:13.5px;line-height:1.9}
.applied-banner .rc{display:inline-block;margin:0 10px;font-weight:700;color:var(--brand)}
.applied-banner a{color:#fff;text-decoration:underline;text-underline-offset:3px}
/* 受付が済んだあとは、応募へ誘う導線を出さない（二度送りを防ぐ） */
body.applied .hero-cta .btn-brand{display:none}
.done-back{margin:22px 0 0}
.fact{background:var(--ink);padding:var(--s5) var(--s3);text-align:center}
.fact .lb{font-size:11px;letter-spacing:.12em;color:#B9B3B0;margin:0 0 var(--s2)}
.fact .bg{font-family:${T.fontDisp};font-size:38px;line-height:1;color:var(--brand);
  letter-spacing:.02em;font-variant-numeric:tabular-nums}
.fact .sm{font-family:${T.fontDisp};font-size:16px;color:var(--brand);opacity:.85;margin-left:2px}
.fact .nt{font-size:11px;color:#B9B3B0;margin:var(--s2) 0 0;line-height:1.6}

/* ── 3. 募集要項：アコーディオン */
.section{padding-top:var(--s8);padding-bottom:var(--s8)}
.sec-head{display:flex;align-items:baseline;gap:var(--s3);margin:0 0 var(--s5)}
.sec-head h2{margin:0;font-size:22px;font-weight:700;letter-spacing:.02em}
.sec-head .en{font-family:${T.fontDisp};font-size:13px;letter-spacing:.2em;color:var(--ink-faint)}
.notice-closed{margin:0 0 var(--s5);font-size:12.5px;line-height:1.8;color:var(--ink-muted);
  border-left:3px solid var(--brand);padding-left:var(--s3)}
.lead-note{margin:0 0 var(--s5);font-size:13.5px;line-height:1.85;color:var(--ink-muted)}

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
/* ⚠ 白い面では使わないこと。水色の文字は白地に対して 1.81:1 で読めない。
   濃色の面（フッター等）専用。ヒーローで使っていないことをテストが検査する。 */
.btn-ghost{background:transparent;color:var(--brand);border:1.5px solid var(--brand)}
.btn-ghost:hover{background:rgba(127,202,241,.14)}
.btn-brand{background:var(--brand);color:var(--ink);box-shadow:0 2px 0 var(--brand-deep)}
.btn-brand:hover{filter:brightness(1.05)}
.btn-ghost-dark{background:transparent;border:1.5px solid var(--ink);color:var(--ink)}
/* 白地に水色の枠、文字は墨色（けいた指示「背景白の水色文字」）。
   **文字まで水色にはできない。** 水色 #7FCAF1 は白に対して 1.81:1 で、
   ボタンの文字としては読めない（theme.js の注記・src/contrast.js の実測）。
   水色は枠と影で出し、可読性は文字色で担保する。
   地の白は写真に埋もれないよう不透明にする（半透明だと下の芝が透けて濁る）。 */
.btn-outline-brand{background:var(--white);border:2px solid var(--brand);color:var(--ink);
  box-shadow:0 2px 0 rgba(47,143,196,.28)}
.btn-outline-brand:hover{background:var(--brand-pale);border-color:var(--brand-deep)}
.btn-ghost-dark:hover{background:var(--ink);color:#fff}
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
.choice .rental-note{display:block;font-size:11.5px;color:var(--ink-muted);margin-top:2px}
.rental-price{margin-top:2px}
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
.after-submit{margin:14px 0 0;font-size:13px;line-height:1.75;color:var(--ink-muted);
  background:var(--bg-subtle);border-left:3px solid var(--brand);padding:12px 14px}
.submit-note{font-size:13px;color:var(--ink-muted);margin:var(--s3) auto 0;
  max-width:32em;line-height:1.85}
.form-error{display:none;background:#FDF4F3;border:1px solid var(--error);color:var(--error);
  border-radius:10px;padding:var(--s4);margin:0 0 var(--s4);font-size:14px;font-weight:700}
.form-error.show{display:block}
#confirm-box{background:var(--brand-pale);border:1px solid var(--brand);border-radius:var(--r);
  padding:var(--s4);margin:0 0 var(--s3)}
#confirm-box h4{margin:0 0 var(--s3);font-size:14px}

/* ── 完了・受付終了 */
.notice-page{padding-top:var(--s8);padding-bottom:var(--s8);text-align:center}
.notice-page .mark{width:64px;height:64px;border-radius:50%;background:var(--brand);
  margin:0 auto var(--s4);display:grid;place-items:center;color:var(--ink)}
.notice-page h2{font-size:21px;margin:0 0 var(--s3)}
.notice-page p{max-width:34em;margin-left:auto;margin-right:auto;line-height:1.9}
.receipt{display:inline-block;margin:var(--s4) 0;padding:var(--s4) var(--s6);background:var(--bg-subtle);
  border-radius:var(--r);border:2px solid var(--brand)}
.receipt .num{font-family:${T.fontDisp};font-size:36px;letter-spacing:.06em;display:block;line-height:1.1}
.receipt .cap{font-size:11px;color:var(--ink-muted);letter-spacing:.12em}

footer{background:var(--ink);color:#CFC9C6;padding:var(--s6) 0 var(--s7);font-size:13px}
footer a{color:var(--brand)}
/* 下線をベースラインから離す。重なるとアンダースコアが空白に見えて、
   fcosaka_bondance@… を「fcosaka bondance@…」と読み違える。
   **見たまま打っても届かない**。ファイル名でも同じことが起きる */
a{text-underline-offset:3px}
footer .org{color:var(--white);font-weight:700;margin:0 0 var(--s2)}

@media (min-width:600px){
  .hero-inner{padding-top:var(--s8);padding-bottom:var(--s7)}
  /* 6項目なので3列×2段。4列だと 4+2 に割れて右下が空く（PDFも3列×2段） */
  .facts-grid{grid-template-columns:repeat(3,1fr)}
  .fact .bg{font-size:44px}
}
@media (max-width:380px){
  .fact .bg{font-size:32px}
  .kv>div{grid-template-columns:1fr;gap:0}
}
/* ── 印刷
 * ■ 写真は消すこと
 *   ヒーローは「写真（<img>）＋白い膜（CSSの背景）」で成り立っている。
 *   ブラウザは既定で**背景を印刷しない**ので、膜だけが消えて写真が残る。
 *   その結果、青空と芝の上に濃色の文字が乗り、ほぼ読めない紙が出てくる。
 *   画面では正常なので、刷ってみるまで誰も気づかない。
 *   紙では写真も膜も要らない（白地に墨色のロゴが、むしろ紙に向いている）。
 *
 * ■ 濃色の面も同じ理由で反転する
 *   ファクト帯は「濃色の地＋水色の数字」。地が印刷されないと
 *   白地に水色の数字だけが残り 1.81:1 になる。紙では墨色に落とす。 */
@media print{
  .form-section,.submit-area,.sticky-cta,.hero-cta{display:none}
  .acc-body{display:block!important}
  .hero-photo{display:none}
  .hero::before,.hero::after{display:none}
  .hero{background:#fff}
  .facts{background:#fff;color:var(--ink)}
  .facts-grid{background:var(--border)}
  .fact .bg,.fact .sm,.fact .lb{color:var(--ink)}
  .fact .nt{color:var(--ink-muted)}
  footer{background:#fff;color:var(--ink)}
  footer .org,footer a{color:var(--ink)}
}`;
}

// ─────────────────────────────────────────── 各パート
function renderHero() {
  return `
  <section class="hero">
    <img class="hero-photo" src="assets/stadium.webp" alt="" width="1920" height="1005" fetchpriority="high">
    <div class="wrap hero-inner">
      <div class="hero-top">
        <span class="eyebrow">出店者募集</span>
        <p class="supported"><span class="label">主催</span><b>FC大阪</b>／<b>UPDATER</b></p>
      </div>
      <p class="en">${esc(C.EVENT.nameEn)}</p>
      <!-- ロゴが見出しそのもの。文字はロゴの中にあるので、テキストで打ち直さない。
           alt にイベント名を持たせて、検索エンジンと読み上げには残す。
           狭い画面＝縦組み／広い画面＝横組み（CSSで入れ替え）。 -->
      <h1>
        <picture>
          <source media="(min-width:600px)" srcset="${esc(C.BRAND.logoWide)}"
                  ${IMG.sizeAttrs(C.BRAND.logoWide)}>
          <img class="logo-stack" src="${esc(C.BRAND.logoBox)}" alt="${esc(C.EVENT.name)}"
               ${IMG.sizeAttrs(C.BRAND.logoBox)} fetchpriority="high">
        </picture>
      </h1>
      <p class="yomi">${esc(C.EVENT.titleMain)}／${esc(C.EVENT.titleYomi)}</p>
      <p class="place"><span>${esc(C.EVENT.date)}</span><span>${esc(C.EVENT.venueShort)}</span></p>
      <p class="match"><b>KICK OFF 14:00</b><span>${esc(C.EVENT.match)}</span></p>
      <div class="hero-cta">
        <a class="btn btn-brand" href="#form-area" data-scroll>応募フォームへ</a>
        ${PDF_EXISTS ? `<a class="btn btn-outline-brand" href="assets/${PDF_FILE}" target="_blank" rel="noopener">募集要項PDFを見る</a>
        <a class="btn-dl" href="assets/${PDF_FILE}" download>PDFを保存</a>` : ''}
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
      ? `\n          <p class="pending hidden" data-price-note>単価：調整中（確定しだいご案内します）</p>` : '';
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
    if (f.type === 'rental') {
      // 中身は台帳の「レンタル品目」シートで決まるので、ここでは器だけ置く。
      // 取得できるまでは何も出さない（空の欄が出て「壊れている」と見えないように）
      return `<div class="field" data-field="${f.key}">
        <div data-rental-items></div>
        <p class="inline-note" data-rental-loading>レンタル備品を読み込んでいます…</p>
        <p class="err" data-err="${f.key}"></p>
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

var SPACE_SIZE = ${JSON.stringify(S.SPACE_SIZE)};
var TENT_SIZE = ${JSON.stringify(S.TENT_SIZE)};
${S.crossChecks.toString()}

var FIELDS = ${JSON.stringify(APPLY_FIELDS)};
var GAS_URL = ${JSON.stringify(ENDPOINT.gasUrl || '')};
// GASに接続できないとき（表示確認用ページなど）に使う仮単価。
// 本番では設定シートの値で必ず上書きされる。
var FALLBACK_PRICES = ${JSON.stringify(C.PRICES)};
var CFG = { prices:FALLBACK_PRICES, closed:false, deadline:'', contact:'', staff:[] };
var submissionId = (function(){
  try { return crypto.randomUUID(); }
  catch(e){ return 'sid-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
})();

/**
 * 画面側のHTMLエスケープ。
 *
 * ビルド時（Node側）にも同名の esc があるが、あちらは生成物には入らない。
 * 実行時に文字列を組み立てる場所で呼ぶと ReferenceError になり、
 * **そこから後ろの処理が全部止まる**。
 * 実際、レンタル欄の描画で落ちて担当社員の選択肢まで空になり、
 * 必須項目が埋まらず誰も応募できない状態になっていた。
 */
function esc(v){
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
    var show = !heroVisible && !formVisible && !CFG.closed && !SUBMITTED;
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
  // 数量で頼む備品は、品目シートで決まるので FIELDS からは作れない。
  // { 品目名: 個数 } の形でそのまま送り、金額はサーバー側で計算し直す
  // （画面から送られた単価は信じない）。
  v.rentalItems = collectRentalQty();
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
  // 項目どうしの食い違い（希望区画にテントが収まるか など）。
  // サーバーと同じ関数なので、画面で通ったものがサーバーで弾かれることがない。
  crossChecks(v).forEach(function(e){ errs.push(e); });
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
    // 画面に無い項目のエラーが返ってくると、赤くする先が無く、
    // 利用者から見ると「押しても何も起きない」ことになる。
    // 実際にそれが起きたので、出せなかったときは文章で伝える。
    var shown = errs.filter(function(e){ return $('[data-field="'+e.key+'"]'); });
    box.textContent = shown.length
      ? '入力内容に' + shown.length + '件の不備があります。赤く表示された項目をご確認ください。'
      : '送信できませんでした（' + errs.map(function(e){ return e.message; }).join(' ')
        + '）。お手数ですが、実行委員会までご連絡ください。';
    box.classList.add('show');
    if (!shown.length){ box.scrollIntoView({ behavior:'smooth', block:'center' }); return; }
    var first = $('[data-field="'+shown[0].key+'"]');
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
/**
 * 数量で頼む備品の欄を、取得した品目の一覧から作る。
 * 品目が増えても、ここは触らなくてよい。
 */
function renderRentalItems(){
  var box = $('[data-rental-items]');
  if (!box) return;
  var items = CFG.rentalItems || [];
  var loading = $('[data-rental-loading]');

  if (!items.length){
    box.innerHTML = '';
    if (loading){
      loading.textContent = 'ご用意しているレンタル備品はありません。';
      loading.classList.remove('hidden');
    }
    return;
  }
  box.innerHTML = items.map(function(it, i){
    var id = 'rq' + i;
    return '<div class="rental-row">'
      + '<div><span class="rental-name">' + esc(it.name) + '</span>'
      + '<span class="rental-price">単価：' + Number(it.price).toLocaleString('ja-JP') + '円</span>'
      + (it.note ? '<span class="rental-note">' + esc(it.note) + '</span>' : '')
      + '</div>'
      + '<input type="number" id="' + id + '" data-rental-qty="' + esc(it.name) + '"'
      + ' min="0" max="' + Number(it.max) + '" value="0" inputmode="numeric"'
      + ' aria-label="' + esc(it.name) + 'の数量（単位：' + esc(it.unit) + '）">'
      + '</div>';
  }).join('');

  // 隠すのは描き終わってから。先に隠すと、描画で落ちたときに
  // 欄も文言も無い、ただの空白になる（壊れていることが誰にも分からない）
  if (loading) loading.classList.add('hidden');
}

/** 画面で入力された数量を { 品目名: 個数 } で集める */
function collectRentalQty(){
  var out = {};
  $$('[data-rental-qty]').forEach(function(el){
    var n = Math.floor(Number(el.value) || 0);
    if (n > 0) out[el.getAttribute('data-rental-qty')] = n;
  });
  return out;
}

function updateRental(){
  var p = CFG.prices || {};
  var v = collect();
  var map = { tentT1: p.tentT1, tentT2: p.tentT2 };

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

  var priceOf = {};
  (CFG.rentalItems || []).forEach(function(it){ priceOf[it.name] = it.price; });
  var qty = collectRentalQty();
  Object.keys(qty).forEach(function(name){
    any = true;
    var unit = priceOf[name];
    if (unit == null){ known = false; return; }
    total += unit * qty[name];
  });

  // 単価が入っているかどうかで、募集要項側の「調整中」の出し方を変える。
  // 単価を入れたのに「調整中」が残っている、という状態を作らない
  var priced = (p.tentT1 != null) && (p.tentT2 != null)
            && (CFG.rentalItems || []).length > 0;
  $$('[data-price-note]').forEach(function(n){ n.classList.toggle('hidden', priced); });

  var el = $('[data-rental-total]'), note = $('[data-rental-note]');
  if (!el) return;
  if (!any){ el.textContent = '—'; note.textContent = 'レンタルをご希望の備品を選択してください。'; }
  else if (!known){ el.textContent = '—'; note.textContent = '単価が確定しだい、合計金額が表示されます。'; }
  else { el.textContent = total.toLocaleString('ja-JP') + '円'; note.textContent = '概算です。確定金額は別途ご案内します。'; }
}

/**
 * 担当社員プルダウン。取得に失敗してもフォームは止めない。
 * 文言は src/schema.js の unknownOption が正。ここに直書きすると、
 * 片方だけ変えたときに**サーバーが受け付けない値を画面が出す**
 * （gas/Api.gs は unknownOption を許可リストに入れている）。
 */
var STAFF_FALLBACK = ${JSON.stringify(
  S.FIELDS.find(f => f.key === 'fcosakaStaff').unknownOption)};
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
  if (!GAS_URL){
    // 表示確認用のページ。品目が取れないので、器だけ畳んでおく
    CFG.rentalItems = [];
    try { renderRentalItems(); } catch (e) {}
    setupStaff([]); updateRental(); return;
  }
  fetch(GAS_URL + '?action=formConfig', { method:'GET' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || !d.ok) throw new Error('bad config');
      CFG = d;
      // 設定シートが空欄の単価だけ、仮単価で補う
      CFG.prices = CFG.prices || {};
      Object.keys(FALLBACK_PRICES).forEach(function(k){
        if (CFG.prices[k] == null) CFG.prices[k] = FALLBACK_PRICES[k];
      });
      CFG.rentalItems = CFG.rentalItems || [];
      // ここで落ちても、担当社員の選択肢や問い合わせ先の差し替えは続ける。
      // 担当社員は必須項目なので、道連れにすると誰も応募できなくなる
      try { renderRentalItems(); } catch (e) {}
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
    .catch(function(){
      CFG.rentalItems = CFG.rentalItems || [];
      try { renderRentalItems(); } catch (e) {}
      setupStaff([]); updateRental();
    });
}

function showClosed(){
  $('#form-area').classList.add('hidden');
  $('#closed-area').classList.remove('hidden');
  var cta = $('#sticky-cta'); if (cta) cta.classList.remove('show');
  document.body.classList.remove('cta-on');
}

/**
 * 応募が受け付けられたあとの画面まわり。
 *
 * ■ なぜ「戻る」を素直に作らないか
 *   完了画面から入力画面へそのまま戻せると、同じ方が二度送れてしまう。
 *   受付IDは発行済みなので、二通目は台帳に別の行として増える。
 *   そこで戻り先は**募集要項だけ**にし、入力欄は伏せたままにする。
 *   代わりに受付済みであることと受付IDを、画面の先頭に出し続ける。
 */
var SUBMITTED = false;   // 受付が済んだか（応募ボタン類を出さない判断に使う）
var RECEIPT   = '';      // 受付ID。募集要項に戻ってもここから読み直せる
var donePushed = false;  // 履歴に完了画面を積んだか（ブラウザバックの受け皿）

function showDone(receiptId, mailWarning){
  SUBMITTED = true;
  if (receiptId) RECEIPT = receiptId;

  $('#form-area').classList.add('hidden');
  $('#intro-area').classList.add('hidden');
  $('#applied-banner').classList.add('hidden');
  var cta = $('#sticky-cta'); if (cta) cta.classList.remove('show');
  document.body.classList.remove('cta-on');
  document.body.classList.add('applied');
  $('#done-area').classList.remove('hidden');
  $('#receipt-number').textContent = RECEIPT;
  var ar = $('#applied-receipt'); if (ar) ar.textContent = RECEIPT;
  if (mailWarning) $('#mail-warning').classList.remove('hidden');

  // ブラウザの「戻る」で募集要項に戻れるよう、履歴を1つ積む。
  // 使えない環境でも画面内のボタンで戻れるので、失敗しても黙って進める。
  if (!donePushed) {
    try { history.pushState({ bondance:'done' }, ''); donePushed = true; } catch (e) {}
  }
  window.scrollTo({ top:0, behavior:'smooth' });
}

/** 募集要項だけを見せる状態。入力欄は伏せたまま。 */
function showIntroOnly(){
  $('#done-area').classList.add('hidden');
  $('#form-area').classList.add('hidden');
  $('#intro-area').classList.remove('hidden');
  $('#applied-banner').classList.remove('hidden');
  var ar = $('#applied-receipt'); if (ar) ar.textContent = RECEIPT;
  window.scrollTo({ top:0 });
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
  fillForm(d.v);
  var note = $('#draft-note');
  if (note){ note.textContent = '前回の入力内容を復元しました'; note.classList.remove('hidden'); }
}

/**
 * 値をフォームに書き戻す。下書きの復元と、応募済み情報の修正で共有する。
 * 片方だけ直すとズレるので、1か所にまとめている。
 */
function fillForm(v){
  FIELDS.forEach(function(f){
    var val = v[f.key];
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
    if (f.unknownCheckbox && v[f.unknownCheckbox.key] !== undefined){
      var u = document.getElementById(f.unknownCheckbox.key);
      if (u) u.checked = !!v[f.unknownCheckbox.key];
    }
  });

  // レンタルの数量。欄は取得後に作られるので、まだ無いこともある
  var q = (v.rentalItems && typeof v.rentalItems === 'object') ? v.rentalItems : {};
  $$('[data-rental-qty]').forEach(function(el){
    el.value = Number(q[el.getAttribute('data-rental-qty')] || 0);
  });

  applyVisibility(); updateRental(); renderConfirm();
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

// ─────────────────────────── 応募済み情報の修正
/**
 * 修正中かどうか。ここが立っていると、送信は「新しい応募」ではなく
 * 「既存の上書き」になる。取り違えると、同じ会社の応募が2件立つ。
 */
var EDIT = { on: false, token: '', receiptId: '' };

function showEditGate(){
  $('#intro-area').classList.add('hidden');
  $('#form-area').classList.add('hidden');
  $('#done-area').classList.add('hidden');
  $('#edit-done').classList.add('hidden');
  var cta = $('#sticky-cta'); if (cta) cta.classList.remove('show');
  document.body.classList.remove('cta-on');
  $('#edit-gate').classList.remove('hidden');
  editError('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  var m = $('#eg-mail'); if (m) m.focus();
}

function closeEditGate(){
  $('#edit-gate').classList.add('hidden');
  $('#intro-area').classList.remove('hidden');
  $('#form-area').classList.remove('hidden');
  window.scrollTo({ top: 0 });
}

/** 受付IDのブロック入力。1文字入れたら次へ、消したら前へ戻る */
function wireIdBlocks(){
  var boxes = $$('.idbox');
  if (!boxes.length) return;
  boxes.forEach(function(box, i){
    box.addEventListener('input', function(){
      // 数字以外は受け付けない
      var v = box.value.replace(/[^0-9]/g, '');
      box.value = v.slice(-1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', function(e){
      if (e.key === 'Backspace' && !box.value && i > 0){
        boxes[i - 1].focus();
        boxes[i - 1].value = '';
        e.preventDefault();
      }
      if (e.key === 'Enter') lookupApplication();
    });
    // 「SB-0007」や「0007」をまとめて貼り付けられるように
    box.addEventListener('paste', function(e){
      var t = (e.clipboardData || window.clipboardData).getData('text') || '';
      var digits = t.replace(/[^0-9]/g, '').slice(-4);
      if (!digits) return;
      e.preventDefault();
      boxes.forEach(function(b, j){ b.value = digits[j] || ''; });
      boxes[Math.min(digits.length, boxes.length) - 1].focus();
    });
  });
  var mail = $('#eg-mail');
  if (mail) mail.addEventListener('keydown', function(e){
    if (e.key === 'Enter'){ e.preventDefault(); boxes[0].focus(); }
  });
}

function readReceiptId(){
  var d = $$('.idbox').map(function(b){ return b.value; }).join('');
  return d.length === 4 ? 'SB-' + d : '';
}

function editError(msg){
  var el = $('#eg-err');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('show', !!msg);
}

function lookupApplication(){
  var email = $('#eg-mail').value.trim();
  var receiptId = readReceiptId();
  if (!email){ editError('メールアドレスをご入力ください。'); return; }
  if (!receiptId){ editError('受付IDを4桁すべてご入力ください。'); return; }
  if (!GAS_URL){ editError('これは表示確認用のページです。'); return; }

  editError('');
  var btn = $('#eg-go');
  btn.disabled = true; btn.textContent = '確認しています…';
  var restore = function(){ btn.disabled = false; btn.textContent = '内容を呼び出す'; };

  api_('selfLookup', { email: email, receiptId: receiptId })
    .then(function(d){
      restore();
      if (!d || !d.ok){ editError((d && d.message) || '確認できませんでした。'); return; }
      EDIT.on = true; EDIT.token = d.token; EDIT.receiptId = d.receiptId;
      startEditing(d.values || {});
    }, function(){
      restore();
      editError('通信に失敗しました。電波の良い場所で、もう一度お試しください。');
    });
}

/** 呼び出した内容をフォームに戻し、画面を「上書きする」形に切り替える */
function startEditing(values){
  $('#edit-gate').classList.add('hidden');
  $('#intro-area').classList.add('hidden');
  $('#form-area').classList.remove('hidden');
  $('#editing-banner').classList.remove('hidden');
  $('#editing-receipt').textContent = EDIT.receiptId;

  fillForm(values);

  // 送信の意味が変わるので、ボタンの文言もそろえる。
  // 「この内容で応募する」のままだと、二重に応募したと思われる
  $('#submit-btn').textContent = 'この内容で上書きする';
  $$('.edit-entry').forEach(function(e){ e.classList.add('hidden'); });
  var draft = $('#draft-note'); if (draft) draft.classList.add('hidden');

  $('#form-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveEdit(){
  var v = collect();
  var errs = validate(v);
  if (errs.length){ showErrors(errs); return; }

  var btn = $('#submit-btn');
  btn.disabled = true; btn.textContent = '保存しています…';
  var restore = function(){ btn.disabled = false; btn.textContent = 'この内容で上書きする'; };

  api_('selfSave', { token: EDIT.token, values: v })
    .then(function(d){
      if (d && d.ok){
        clearDraft();
        $('#form-area').classList.add('hidden');
        $('#editing-banner').classList.add('hidden');
        $('#edit-receipt').textContent = d.receiptId || EDIT.receiptId;
        var list = $('#edit-changed');
        list.innerHTML = (d.changed || []).length
          ? d.changed.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('')
          : '<li>変更はありませんでした。</li>';
        $('#edit-done').classList.remove('hidden');
        EDIT.on = false; EDIT.token = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      restore();
      if (d && d.error === 'validation'){ showErrors(d.fields || []); return; }
      $('.form-error').textContent = (d && d.message)
        || '保存できませんでした。お手数ですが、もう一度お試しください。';
      $('.form-error').classList.add('show');
    }, function(){
      restore();
      $('.form-error').textContent = '通信に失敗しました。もう一度お試しください。';
      $('.form-error').classList.add('show');
    });
}

/** 修正まわりの呼び出し。プリフライトを避けるため text/plain で送る */
function api_(action, body){
  var payload = { action: action };
  Object.keys(body || {}).forEach(function(k){ payload[k] = body[k]; });
  return fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  }).then(function(r){ return r.json(); });
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
    if (e.target && (e.target.type === 'number'
        || e.target.hasAttribute('data-rental-qty'))) updateRental();
    clearTimeout(typeTimer);
    typeTimer = setTimeout(function(){ renderConfirm(); saveDraft(); }, 800);
  });
  $('#submit-btn').addEventListener('click', function(e){
    e.preventDefault();
    // 修正中は新しい応募を作らない。取り違えると同じ会社の行が2本立つ
    if (EDIT.on) saveEdit(); else submitForm();
  });

  wireIdBlocks();
  // 入口はフォームの先頭と応募ボタンの下の2か所にある。
  // id だと片方にしか効かないので、目印はクラスで持つ
  $$('.js-open-edit').forEach(function(b){ b.addEventListener('click', showEditGate); });
  var egGo = $('#eg-go');
  if (egGo) egGo.addEventListener('click', lookupApplication);
  var egCancel = $('#eg-cancel');
  if (egCancel) egCancel.addEventListener('click', closeEditGate);
  var editBack = $('#edit-back');
  if (editBack) editBack.addEventListener('click', function(){ location.reload(); });

  // 完了画面 → 募集要項。履歴を積んであるなら戻るを使い、
  // ブラウザの「戻る」と画面のボタンで同じ動きになるようにする
  var back = $('#back-to-intro');
  if (back) back.addEventListener('click', function(){
    if (donePushed) history.back(); else showIntroOnly();
  });

  // 募集要項 → 完了画面（受付IDを見返したいとき）
  var toDone = $('#to-done');
  if (toDone) toDone.addEventListener('click', function(e){ e.preventDefault(); showDone(RECEIPT, ''); });

  window.addEventListener('popstate', function(){
    if (SUBMITTED) { donePushed = false; showIntroOnly(); }
  });
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
<meta property="og:image" content="${esc(C.SITE.url)}assets/ogp.png">
<meta property="og:url" content="${esc(C.SITE.url)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${esc(C.BRAND.favicon)}" sizes="32x32">
<link rel="apple-touch-icon" href="${esc(C.BRAND.faviconLg)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>${css()}</style>
</head>
<body>

<!-- ヘッダーは置かない（けいた判断・2026-09-01）。
     ヒーローの h1 がロゴそのものになったので、上に小さなロゴをもう一枚置くと
     同じ絵が2回出るだけになる。主催表記はヒーローの右上へ移した。 -->

<main>
<div class="editing-banner hidden" id="editing-banner">
  <div class="wrap">
    <p><b>応募済み内容の修正中です。</b>
       <span class="rc">受付ID <span id="editing-receipt">SB-0000</span></span>
       保存すると、いまの内容で上書きされます。</p>
  </div>
</div>
<div class="applied-banner hidden" id="applied-banner">
  <div class="wrap">
    <p><b>ご応募は受け付けております。</b>
       <span class="rc">受付ID <span id="applied-receipt">SB-0000</span></span>
       <a href="#" id="to-done">受付画面をもう一度見る</a></p>
  </div>
</div>
<div id="intro-area">
  ${renderHero()}
  ${renderFacts()}
  ${renderOutline()}
</div>

<div class="wrap section" id="form-area">
  <div class="sec-head"><h2>応募フォーム</h2><span class="en">ENTRY</span></div>
  <p class="edit-entry edit-entry-top">
    すでにご応募済みの方は、
    <button type="button" class="linkbtn js-open-edit">応募済み情報の修正</button>
    から内容を呼び出して直せます。
  </p>
  <p class="lead-note">所要時間の目安は5分です。<br>
    入力内容はこの端末に自動保存されるので、途中で閉じても続きから入力できます。</p>
  <div class="form-error" role="alert"></div>
  <form id="entry" novalidate autocomplete="on">
    ${renderForm()}
    <div id="confirm-box"></div>
    <p class="inline-note hidden" id="draft-note"></p>
    <div class="submit-area">
      <button type="submit" class="btn btn-brand" id="submit-btn">この内容で応募する</button>
      <p class="after-submit">${esc(C.PDF.afterSubmit)}</p>
      <p class="edit-entry">
        すでにご応募いただいた内容を直したい場合は、
        <button type="button" class="linkbtn js-open-edit">応募済み情報の修正</button>
        からお手続きいただけます。
      </p>
      <p class="submit-note">送信後、ご記入のメールアドレスに受付確認メールをお送りします。</p>
    </div>
  </form>
</div>

<!-- ── 応募済み情報の修正：本人確認 ─────────── -->
<div class="wrap notice-page hidden" id="edit-gate">
  <h2>応募済み情報の修正</h2>
  <p>ご応募時にお送りした<b>自動返信メール</b>に記載の、
     メールアドレスと受付IDをご入力ください。</p>

  <div class="egrid">
    <label class="eg-label" for="eg-mail">ご応募に使ったメールアドレス</label>
    <input type="email" id="eg-mail" inputmode="email" autocomplete="email"
           placeholder="example@company.co.jp">

    <label class="eg-label" id="eg-id-label">受付ID</label>
    <div class="idblocks" role="group" aria-labelledby="eg-id-label">
      <span class="idprefix">SB-</span>
      <input class="idbox" data-idpos="0" inputmode="numeric" maxlength="1" aria-label="受付IDの1桁目">
      <input class="idbox" data-idpos="1" inputmode="numeric" maxlength="1" aria-label="受付IDの2桁目">
      <input class="idbox" data-idpos="2" inputmode="numeric" maxlength="1" aria-label="受付IDの3桁目">
      <input class="idbox" data-idpos="3" inputmode="numeric" maxlength="1" aria-label="受付IDの4桁目">
    </div>
    <p class="eg-hint">受付IDをお忘れの場合は、応募時の自動返信メールをご確認ください。</p>
  </div>

  <p class="form-error" id="eg-err"></p>
  <p class="done-back">
    <button type="button" class="btn btn-brand" id="eg-go">内容を呼び出す</button>
    <button type="button" class="btn btn-ghost-dark" id="eg-cancel">やめる</button>
  </p>
</div>

<div class="wrap notice-page hidden" id="edit-done">
  <div class="mark">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
  </div>
  <h2>修正を保存しました</h2>
  <div class="receipt"><span class="cap">受付ID</span><span class="num" id="edit-receipt">SB-0000</span></div>
  <p>変更された項目は次のとおりです。</p>
  <ul class="changed-list" id="edit-changed"></ul>
  <p class="submit-note">ご担当者にも変更をお知らせしました。<br>
     さらに修正が必要な場合は、もう一度この画面からお手続きいただけます。</p>
  <p class="done-back">
    <button type="button" class="btn btn-ghost-dark" id="edit-back">募集要項に戻る</button>
  </p>
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
  <p class="after-submit">${esc(C.PDF.afterSubmit)}</p>
  <p class="submit-note">メールが届かない場合は、迷惑メールフォルダをご確認のうえ、
     <a data-contact href="#">お問い合わせ先</a> までご連絡ください。</p>
  <p class="done-back">
    <button type="button" class="btn btn-ghost-dark" id="back-to-intro">募集要項に戻る</button>
  </p>
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
/**
 * css / fieldHtml は出店確定情報フォーム（src/build-confirm.js）と共有する。
 * 仕様書§6-3「デザインは応募フォームと共通」を、**同じコードを使う**ことで守る。
 * 見た目を似せて2つ書くと、片方だけ直したときに必ずずれる。
 */
module.exports = { page, css, fieldHtml, ENDPOINT };
