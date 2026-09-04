/**
 * GASのコードが、存在しない関数を呼んでいないかを確かめる。
 *
 * ■ なぜ要るか
 *   GASは実行時にしかエラーが出ない。呼び出し先を消しても、
 *   その経路を通るまで誰も気づかない。実際に2回起きた。
 *
 *   1回目: build.js が columnsFor_ を生成物に書き出しておらず、
 *          setup() が動かなくなった（台帳の列を直せない状態）。
 *   2回目: レンタル品目シートへの移行の途中で getPrices() を消したまま
 *          本番へ push し、**応募フォームの設定取得ごと落とした**。
 *          応募フォームが単価も締切も読めない状態で数分間公開されていた。
 *
 *   どちらも「文法としては正しいが、呼ぶと落ちる」。
 *   このテストは、呼び出しているのに定義が無い名前を洗い出す。
 *
 * ■ 限界
 *   静的な検査なので、動的に組み立てた呼び出しは見つけられない。
 *   それでも「消し忘れ」「移行の途中で止まった」は確実に捕まえられる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAS = path.join(ROOT, 'gas');

/** GAS と JavaScript が最初から持っているもの。ここに無い名前は自前で定義が要る */
const BUILTIN = new Set([
  // Apps Script のサービス
  'SpreadsheetApp', 'PropertiesService', 'LockService', 'Utilities', 'MailApp',
  'GmailApp', 'DriveApp', 'CacheService', 'ScriptApp', 'Session', 'HtmlService',
  'ContentService', 'UrlFetchApp', 'Logger', 'console',
  // JavaScript
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date',
  'RegExp', 'Error', 'TypeError', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'Promise',
  // 構文として () が続くだけのもの
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new',
  'else', 'do', 'try', 'throw', 'var', 'this',
]);

function gasFiles() {
  return fs.readdirSync(GAS).filter(f => f.endsWith('.gs'))
    .map(f => ({ name: f, src: fs.readFileSync(path.join(GAS, f), 'utf8') }));
}

/**
 * コメント・文字列・正規表現を落とす。中に書かれた名前を呼び出しと取り違えないため。
 * 正規表現を残すと /(\d{4})\D(\d{1,2})/ の \D( が呼び出しに見えた。
 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    // 正規表現リテラル。直前が ( , = : ! & | や行頭のときだけ除算と区別できる
    .replace(/([(,=:!&|?{;]\s*)\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g, '$1RE');
}

describe('GASのコードが、存在しない関数を呼んでいないか', () => {

  test('呼び出している関数が、すべてどこかで定義されている', () => {
    const files = gasFiles();
    assert.ok(files.length > 0, 'gas/*.gs が見つかりません');

    // 定義されている名前を集める（関数宣言・var への関数代入）
    const defined = new Set();
    for (const f of files) {
      const s = strip(f.src);
      for (const m of s.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
      for (const m of s.matchAll(/var\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\(/g)) defined.add(m[1]);
      // var で置かれた値も、呼び出しの対象になりうる（差し替え可能な代役など）
      for (const m of s.matchAll(/var\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
    }

    const missing = [];
    for (const f of files) {
      const s = strip(f.src);
      for (const m of s.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = m[2];
        if (BUILTIN.has(name) || defined.has(name)) continue;
        // その場で作った関数の引数名など、局所的なものは拾わない
        if (/^(function|callback|fn|cb)$/.test(name)) continue;
        missing.push(f.name + ' が ' + name + '() を呼んでいますが、定義がありません');
      }
    }

    assert.deepStrictEqual([...new Set(missing)], [],
      '呼び出し先の無い関数があります。GASは実行するまで気づけません:\n  '
      + [...new Set(missing)].join('\n  '));
  });

  test('応募フォームの設定取得が呼ぶものは、すべて揃っている', () => {
    // ここが落ちると、単価も締切も読めない応募フォームが公開される。
    // 実際に getPrices() を消して本番へ出し、この状態を作ってしまった。
    const api = fs.readFileSync(path.join(GAS, 'Api.gs'), 'utf8');
    const start = api.indexOf('function formConfig_');
    assert.ok(start >= 0, 'formConfig_ が見つかりません');
    const body = strip(api.slice(start, api.indexOf('\n}\n', start)));

    const all = gasFiles().map(f => strip(f.src)).join('\n');
    const defined = new Set(
      [...all.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));

    const called = [...body.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)]
      .map(m => m[2])
      .filter(n => !BUILTIN.has(n));

    const missing = called.filter(n => !defined.has(n));
    assert.deepStrictEqual([...new Set(missing)], [],
      '応募フォームの設定取得が、存在しない関数を呼んでいます: ' + missing.join(', '));
  });
});

describe('ブラウザ側のコードが、存在しない関数を呼んでいないか', () => {
  /**
   * ■ なぜ要るか
   *   ビルド時（Node側）にしかない関数を、実行時のコードから呼んでしまう事故が起きた。
   *   `esc()` がそれで、生成物には定義が入らないまま呼び出しだけが残った。
   *   レンタル欄の描画で落ち、そこから後ろの処理が全部止まり、
   *   **担当社員（必須項目）の選択肢が空になって誰も応募できない**状態になっていた。
   *   文法は正しいので、ビルドもテストも通ってしまう。
   */
  const PAGES = ['index.html', 'admin.html'];

  const BROWSER = new Set([
    'window', 'document', 'navigator', 'location', 'history', 'localStorage',
    'sessionStorage', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout',
    'clearInterval', 'alert', 'confirm', 'prompt', 'crypto', 'console', 'FormData',
    'AbortController', 'Event', 'KeyboardEvent', 'CustomEvent', 'IntersectionObserver',
    'MutationObserver', 'PasswordCredential', 'URLSearchParams', 'Blob', 'URL',
    // ファイルの読み込み（素材アップロード・資料置き場で使う）。
    // ここに足し忘れると誤検出になるが、**誤検出のほうが安全**。
    // 逆（知らないものを黙って通す）だと、esc() をブラウザから呼んで
    // 誰も応募できなくなった過去の事故を見逃す。
    'FileReader', 'File', 'DataTransfer',
    'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date',
    'RegExp', 'Error', 'TypeError', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
    'encodeURIComponent', 'decodeURIComponent', 'Promise', 'Set', 'Map', 'Symbol',
    'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new',
    'else', 'do', 'try', 'throw', 'var', 'this', 'await', 'of', 'in', 'delete', 'void',
  ]);

  for (const page of PAGES) {
    test(page + ' が、定義の無い関数を呼んでいない', () => {
      const file = path.join(ROOT, page);
      assert.ok(fs.existsSync(file), page + ' がありません。先に npm run build を実行してください');
      const html = fs.readFileSync(file, 'utf8');

      // <script> の中身だけを見る（属性や本文の日本語は対象外）
      const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        .map(m => m[1]).join('\n');
      assert.ok(scripts.length > 500, page + ' からスクリプトを取り出せません');

      const s = strip(scripts);

      const defined = new Set();
      for (const m of s.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
      for (const m of s.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
      // function(a, b) の引数名。中で呼ばれることがある
      for (const m of s.matchAll(/function\s*\(([^)]*)\)/g)) {
        m[1].split(',').forEach(a => { const n = a.trim(); if (n) defined.add(n); });
      }

      const missing = new Set();
      for (const m of s.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = m[2];
        if (BROWSER.has(name) || defined.has(name)) continue;
        missing.add(name);
      }

      assert.deepStrictEqual([...missing], [],
        page + ' が、定義の無い関数を呼んでいます。'
        + 'ビルド時にしかない関数（esc など）を実行時のコードから呼んでいないか確認してください:\n  '
        + [...missing].join(', '));
    });
  }
});

describe('生成物の画面コードが、そもそも動く形になっているか', () => {
  /**
   * ■ なぜ要るか
   *   <script> の中に文法エラーがあると、そのブロックは**1行も実行されない**。
   *   しかも window.onerror は発火しないので、画面には
   *   「エラーは出ていないのに入室できない」という、一番読みにくい形で現れる。
   *   実際、切り出しの残骸で `});` が1つ余り、管理ページ全体が動かなくなった。
   *   呼び出し先の検査（上のテスト）は静的解析なので、これを見逃す。
   */
  for (const page of ['index.html', 'admin.html']) {
    test(page + ' の <script> が構文として通る', () => {
      const file = path.join(ROOT, page);
      assert.ok(fs.existsSync(file), page + ' がありません。先に npm run build を実行してください');
      const html = fs.readFileSync(file, 'utf8');
      const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
      assert.ok(blocks.length > 0, page + ' に <script> がありません');
      blocks.forEach((b, i) => {
        assert.doesNotThrow(() => new Function(b[1]),
          page + ' の ' + (i + 1) + '番目の <script> が構文エラーです。'
          + 'この状態だと画面のコードは1行も動かず、しかもエラーも出ません。'
          // 実際にこれで詰まったので、真っ先に疑う場所を書いておく
          + '【よくある原因】生成器（src/build-*.js）は、ページのコードを'
          + 'テンプレートリテラルの中に書いている。そこで改行のエスケープを'
          + '1つだけ書くと、**書き出しの時点で本物の改行になり**、'
          + '生成物の中で文字列リテラルが途中で切れる。'
          + 'ソース側はテンプレートリテラルなので構文として通り、ここで初めて分かる。'
          + 'バックスラッシュを2つ重ねること（コメント行でも同じことが起きる）。'
          + '【調べ方】<script> の中身を build/ に書き出して node --check を掛けると、'
          + '行番号とキャレットが出る。');
      });
    });
  }
});
