/**
 * 詳細欄のURLのリンク化（src/linkify.js）を、実際に呼んで確かめる。
 *
 * ■ なぜ「呼べるようにして呼ぶ」のか
 *   引き継ぎ書§9のとおり、ソース文字列を見る検査は**順序の取り違え**には有効だが、
 *   **入力に対する振る舞い**は捕まえられない。
 *   ここで守りたいのは「javascript: が通らないこと」で、これは入力の話なので、
 *   関数を呼んで返り値を見るしかない。
 *
 * ■ 前提（検証役に伝えているものと同じ）
 *   詳細欄は**全員が書ける**。管理ページは応募企業の個人情報を読める画面。
 *   つまりここは、台帳の中身を外へ持ち出すための足がかりになりうる。
 *
 * ■ esc は引数で渡す
 *   本番では画面側の esc（src/build-admin.js:618）がそのまま渡る。
 *   ここでは**それと1文字も違わないもの**を置く。違うものを置くと、
 *   テストは通るのに本番だけ抜ける、といういちばん困る形になる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { linkifyDetail } = require('../src/linkify.js');

/** src/build-admin.js の画面側 esc と同じもの */
const esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

const L = (s) => linkifyDetail(s, esc);

describe('詳細欄のURLのリンク化', () => {

  describe('リンクにしてよいものだけをリンクにする', () => {
    test('https:// はリンクになる', () => {
      const out = L('資料は https://example.com/a です');
      assert.match(out, /<a href="https:\/\/example\.com\/a"/,
        'リンクが作られていません（エスケープとリンク化の順番が逆だと、こうなります）: ' + out);
      assert.match(out, /target="_blank"/,
        'target="_blank" がありません: ' + out);
      assert.match(out, /rel="noopener noreferrer"/,
        'rel="noopener noreferrer" がありません。開いた先から window.opener でこの管理ページを操作できます: ' + out);
    });

    test('http:// もリンクになる', () => {
      assert.match(L('http://example.com'), /<a href="http:\/\/example\.com"/);
    });

    test('javascript: はリンクにならない（そのままの文字として出る）', () => {
      const out = L('javascript:alert(1)');
      assert.ok(!out.includes('<a '), 'リンクになってしまいました: ' + out);
      assert.ok(!out.includes('href'), 'href が出てしまいました: ' + out);
      assert.ok(out.includes('javascript:alert(1)'), '文字としては残るはずです: ' + out);
    });

    test('data: と vbscript: はリンクにならない', () => {
      for (const s of ['data:text/html,<h1>x</h1>', 'vbscript:msgbox(1)', 'file:///c:/']) {
        const out = L(s);
        assert.ok(!out.includes('<a '), s + ' がリンクになりました: ' + out);
      }
    });

    test('javascript: の後ろに https:// を隠しても、リンク先は https:// の側だけ', () => {
      // ここが素通りすると href="javascript:..." が作れてしまう
      const out = L('javascript:https://evil.example/x');
      const m = out.match(/href="([^"]*)"/);
      assert.ok(m, 'リンクが1つも作られていません: ' + out);
      assert.strictEqual(m[1], 'https://evil.example/x');
      assert.ok(!m[1].includes('javascript'), 'href に javascript が入りました: ' + m[1]);
    });

    test('スキームだけ（https://）はリンクにしない', () => {
      const out = L('https:// と書いただけ');
      assert.ok(!out.includes('<a '), 'リンクになりました: ' + out);
    });
  });

  describe('差し込み（HTMLとして解釈されること）を許さない', () => {
    test('<img onerror=1> はタグとして出ない', () => {
      const out = L('<img src=x onerror=alert(1)>');
      assert.ok(!out.includes('<img'), 'タグが生で出ました: ' + out);
      assert.ok(out.includes('&lt;img'), 'エスケープされていません: ' + out);
    });

    test('引用符でhrefから抜け出せない', () => {
      // 「先にリンク化してから esc」だと、この形で属性の外に出られる
      const out = L('https://example.com/" onmouseover="alert(1)');
      assert.ok(!out.includes('onmouseover="alert(1)"'),
        '属性の外に出られました: ' + out);
      assert.ok(!/onmouseover=(?!&quot;)/.test(out),
        '生の属性ができました: ' + out);
    });

    test('URLの直後の <script> を飲み込まない（&lt; で止まる）', () => {
      const out = L('https://example.com<script>alert(1)</script>');
      const m = out.match(/href="([^"]*)"/);
      assert.ok(m, 'リンクが作られていません: ' + out);
      assert.strictEqual(m[1], 'https://example.com',
        'href が &lt;script&gt; まで飲み込みました: ' + m[1]);
      assert.ok(!out.includes('<script'), 'script タグが生で出ました: ' + out);
    });

    test('タグを含む文でも、リンク部分だけが <a> になる', () => {
      const out = L('<b>太字</b> と https://example.com/x');
      assert.ok(out.includes('&lt;b&gt;'), 'b タグがエスケープされていません: ' + out);
      assert.strictEqual((out.match(/<a /g) || []).length, 1);
    });
  });

  describe('リンク先が、書いた人の意図どおりであること', () => {
    test('クエリの & は &amp; になり、二重にエスケープされない', () => {
      const out = L('https://example.com/s?a=1&b=2');
      const m = out.match(/href="([^"]*)"/);
      assert.strictEqual(m[1], 'https://example.com/s?a=1&amp;b=2');
      assert.ok(!m[1].includes('&amp;amp;'), '二重にエスケープされました: ' + m[1]);
    });

    test('末尾の句読点はリンクに含めない', () => {
      for (const [src, want] of [
        ['詳細は https://example.com/a。', 'https://example.com/a'],
        ['詳細は https://example.com/a.', 'https://example.com/a'],
        ['（https://example.com/a）', 'https://example.com/a'],
        ['https://example.com/a、次に', 'https://example.com/a'],
      ]) {
        const m = L(src).match(/href="([^"]*)"/);
        assert.ok(m, 'リンクが作られていません: ' + src);
        assert.strictEqual(m[1], want, src + ' → ' + m[1]);
      }
    });

    test('URLの直後に日本語が続いても、そこで止まる', () => {
      // **日本語は空白で区切らない**。「空白以外は全部URL」と書くと、
      // 後ろの本文を丸ごとリンクにする。英語で試すと気づけない形。
      for (const [src, want] of [
        ['https://example.com/aあいう', 'https://example.com/a'],
        ['資料はhttps://example.com/xをご覧ください', 'https://example.com/x'],
        ['https://example.com/a と https://example.com/b', 'https://example.com/a'],
      ]) {
        const m = L(src).match(/href="([^"]*)"/);
        assert.ok(m, 'リンクが作られていません: ' + src);
        assert.strictEqual(m[1], want,
          'URLの後ろの日本語まで飲み込みました: ' + src + ' → ' + m[1]);
      }
    });

    test('パスの途中のピリオドやハイフンは削らない', () => {
      const m = L('https://example.com/a.b-c/d_e').match(/href="([^"]*)"/);
      assert.strictEqual(m[1], 'https://example.com/a.b-c/d_e');
    });

    test('1つの文に2つのURLがあれば、2つともリンクになる', () => {
      const out = L('https://a.example/1 と https://b.example/2');
      assert.strictEqual((out.match(/<a /g) || []).length, 2);
    });

    test('リンクの表示文字と href が一致する', () => {
      const out = L('https://example.com/s?a=1&b=2');
      const m = out.match(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/);
      assert.ok(m, 'リンクの形が想定と違います: ' + out);
      assert.strictEqual(m[1], m[2], '表示とリンク先が違います（偽装できます）');
    });
  });

  describe('壊れた入力で落ちない', () => {
    test('null / undefined / 数値 / 空文字', () => {
      assert.strictEqual(L(null), '');
      assert.strictEqual(L(undefined), '');
      assert.strictEqual(L(''), '');
      assert.strictEqual(L(0), '0');
    });

    test('URLが1つも無ければ、esc しただけのものと同じ', () => {
      const s = 'ふつうの文章 <b>&</b> "引用"';
      assert.strictEqual(L(s), esc(s));
    });
  });

  describe('この関数は、画面に埋め込める形になっているか', () => {
    /**
     * `.toString()` で画面に書き出す方式（src/schema.js と同じ）を使うので、
     * **関数の外側のものを参照していると、埋め込んだ瞬間に動かなくなる**。
     * ソースを読むだけでは気づけないので、外のスコープが空の場所で実行してみる。
     */
    test('外側のスコープが無くても動く（esc は引数で受け取っている）', () => {
      const src = linkifyDetail.toString();
      // eslint-disable-next-line no-new-func
      const isolated = new Function('return (' + src + ');')();
      const out = isolated('https://example.com/a と <b>', esc);
      assert.match(out, /<a href="https:\/\/example\.com\/a"/);
      assert.ok(out.includes('&lt;b&gt;'));
    });

    test('モジュールの外の変数を名前で呼んでいない', () => {
      // ファイルを読むと module.exports まで入ってしまう。
      // 画面に出るのは .toString() の中身だけなので、**それだけ**を見る。
      const body = linkifyDetail.toString();
      // require / module / process などを参照していたら、埋め込み先で落ちる
      for (const bad of ['require(', 'module.', 'process.', '__dirname']) {
        assert.ok(!body.includes(bad),
          '関数の中で ' + bad + ' を使っています。画面に埋め込むと落ちます');
      }
    });
  });
});
