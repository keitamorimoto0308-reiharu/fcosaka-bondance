/**
 * 成果物が指しているファイルが、本当に置いてあるか。
 *
 * ■ なぜ要るか
 *   ロゴを差し替えたとき、参照先のパスを1文字間違えても
 *   ・ビルドは通る（文字列を書き出しているだけなので）
 *   ・既存のテストも通る（HTMLの中身は正しい）
 *   ・ブラウザはエラーを出さず、壊れた画像枠を黙って出す
 *   という形になる。**ロゴが出ない募集ページを配ってしまう**のが最悪の現れ方で、
 *   しかも作った本人の手元にはキャッシュが残っているので気づきにくい。
 *
 *   ここでは、書き出されたHTMLが指している相対パスを全部拾って、
 *   実在するかを確かめる。外部URL（フォント・GAS）は対象外。
 *
 * ■ 濃色の面に置けないロゴがある
 *   支給ロゴのロゴタイプは墨色（#221816）で、濃い面では読めない。
 *   ヒーローやフッターに wide / box を置くと消えるので、それも検出する。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const C = require('../src/content.js');

// CRLF のままだと `\n}\n` のような目印が見つからず、関数の切り出しに失敗する。
// 失敗しても indexOf は -1 を返すだけなので、ファイル全体を掴んだまま
// 「テストは通っている」ように見えてしまう（引き継ぎ書§8）。
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const exists = f => fs.existsSync(path.join(ROOT, f));

/**
 * HTML から相対パスの参照を拾う。
 * http(s):// ・ data: ・ # ・ mailto: ・ tel: は外す。
 *
 * 管理ページの中には、画面を組み立てるスクリプトが入っている。
 * そこには `'<img src="' + esc(r.background) + '">'` のような**文字列の連結**があり、
 * 素朴に src=" を拾うと、これを実在しないファイル名として報告してしまう。
 * 実行時に決まる参照はここでは検査できないので、
 * JavaScript の断片に現れる文字を含むものは対象から外す。
 */
const JS_FRAGMENT = /['"`+$<>\\\s]/;

function localRefs(html) {
  const out = new Set();
  const re = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const v = m[1].trim();
    if (!v) continue;
    if (/^(https?:|data:|mailto:|tel:|#|\/\/)/i.test(v)) continue;
    if (JS_FRAGMENT.test(v)) continue;
    out.add(v.split('#')[0].split('?')[0]);
  }
  return [...out];
}

describe('成果物が指しているファイルは、実在するか', () => {

  // 書き出し先ごとに「そのHTMLから見た起点」が違う。
  // index.html はリポジトリ直下、配布キットは assets/kit/ に置かれる。
  const targets = [
    { file: 'index.html', base: '.' },
    { file: 'admin.html', base: '.' },
    { file: 'assets/kit/haifu-kit.html', base: 'assets/kit' },
  ];

  for (const t of targets) {
    test(`${t.file} の参照先がすべて実在する`, () => {
      const refs = localRefs(read(t.file));
      assert.ok(refs.length > 0, t.file + ' に相対参照が1つもありません（拾い方が壊れています）');

      const missing = refs
        .map(r => ({ ref: r, resolved: path.posix.normalize(path.posix.join(t.base, r)) }))
        .filter(x => !exists(x.resolved));

      assert.deepStrictEqual(missing, [],
        t.file + ' が実在しないファイルを指しています：'
        + missing.map(x => `${x.ref} → ${x.resolved}`).join(' / '));
    });
  }

  test('OGP画像が、正しい寸法で置いてある', () => {
    // URLを貼ったときに出る画像。**自分の画面には出ない**ので、
    // 壊れていても本人には見えない。寸法が違うとカードが切れて配信される。
    const { pngSize, W, H } = require('../src/build-ogp.js');
    assert.ok(exists('assets/ogp.png'), 'assets/ogp.png がありません');
    const dim = pngSize(path.join(ROOT, 'assets/ogp.png'));
    assert.deepStrictEqual({ w: dim.w, h: dim.h }, { w: W, h: H },
      'OGP画像の寸法が想定と違います');
  });

  test('OGP画像が、いまのイベント名で作り直されている', () => {
    // content.js を直したのに OGP を作り直していない、を検出する。
    // 募集要項PDFと同じ考え方（test/pdf.test.js）。
    const src = fs.statSync(path.join(ROOT, 'src/content.js')).mtimeMs;
    const ogp = fs.statSync(path.join(ROOT, 'assets/ogp.png')).mtimeMs;
    assert.ok(ogp >= src,
      'src/content.js を直したあと OGP画像を作り直していません（npm run build:ogp）');
  });

  test('BRAND に登録したロゴが、すべて置いてある', () => {
    // 別イベントへ転用するときに差し替える4点＋ファビコン。
    // ここが欠けていると、転用先で「ロゴだけ出ない」状態になる。
    const keys = ['logoWide', 'logoBox', 'logoText', 'mark', 'favicon', 'faviconLg'];
    const missing = keys.filter(k => !C.BRAND[k] || !exists(C.BRAND[k]));
    assert.deepStrictEqual(missing, [],
      'BRAND のロゴが実在しません：' + missing.map(k => `${k}=${C.BRAND[k]}`).join(' / '));
  });

  test('募集ページの見出しが、ロゴそのものになっている', () => {
    // ヒーローの h1 は画像。ロゴの中に「秋のサステナ盆踊り／presented by みんな電力」が
    // 入っているので、同じ文言をテキストで打ち直さない（けいた指摘）。
    // ただし画像だけの h1 は主題が機械に伝わらないので、alt にイベント名を持たせる。
    const html = read('index.html');
    const h1 = html.slice(html.indexOf('<h1>'), html.indexOf('</h1>') + 5);
    assert.ok(h1.includes(C.BRAND.logoBox), 'h1 に縦組みロゴ（狭い画面用）がありません');
    assert.ok(h1.includes(C.BRAND.logoWide), 'h1 に横組みロゴ（広い画面用）がありません');
    // picture は仕様上 img を1枚だけ描画するので、alt も1つでよい。
    // 属性の先頭で区切ること。`alt="` だけを探すと **data-alt="…" にも当たる**
    // （実際に、alt を消す壊し方がすり抜けた）。
    const alts = (h1.match(/\salt="[^"]*"/g) || []).map(a => a.trim());
    assert.strictEqual(alts.length, 1, 'h1 の alt が1つではありません：' + alts.join(' / '));
    assert.strictEqual(alts[0], 'alt="' + C.EVENT.name + '"',
      'h1 のロゴに alt が無く、検索エンジンと読み上げに主題が伝わりません：' + alts[0]);
    // 打ち直しの再発防止：h1 の中にイベント名の**テキスト**を置かない
    const textOnly = h1.replace(/<[^>]*>/g, '').replace(/\s/g, '');
    assert.strictEqual(textOnly, '',
      'h1 にテキストが入っています。ロゴと同じ文言が二重になります');
  });

  test('ヘッダーを置いていない（ロゴが2回出ないように）', () => {
    // ヒーローの h1 がロゴそのものなので、上に小さなロゴをもう一枚置くと
    // 同じ絵が2回出るだけになる（けいた判断・2026-09-01）。
    const html = read('index.html');
    assert.ok(!html.includes('site-header'),
      'ヘッダーが復活しています。ヒーローのロゴと二重になります');
    assert.ok(!html.includes('brandmark'),
      'ヘッダーのロゴ並びが残っています');
  });

  test('主催表記がヒーローの中にある', () => {
    // ヘッダーを廃したので、ここが唯一の主催表記になる。消えると
    // 「UPDATER」がページのどこにも出なくなる（ロゴには みんな電力 しか無い）。
    const html = read('index.html');
    const hero = html.slice(html.indexOf('<section class="hero">'),
                            html.indexOf('</section>', html.indexOf('<section class="hero">')));
    assert.ok(hero.includes('class="supported"'), 'ヒーローに主催表記がありません');
    assert.ok(hero.includes('UPDATER'),
      '主催表記に UPDATER がありません（ロゴには みんな電力 しか入っていません）');
  });

  test('ロゴの出し分けが picture になっている（1枚しか読み込まない）', () => {
    // 以前は img を2枚置いて display:none で切り替えていた。
    // その形だと (1) 隠れている側も必ずダウンロードされ、ヒーロー写真と
    // 読み込みを取り合う (2) 隠し忘れるとロゴが2枚見え、h1 の読み上げが
    // イベント名を2回繰り返す、という2つの事故が起きる。
    // picture は仕様上1枚しか描画しないので、どちらも構造的に起きなくなる。
    const html = read('index.html');
    const h1 = html.slice(html.indexOf('<h1>'), html.indexOf('</h1>') + 5);
    assert.ok(h1.includes('<picture>'), 'h1 が picture になっていません');
    assert.ok(h1.includes('media="(min-width:600px)"') && h1.includes(C.BRAND.logoWide),
      '広い画面で横組みに差し替える source がありません');
    assert.ok(h1.includes(C.BRAND.logoBox), '狭い画面用の縦組みがありません');
    assert.strictEqual((h1.match(/<img/g) || []).length, 1,
      'h1 に img が複数あります（隠れている側もダウンロードされます）');
  });

  test('紙面と配布キットは横組み版を使っている（エンブレムが1回だけ出る）', () => {
    // 紙にはヒーローが無いので、ヘッダーに全部入りの横組みを置くのが正しい。
    const pdf = read('build/boshu-yoko.html');
    assert.ok(pdf.includes(C.BRAND.logoWide), '募集要項PDFに横組み版がありません');
  });
});

describe('イベント名が、二重管理でずれていないか', () => {

  /**
   * GAS からは src/content.js を読めないため、メールの件名に使うイベント名だけは
   * gas/Mail.gs に手で複製してある。片方だけ直すと
   * **メールの件名だけ旧名のまま**になり、送っている本人にも見えない。
   * 応募者の手元に残る唯一の控えなので、ここは必ず一致させる。
   */
  test('gas/Mail.gs の EVENT_NAME が content.js と一致する', () => {
    const gas = read('gas/Mail.gs');
    const m = gas.match(/var EVENT_NAME = '([^']*)';/);
    assert.ok(m, 'gas/Mail.gs に EVENT_NAME が見つかりません');
    assert.strictEqual(m[1], C.EVENT.name,
      'メールの件名に使うイベント名が、content.js とずれています');
  });

  test('ページの副題と協賛表記が、ロゴの中の文字と食い違っていない', () => {
    // ロゴには「秋のサステナ盆踊り」「presented by みんな電力」が図案として入っている。
    // 本文をこれに合わせる、とけいたが決めた（decisions_pending K1）。
    // 片方だけ戻すと、同じ画面に2つの表記が並ぶ状態に逆戻りする。
    assert.ok(C.EVENT.titleSub.includes('秋の'),
      '副題がロゴの「秋のサステナ盆踊り」と食い違っています');
    assert.ok(C.EVENT.presented.includes('みんな電力'),
      '協賛表記がロゴの「presented by みんな電力」と食い違っています');
    assert.ok(C.EVENT.name.includes(C.EVENT.titleSub),
      '1行表記（EVENT.name）に副題が含まれていません');
  });
});

describe('濃色の面に、読めないロゴを置いていないか', () => {

  /**
   * 支給ロゴのロゴタイプは墨色。**明るい面でしか読めない。**
   *
   * ヒーローは白い膜に変えたのでロゴを置けるようになったが、
   * 膜を濃色に戻すとロゴの上半分が消える。戻せないように固定する。
   * フッターは濃色のままなので、そちらにはロゴを置かない。
   */
  test('ヒーローの膜は白のまま（ロゴタイプが読める地色）', () => {
    const src = read('src/build-form.js');
    // 色の書き方（radial / linear / 重ね順）は今後も変わりうるので、
    // 「どう書かれているか」ではなく「どんな色が入っているか」で見る。
    const m = src.match(/\.hero::before\{([^}]*)\}/);
    assert.ok(m, '.hero::before が見つかりません');
    const decl = m[1];

    const colors = decl.match(/rgba?\([^)]*\)/g) || [];
    assert.ok(colors.length >= 2, 'ヒーローの膜に色指定がほとんどありません');
    const notWhite = colors.filter(
      c => !/^rgba?\(\s*255\s*,\s*255\s*,\s*255\s*[,)]/.test(c));
    assert.deepStrictEqual(notWhite, [],
      'ヒーローの膜に白以外の色が入っています：' + notWhite.join(' / ')
      + '（墨色のロゴタイプが読めなくなります）');

    // 16進やhslで書かれると上の検査をすり抜ける。書き方自体を縛る
    assert.ok(!/#[0-9a-fA-F]{3,8}|hsla?\(/.test(decl),
      'ヒーローの膜が rgba 以外の書き方になっています（色の検査をすり抜けます）');
  });

  test('フッター（濃色）には、読めないロゴを置いていない', () => {
    const html = read('index.html');
    const foot = html.slice(html.indexOf('<footer'));
    for (const key of ['logoWide', 'logoBox', 'logoText']) {
      assert.ok(!foot.includes(C.BRAND[key]),
        `フッターに ${key} を置いています。濃色なのでロゴタイプが読めません`);
    }
  });

  test('ヒーローのボタンが、白地でも見える色になっている', () => {
    // .btn-ghost は水色の枠線と**水色の文字**。白地に対して 1.81:1 で、
    // 押せる場所がほぼ見えない。濃色ヒーロー時代の遺物なので、
    // 白いヒーローの中では使わない。
    const src = read('src/build-form.js');
    const start = src.indexOf('function renderHero()');
    const end = src.indexOf('\n}\n', start);
    assert.ok(end > start, 'renderHero の切り出しに失敗しました');
    const hero = src.slice(start, end);
    assert.ok(!/class="btn btn-ghost"/.test(hero),
      'ヒーローに .btn-ghost（水色の文字）があります。白地では 1.81:1 で見えません');

    // 白地＋水色の枠のボタンは、文字まで水色にしてはいけない
    const m = src.match(/\.btn-outline-brand\{([^}]*)\}/);
    assert.ok(m, '.btn-outline-brand が見つかりません');
    assert.ok(/color:var\(--ink\)/.test(m[1]),
      '.btn-outline-brand の文字色が墨色ではありません。水色は白地で 1.81:1 です');
  });
});
