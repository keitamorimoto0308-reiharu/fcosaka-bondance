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

describe('② タイムスケジュールの画面：検証役3体が見つけた穴（2026-09-05）', () => {

  test('仮のIDは、送る直前に外す（サーバーの8桁を緩めない）', () => {
    /*
     * **②の中心機能が一度も通らない状態だった。**
     * 画面が新しい予定に振る仮IDは、サーバーの `/^[0-9a-zA-Z]{8}$/` を
     * わざと外した形にしてある（見分けが付くように）。
     * そのまま送ると100%断られるので、`ttSave` が外す。
     */
    const src = SRC;
    const s = src.indexOf('function ttSave(auto)');
    const e = src.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = src.slice(s, e);
    assert.ok(body.indexOf('ttStripTempIds(') >= 0,
      '仮のIDを外さずに送っています。新しい予定が1件も保存できません');
    assert.ok(src.indexOf('function ttStripTempIds(') >= 0, 'ttStripTempIds がありません');
    assert.ok(src.indexOf('function ttIsTempId(') >= 0, 'ttIsTempId がありません');
  });

  test('仮のIDは、サーバーが通す形と必ず違う', () => {
    // 同じ形にすると「外し忘れても偶然通る」ことがあり、外し忘れに気づけない
    const s = SRC.indexOf('function ttTempId()');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(body.indexOf('tmp-') >= 0,
      '仮のIDに、ひと目で分かる印が付いていません');
  });

  test('保存の最中は、次の保存を始めない', () => {
    /*
     * 送信中の門番が無いと：
     *   ・「保存する」を連打すると、**自分と自分がぶつかった**赤い帯が出る
     *   ・自動保存と手で押した保存が重なると、同じことが起きる
     */
    const s = SRC.indexOf('function ttSave(auto)');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(/if \(TT\.saving\)/.test(body),
      '保存中かどうかを見ていません（連打すると自分同士でぶつかります）');
  });

  test('保存の最中に加えた変更を、捨てない', () => {
    /*
     * 保存の返事が返る前に予定を動かすと、返事が届いた瞬間に
     * `TT.rows = r.rows` で**その変更が消え**、しかも「たった今保存しました」と出た。
     * 取り消し（Ctrl+Z）でも戻せない。
     * 送った内容と、いまの内容が違っていたら、いまのほうを残す。
     */
    const s = SRC.indexOf('function ttSave(auto)');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(body.indexOf('TT.dirtySince') >= 0,
      '保存中に加えた変更を見分けていません（黙って消えます）');
  });

  test('保存していないのに「保存しました」と出さない', () => {
    // 読み込み直後と、ぶつかって「最新を読み込む」を押した直後に出ていた。
    // **自分の保存は1文字も通っていない**のに「保存しました」と読める
    ['function loadTimetable()', 'function ttTakeLatest('].forEach(name => {
      const s = SRC.indexOf(name);
      const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
      const body = SRC.slice(s, e);
      assert.ok(body.indexOf('TT.savedAt = 0') >= 0,
        name + ' が「保存しました」と出る状態にしています');
    });
  });

  test('保存に成功したら、取り消しの履歴も片づける', () => {
    // 残っていると、保存後に Ctrl+Z で保存前へ戻れてしまい、
    // 「変更 0 件」なのに未保存、という食い違いが出る
    const s = SRC.indexOf('function ttSave(auto)');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(body.indexOf('TT.undo = []') >= 0, '保存後に取り消しの履歴を消していません');
  });

  test('画面でも全角の時刻・数字を受ける（サーバーは受けている）', () => {
    // 日本語IMEでは「１１：００」が普通に出る。
    // サーバーは ttHalfWidth_ で受けるのに、画面だけ断るのは食い違い
    assert.ok(SRC.indexOf('function ttHalf(') >= 0, '画面に全角を直す関数がありません');
    const s = SRC.indexOf('function ttPopSave()');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    assert.ok(SRC.slice(s, e).indexOf('ttHalf(') >= 0,
      '窓の入力で全角を直していません');
  });

  test('ドラッグの途中で Esc を押したら、取り消す', () => {
    const s = SRC.indexOf('function bindTimetable()');
    const body = SRC.slice(s);
    assert.ok(body.indexOf('TT.drag = null') >= 0 && /Escape[\s\S]{0,400}TT\.drag/.test(body),
      'ドラッグ中の Esc で取り消していません');
  });

  test('鍵の付いた予定は、伸ばすときにも確認する', () => {
    // つかんで動かすときだけ確認していた。§5-3 の「うっかり動かさない」印としては抜け
    const s = SRC.indexOf('function ttOnUp(');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    const resize = body.slice(body.indexOf("} else {"));
    assert.ok(resize.indexOf('confirm(') >= 0,
      '鍵の付いた予定を、確認なしで伸ばせます');
  });

  test('窓は、外を押しても・タブを移っても閉じる', () => {
    // 窓を開けたままタブを移ると、別のタブの上に浮いたまま残り、Esc でも閉じなかった
    assert.ok(SRC.indexOf('tt-pop-back') >= 0, '窓の背後の覆いがありません');
    const s = SRC.indexOf('function showTab(name, keepHash)');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    assert.ok(SRC.slice(s, e).indexOf('ttClosePop') >= 0,
      'タブを移っても窓が閉じません');
  });

  test('窓が画面より高いときは、窓の中がスクロールする', () => {
    // 横向きのスマホや、文字キーボードが出た状態で、保存ボタンが画面の外に出ていた
    assert.ok(/\.tt-pop\{[^}]*max-height/.test(SRC.split(String.fromCharCode(10)).join('')),
      '窓に max-height がありません（ボタンが画面の外に出ます）');
  });

  test('自動保存は、ほかのタブを見ているあいだも走る', () => {
    // 「見えているときだけ」という条件は §4-5 に無い。
    // 未保存のままタブを移ると、いつまでも保存されなかった
    const s = SRC.indexOf('function ttStartTimers()');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(!/if \(ttVisible\(\) && TT\.dirty\) ttSave/.test(body),
      '見えているときしか自動保存していません');
  });

  test('読み取れない行は、画面に印を付けて出す', () => {
    // サーバーが laneBad / minBad / titleBad を返す。
    // 消してしまうと、画面から直せなくなる
    ['laneBad', 'minBad', 'titleBad'].forEach(k => {
      assert.ok(SRC.indexOf(k) >= 0, k + ' を画面が見ていません');
    });
  });

  test('重なりの4択は、押した重なりに対して出す', () => {
    // どこを押しても1か所目の窓が出て、3件以上あっても最初の2件しか出なかった
    const s = SRC.indexOf('function ttOverlapMenu(');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(!/TT\.warn \|\| \[\]\)\[0\]/.test(body),
      '押した場所によらず、1か所目の重なりを出しています');
  });

  test('「別の列へ移す」は、行き先を選ばせる', () => {
    // 確認も選択も無く、先頭の列（全体）に決め打ちしていた
    const s = SRC.indexOf('function ttOverlapMenu(');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    assert.ok(!/others\[0\]/.test(SRC.slice(s, e)),
      '行き先の列を決め打ちしています');
  });

  test('IDを持たない行には、画面が仮のIDを振る', () => {
    /*
     * 人がシートに直接足した行は、IDの列が空。
     * そのまま画面に並べると、**同じ「空のID」が衝突**して、
     * 重なりの4択が別の予定を指す／取り消しが効かない／
     * 幅の計算が混ざる、といった取り違えが起きる（2026-09-05 に再現した）。
     * 仮のIDは保存時に外れるので、サーバーが8桁を振り直す。
     */
    const s = SRC.indexOf('function loadTimetable()');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(body.indexOf('ttFillIds(') >= 0,
      'IDの無い行に仮のIDを振っていません（同じ空IDが衝突します）');
    assert.ok(SRC.indexOf('function ttFillIds(') >= 0, 'ttFillIds がありません');
  });

  test('新しく作った予定は、見える位置まで表を動かす', () => {
    // 15:00 に作っても画面は 11:00 のまま。作れたのかどうか分からなかった
    assert.ok(SRC.indexOf('function ttScrollTo(') >= 0,
      '新しい予定の位置まで動かしていません');
  });

  test('時刻の列は、横にスクロールしても残る', () => {
    // スマホで右へスクロールすると時刻の目盛りが画面外へ消え、
    // 「予定は見えるが何時か分からない」状態になっていた
    const flat = SRC.split(String.fromCharCode(10)).join('');
    assert.ok(/\.tt-times\{[^}]*position:sticky/.test(flat),
      '時刻の列が固定されていません');
  });

  test('キーボードだけでも、予定を開ける', () => {
    // 予定の四角も警告帯も、押せるものとして作られていなかった
    const s = SRC.indexOf('function ttEvHtml(');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(body.indexOf('tabindex="0"') >= 0 && body.indexOf('role="button"') >= 0,
      '予定がキーボードから押せません');
  });

  test('0分の予定にも、時刻が見える（枠から切れない）', () => {
    /*
     * 時刻を出していても、**枠（18px）に2行を詰めると下の行が切れて見えない**。
     * 撮影して初めて分かった。1行に詰める側に入れる。
     */
    const s = SRC.indexOf('function ttEvHtml(');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    const body = SRC.slice(s, e);
    assert.ok(body.indexOf('var when = isMark ? r.start') >= 0,
      '0分の予定に時刻を出していません');
    assert.ok(body.indexOf('var slim = isMark || hh < 40;') >= 0,
      '0分の予定を1行にしていません（時刻が枠から切れます）');
  });
});

describe('② タイムスケジュールの画面：印刷して配る（§6-1）', () => {

  test('印刷のボタンがある', () => {
    /*
     * **初見の検証役がいちばん困ったのがここ。**
     * 「？ この画面の見かた」に「当日は、印刷したものかPDFをご覧ください」と
     * 書いてあるのに、その入口がどこにも無かった。
     * しかも隣の「当日運営」タブには「印刷する（A4横）」がある。
     * **書いてあるのに無い**のが、いちばん迷う。
     */
    assert.ok(SRC.indexOf('id="ttPrint"') >= 0, '印刷のボタンがありません');
  });

  test('印刷用の表を、予定の境目で組む（5分刻みにしない）', () => {
    assert.ok(SRC.indexOf('function ttBuildPrint(') >= 0, '印刷用の表を組んでいません');
  });

  test('印刷はA4縦（当日運営のA4横に引きずられない）', () => {
    // @page はページ全体にかかるので、印刷の直前に足して、終わったら外す
    assert.ok(SRC.indexOf('ttPrintPage') >= 0, '印刷の向きを指定していません');
    assert.ok(SRC.indexOf('A4 portrait') >= 0, 'A4縦になっていません');
  });

  test('鍵の斜線は刷らない（インクの無駄・§6-1）', () => {
    const flat = SRC.split(String.fromCharCode(10)).join('');
    assert.ok(/tt-printing[^{]*\.tt-wrap\{display:none/.test(flat)
              || flat.indexOf('.tt-printing .tt-wrap{display:none') >= 0,
      '印刷のときに画面の格子を隠していません');
  });

  test('当日運営タブから、この画面へのリンクがある（§0）', () => {
    assert.ok(SRC.indexOf('data-goto="tt"') >= 0,
      '当日運営から進行表へのリンクがありません');
  });

  test('詳細のURLは、①と同じ関数でリンクにする（§7-1）', () => {
    // 2つ書くと必ずズレるので、src/linkify.js を共有する約束になっている
    const s = SRC.indexOf('function ttEvHtml(');
    const e = SRC.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), s);
    assert.ok(SRC.slice(s, e).indexOf('linkifyDetail(') >= 0,
      '②が詳細を出していません（linkifyDetail の共有が空振りしています）');
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
    assert.ok(SRC.indexOf('var slim = isMark || hh < 40;') >= 0,
      '短い予定を1行にしていません。枠からはみ出して次の予定に重なります');
  });
});

/** コメントを外す。直した理由を書くと、そこに昔の書き方が残るため */
function noComment(s) {
  return s.split(String.fromCharCode(10))
    .map(l => l.replace(/^\s*\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
    .join(String.fromCharCode(10));
}

describe('② 画面：表示の大きさ（2026-09-07）', () => {

  test('レバーがある（全体を見る／その時間だけ大きく見る）', () => {
    assert.ok(SRC.indexOf('id="ttZoom"') >= 0, '表示の大きさのレバーがありません');
    assert.match(SRC, /id="ttZoom"[^>]*type="range"|type="range"[^>]*id="ttZoom"/,
      'レバー（range）になっていません');
    ['ttZoomFit', 'ttZoomReset', 'ttZoomIn', 'ttZoomOut'].forEach(id => {
      assert.ok(SRC.indexOf('id="' + id + '"') >= 0, id + ' がありません');
    });
  });

  test('1分あたりの高さは、決め打ちではなく ttPpm() から取る', () => {
    /*
     * どこか1か所でも定数のままだと、そこだけ拡大に付いてこない。
     * 目盛りと予定の位置がずれ、**11時の予定が10時の線の上に出る**。
     */
    /*
     * `TT_PPM` そのものを禁じてはいけない。既定値と上下限の宣言、
     * ttPpm() の中の丸め込みは、あって当然のもの。
     * 見たいのは**位置を計算しているところ**だけなので、
     * 宣言と丸め込みの行を除いてから数える。
     */
    const b = noComment(ttBlock());
    const bad = b.split(String.fromCharCode(10)).filter(l =>
      l.indexOf('TT_PPM') >= 0
      && !/var TT_PPM/.test(l)          // 宣言
      && !/TT_PPM_MIN|TT_PPM_MAX/.test(l)  // 上下限で丸める
      && !/return TT_PPM;/.test(l));    // 決めていないときの既定値
    assert.deepStrictEqual(bad.map(l => l.trim()), [],
      '②の画面に、拡大に付いてこない TT_PPM の使い方があります');
  });

  test('大きさを変えても、見ていた時刻が動かない', () => {
    // これが無いと、レバーを動かすたびに見ていた場所が飛ぶ
    /*
     * **「scrollTop という字があるか」では足りない。**
     * 0 を入れるだけでも字は残るので素通りする
     * （引き継ぎ書§5「位置だけを見る検査は if (false) で囲まれても素通りする」）。
     * 計算の形そのものを見る。
     */
    const f = noComment(SRC.slice(SRC.indexOf('function ttSetPpm'),
                                  SRC.indexOf('function ttRenderZoom')));
    assert.match(f, /var mid = wrap \?/, '真ん中の時刻を取っていません');
    assert.match(f, /var y = \(mid - R\.from\) \* ttPpm\(\)/,
      '新しい大きさで置き直していません');
    assert.match(f, /wrap\.scrollTop = Math\.max\(0, Math\.round\(y\)\);/,
      '見ていた場所を保っていません');
  });

  test('縮めたときの「見た目の重なり」を、規則に渡している', () => {
    /*
     * 最低の高さ(18px)まで引き伸ばされたぶんを渡さないと、
     * 短い予定が次の予定に覆われて**画面から消える**。
     */
    const b = noComment(ttBlock());
    assert.match(b, /ttLayout\(TT\.rows, TT_EV_MIN_PX \/ ttPpm\(\)\)/,
      '見た目の重なりを渡していません（縮めると予定が消えます）');
  });

  test('最低の高さは、描く側と重なり判定で同じ数を使う', () => {
    // 数字が2か所にあると、片方だけ直したときにまた消える
    const b = noComment(ttBlock());
    assert.ok(b.indexOf('), 18)') < 0, '最低の高さを直接書いています');
    assert.ok(b.indexOf('TT_EV_MIN_PX') > 0, '共通の名前を使っていません');
  });
});

describe('② 印刷：画面と同じ形にする（2026-09-07）', () => {

  const printBlock = () => noComment(
    SRC.slice(SRC.indexOf('function ttPrintRange'), SRC.indexOf('function ttPrint(')));

  test('表組みをやめて、時間軸に置く', () => {
    /*
     * 表は「予定が始まる時刻」の行しか作らないので、
     * 1分の予定も120分の予定も同じ高さになり、長さが伝わらない。
     */
    const f = printBlock();
    assert.ok(f.indexOf('<table') < 0, 'まだ表組みで刷っています');
    assert.match(f, /tt-p-lane/, 'レーンを置いていません');
    assert.match(f, /top:/, '時刻の位置に置いていません');
  });

  test('時間の幅は 8:00〜21:00 で固定する', () => {
    const f = noComment(SRC.slice(SRC.indexOf('function ttPrintRange'),
                                  SRC.indexOf('function ttPrintMm')));
    assert.match(f, /var from = 8 \* 60, to = 21 \* 60;/,
      '8:00〜21:00 で固定していません');
  });

  test('その外に予定があれば、広げる（紙から予定を消さない）', () => {
    // 固定を守って切り落とすと、「載っていない＝無い」と読まれる
    const f = noComment(SRC.slice(SRC.indexOf('function ttPrintRange'),
                                  SRC.indexOf('function ttPrintMm')));
    assert.match(f, /if \(s < from\)/, '早い予定に合わせて広げていません');
    assert.match(f, /if \(e > to\)/, '遅い予定に合わせて広げていません');
  });

  test('レーンごとに色を分ける', () => {
    ['tt-p-ev.lane0', 'tt-p-ev.lane1', 'tt-p-ev.lane2'].forEach(sel => {
      assert.ok(SRC.indexOf('.' + sel + '{') >= 0, sel + ' の色がありません');
    });
  });

  test('0分の目印にも高さを持たせる（文字が消えないように）', () => {
    /*
     * 枠は overflow:hidden なので、高さ0にすると
     * 線だけが残って「営業終了 17:30」の字が丸ごと消える。
     */
    const f = printBlock();
    assert.ok(f.indexOf('isMark ? 0 :') < 0, '目印の高さが0のままです（字が消えます）');
    assert.match(f, /isMark \? TT_P_MARK_MM/, '目印の高さを持たせていません');
  });

  test('枠に入らない備考と出演者は、切らずに下へ送る', () => {
    const f = printBlock();
    // 見張りの形そのものを見る。if (false) で囲まれても字は残るため
    assert.match(f, /if \(over\.length\)\{/, '入らなかったものを下に送っていません');
    assert.match(f, /notes\.push/, '下に送る先がありません');
    assert.match(f, /over\.push/, '出演者を送る道がありません');
    assert.ok(SRC.indexOf('tt-p-notes') >= 0, '下の「備考」の場所がありません');
  });

  test('脚注の番号は、時刻と同じ行に置く', () => {
    /*
     * 別の行に置くと、その行ごと枠から切れて、
     * 下に備考が載っているのに誰も辿り着けない。
     */
    const f = printBlock();
    assert.match(f, /esc\(when\) \+ ref/, '番号が時刻と同じ行にありません');
  });

  test('紙でも、見た目の重なりを規則に渡す', () => {
    const f = printBlock();
    assert.match(f, /ttLayout\(TT\.rows, TT_P_EV_MIN_MM \/ mm\)/,
      '紙で短い予定が次の予定に隠れます');
  });
});

describe('② 印刷：1枚に収める（2026-09-07）', () => {

  test('時間軸以外の高さを、決め打ちにしない', () => {
    /*
     * 「見出しと脚注でおよそ40mm」と見積もっていたが、
     * 脚注の行数は予定によって変わるので、多いと1枚に収まらない
     * （実測で 55.6mm だった。15mmはみ出す）。
     */
    assert.ok(SRC.indexOf('function ttPrintUsedMm') >= 0, '実際に測る手立てがありません');
    const f = noComment(SRC.slice(SRC.indexOf('function ttPrintUsedMm'),
                                  SRC.indexOf('function ttBuildPrintAt')));
    assert.match(f, /getBoundingClientRect/, '高さを測っていません');
    // 時間軸そのものは引く（残りが「見出し＋脚注」）
    assert.match(f, /all - timeline/, '時間軸を引いていません');
  });

  test('測ってから、組み直す', () => {
    const f = noComment(SRC.slice(SRC.indexOf('function ttBuildPrint('),
                                  SRC.indexOf('function ttPrintUsedMm')));
    assert.match(f, /ttPrintUsedMm\(\)/, '測った結果を使っていません');
    assert.match(f, /ttBuildPrintAt\(R, next\)/, '測ったあとに組み直していません');
    assert.match(f, /for \(var pass = 0; pass < 2; pass\+\+\)/,
      '組み直しの回数に上限がありません');
  });

  test('1mmが何pxかは、端末で測る（96dpiの決め打ちにしない）', () => {
    const f = noComment(SRC.slice(SRC.indexOf('function ttPxPerMm'),
                                  SRC.indexOf('function ttBuildPrint(')));
    assert.match(f, /height:100mm/, '実寸を測っていません');
    assert.match(f, /3\.7795/, '測れなかったときの控えがありません');
  });

  test('刷りのずれのぶん、余裕を取る', () => {
    const f = noComment(SRC.slice(SRC.indexOf('var TT_P_PAGE_MM'),
                                  SRC.indexOf('function ttPxPerMm')));
    assert.match(f, /TT_P_PAGE_MM - used - 5/, '余裕を取っていません');
  });

  test('通信の失敗は、②でも netFail を通す', () => {
    // 入室が切れると、赤い帯に __session_ended__ が生で出ていた
    const b = noComment(ttBlock());
    assert.ok(b.indexOf('toast(String(e && e.message || e), true)') < 0,
      '②が、通信の失敗を生のまま出しています');
  });
});

describe('② 印刷：測るときの前提（2026-09-07）', () => {

  test('紙の幅は固定する（画面の幅で測らない）', () => {
    /*
     * **これを外すと、測った高さが紙とまるで違う。**
     * 画面が狭いと文字が何行にも折り返し、実測で 272mm の紙が
     * 893mm と出た（そのぶん時間軸が潰れて、使いものにならない紙になる）。
     * A4縦 210mm − 左右の余白 10mm ずつ ＝ 190mm。
     */
    const flat = SRC.split(String.fromCharCode(10)).join('');
    assert.match(flat, /\.tt-paper\{[^}]*width:190mm/,
      '紙の幅を固定していません（画面の幅で折り返した高さを測ってしまいます）');
  });

  test('枠に入る量の判断は、幅が半分かどうかで変える', () => {
    /*
     * 全幅なら題名は1行、重なりで半分になると2行になる。
     * 一律にすると、余裕のある全幅の枠まで中身を下へ送ってしまう。
     */
    const f = noComment(SRC.slice(SRC.indexOf('function ttBuildPrintAt'),
                                  SRC.indexOf('function ttPrint(')));
    assert.match(f, /var titleMm = \(cols > 1 \? 2 : 1\) \* 3;/,
      '題名の行数を、幅から見ていません');
    assert.match(f, /hh >= needCast/, '出演者の判断が決め打ちです');
    assert.match(f, /hh >= needMemo/, '備考の判断が決め打ちです');
  });
});
