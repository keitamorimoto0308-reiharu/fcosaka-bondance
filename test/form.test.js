/**
 * 応募フォームの受け入れテスト（生成物 index.html を読んで確かめる）。
 *
 * ここで守りたいのは、けいたさんの指摘で直した「戻れないこと」と
 * 「概要帯の並びが崩れること」が、次の変更で黙って戻らないこと。
 *
 * 実行: npm test
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const C = require('../src/content.js');

const FORM = path.join(ROOT, 'index.html');
const html = () => {
  assert.ok(fs.existsSync(FORM), 'index.html がありません。先に npm run build を実行してください');
  return fs.readFileSync(FORM, 'utf8');
};

describe('概要帯（ファクト帯）の並び', () => {

  test('段が欠けないよう、項目数は列数で割り切れる', () => {
    // 6項目を4列に並べると 4+2 になり、右下が2枠ぶん空いて「情報が足りない」ように見える。
    // 項目を足す／減らすときは、列数のほうも一緒に見直すこと。
    const n = C.FACTS.length;
    const src = fs.readFileSync(path.join(ROOT, 'src', 'build-form.js'), 'utf8');
    const m = src.match(/\.facts-grid\{[^}]*repeat\((\d+),/g) || [];
    const cols = m.map(x => Number(x.match(/repeat\((\d+),/)[1]));
    assert.ok(cols.length >= 2, '列数の指定が見つかりません（スマホ用とPC用の2つが要ります）');
    for (const c of cols) {
      assert.strictEqual(n % c, 0,
        '概要が' + n + '項目なのに' + c + '列で並べています。'
        + '割り切れないと最後の段が欠けます（列数か項目数のどちらかを直してください）');
    }
  });

  test('1枠だけ背景色を変えて浮かせていない', () => {
    // 揃った帯の中で1枠だけ色が違うと、強調ではなく異物に見える。
    // キックオフの強調はヒーローの水色バッジが担っている。
    assert.ok(!C.FACTS.some(f => f.strong),
      '概要帯の一部だけを強調しています。強調はヒーローのバッジで行ってください');
    assert.ok(!/\.fact\.strong\{/.test(fs.readFileSync(path.join(ROOT, 'src', 'build-form.js'), 'utf8')),
      '使われていない強調用のCSSが残っています');
  });
});

describe('応募したあとに、行き止まりにしない', () => {

  test('完了画面から募集要項に戻る手段がある', () => {
    // 完了画面しか出ていないと、内容を見返すことも、戻ることもできなくなる。
    const h = html();
    assert.ok(h.includes('id="back-to-intro"'), '完了画面に戻るボタンがありません');
    assert.ok(h.includes('id="applied-banner"'), '戻った先に受付済みの表示がありません');
    assert.ok(h.includes('id="applied-receipt"'), '戻った先で受付IDを見返せません');
  });

  test('ブラウザの「戻る」を受け止めている', () => {
    const h = html();
    assert.ok(h.includes("history.pushState"), '履歴を積んでいないため、戻るとページを離れてしまいます');
    assert.ok(h.includes("addEventListener('popstate'") || h.includes('addEventListener("popstate"'),
      '戻る操作を受け止めていません');
  });

  test('受け付けたあとは、応募へ誘う導線を出さない', () => {
    // 戻れるようにした副作用で二度送りできると、台帳に同じ会社の行が2本立つ。
    const h = html();
    assert.ok(/body\.applied[^{]*\.btn-brand\{display:none\}/.test(h),
      '受付後もヒーローの応募ボタンが出ています（二重応募につながります）');
    assert.ok(h.includes('!SUBMITTED'),
      '受付後も常駐の応募ボタンが出ます');
    assert.ok(!/showIntroOnly[\s\S]{0,400}#form-area'\)\.classList\.remove\('hidden'\)/.test(h),
      '募集要項に戻ったときに入力欄まで出しています（二重応募につながります）');
  });
});

describe('応募済み情報の修正：入口の置き方', () => {
  const HTML = () => {
    const f = path.join(ROOT, 'index.html');
    assert.ok(fs.existsSync(f), 'index.html がありません。先に npm run build を実行してください');
    return fs.readFileSync(f, 'utf8');
  };

  test('入口が、フォームの先頭と応募ボタンの下の2か所にある', () => {
    // 一番下まで行かないと見つからないと、すでに応募した方が
    // 新規で出し直してしまい、同じ会社の応募が2件立つ
    const h = HTML();
    const buttons = h.match(/<button[^>]*class="linkbtn js-open-edit"[^>]*>/g) || [];
    assert.strictEqual(buttons.length, 2,
      '入口の数が2つではありません（' + buttons.length + '個）');
    assert.ok(h.includes('edit-entry-top'), 'フォーム先頭の入口がありません');
  });

  test('入口を id ではなくクラスで拾っている', () => {
    // id は1ページに1つしか置けない。2か所目を足したとき、
    // id で拾っていると片方だけ反応しなくなる（見た目には気づけない）
    const h = HTML();
    assert.ok(!/id="open-edit"/.test(h),
      '入口が id で置かれています（2か所目が反応しません）');
    assert.ok(/\$\$\('\.js-open-edit'\)/.test(h),
      '入口をまとめて配線していません');
  });

  test('修正中は、どちらの入口も隠す', () => {
    // 修正中に「修正の入口」が出ていると、操作が入れ子になって混乱する
    const h = HTML();
    assert.ok(/\$\$\('\.edit-entry'\)[\s\S]{0,120}add\('hidden'\)/.test(h),
      '修正中に入口を隠していません（片方だけ隠していないか確認してください）');
  });
});
