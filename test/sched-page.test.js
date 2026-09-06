/**
 * ① 制作スケジュール表の**画面側**（Excelの取り込みと、タブ上の記録）。
 *
 * 見るのは、画面にしか無い約束：
 *   - **赤があるあいだ「取り込む」を押せない**（§4-2）
 *   - **行を押したら、①でいま使っている編集パネルを開く**（新しい編集画面を作らない・§1-3）
 *   - **判定を画面に写さない**（直したあとはサーバーに見直させる）
 *   - タブの上に「最後に誰がいつ」を出す。**無いものは出さない**（§5-4）
 *
 * ■ 落ちたときの理由が、1件ずつ区別できるようにする
 *   `test/break_sched.py` が「どの歯止めが働いたか」を出力の文字列で見分ける。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const SRC = read('src/build-admin.js');

/** 関数の中身を1つ切り出す */
function body(name) {
  const s = SRC.indexOf(name);
  assert.ok(s >= 0, name + ' がありません');
  const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
  assert.ok(e > s, name + ' の終わりが見つかりません');
  return SRC.slice(s, e);
}

describe('① 画面：Excelの取り込みの入口（§4-1）', () => {

  test('「Excelから取り込む」のボタンがある', () => {
    assert.ok(SRC.indexOf('id="schImport"') >= 0, '取り込みのボタンがありません');
  });

  test('選べるのは xlsx だけにしておく（画面の親切。守りはサーバー側）', () => {
    assert.match(SRC, /id="schFile"[^>]*accept="\.xlsx"/,
      'ファイル選択が xlsx に絞られていません');
  });

  test('下見の表を組む関数がある', () => {
    assert.ok(SRC.indexOf('function schImpRender(') >= 0, '下見の表を組んでいません');
  });
});

describe('① 画面：赤があるあいだは取り込めない（§4-2）', () => {

  test('赤が1つでもあれば、「取り込む」を押せない', () => {
    const b = body('function schImpRender(');
    assert.ok(/disabled\s*=\s*[^;]*bad/.test(b) || b.indexOf('.disabled = !!IMP.counts.bad') >= 0,
      '赤があっても「取り込む」を押せます');
  });

  test('押せないボタンは、押せないように見える', () => {
    // 赤が2行あるのに「取り込む」が濃いままだった（2026-09-07・撮影して発覚）。
    // ②の検証役が同じ形を指摘している
    const flat = SRC.split(String.fromCharCode(10)).join('');
    assert.ok(/\.sch-imp[^{]*button\[disabled\]\{[^}]*opacity/.test(flat),
      '押せないボタンが、押せるように見えます');
  });

  test('件数の内訳を出す（追加・更新・変わらない・Excelに無い）', () => {
    const b = body('function schImpRender(');
    ['追加', '更新', '変わらない', 'Excelに無い'].forEach(word => {
      assert.ok(b.indexOf(word) >= 0, '下見に「' + word + '」が出ていません');
    });
  });

  test('問題のあるセルに、理由を添える', () => {
    const b = body('function schImpRender(');
    assert.ok(b.indexOf('title="') >= 0, 'セルに理由を添えていません');
    assert.ok(b.indexOf('sch-imp-bad') >= 0, '問題のあるセルに印を付けていません');
  });
});

describe('① 画面：直すのは既存の編集パネル（§1-3）', () => {

  test('行を押したら schOpen を呼ぶ（新しい編集画面を作らない）', () => {
    const b = SRC.slice(SRC.indexOf('function bindSched()'));
    assert.ok(/data-imp[\s\S]{0,400}schOpen\(/.test(b),
      '下見の行から、①の編集パネルを開いていません');
  });

  test('取り込みの編集では、台帳に保存しない', () => {
    // 下見の行を直しただけで台帳が書き換わってはいけない
    const b = body('function schSave()');
    assert.ok(b.indexOf('IMP.editing') >= 0,
      '取り込みの編集と、台帳の保存を見分けていません');
  });

  test('直したあとは、サーバーに見直させる（判定を画面に写さない）', () => {
    const b = SRC.slice(SRC.indexOf('function schImpApplyEdit'));
    assert.ok(b.slice(0, 900).indexOf("adminSchedImportRead") >= 0,
      '直したあとの見直しを、画面でやっています（サーバーと規則がズレます）');
  });
});

describe('① 画面：最後に誰がいつ（§5-4）', () => {

  test('タブの上に出す場所がある', () => {
    assert.ok(SRC.indexOf('id="schStamps"') >= 0, 'タブの上に出す場所がありません');
  });

  test('無いものは出さない', () => {
    const b = body('function schRenderStamps(');
    assert.ok(b.indexOf('.at') >= 0, '記録があるかどうかを見ていません');
    assert.ok(/if \(!/.test(b) || b.indexOf('filter(') >= 0,
      '記録が無いものも出しています（まだ取り込んでいなければ出しません）');
  });

  test('編集・取り込み・書き出しの3つを出す', () => {
    const b = body('function schRenderStamps(');
    ['最終編集', '取り込み', '書き出し'].forEach(word => {
      assert.ok(b.indexOf(word) >= 0, '「' + word + '」が出ていません');
    });
  });
});

describe('① 画面：CSSの名前（①の接頭辞をはみ出さない）', () => {

  test('取り込みのCSSは sch- で始まる', () => {
    const s = SRC.indexOf('/* 取り込みの下見');
    assert.ok(s > 0, '取り込みのCSSが見つかりません');
    const css = SRC.slice(s, SRC.indexOf('/*', s + 10));
    const bad = [];
    css.replace(/(^|\})([^{}]+)\{/g, (m, a, sel) => {
      sel.split(',').forEach(one => {
        const t = one.trim();
        if (!t || t.charAt(0) === '@') return;
        const head = t.split(/[\s>+~]/)[0];
        const cls = head.match(/^\.([a-zA-Z][\w-]*)/);
        if (cls && cls[1].indexOf('sch-') !== 0) bad.push(cls[1]);
      });
      return m;
    });
    assert.deepStrictEqual([...new Set(bad)], [],
      '取り込みのCSSに sch- で始まらない入口のクラスがあります: ' + bad.join(', '));
  });
});
