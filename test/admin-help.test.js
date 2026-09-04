/**
 * 管理ページが、**初めて見る人にも分かる**状態になっているか。
 *
 * ■ なぜ要るか
 *   2026-09-02 けいた指摘：
 *   「通知 ON/OFF ってなんだっけ？　私はわかるけど、これをFC大阪さんに
 *     渡した後、初めて見る人たちが困りそう」
 *
 *   説明はソースのコメントに書いても、使う人には届かない。
 *   **画面に出ていること**を検査で担保する。
 *   タブや設定項目を足したとき、説明だけ抜けるのがいちばん起きやすい。
 *
 * ■ 「在るか」だけでなく「短すぎないか」も見る
 *   説明を通すためだけの一言（「設定です」）を書かれると、
 *   検査は緑のまま、使う人は分からないままになる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const SRC = read('src/build-admin.js');
const ADMIN_GS = read('gas/Admin.gs');

/** 説明として意味をなす最低の長さ。「設定です」で通らないように */
const MIN_HELP = 20;

describe('管理ページ：初めて見る人に説明があるか', () => {

  test('すべてのタブに「見かた」がある', () => {
    // タブを足したのに説明を足し忘れる、がいちばん起きやすい
    const tabs = [...SRC.matchAll(/data-tab="([a-z]+)"/g)].map(m => m[1]);
    assert.ok(tabs.length >= 8, 'タブを拾えていません：' + tabs.length);

    const howto = SRC.slice(SRC.indexOf('const HOWTO = {'));
    [...new Set(tabs)].forEach(t => {
      assert.ok(new RegExp('^  ' + t + ': \\[', 'm').test(howto),
        'タブ「' + t + '」の説明（HOWTO）がありません');
    });
  });

  test('「見かた」が、すべてのタブの画面に差し込まれている', () => {
    // 定義しても、画面に置き忘れれば誰の目にも入らない
    const views = [...SRC.matchAll(/<section class="view(?: on)?" id="v-([a-z]+)">/g)]
      .map(m => m[1]);
    assert.ok(views.length >= 8, '画面を拾えていません：' + views.length);
    views.forEach(v => {
      assert.ok(SRC.includes("${howto('" + v + "')}"),
        '画面「' + v + '」に「見かた」が置かれていません');
    });
  });

  test('書き出した admin.html にも出ている', () => {
    // ビルドを通していない、テンプレートの外に書いた、を捕まえる
    const html = read('admin.html');
    const n = (html.match(/class="howto"/g) || []).length;
    assert.ok(n >= 8, 'admin.html の「見かた」が ' + n + ' 個しかありません');
    assert.ok(html.includes('自分が担当社員として選ばれた応募だけ届きます'),
      '通知ON/OFFの説明が画面に出ていません');
  });

  test('設定のすべての項目に説明がある', () => {
    // 設定は追加されやすい。説明はサーバー側（SETTING_KEYS_）が正
    const m = ADMIN_GS.match(/var SETTING_KEYS_ = \[([\s\S]*?)\n\];/);
    assert.ok(m, 'SETTING_KEYS_ が見つかりません');
    const entries = m[1].split(/\{ key:/).slice(1);
    assert.ok(entries.length >= 8, '設定項目を拾えていません：' + entries.length);

    entries.forEach(e => {
      const key = (e.match(/^\s*'([^']+)'/) || [])[1] || '(不明)';
      const help = (e.match(/help:\s*((?:'[^']*'\s*\+?\s*)+)/) || [])[1] || '';
      const text = (help.match(/'([^']*)'/g) || []).map(s => s.slice(1, -1)).join('');
      assert.ok(text.length >= MIN_HELP,
        '設定「' + key + '」の説明が短すぎます（' + text.length + '文字）');
    });
  });

  test('設定の説明が、画面に出るようになっている', () => {
    // サーバーが送っても、画面が捨てていれば意味がない
    assert.ok(/f\.help \?/.test(SRC), '設定の説明を画面に出していません');
    assert.ok(SRC.includes("class=\"hint\""), '説明の置き場（.hint）がありません');
  });

  test('説明が短すぎない（「見かた」の各行）', () => {
    // 終わりの目印は 'function howto(' にする。
    // 'function mdBold' はブラウザ側にも同名があり、
    // そちらが先に見つかって**切り出しが空になった**（実際に起きた）
    const start = SRC.indexOf('const HOWTO = {');
    const end = SRC.indexOf('function howto(', start);
    assert.ok(start >= 0 && end > start, 'HOWTO を切り出せません');
    const howto = SRC.slice(start, end);
    // ['見出し', '本文…'] の本文だけを拾う
    const bodies = [...howto.matchAll(/\['[^']{1,20}',\s*((?:'[^']*'\s*\+?\s*)+)\]/g)]
      .map(m => (m[1].match(/'([^']*)'/g) || []).map(s => s.slice(1, -1)).join(''));
    assert.ok(bodies.length >= 20, '説明の行を拾えていません：' + bodies.length);
    bodies.forEach(t => {
      assert.ok(t.length >= MIN_HELP, '説明が短すぎます：' + t);
    });
  });

  test('関係者の表の見出しが、そのまま用語になっていない', () => {
    // 「通知」だけでは何の通知か分からない。説明側で必ず触れること
    const howto = SRC.slice(SRC.indexOf('const HOWTO = {'));
    const people = howto.slice(howto.indexOf('people: ['), howto.indexOf('settings: ['));
    ['応募フォーム', '管理ページ', '役割', '通知'].forEach(k => {
      assert.ok(people.includes("['" + k + "'"),
        '関係者の「' + k + '」の説明がありません');
    });
  });
});

describe('模擬サーバーと本番で、設定の一覧がずれていないか', () => {

  test('模擬が返す設定は、本番の定義そのもの', () => {
    // 模擬に写しを置いていたら、6項目のまま取り残されていた。
    // あとから足した「確定情報フォームURL」なども模擬に出ず、
    // 説明（help）も出なかった。**模擬で見えないものは見落とす。**
    const MOCK = read('src/mock.js');
    assert.ok(/const SETTING_FIELDS = \(\(\) => \{/.test(MOCK),
      '模擬が設定の一覧を自前で持っています（本番から読むこと）');
    assert.ok(MOCK.includes("'gas', 'Admin.gs'"),
      '模擬が gas/Admin.gs を読んでいません');
    // 写しの痕跡が残っていないか
    assert.ok(!/const SETTING_FIELDS = \[/.test(MOCK),
      '模擬に設定一覧の写しが残っています');
  });

  test('実際に読み込んで、本番と同じ項目数・同じ説明になる', () => {
    const mock = require('../src/mock.js');
    const fromMock = mock.handle({ action: 'adminSettings', token: null });
    // 認証が要るので、ここでは定義の読み取り自体が通ることだけを見る
    assert.ok(fromMock && typeof fromMock === 'object', '模擬が応答しません');

    const m = ADMIN_GS.match(/var SETTING_KEYS_ = \[([\s\S]*?)\n\];/);
    const keys = [...m[1].matchAll(/\{ key: '([^']+)'/g)].map(x => x[1]);
    const MOCK = read('src/mock.js');
    assert.ok(keys.length >= 10, '本番の設定を拾えていません：' + keys.length);
    // 模擬側に本番のキーが直書きされていない＝読み込みに頼っている
    keys.forEach(k => {
      const inMockLiteral = new RegExp("key: '" + k + "'").test(MOCK);
      assert.ok(!inMockLiteral, '模擬に「' + k + '」が直書きされています');
    });
  });
});

describe('説明の強調が、記号のまま画面に出ていないか', () => {

  test('「見かた」に ** が残っていない', () => {
    // 書く側は ** ** で強調を書く。太字にし忘れると、
    // 「**空だと採択通知を送れません。**」とそのまま出る（実際に出た）
    const html = read('admin.html');
    const dds = [...html.matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map(m => m[1]);
    assert.ok(dds.length >= 20, '説明の行を拾えていません：' + dds.length);
    dds.forEach(t => {
      assert.ok(!t.includes('**'), '強調の記号がそのまま出ています：' + t.slice(0, 40));
    });
    assert.ok(dds.some(t => t.includes('<b>')), '太字が1つもありません');
  });

  test('設定の説明も、ブラウザ側で太字になる', () => {
    // renderSettings はブラウザで動くので、mdBold もブラウザ側に要る。
    // 組み立て側にだけ用意しても効かない
    const client = SRC.slice(SRC.indexOf('var esc = function'), SRC.indexOf('function html()'));
    assert.ok(/function mdBold\(s\)\{/.test(client),
      'ブラウザ側に mdBold がありません（設定の説明の ** がそのまま出ます）');
    assert.ok(/mdBold\(f\.help\)/.test(SRC), '設定の説明に mdBold を通していません');
  });

  test('先に esc してから ** を分けている（差し込みを作らない）', () => {
    // 先に分けると、< > が生のまま残って差し込みになる
    const i = SRC.indexOf('function mdBold(s){');
    const fn = SRC.slice(i, SRC.indexOf('}', SRC.indexOf('.join', i)));
    assert.ok(/esc\(s\)\.split\('\*\*'\)/.test(fn),
      'esc より先に ** を分けています（HTMLの差し込みになります）');
  });
});
