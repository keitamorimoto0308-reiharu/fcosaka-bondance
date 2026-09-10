/**
 * **守りが立っている「地面」を検査する。**
 *
 * ■ なぜ要るか（2026-09-10、検証役の指摘）
 *   引き継ぎ書 §6 に、こういう事故が記録されている：
 *
 *   > **「リンクの無い通知は送らない」検査が効かない**
 *   > … 自分で入れた既定値のURLで、条件が常に偽になっていた
 *   > → 教訓：検査の**前提**も検査する
 *
 *   その教訓が、いまはコード内のコメントだけで守られていた。
 *   **前提を見ている検査は1件も無かった。**
 *   誰かが既定値に1文字入れた瞬間、同じ事故が同じ形で戻る。
 *
 * ■ ここで見るもの
 *   「これが○○だから、あの守りが働く」という前提を、名指しで縛る。
 *   守り本体の検査とは別に要る。**本体の検査は、前提が崩れても緑のまま**だから。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join(NL);

const CONFIG = read('gas/Config.gs');
const NOTIFY = read('gas/Notify.gs');

/** CONFIG_DEFAULTS から、その項目の既定値を読む */
function defaultOf(key) {
  const i = CONFIG.indexOf('var CONFIG_DEFAULTS = [');
  assert.ok(i >= 0, 'gas/Config.gs に CONFIG_DEFAULTS がありません');
  const body = CONFIG.slice(i, CONFIG.indexOf(NL + '];', i));
  const re = new RegExp("\\[\\s*'" + key + "'\\s*,\\s*'([^']*)'");
  const m = re.exec(body);
  assert.ok(m, 'CONFIG_DEFAULTS に「' + key + '」がありません');
  return m[1];
}

describe('守りが立っている前提が、崩れていないか', () => {

  /*
   * ■ 前提：採択通知のリンク先URLの既定値は**空**
   *
   *   空だから `no_url` が働き、「リンクの無い採択通知」を止められる。
   *   ここに1文字でも入れると、setup() がその値を設定シートへ書き、
   *   **no_url は二度と発火しない**（過去に実際に起きた形）。
   *
   *   URLは**公開してから、人が設定シートに入れる**。既定値では持たない。
   */
  test('採択通知のリンク先URLの既定値が、空のまま', () => {
    for (const key of ['確定情報フォームURL', '素材アップロードURL']) {
      let v;
      try { v = defaultOf(key); } catch (e) { continue; }   // 項目が無いなら別の話
      assert.strictEqual(v, '',
        NL + '「' + key + '」の既定値が「' + v + '」になっています。' + NL
        + '**これが空でないと、「リンクの無い通知は送らない」守りが二度と働きません。**'
        + NL + 'setup() がこの値を設定シートへ書き、条件が常に偽になります。' + NL
        + '（引き継ぎ書 §6：同じ事故が実際に起きています）' + NL
        + 'URLは公開してから、人が設定シートに入れてください。');
    }
  });

  test('その前提に乗っている守りが、いまも在る', () => {
    // 前提だけ縛っても、守り本体が消えていたら意味がない
    assert.ok(NOTIFY.includes("error: 'no_url'"),
      'gas/Notify.gs から no_url の守りが消えています');
  });

  /*
   * ■ 前提：パスワードの既定値は**空**
   *
   *   空だから「パスワード未設定では管理ページを開かない」が働く。
   *   既定値が入ると、**公開URLが素通しになる**。
   */
  test('パスワードの既定値が、空のまま', () => {
    for (const key of ['管理者パスワード', '一般パスワード']) {
      const v = defaultOf(key);
      assert.strictEqual(v, '',
        NL + '「' + key + '」に既定値が入っています（「' + v + '」）。' + NL
        + '**管理ページは誰でも開けるURLにあります。**'
        + '既定値が入ると、そのまま公開されます。');
    }
  });

  /*
   * ■ 前提：資料フォルダIDの既定値は**空**
   *
   *   空だから、初回に「マイドライブの直下」へ作る経路を通る。
   *   既定値が入っていると、**他人のフォルダに応募企業の提出物を置きに行く**。
   */
  test('資料フォルダIDの既定値が、空のまま', () => {
    let v;
    try { v = defaultOf('資料フォルダID'); } catch (e) { return; }
    assert.strictEqual(v, '',
      NL + '資料フォルダIDに既定値が入っています（「' + v + '」）。' + NL
      + '**応募企業の提出物を、意図しないフォルダへ置きに行きます。**');
  });

  /*
   * ■ 前提：既定値の一覧そのものが、増減を見張られていること
   *
   *   新しく「○○URL」や「○○パスワード」を足したとき、
   *   **上の検査が自動では追いかけない**。ここで気づけるようにする。
   */
  test('URL・パスワードの項目が増えたら、前提の検査も見直す', () => {
    const i = CONFIG.indexOf('var CONFIG_DEFAULTS = [');
    const body = CONFIG.slice(i, CONFIG.indexOf(NL + '];', i));
    const keys = [...body.matchAll(/\[\s*'([^']+)'\s*,/g)].map(m => m[1]);
    const risky = keys.filter(k => /URL|パスワード/.test(k));
    assert.deepStrictEqual(risky.sort(),
      ['一般パスワード', '素材アップロードURL', '確定情報フォームURL',
       '管理ページURL', '管理者パスワード'].sort(),
      NL + 'URL・パスワードの項目が変わりました：' + risky.join('、') + NL
      + '→ **上の「既定値が空か」の検査に、新しい項目を足してください。**' + NL
      + '（前提を見張る検査は、自動では増えません）');
  });
});
