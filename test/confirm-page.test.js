/**
 * 出店確定情報フォーム（confirm.html）の検査。
 *
 * ■ 一番痛い形は「公開し忘れ」
 *   採択通知メールは取り消せない。リンク先が404だと、
 *   50社に「出店決定」と壊れたリンクを配った状態になる。
 *   ビルドされること・公開物に入ることを、ここで固定する。
 *
 * ■ 次に痛いのは「条件つきの必須をブラウザから外される」
 *   火気と保険は飲食のみ。条件は応募段階の boothTypes を見る。
 *   画面がこれを入力から作れる形になっていると、書き換えて回避できる。
 *   （サーバー側でも台帳の値で上書きしているが、画面側でも塞ぐ）
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const S = require('../src/schema.js');
const C = require('../src/content.js');

describe('出店確定情報フォームのページ', () => {

  test('ビルドされている', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'confirm.html')),
      'confirm.html がありません。先に npm run build を実行してください');
  });

  test('npm run build に組み込まれている', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.scripts.build.includes('build-confirm'),
      'build に build-confirm.js が入っていません（作り忘れたまま公開されます）');
  });

  test('公開物に入る（採択通知のリンク先が404にならない）', () => {
    // 送信は取り消せない。リンク先が無い状態で送ると取り返しがつかない
    const deploy = read('src/deploy.js');
    assert.ok(/copy\('confirm\.html', 'confirm\.html'\)/.test(deploy),
      'deploy.js が confirm.html を公開していません。'
      + '採択通知のリンクが404になります');
  });

  test('確定情報の項目が、すべて画面にある', () => {
    const html = read('confirm.html');
    const missing = S.confirmFields()
      .filter(f => !html.includes('data-field="' + f.key + '"'))
      .map(f => f.key);
    assert.deepStrictEqual(missing, [],
      '画面に無い項目があります：' + missing.join(', '));
  });

  test('応募段階の項目を、この画面で聞いていない', () => {
    const html = read('confirm.html');
    const leaked = S.applyFields()
      .filter(f => f.type !== 'honeypot')
      .filter(f => html.includes('data-field="' + f.key + '"'))
      .map(f => f.key);
    assert.deepStrictEqual(leaked, [],
      '応募時に聞いた項目を、もう一度聞いています：' + leaked.join(', '));
  });

  test('条件判定の値を、画面の入力から作っていない', () => {
    // ここを入力から作れる形にすると、飲食なのに「飲食ではない」と偽って
    // 火気・保険の必須を回避できる
    const src = read('src/build-confirm.js');
    assert.ok(/var v = \{ boothTypes: STATE\.boothTypes \};/.test(src),
      'boothTypes をサーバーの応答から持っていません');
    assert.ok(/delete v\.boothTypes;/.test(src),
      '保存時に boothTypes を落としていません（サーバーへ送ると偽装の入口になります）');
  });

  test('紙面から外した行が、すべて載っている', () => {
    // 募集要項から外した行き先がここ（content.js の PDF.afterAcceptRows）。
    // メールにも書くが、メールは流れる。入力するこの画面にも置く。
    const html = read('confirm.html');
    const { afterAcceptRows } = require('../src/build-confirm.js');
    const rows = afterAcceptRows();
    // 件数は直書きしない。紙面へ戻した行があると、検査だけ古いまま残る
    // （2026-09-02 に「包材について」を紙面へ戻して、実際にここが落ちた）
    assert.ok(rows.length >= 3, '紙面から外した行を拾えていません：' + rows.length);
    rows.forEach(r => {
      assert.ok(html.includes(r.k), '「' + r.k + '」が確定情報フォームにありません');
    });
  });

  test('デザインは応募フォームと同じコードを使っている', () => {
    // 仕様書§6-3。見た目を似せて2つ書くと、片方だけ直したときに必ずずれる
    const src = read('src/build-confirm.js');
    assert.ok(/FORM\.css\(\)/.test(src), 'CSSを共有していません');
    assert.ok(/FORM\.fieldHtml\(f\)/.test(src), '項目の描画を共有していません');
  });

  test('検索に出さず、トークンを外部へ漏らさない', () => {
    const html = read('confirm.html');
    assert.ok(/name="robots" content="noindex/.test(html),
      '検索避けがありません（専用リンクのページです）');
    // URLにトークンが乗るので、外部への参照元送信を止める
    assert.ok(/name="referrer" content="no-referrer"/.test(html),
      'referrer を止めていません（URLのトークンが外部に渡りえます）');
  });

  test('送信先が入っている（押しても何も起きないページを作らない）', () => {
    const html = read('confirm.html');
    const live = JSON.parse(read('src/endpoint.live.json')).gasUrl;
    assert.ok(html.includes(live),
      'confirm.html に稼働中の送信先が入っていません');
  });

  test('画面のコードが構文として通る', () => {
    const html = read('confirm.html');
    const m = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(m, '画面のコードが見つかりません');
    assert.doesNotThrow(() => new Function(m[1]),
      'confirm.html の <script> が構文エラーです。'
      + 'この状態だと画面は1行も動かず、しかもエラーも出ません');
  });

  test('模擬サーバーが confirm.html を配れる', () => {
    // 本番に触らずに確かめられる状態を保つ。
    // 配れないと、この画面だけ「実際に動かして確認」ができなくなる
    const mock = read('src/mock.js');
    assert.ok(/url === '\/confirm\.html'/.test(mock),
      '模擬サーバーが confirm.html を配っていません');
    assert.ok(/confirmLoad|confirmSave/.test(mock),
      '模擬サーバーに確定情報のAPIがありません');
  });

  test('模擬サーバーが、管理ページのトークン無しで確定情報を返す', () => {
    // 管理ページのトークンを持たない事業者が使う画面なので、
    // 認証のあとに置くと必ず unauthorized になる（実際そうなっていた）。
    //
    // ⚠ ここは最初、分岐の**位置**を indexOf で見ていた。
    //   `if (false && …)` で無効化しても位置は変わらず素通りし、
    //   名前を `xconfirmLoad` に変えても正規表現が緩くて素通りした。
    //   形を見る検査を2回直しても駄目だったので、**実際に呼ぶ**形にした。
    const MOCK = require('../src/mock.js');
    const accepted = MOCK.DB.rows.find(r => r['ステータス'] === '採択');
    assert.ok(accepted, '模擬データに採択の行がありません');

    const r = MOCK.handle({
      action: 'confirmLoad',
      id: accepted['受付ID'],
      t: MOCK.mockToken(accepted['受付ID']),
      // token（管理ページの鍵）は**わざと渡さない**
    });
    assert.notStrictEqual(r.error, 'unauthorized',
      '模擬の確定情報APIが管理ページの認証を要求しています。'
      + '事業者は管理ページの鍵を持たないので、必ず弾かれます');
    assert.strictEqual(r.ok, true, '確定情報を返していません：' + JSON.stringify(r));
    assert.strictEqual(r.receiptId, accepted['受付ID']);
  });

  test('模擬サーバーが、採択者以外と鍵違いを拒む', () => {
    // 実際に呼んで確かめる。模擬が本番より緩いと、
    // 模擬で確かめて良しとした挙動が本番と違う、という一番まずい形になる
    const MOCK = require('../src/mock.js');
    const accepted = MOCK.DB.rows.find(r => r['ステータス'] === '採択');
    const other = MOCK.DB.rows.find(r => r['ステータス'] !== '採択');

    const wrongKey = MOCK.handle({ action: 'confirmLoad',
      id: accepted['受付ID'], t: MOCK.mockToken('SB-9999') });
    assert.strictEqual(wrongKey.ok, false, '鍵が違うのに開けます');
    assert.strictEqual(wrongKey.error, 'denied');

    const notAccepted = MOCK.handle({ action: 'confirmLoad',
      id: other['受付ID'], t: MOCK.mockToken(other['受付ID']) });
    assert.strictEqual(notAccepted.ok, false, '採択されていないのに開けます');
    assert.strictEqual(notAccepted.error, 'not_accepted');

    // 他社の鍵で保存できない
    const hijack = MOCK.handle({ action: 'confirmSave',
      id: accepted['受付ID'], t: MOCK.mockToken(other['受付ID']),
      values: { siteManagerName: '乗っ取り' } });
    assert.strictEqual(hijack.ok, false, '他社の鍵で保存できます');
  });
});
