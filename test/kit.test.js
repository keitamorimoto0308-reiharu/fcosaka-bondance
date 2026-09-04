/**
 * 配布キットの受け入れテスト
 *
 * 配布キットは、営業がそのままコピーして取引先に送るもの。
 * 守りたいのは次の3つ。
 *   ・QRを読み取ったら、本当に応募フォームに行くこと
 *   ・文例の中に、埋め忘れの差し込みが残っていないこと
 *   ・締切・URL・問い合わせ先が、募集要項と同じ値であること
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const C = require('../src/content.js');
const K = require('../src/build-kit.js');

const KIT = path.join(ROOT, 'assets', 'kit');
const built = f => fs.existsSync(path.join(KIT, f));

describe('配布キット：QRが本当に応募フォームに行くか', () => {

  test('書き出したQR画像を読み取ると、公開URLになる', () => {
    // 生成した文字列を照合するだけでは「符号化が正しいか」は分からない。
    // 印刷して配るものなので、実際に読み取って確かめる。
    const png = path.join(KIT, 'qr-1024.png');
    assert.ok(fs.existsSync(png), 'QR画像がありません。先に npm run build を実行してください');

    const jsQR = require('jsqr');
    const { PNG } = require('pngjs');
    const img = PNG.sync.read(fs.readFileSync(png));
    const res = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);

    assert.ok(res, 'QRコードを読み取れませんでした');
    assert.strictEqual(res.data, C.SITE.url,
      'QRの中身が公開URLと違います。配ったQRが別の場所を指す事故になります');
  });
});

describe('配布キット：文例が「送れる状態」になっているか', () => {

  const mails = [['初回のご案内', C.KIT.intro], ['リマインド', C.KIT.remind],
                 ['訪問後', C.KIT.followup]];

  test('締切・URL・問い合わせ先が実際の値に置き換わっている（件名を含む）', () => {
    for (const [name, m] of mails) {
      const t = K.mailText(m) + String.fromCharCode(10) + K.mailSubject(m);
      for (const key of Object.keys(K.FILL)) {
        assert.ok(!t.includes(key),
          name + 'の文例に ' + key + ' が残っています（差し込みが効いていません）');
      }
      assert.ok(t.includes(C.SITE.url), name + 'の文例に応募フォームのURLがありません');
    }
  });

  test('営業が埋める場所以外に、置き換え漏れの【　】が無い', () => {
    for (const [name, m] of mails) {
      const t = K.mailText(m) + String.fromCharCode(10) + K.mailSubject(m);
      const left = (t.match(/【[^】]*】/g) || []);
      for (const tag of left) {
        assert.ok(K.MANUAL.includes(tag) || K.LITERAL.includes(tag),
          name + 'の文例に、埋め方の分からない差し込みが残っています: ' + tag);
      }
    }
  });

  test('初回のご案内には、締切が完全な形で入っている', () => {
    // 「9/30まで」だけでは、何年の何曜日か分からないまま転送される
    assert.ok(K.mailText(C.KIT.intro).includes(C.DEADLINE.full),
      '初回のご案内に「' + C.DEADLINE.full + '」がありません');
  });

  test('締切の曜日が、募集要項と配布キットで一致している', () => {
    assert.strictEqual(K.deadline(), C.DEADLINE.full);
  });
});

describe('配布キット：一式がそろっているか', () => {

  test('営業に渡すファイルが全部ある', () => {
    for (const f of ['haifu-kit.html', 'qr.svg', 'qr-1024.png',
                     'qr-a4.pdf', 'qr-meishi.pdf', 'fcosaka-shanai.pdf']) {
      assert.ok(built(f), '配布キットに ' + f + ' がありません（npm run build）');
    }
  });

  test('配布キットの画面から、募集要項PDFへのリンクが切れていない', () => {
    const html = fs.readFileSync(path.join(KIT, 'haifu-kit.html'), 'utf8');
    const links = [...html.matchAll(/href="([^"]+)"\s+download/g)].map(m => m[1]);
    assert.ok(links.length >= 6, '配布物へのリンクが足りません');
    for (const rel of links) {
      assert.ok(fs.existsSync(path.resolve(KIT, rel)),
        '配布キットのリンク先がありません: ' + rel);
    }
  });

  test('印刷物がA4・1枚である', async () => {
    const { PDFDocument } = require('pdf-lib');
    for (const f of ['qr-a4.pdf', 'qr-meishi.pdf', 'fcosaka-shanai.pdf']) {
      const doc = await PDFDocument.load(fs.readFileSync(path.join(KIT, f)));
      assert.strictEqual(doc.getPageCount(), 1, f + ' が1枚に収まっていません');
      const { width, height } = doc.getPage(0).getSize();
      assert.strictEqual(Math.round(width / 72 * 25.4), 210, f + ' がA4ではありません');
      assert.strictEqual(Math.round(height / 72 * 25.4), 297, f + ' がA4ではありません');
    }
  });
});
