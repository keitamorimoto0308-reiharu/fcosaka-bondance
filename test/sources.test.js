/**
 * ソースに、書いた覚えのない制御文字が混ざっていないか。
 *
 * ■ なぜ要るか
 *   このリポジトリの編集は、しばしば bash のヒアドキュメントや Python の
 *   文字列を経由する。そこで `\b` `\a` `\f` `\v` `\0` と書くと、
 *   **意図した2文字ではなく1つの制御文字**に化ける（引き継ぎ書§8）。
 *
 *   化けても構文エラーにはならない。正規表現なら
 *   `/<img\b/` が `/<img<BS>/` になり、**エラーも出さずに何にもマッチしない**。
 *   実際に `test/assets.test.js` で起きた。
 *   このとき「0件なら合格」という向きの検査だったら、
 *   **永久に無言で通り続ける検査**が出来上がっていた。
 *
 *   目でも grep でも見えない文字なので、機械に探させるしかない。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 通常のソースに出てよい制御文字は TAB(09) / LF(0A) / CR(0D) だけ */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

function listFiles(dir, ext) {
  return fs.readdirSync(path.join(ROOT, dir))
    .filter(f => f.endsWith(ext))
    .map(f => path.posix.join(dir, f));
}

/**
 * ■ このセッションで5回踏んだ罠
 *   bash のヒアドキュメントや Python の文字列を経由してコードを書くと、
 *   `\b` `\n` `\r` が**1文字の制御文字**に化ける。
 *   - 正規表現なら「エラーも出さずに何にもマッチしない」
 *   - 文字列リテラルなら「途中で改行されて構文エラー」
 *   - **生成器（build-*.js）の中では、さらに1層ぶん余計に展開される**
 *   目でも grep でも見えないので、機械に探させるしかない。
 */
describe('ソースに制御文字が混ざっていないか', () => {
  const files = [
    ...listFiles('src', '.js'),
    ...listFiles('test', '.js'),
    ...listFiles('gas', '.gs'),
  ];

  test('検査対象のファイルが実在する（拾い方が壊れていないこと）', () => {
    assert.ok(files.length > 20, 'ソースを拾えていません：' + files.length + '件');
  });

  for (const f of files) {
    test(`${f} に制御文字が無い`, () => {
      const buf = fs.readFileSync(path.join(ROOT, f));
      const hits = [];
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c < 0x20 && !ALLOWED.has(c)) {
          const line = buf.subarray(0, i).toString('utf8').split('\n').length;
          hits.push(`${line}行目に 0x${c.toString(16).padStart(2, '0')}`);
          if (hits.length >= 5) break;
        }
      }
      // ⚠ このメッセージ自体に `\b` と書くと、JSのエスケープでバックスペースになる。
      //    まさにこの検査が探しているものが、検査のメッセージに混ざる。
      assert.deepStrictEqual(hits, [],
        f + ' に制御文字が混ざっています'
        + '（バックスラッシュ+b などが、ヒアドキュメント経由で化けた可能性）：'
        + hits.join(' / '));
    });
  }
});

/**
 * ソースが JavaScript として読めるか。
 *
 * ■ なぜ足したか
 *   `\n` が**実際の改行**に化けて、文字列リテラルが途中で切れたまま
 *   `npm test` が 427件すべて通り、**GASのパーサだけが捕まえた**
 *   （`Syntax error: Invalid or unexpected token line: 393 file: Setup.gs`）。
 *
 *   上の制御文字の検査は 0x20 未満の**制御文字**を探すもので、
 *   LF は許可している（当然、行末に要る）。だから化けたLFは通り抜ける。
 *   構文として読めるかは、別に見るしかない。
 *
 *   .gs は GAS に送るまで誰も構文を見ない。**送る前にここで止める。**
 *   実行はしない（GASのAPIは Node に無い）。構文解析だけ。
 */
describe('ソースが JavaScript として読めるか', () => {
  const vm = require('node:vm');
  const files = [
    ...listFiles('src', '.js'),
    ...listFiles('gas', '.gs'),
  ];

  test('検査対象のファイルが実在する（拾い方が壊れていないこと）', () => {
    assert.ok(files.length > 20, 'ソースを拾えていません：' + files.length + '件');
  });

  for (const f of files) {
    test(f + ' が構文として読める', () => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      // .js は Node の CommonJS として読む。素のスクリプトとして読むと、
      // 最上位の return（src/mock.js が使っている）が構文エラーになる。
      // .gs は GAS 側でも素のスクリプトなので、そのまま読む。
      const wrapped = f.endsWith('.js')
        ? '(function(exports,require,module,__filename,__dirname){' + src + '\n})'
        : src;
      try {
        new vm.Script(wrapped, { filename: f });
      } catch (e) {
        assert.fail(f + ' が構文として読めません：' + e.message
          + '（ヒアドキュメント経由でバックスラッシュが化けた可能性）');
      }
    });
  }
});

/**
 * 書き出したページの中のJavaScriptも、構文として読めるか。
 *
 * ■ なぜ別に要るか
 *   src/build-admin.js などは「JavaScriptを書き出すJavaScript」で、
 *   画面のコードは**テンプレートリテラルの中**にある。
 *   そこにバッククォートを1つ書くと、その場で文字列が切れる。
 *   **同じ事故が3回起きている**（build-upload.js / build-form.js / build-admin.js）。
 *
 *   書き出し側が壊れれば build が落ちるので気づけるが、
 *   「書き出しは通るのに、出来上がったページの中身だけが壊れている」形もありうる。
 *   そのときブラウザは白い画面を出すだけで、こちらには何も届かない。
 */
describe('書き出したページの中のJavaScriptが読めるか', () => {
  const vm = require('node:vm');
  const pages = ['admin.html', 'index.html', 'confirm.html', 'upload.html']
    .filter(f => fs.existsSync(path.join(ROOT, f)));

  test('書き出したページが実在する', () => {
    assert.ok(pages.length >= 3, 'ページを拾えていません：' + pages.join(','));
  });

  for (const f of pages) {
    test(f + ' の中のJavaScriptが構文として読める', () => {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const blocks = [];
      const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = re.exec(html)) !== null) blocks.push(m[1]);
      assert.ok(blocks.length, f + ' にJavaScriptが見つかりません');
      blocks.forEach((code, i) => {
        if (!code.trim()) return;
        try {
          new vm.Script(code, { filename: f + ' の script[' + i + ']' });
        } catch (e) {
          assert.fail(f + ' の ' + (i + 1) + 'つ目の script が読めません：' + e.message
            + '（テンプレートリテラルの中にバッククォートを書いた可能性）');
        }
      });
    });
  }
});

/**
 * ページを書き出すコード（src/build-*.js）の**コメント行に、バッククォートを書かない**。
 *
 * ■ なぜ機械で止めるか
 *   あれは「JavaScriptを書き出すJavaScript」で、画面のコードは
 *   テンプレートリテラルの中にある。コメントにバッククォートを1つ書くと
 *   **そこでテンプレートが終わり**、続きがコードとして解釈される。
 *
 *   2026-09-08、1日に3回踏んだ。うち1回は、直した直後にまた踏んだ。
 *   ソースは構文として通り、落ちるのは書き出しの実行時なので、
 *   `node --check` は**1件ずつしか**教えてくれない。
 *
 *   注意していれば避けられる、という種類のものではない。
 *   **人の注意力に頼るのをやめて、機械に止めさせる。**
 *
 *   （マークダウンの引用のつもりで書きたくなるが、この案件のコメントは
 *     日本語なので「」で足りる）
 */
describe('ページを書き出すコードのコメントに、バッククォートが無いか', () => {
  const BQ = String.fromCharCode(96);
  const files = fs.readdirSync(path.join(ROOT, 'src'))
    .filter(f => /^build-.*\.js$/.test(f));

  test('書き出すコードを拾えている', () => {
    assert.ok(files.length >= 4, 'src/build-*.js を拾えていません：' + files.join(','));
  });

  for (const f of files) {
    test(f + ' のコメントにバッククォートが無い', () => {
      const lines = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')
        .split('\r\n').join('\n').split('\n');
      const bad = [];
      lines.forEach((line, i) => {
        const t = line.trim();
        const isComment = t.indexOf('//') === 0 || t.indexOf('*') === 0
                       || t.indexOf('/*') === 0;
        if (isComment && line.indexOf(BQ) >= 0) bad.push((i + 1) + '行目: ' + t.slice(0, 60));
      });
      assert.deepStrictEqual(bad, [],
        f + ' のコメントにバッククォートがあります。'
        + 'テンプレートリテラルの中だと、そこで文字列が終わって書き出しが落ちます'
        + '（「」を使ってください）：' + String.fromCharCode(10) + bad.join(String.fromCharCode(10)));
    });
  }
});
