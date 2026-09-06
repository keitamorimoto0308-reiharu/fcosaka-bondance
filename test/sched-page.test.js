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

/**
 * コメントを外す。**コードだけを見るため。**
 * 「なぜ直したか」をコメントに書くと、直す前の書き方がそこに残る。
 */
function noComment(s) {
  return s.split(String.fromCharCode(10))
    .map(line => line.replace(/^\s*\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
    .join(String.fromCharCode(10));
}

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
    /*
     * 下見の行を直しただけで台帳が書き換わってはいけない。
     *
     * **「IMP.editing という文字列があるか」では足りない。**
     * `if (false)` で囲んでも本体に名前は残るので素通りする
     * （引き継ぎ書§5「位置だけを見る検査は if (false) で囲まれても素通りする」）。
     * **見張り自体の形**と、**それが台帳への保存より前にあること**を見る。
     */
    const b = body('function schSave()');
    assert.ok(/if \(IMP\.editing !== null/.test(b),
      '取り込みの編集と、台帳の保存を見分けていません');
    const guard = b.indexOf('if (IMP.editing !== null');
    const save = b.indexOf("api('adminSchedSave'");
    assert.ok(guard >= 0 && save > guard,
      '取り込みの見張りが、台帳への保存より後ろにあります（素通りします）');
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

  test('編集・取り込み・書き出しの3つを、誰が何をしたかの言い方で出す', () => {
    /*
     * 「最終編集：山田 ／ 取り込み：佐藤」では、
     * 佐藤さんが取り込んだのか、佐藤さんの行が取り込まれたのか読めない。
     * 「◯◯さんが △時に □した」の形にそろえた（検証役 2026-09-07）。
     */
    const b = noComment(body('function schRenderStamps('));
    ['編集', 'Excelから取り込み', 'Excelで保存'].forEach(word => {
      assert.ok(b.indexOf(word) >= 0, '「' + word + '」が出ていません');
    });
    assert.match(b, /さんが .*に/, '「誰が・いつ・何をした」の形になっていません');
    // 並びは 書き出し → 取り込み → 編集（人がやった順に読める）
    assert.ok(b.indexOf("st['export']") < b.indexOf("st['import']")
              && b.indexOf("st['import']") < b.indexOf('st.edit'),
      '時系列の並びになっていません');
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

/*
 * 検証役3体（2026-09-07）が「使っていて」見つけた穴。
 * どれも画面にしか無い約束なので、ここで形を確かめる。
 */
describe('① 画面：検証役の指摘（2026-09-07）', () => {

  test('送信中の印は IMP に持つ（描き直しで消えない）', () => {
    /*
     * 以前は schImpGo が button.disabled に直接立てていた。
     * schImpRender は毎回ボタンを作り直して disabled を塗り替えるので、
     * **送信中に下見が描き直されると押せる状態に戻り**、同じ行が二重に入った。
     */
    assert.match(SRC, /IMP\.busy\s*=\s*true/,
      '送信中の印を IMP に持っていません');
    assert.match(body('function schImpRender'), /disabled\s*=\s*!!c\.bad\s*\|\|\s*!!IMP\.busy/,
      '描き直しのときに、送信中かどうかを見ていません');
  });

  test('遅れて返ってきた見直しで、下見を開き直さない', () => {
    /*
     * 取り込みが済んで下見を閉じたあとに古い返事が届き、
     * 下見が勝手に復活して、もう一度「取り込む」を押せてしまった。
     */
    const f = body('function schImpApplyEdit');
    assert.match(f, /var seq = \+\+IMP\.seq/, '見直しに番号を振っていません');
    assert.match(f, /seq !== IMP\.seq/, '古い返事を捨てていません');
    assert.match(body('function schImpClose'), /IMP\.seq\+\+/,
      '閉じたときに番号を進めていません（閉じたあとの返事で復活します）');
  });

  test('読めたときだけ、ファイル名を差し替える', () => {
    // 断られたファイルの名前が「◯◯を読みました」に出ていた
    const f = body('function schImpPick');
    const okAt = f.indexOf('IMP.fileName = name');
    const guardAt = f.indexOf('if (!r || !r.ok)');
    assert.ok(okAt > 0, 'ファイル名を読めたあとに入れていません');
    assert.ok(guardAt > 0 && okAt > guardAt,
      '断る判定より前にファイル名を入れています');
  });

  test('赤の理由は、文をそのまま出す（真偽値にしない）', () => {
    /*
     * 昔の書き方は真偽値を返すので、吹き出しに「true」とだけ出ていた。
     *
     * **コメントを外してから見る。**直した理由をコメントに書くと、
     * そこに昔の書き方がそのまま残る。素で探すと「まだ直っていない」と
     * 誤って言う（この案件で3度目の、同じ取り違え）。
     */
    const f = noComment(body('function schImpRender'));
    assert.ok(f.indexOf("why['*'] && h ===") < 0,
      '理由のところで真偽値を作っています（吹き出しに true と出ます）');
    assert.match(f, /h === 'タスク名' \? \(why\['\*'\] \|\| ''\)/,
      '理由の文をそのまま渡していません');
  });

  test('取り込みの下見を直すときは、削除ボタンを出さない', () => {
    /*
     * 下見の行は台帳の行ではないので、消すものがない。
     * それでも「削除する」が出て、押すと
     * 「元に戻すには変更履歴から…」というこわい確認まで出ていた。
     */
    assert.match(SRC, /\$\('#schDel'\)\.hidden = isNew \|\| impMode/,
      '下見を直すときにも削除ボタンが出ます');
    assert.match(SRC, /\$\('#schMetaBox'\)\.hidden = isNew \|\| impMode/,
      '下見を直すときにも「追加・更新の記録」が出ます');
  });

  test('別のタブへ移ったら、編集パネルを閉じる', () => {
    // 出店者一覧の上に「タスクを編集」が浮いたまま保存でき、
    // 見えていない下見の行が黙って書き換わっていた
    assert.match(SRC, /if \(name !== 'sched' && typeof schClose === 'function'\) schClose\(\)/,
      'タブを移っても、①の編集パネルが閉じません');
  });

  test('取り込みボタンを押すたびに、選んだファイルを空に戻す', () => {
    /*
     * 同じ名前のファイルを選び直しても change が飛ばないのがブラウザの仕様。
     * 「Excelで直して、同じファイルをもう一度読み込む」——説明どおりの
     * 使い方で、ボタンが無反応になっていた。
     */
    const i = SRC.indexOf("$('#schImport').addEventListener");
    assert.ok(i > 0, '取り込みボタンの結び付けがありません');
    const f = SRC.slice(i, i + 700);
    const clearAt = f.indexOf("$('#schFile').value = ''");
    const clickAt = f.indexOf("$('#schFile').click()");
    assert.ok(clearAt > 0, '押したときに選択を空に戻していません');
    assert.ok(clickAt > clearAt, '空に戻すより先に開いています');
  });
});

describe('① 画面：直し方が分かるか（2026-09-07）', () => {

  test('下見の行を開いたら、なぜ赤いのかをパネルに出す', () => {
    // 以前は表のセルの吹き出しだけ。触る画面では合わせられない
    assert.ok(SRC.indexOf('id="schWhy"') >= 0, '理由を出す場所がありません');
    assert.match(noComment(body('function schImpWhy')), /p\.why/,
      '理由の文をパネルに出していません');
    assert.match(SRC, /schOpen\(schImpRowForEdit\(x\)\);\s*\n\s*schImpWhy\(x\);/,
      '行を開いたときに理由を出していません');
  });

  test('IDだけが問題の行には「この画面では直せない」と書く', () => {
    /*
     * 編集パネルにID欄は無い（置くと人が番号を打ち直せてしまう）。
     * 直せないものに「押すと直せます」と言い続けていた。
     */
    const f = noComment(body('function schImpWhy'));
    assert.match(f, /この画面では直せません/, '直せないことを言っていません');
    assert.match(f, /ID列を空にして/, 'どうすればいいかが書かれていません');
  });

  test('下見のボタンは「この行を直す」（台帳に保存しない）', () => {
    assert.match(SRC, /\$\('#schSave'\)\.textContent = impMode \? 'この行を直す'/,
      'ボタンの名前が、押した結果を表していません');
    assert.match(SRC, /\$\('#schPanelTitle'\)\.textContent = impMode/,
      'パネルの見出しが「タスクを編集」のままです');
  });

  test('「Excelで消しても台帳からは消えない」を、件数がゼロでも出す', () => {
    // 「そのまま残します」だけでは、Excelの行を残すのか台帳の行を残すのか読めない
    const f = noComment(body('function schImpRender'));
    const i = f.indexOf('Excelで行を消しても、台帳からは消えません');
    assert.ok(i > 0, '「消えません」の案内がありません');
    // c.missing の中ではなく、外に置く（0件でも出す）
    assert.ok(f.slice(0, i).lastIndexOf('c.missing') < f.slice(0, i).lastIndexOf('sch-imp-sum'),
      '件数があるときだけ出しています');
  });

  test('書き換える行があるときは、押す前に確認する', () => {
    // 「削除する」には確認があるのに、上書きには無かった
    const f = noComment(body('function schImpGo'));
    assert.match(f, /c\.update && !confirm\(/, '書き換える前に止めていません');
    assert.match(f, /書き換えます/, '何が起きるかを書いていません');
  });

  test('取り込みの通信の失敗は、netFail を通す', () => {
    // 入室が切れると、赤いトーストに __session_ended__ が生で出ていた
    ['function schImpPick', 'function schImpApplyEdit', 'function schImpGo',
     'function loadSched'].forEach(name => {
      const f = body(name);
      assert.ok(f.indexOf('toast(String(e && e.message || e), true)') < 0,
        name + ' が、通信の失敗を生のまま出しています');
    });
  });

  test('「見かた」に、書き出す→直す→取り込む の順番が書いてある', () => {
    const i = SRC.indexOf("sched: ['制作スケジュール表の見かた'");
    assert.ok(i > 0, '見かたが見つかりません');
    const how = SRC.slice(i, SRC.indexOf("list: ['出店者一覧の見かた'"));
    assert.match(how, /先に.*「Excelで保存」/, '順番が書かれていません');
    assert.match(how, /「Excelから取り込む」で戻します/, '戻す手順が書かれていません');
    assert.match(how, /ID列は消さないでください/, 'ID列のことが書かれていません');
    assert.match(how, /ID列まで一緒にコピー/, '行を増やすときの注意がありません');
    assert.match(how, /Excelで消しても、台帳からは消えません/,
      '「消しても消えない」が書かれていません');
  });
});
