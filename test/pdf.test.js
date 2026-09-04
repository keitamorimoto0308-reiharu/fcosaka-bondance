/**
 * 募集要項PDFの受け入れテスト
 *
 * このPDFは営業が取引先へ手渡す紙面で、一度配ると回収できない。
 * だから守りたいのは見た目ではなく「フォームに書いてあることと違わないこと」と
 * 「載せたつもりの節が黙って消えていないこと」の2点。
 *
 * 実行: npm test
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const C = require('../src/content.js');
const B = require('../src/build-pdf.js');
const { qrSvg } = require('../src/qr.js');

/** PDFの組版HTML。ビルド前でもテストできるよう、その場で生成する */
let HTML;
const html = async () => (HTML = HTML || await B.html());

/**
 * タグを外した「読み手に見える文字列」。
 * 紙面では 11:00〜17:30 と読めても、HTMLでは
 * <span>11:00</span><span>〜17:30</span> と分かれていることがある。
 * 検査したいのは読み手が見るほうなので、タグを落としてから照合する。
 */
const text = async () => (await html())
  .replace(/<style>[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ');

/** build-pdf.js と同じHTMLエスケープ。ラベルに & が入っても取り違えないため */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const indexHtml = () => {
  const f = path.join(ROOT, 'index.html');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};

describe('募集要項PDF：載せたはずの内容が消えていないか', () => {

  test('募集要項の節がすべてPDFに載る（片方だけ増やす事故を止める）', () => {
    // content.js に節を足して PAGE_PLAN に足し忘れると、ここで落ちる
    assert.doesNotThrow(() => B.planSections());
  });

  test('PDFで省く行は、実際に content.js に存在する行だけ', () => {
    const omit = C.PDF.omitRows || {};
    for (const [title, labels] of Object.entries(omit)) {
      const g = C.OUTLINE.find(g => g.title === title);
      assert.ok(g, 'omitRows の節が OUTLINE にありません: ' + title);
      for (const label of labels) {
        assert.ok(g.body.some(r => r[0] === label),
          `omitRows の行が見つかりません: ${title} / ${label}`
          + '（綴りが違うと、消したつもりの行が消えないまま残ります）');
      }
    }
  });

  test('省いてよいのは、同じ文言がファクト帯にそのまま出ている行だけ', () => {
    // 「紙面が足りないから消す」を無自覚に増やさないための歯止め。
    // ラベルが一致するだけでは足りない。開催日はファクト帯では
    // 「10.24 / SAT / 2026年」と分かれており、
    // 「2026年10月24日（土）」を書いたことにはならないため。
    for (const [title, labels] of Object.entries(C.PDF.omitRows || {})) {
      const g = C.OUTLINE.find(g => g.title === title);
      for (const label of labels) {
        const rowText = g.body.find(r => r[0] === label)[1];
        const shown = C.FACTS.map(f => String(f.big) + String(f.small || ''));
        assert.ok(shown.includes(rowText),
          `「${label}：${rowText}」はファクト帯に同じ形で出ていません。`
          + 'PDFから省くと、その情報が紙面から失われます');
      }
    }
  });

  test('省いた行以外は、見出しも中身も紙面に出ている', async () => {
    const h = await html();
    const t = await text();
    // 紙面から外す行は2種類ある（重複だから省く／採択後に伝える）
    const omitted = Object.values(C.PDF.omitRows || {}).flat()
      .concat(Object.values(C.PDF.afterAcceptRows || {}).flat());
    for (const g of C.OUTLINE) {
      for (const [label, body] of g.body) {
        if (omitted.includes(label)) continue;
        assert.ok(h.includes('<dt>' + esc(label) + '</dt>'),
          '紙面に見出しが無い行: ' + g.title + ' / ' + label);
        // 見出しだけあって中身が落ちる事故も止める。
        // dt の検査だけでは section() が本文を落としても素通りしてしまう。
        // 期待値にも同じ正規化をかける。全角スペースは \s に含まれるので、
        // 紙面から読み取った文字列側だけ潰れていると一致しなくなる。
        const want = body.replace(/\s+/g, ' ');
        assert.ok(t.includes(want),
          '紙面に本文が無い行: ' + g.title + ' / ' + label + ' → ' + want.slice(0, 30) + '…');
      }
    }
  });
});

describe('募集要項PDF：フォームと食い違っていないか', () => {

  test('日時・会場・締切がイベント定義どおりに載っている', async () => {
    const t = await text();
    for (const v of [C.EVENT.name, C.EVENT.venue, C.EVENT.hours, C.EVENT.date]) {
      assert.ok(t.includes(v), 'PDFに載っていません: ' + v);
    }
    const deadline = C.FACTS.find(f => f.fromConfig === 'deadline');
    assert.ok(t.includes(deadline.big), '応募締切がPDFに載っていません');
  });

  test('レンタル備品の単価がフォームと同じ値を使っている', () => {
    const idx = indexHtml();
    assert.ok(idx, 'index.html がありません。先に npm run build を実行してください');
    const m = idx.match(/var FALLBACK_PRICES = (\{[^;]*\});/);
    assert.ok(m, 'index.html に単価の埋め込みが見つかりません');
    assert.deepStrictEqual(JSON.parse(m[1]), C.PRICES,
      'フォームとPDFで単価がずれています。src/content.js の PRICES が唯一の正です');
  });

  test('料金表に、単価と金額がすべて並んでいる', async () => {
    // テントは PRICES から、数量で頼む備品は RENTAL_QTY から単価を取る。
    // 稼働中のシートとの食い違いは build-pdf.js の verifyConfig が止める。
    const t = await text();
    for (const r of C.RENTALS) {
      const price = r.key ? C.PRICES[r.key] : r.price;
      assert.ok(price != null, '単価が未設定の備品があります: ' + r.label);
      assert.ok(t.includes(r.label), '料金表に無い備品: ' + r.label);
      assert.ok(t.includes(Number(price).toLocaleString('ja-JP')),
        '金額が載っていません: ' + r.label);
    }
  });

  test('QRコードの中身が公開URLと一致する', async () => {
    const h = await html();
    const expected = await qrSvg(C.SITE.url);
    // QRの符号化は決定的なので、同じURLなら同じSVGになる
    assert.ok(h.includes(expected),
      'QRコードが SITE.url 以外を指しています。配布物のQRが別のURLを向く事故を防ぐための検査です');
  });

  test('表示用URLが実URLと矛盾していない', () => {
    assert.ok(C.SITE.url.includes(C.SITE.urlShown),
      '印刷用の表記 ' + C.SITE.urlShown + ' が実URL ' + C.SITE.url + ' に含まれていません');
  });
});

describe('募集要項PDF：印刷物としての約束', () => {

  test('メールアドレスを大文字しか持たない書体で組まない', async () => {
    const h = await html();
    const m = h.match(/\.contact \.mail\{[^}]*\}/);
    assert.ok(m, '.contact .mail の指定が見つかりません');
    assert.ok(!/Bebas/.test(m[0]),
      'Bebas Neue は大文字しか持たないため、'
      + C.CONTACT.email + ' が全部大文字で印刷されます');
    assert.ok(h.includes(C.CONTACT.email), '問い合わせ先が載っていません');
  });

  test('ブランド水色を白地の文字色に使っていない（1.81:1で読めない）', async () => {
    const h = await html();
    const css = h.match(/<style>([\s\S]*?)<\/style>/)[1];
    // 水色を color に使ってよいのは、濃色の面の上に載る要素だけ
    const allowed = ['.eyebrow', '.fact .lab', '.fact .big', '.apply h2', '.apply .url', '.apply .dl b'];
    const rules = css.match(/[^{}]+\{[^}]*\}/g) || [];
    for (const rule of rules) {
      const sel = rule.split('{')[0].trim();
      const body = rule.split('{')[1];
      if (!/color:\s*#7FCAF1/i.test(body)) continue;
      assert.ok(allowed.includes(sel),
        '白地に水色の文字を使っています: ' + sel + '（濃色の面の上でのみ許可）');
    }
  });

  test('紙面はA4・2枚で、いまのソースから作られている', async () => {
    const pdf = path.join(ROOT, 'assets', 'boshu-yoko.pdf');
    assert.ok(fs.existsSync(pdf), 'PDFがありません。先に npm run build を実行してください');

    // 中身があふれていないかを見ているのは build-pdf.js のページ数検査で、
    // テストはディスク上の成果物しか見ない。作り直していないPDFに対して
    // 「2ページです」と言っても意味がないので、ソースより新しいことを確かめる。
    const built = fs.statSync(pdf).mtimeMs;
    for (const src of ['src/content.js', 'src/build-pdf.js', 'src/theme.js', 'src/qr.js']) {
      assert.ok(built >= fs.statSync(path.join(ROOT, src)).mtimeMs,
        src + ' を直したあとPDFを作り直していません（npm run build）');
    }
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.load(fs.readFileSync(pdf));
    assert.strictEqual(doc.getPageCount(), B.EXPECTED_PAGES, 'PDFのページ数が想定と違います');
    const { width, height } = doc.getPage(0).getSize();
    assert.strictEqual(Math.round(width / 72 * 25.4), 210);
    assert.strictEqual(Math.round(height / 72 * 25.4), 297);
  });
});

describe('募集要項PDF：値が二重管理になっていないか', () => {

  test('content.js の単価と、レンタル品目シートの初期値が一致する', () => {
    // 応募フォームは実行時にレンタル品目シートを読み、PDFは content.js を刷る。
    // どちらの初期値もずれていないことを、まずコード同士で確かめる。
    // （稼働中のシートとの照合は build-pdf.js の verifyConfig で行う）
    const setup = fs.readFileSync(path.join(ROOT, 'gas', 'Setup.gs'), 'utf8');
    const seed = setup.slice(setup.indexOf('function setupRentalSheet_'));
    assert.ok(seed, 'gas/Setup.gs に setupRentalSheet_ がありません');

    // テント：初期値は pick('単価_テント_小', 15000) の第2引数
    for (const [key, label] of [['tentT1', '単価_テント_小'], ['tentT2', '単価_テント_大']]) {
      const m = seed.match(new RegExp("pick\\('" + label + "',\\s*(\\d+)\\)"));
      assert.ok(m, 'gas/Setup.gs に初期値がありません: ' + label);
      assert.strictEqual(Number(m[1]), C.PRICES[key],
        label + ' が content.js の PRICES と食い違っています');
    }

    // 数量で頼む備品：品目名と単価の両方が、紙面と初期値で揃っていること
    for (const r of C.RENTAL_QTY) {
      assert.ok(seed.includes("'" + r.label + "'"),
        'gas/Setup.gs の初期値に「' + r.label + '」がありません（紙面にはあります）');
      const m = seed.match(new RegExp("'" + r.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        + "',\\s*pick\\('[^']+',\\s*(\\d+)\\)"));
      assert.ok(m, '「' + r.label + '」の初期値を読み取れません');
      assert.strictEqual(Number(m[1]), r.price,
        '「' + r.label + '」の単価が、紙面と初期値で食い違っています');
    }
  });

  test('締切の曜日を手で書いていない', () => {
    // 「9/30（火）」と書かれていたが、2026年9月30日は水曜日だった。
    // 曜日は必ず日付から導出する。
    const src = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
    const hardcoded = src.match(/9月30日（[月火水木金土日]）/g) || [];
    assert.strictEqual(hardcoded.length, 0,
      '締切の曜日が直書きされています: ' + hardcoded.join(', ')
      + '（DEADLINE.full / DEADLINE.label を使ってください）');
    assert.ok(C.DEADLINE.full.includes('（水）'), '締切の曜日が導出できていません');
  });

  test('紙面に締切の完全な表記がある', async () => {
    // 開催日について「10.24 / SAT / 2026年 では明記したことにならない」と決めた基準は、
    // 締切にも同じように当てはまる（稟議書・社内共有に転記される）。
    const t = await text();
    assert.ok(t.includes(C.DEADLINE.full),
      '紙面に「' + C.DEADLINE.full + '」がありません。'
      + '大きい数字（9.30）だけでは、何年何曜日か分かりません');
  });
});

describe('紙面から外した行の行き先', () => {

  test('採択後に伝える行が、確実に受け取られる場所が用意されている', () => {
    // 「紙が足りないから消す」を無自覚に増やさないための歯止め。
    // omitRows はファクト帯に同じ文言が残るが、afterAcceptRows は
    // **紙面から本当に消える**。受け取る場所が無ければ、その情報は誰にも届かない。
    const after = C.PDF.afterAcceptRows || {};
    const rows = Object.entries(after).flatMap(([title, labels]) =>
      labels.map(l => [title, l]));
    if (!rows.length) return;

    // 紙面に「採択後に別途お伺いします」と予告があること
    const outline = JSON.stringify(C.OUTLINE);
    assert.ok(outline.includes('採択後'),
      '紙面から外した行があるのに、採択後に案内する旨の予告がありません');

    // 外した行が、そもそも定義に存在すること（打ち間違いで何も外れていない状態を防ぐ）
    for (const [title, label] of rows) {
      const g = C.OUTLINE.find(g => g.title === title);
      assert.ok(g, '存在しない見出しを指しています: ' + title);
      assert.ok(g.body.some(r => r[0] === label),
        '存在しない行を外そうとしています: ' + title + ' / ' + label);
    }
  });

  test('重複だから省く行と、採択後に伝える行を混ぜていない', () => {
    // 混ぜると「紙面から消えたこと」を忘れる
    const omit = Object.values(C.PDF.omitRows || {}).flat();
    const after = Object.values(C.PDF.afterAcceptRows || {}).flat();
    const both = omit.filter(l => after.includes(l));
    assert.deepStrictEqual(both, [],
      '同じ行が両方に入っています: ' + both.join(', '));
  });
});
