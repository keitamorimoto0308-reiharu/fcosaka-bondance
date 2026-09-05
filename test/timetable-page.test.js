/**
 * ② タイムスケジュールの**画面側**を確かめる。
 *
 * サーバー側（timetable-run）と規則（timetable-rules）は別に見ている。
 * ここで見るのは、画面にしか無い約束：
 *   - 断られたら**帯**で出す（トーストにしない・§4-4）
 *   - レーン名を画面に直書きしない（§7-5）
 *   - タブの登録が4か所そろっている（§4-8）
 *
 * ■ 落ちたときの理由が、1件ずつ区別できるようにする
 *   `test/break_timetable.py` が「どの歯止めが働いたか」を出力の文字列で見分ける。
 *   同じ文面を2つの検査に使うと、片方を外しても壊し検査が素通りする。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const SRC = read('src/build-admin.js');

/** 画面の②のコードだけを切り出す（①や他のタブの文字列を巻き込まないため） */
function ttBlock() {
  const s = SRC.indexOf('var TT = { rows: []');
  const e = SRC.indexOf('function bindTimetable()');
  assert.ok(s >= 0 && e > s, '②の画面コードを切り出せませんでした');
  return SRC.slice(s, e);
}

describe('② タイムスケジュールの画面：断り方', () => {

  test('保存を断られたら、帯に出す（トーストにしない）', () => {
    /*
     * トーストは数秒で消える。離席中に流れると「保存されたつもり」になる。
     * **それがいちばん危ない**（§4-4）。
     */
    const s = SRC.indexOf('function ttConflictBanner(');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    assert.ok(s >= 0 && e > s, 'ttConflictBanner がありません');
    const body = SRC.slice(s, e);
    assert.ok(body.indexOf("$('#ttBanner')") >= 0,
      'ぶつかりを帯に出していません（消えない帯で出してください）');
    assert.ok(body.indexOf('toast(') < 0,
      'ぶつかりをトーストで出しています。数秒で消えると「保存されたつもり」になります');
    assert.ok(body.indexOf('.hidden = false') >= 0, '帯を出していません');
  });

  test('自動保存が断られたときも、同じ帯を出す', () => {
    // 黙って失敗させない（§4-5）。自動保存だけ静かに失敗するのがいちばん危ない
    const s = SRC.indexOf('function ttSave(auto)');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(body.indexOf('ttConflictBanner(r)') >= 0,
      '自動保存が断られたときに帯を出していません');
    assert.ok(!/if\s*\(!auto\)[^;]*ttConflictBanner/.test(body),
      '手で押したときだけ帯を出しています。自動保存のときこそ必要です');
  });

  test('「最新を読み込む」を押しても、加えていた変更の一覧は帯に残る', () => {
    const s = SRC.indexOf('function ttTakeLatest(');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(body.indexOf('var log = TT.log.slice()') >= 0,
      '変更の一覧を控えていません。読み込んだ瞬間に消えると、入れ直せません');
    assert.ok(body.indexOf('入れ直して') >= 0, '入れ直しの案内が帯にありません');
  });
});

describe('② タイムスケジュールの画面：直書きしない（§7-5）', () => {

  test('レーン名を画面に直書きしない', () => {
    /*
     * 正は gas/Timetable.gs の TT_LANES_。
     * 画面は adminTimetable が返した配列から組む。
     * 直書きすると、レーンを足したときに**そこだけ古いまま**になる
     * （集計に項目名を直書きしない、と同じ向きの検査）。
     */
    const body = ttBlock();
    ['全体', 'イベント', '備考'].forEach(name => {
      assert.ok(body.indexOf("'" + name + "'") < 0,
        'レーン名「' + name + '」が画面に直書きされています');
    });
  });

  test('規則（ずらし・共存）を画面の中に書かない', () => {
    // 画面の中に書くとテストから呼べない（§9 手順4の肝）
    assert.ok(SRC.indexOf('rulesSource()') >= 0,
      '規則を src/timetable-rules.js から書き出していません');
    const body = ttBlock();
    assert.ok(body.indexOf('function ttPushChain') < 0,
      'ずらしの規則が画面の中に書かれています。テストから呼べません');
  });

  test('自動保存の間隔を画面に直書きしない', () => {
    const body = ttBlock();
    assert.ok(body.indexOf('TT.autosaveMin') >= 0,
      '自動保存の間隔をサーバーから受け取っていません');
  });
});

describe('② タイムスケジュールの画面：タブの登録（§4-8 の4か所）', () => {

  test('タブのボタンがある', () => {
    assert.ok(SRC.indexOf('data-tab="tt"') >= 0, 'タブのボタンがありません');
  });

  test('タブの中身（section）がある', () => {
    assert.ok(SRC.indexOf('id="v-tt"') >= 0, 'タブの中身がありません');
  });

  test('#tt で直接開ける（許可リストに入っている）', () => {
    const i = SRC.indexOf("var parts = location.hash");
    const body = SRC.slice(i, i + 400);
    assert.ok(body.indexOf("'tt'") >= 0,
      'applyHash の許可リストに tt がありません。#tt のリンクが効きません');
  });

  test('タブを開いたら読み直す', () => {
    assert.ok(SRC.indexOf("if (name === 'tt') loadTimetable();") >= 0,
      'タブを開いたときに読み直していません。古い時間割のまま上書きします');
  });

  test('この画面の見かた（HOWTO）がある', () => {
    // test/admin-help.test.js も見張っているが、壊し検査から個別に見分けたい
    assert.ok(/\btt:\s*\['タイムスケジュールの見かた'/.test(SRC),
      "HOWTO['tt'] がありません");
  });
});

describe('② タイムスケジュールの画面：見た目で死ぬところ', () => {

  test('CSSの入口のクラスは、全部 tt- で始める（①の名前と混ざらない）', () => {
    /*
     * 見るのは**セレクタの先頭のクラス**だけ。
     * `.tt-bar .sp` のような入れ子の中の名前は、先祖で囲われているので混ざらない
     * （①も `.sch-bar .sp` と書いている）。
     * 混ざるのは `.alert{...}` のような**素の名前**のほうで、
     * 設計案v2で実際にそれが①の .alert に当たって勝手に色が付いた（§4-7）。
     */
    const s = SRC.indexOf('② タイムスケジュール（当日の時間割）');
    const raw = SRC.slice(s, SRC.indexOf('@media (min-width:701px)', s));
    // 説明のコメントは見ない（コメントで落ちる検査は検査にならない）
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = [];
    css.replace(/(^|\})([^{}]+)\{/g, (m, a, sel) => {
      sel.split(',').forEach(one => {
        const t = one.trim();
        if (!t || t.charAt(0) === '@') return;
        const head = t.split(/[\s>+~]/)[0];
        const cls = head.match(/^\.([a-zA-Z][\w-]*)/);
        if (cls && cls[1].indexOf('tt-') !== 0) bad.push(cls[1]);
      });
      return m;
    });
    assert.deepStrictEqual([...new Set(bad)], [],
      '②のCSSに tt- で始まらない入口のクラスがあります: ' + bad.join(', '));
  });

  test('短い予定は1行に詰める（枠からはみ出して次の予定を隠さない）', () => {
    // 2026-09-05、10分の予定が最低高さまで引き伸ばされて次の予定に覆われた。
    // HTMLもJSも正しいのに**目で見るまで気づけない**形だった
    assert.ok(SRC.indexOf('var slim = !isMark && hh < 40;') >= 0,
      '短い予定を1行にしていません。枠からはみ出して次の予定に重なります');
  });
});
