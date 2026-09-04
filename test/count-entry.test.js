/**
 * 枚数・人数の打ち込み（管理ページ）と、変更履歴の受け渡しを確かめる。
 *
 * ■ なぜ要るか
 *   ここは**電話で聞いた枚数**を入れる画面。当日の手配に直結する。
 *   2026-09-03 の検証で、3つ見つかった：
 *
 *   1. 読めない値（全角・マイナス・文字・範囲外）を**黙って読み飛ばし**、
 *      画面には「変更はありません」とだけ出していた。
 *      閉じて開き直すと元の数字に戻っていて、**聞いた枚数が消える**。
 *   2. 説明が「ダッシュボードの合計に入り」で、**足し算だと読まれた**。
 *      申告6枚のところに8と入れると 14 になるのか 8 になるのか分からない。
 *   3. 変更履歴の「操作者」欄が、模擬ではずっと空欄だった。
 *      本番は `operator` で返すのに、模擬は `who` で返していた。
 *      **名前が違うだけで、画面は何のエラーも出さずに空を表示する。**
 *
 * ■ 1つでも読めなければ、何も書かない
 *   一部だけ入って一部が消えるのが、いちばん気づけない。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const SCHEMA = require('../src/schema.js');

function fresh() {
  const p = require.resolve('../src/mock.js');
  delete require.cache[p];
  return require(p);
}

function login(M, pw, person) {
  const r = M.handle({ action: 'adminLogin', password: pw, person: person });
  assert.ok(r.ok, '入室できません：' + JSON.stringify(r));
  return r.token;
}

const KEYS = SCHEMA.aggregateFields().filter(f => f.stage === 'confirm').map(f => f.key);

describe('枚数の打ち込み：読めない値を黙って捨てない', () => {
  let M, tok, id;
  beforeEach(() => {
    M = fresh();
    tok = login(M, 'admin', '山田 太郎');
    id = M.DB.rows.filter(r => r['ステータス'] === '採択')[0]['受付ID'];
  });

  const save = values => M.handle({ action: 'adminConfirmSave', token: tok, id, values });
  const now = k => (M.DB.confirm[id] || { values: {} }).values[k];

  test('項目がそろっている（試験の前提）', () => {
    assert.ok(KEYS.length >= 2, '数を集める項目が足りません：' + KEYS.join(','));
  });

  test('全角の数字は、半角に直して受ける', () => {
    const r = save({ [KEYS[0]]: '１０' });
    assert.strictEqual(r.ok, true, '全角を断りました：' + JSON.stringify(r));
    assert.strictEqual(Number(now(KEYS[0])), 10,
      '全角が別の数になりました：' + JSON.stringify(now(KEYS[0])));
  });

  test('文字が混ざっていたら、断って理由を言う', () => {
    const r = save({ [KEYS[0]]: 'abc' });
    assert.strictEqual(r.ok, false, '読めない値が通りました');
    assert.strictEqual(r.error, 'bad_value');
    assert.ok(r.message.includes('abc'), '何を断ったのか分かりません：' + r.message);
    const label = SCHEMA.aggregateFields().filter(f => f.key === KEYS[0])[0].label;
    assert.ok(r.message.includes(label), '項目名が出ていません：' + r.message);
  });

  test('マイナスは断る', () => {
    const r = save({ [KEYS[0]]: '-3' });
    assert.strictEqual(r.ok, false, 'マイナスが通りました');
    assert.strictEqual(r.error, 'bad_value');
  });

  test('1つでも読めなければ、ほかの項目も書かない', () => {
    // 一部だけ入って一部が消えるのが、いちばん気づけない
    const before = now(KEYS[1]);
    const r = save({ [KEYS[0]]: 'abc', [KEYS[1]]: '9' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(String(now(KEYS[1]) == null ? '' : now(KEYS[1])),
      String(before == null ? '' : before),
      '読めない値が混ざっていたのに、他の項目が書き換わりました');
    assert.ok(/まだ何も保存していません/.test(r.message),
      '何も保存していないことが伝わりません：' + r.message);
  });

  test('全部読めれば、まとめて入る', () => {
    const r = save({ [KEYS[0]]: '7', [KEYS[1]]: '9' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(Number(now(KEYS[0])), 7);
    assert.strictEqual(Number(now(KEYS[1])), 9);
  });

  test('入れた数は「置き換え」で、足し算ではない', () => {
    save({ [KEYS[0]]: '7' });
    save({ [KEYS[0]]: '3' });
    assert.strictEqual(Number(now(KEYS[0])), 3,
      '足し算になっています：' + JSON.stringify(now(KEYS[0])));
  });

  test('変えたら、変更履歴に誰がいつ何をが残る', () => {
    const before = M.DB.history.length;
    save({ [KEYS[0]]: '7' });
    assert.strictEqual(M.DB.history.length, before + 1, '履歴に残っていません');
    const h = M.DB.history[0];
    assert.strictEqual(h.who, '山田 太郎', '操作者が残っていません');
    assert.strictEqual(h.id, id);
    assert.strictEqual(h.after, '7');
    assert.ok(/管理ページ/.test(h.reason), '理由が残っていません：' + h.reason);
  });

  test('応募一覧に無い受付IDでは、行を作らない', () => {
    // 形（SB-0000）だけ見ていたので、SB-9999 を投げると
    // **どの応募にも紐づかない幽霊行**が確定情報シートに残った。
    // 集計の母数は採択者だけなので、誰も気づけない（2026-09-04 の点検で指摘）
    const r = M.handle({ action: 'adminConfirmSave', token: tok,
                         id: 'SB-9999', values: { [KEYS[0]]: '3' } });
    assert.strictEqual(r.ok, false, '知らない受付IDが通りました');
    assert.strictEqual(r.error, 'not_found');
    assert.ok(r.message.includes('SB-9999'), 'どのIDが悪いのか分かりません：' + r.message);
    assert.ok(!M.DB.confirm['SB-9999'], '幽霊行ができました');
  });

  test('断られたとき、行そのものも作らない', () => {
    // 「まだ何も保存していません」と返しながら、受付IDだけの空行が増えていた。
    // その会社が確定情報フォームから**初回提出**すると「更新」扱いになり、
    // 社内通知の件名まで【確定情報更新】になる（2026-09-04 の点検で指摘）
    const fresh2 = M.DB.rows.filter(r => !M.DB.confirm[r['受付ID']])[0];
    assert.ok(fresh2, 'まだ提出の無い会社が見本にありません');
    const id2 = fresh2['受付ID'];
    const before = Object.keys(M.DB.confirm).length;
    const r = M.handle({ action: 'adminConfirmSave', token: tok, id: id2,
                         values: { [KEYS[0]]: '三名' } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(Object.keys(M.DB.confirm).length, before,
      '断ったのに行が増えました');
    assert.ok(!M.DB.confirm[id2], '断ったのに行ができました');
  });

  test('本番も、行を作るのが検査より後になっている', () => {
    const C = read('gas/Confirm.gs');
    const fn = C.slice(C.indexOf('function adminConfirmSave_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    const check = body.indexOf('if (bad.length)');
    const append = body.indexOf('sh.appendRow([receiptId])');
    assert.ok(append > 0, '行を作る場所が見つかりません');
    assert.ok(check < append,
      '検査より前に行を作っています（「保存していません」が嘘になります）');
    // 条件そのものを見る。if (false) にされても文字列は残る
    assert.ok(body.includes('if (!known) {'), '知らない受付IDを断っていません');
    assert.ok(/error: 'not_found'/.test(body), '知らない受付IDの返事がありません');
  });

  test('本番も、同じ順序（全部読んでから書く）になっている', () => {
    const C = read('gas/Confirm.gs');
    const fn = C.slice(C.indexOf('function adminConfirmSave_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    const check = body.indexOf('if (bad.length)');
    const write = body.indexOf('setValue(');
    assert.ok(check >= 0, '本番が、断った項目をまとめていません');
    assert.ok(check < write, '本番が、確かめる前に書いています');
    assert.ok(/confirmCount_\(/.test(body), '本番が読み取りをまとめていません');
    assert.ok(!/if \(!isFinite\(n\)\) return;/.test(body),
      '本番に「黙って読み飛ばす」書き方が残っています');
    // 数の読み取りは gas/Num.gs にまとめた（単価・枚数・合計で揃っていなかった）
    const num = C.slice(C.indexOf('function confirmCount_'));
    const nb = num.slice(0, num.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/numCount_\(/.test(nb), '共通の読み取りを通っていません');
    const N = read('gas/Num.gs');
    assert.ok(/０-９/.test(N), '共通の読み取りが全角を半角に直していません');
    assert.ok(/return null/.test(N), '共通の読み取りが「読めない」を返していません');
  });

  test('模擬も、本番と同じ厳しさになっている', () => {
    // **模擬が緩いと、本番のバグを模擬が見逃す**
    const mock = read('src/mock.js');
    const i = mock.indexOf("case 'adminConfirmSave'");
    const block = mock.slice(i, i + 2600);
    assert.ok(/confirmCount\(/.test(block), '模擬が読み取りをまとめていません');
    assert.ok(/bad\.length/.test(block), '模擬が、断った項目をまとめていません');
  });
});

describe('変更履歴：画面とサーバーが同じ名前を使っているか', () => {
  // 「操作者が空欄」は、名前の食い違いだけで起きる。
  // 型も例外も無いので、**気づけるのは目で見たときだけ**
  const A = read('src/build-admin.js');

  test('画面が読む名前を、模擬も本番も返している', () => {
    const fn = A.slice(A.indexOf('function renderHistory'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    const used = [];
    body.replace(/h\.([a-zA-Z]+)/g, (m, k) => { if (used.indexOf(k) < 0) used.push(k); });
    assert.ok(used.length >= 5, '画面が読んでいる項目を拾えません：' + used.join(','));

    const M = fresh();
    const tok = login(M, 'admin', '山田 太郎');
    const row = M.handle({ action: 'adminHistory', token: tok }).rows[0];
    assert.ok(row, '模擬が履歴を返していません');
    used.forEach(k => {
      assert.ok(Object.prototype.hasOwnProperty.call(row, k),
        '模擬が「' + k + '」を返していません（画面では空欄になります）');
    });

    // 本番（gas/Admin.gs の adminHistory_）が組み立てている名前
    const G = read('gas/Admin.gs');
    const gf = G.slice(G.indexOf('function adminHistory_'));
    const rec = gf.slice(gf.indexOf('var rec = {'), gf.indexOf('};', gf.indexOf('var rec = {')));
    used.forEach(k => {
      assert.ok(new RegExp('\\b' + k + ':').test(rec),
        '本番が「' + k + '」を返していません（画面では空欄になります）');
    });
  });

  test('どの操作で残した履歴にも、操作者が入っている', () => {
    // 模擬の中で `who` と `operator` の2つの名前が混ざっており、
    // 片方だけを画面に渡していたので、**操作によって空欄になったりならなかったり**
    // していた。行を1つずつ見て、空欄が無いことを確かめる
    const M = fresh();
    const tok = login(M, 'admin', '山田 太郎');
    const id = M.DB.rows.filter(r => r['ステータス'] === '採択')[0]['受付ID'];

    // いくつかの経路で履歴を作る
    M.handle({ action: 'adminUpdate', token: tok, id,
               patch: { '担当メモ': '電話でご連絡あり' }, reason: '' });
    M.handle({ action: 'adminConfirmSave', token: tok, id, values: { [KEYS[0]]: '5' } });
    const r0 = M.handle({ action: 'adminRental', token: tok });
    M.handle({ action: 'adminRentalSave', token: tok, row: r0.items[0].row,
               item: { kind: r0.items[0].kind, name: r0.items[0].name, price: '1234',
                       unit: r0.items[0].unit, max: r0.items[0].max, active: true } });

    const rows = M.handle({ action: 'adminHistory', token: tok }).rows;
    assert.ok(rows.length >= 3, '履歴が足りません：' + rows.length);
    rows.forEach(h => {
      assert.ok(String(h.operator || '').trim(),
        '操作者が空欄の行があります：' + JSON.stringify(h));
    });
  });

  test('絞り込みも、同じ名前を見ている', () => {
    // **絞り込みの行そのもの**を見る。表の描画にも h.operator があるので、
    // 関数全体を眺めると、絞り込みから外しても素通りする
    const fn = A.slice(A.indexOf('function renderHistory'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    const line = body.split(String.fromCharCode(10))
      .filter(l => l.indexOf('.toLowerCase().indexOf(q)') >= 0)[0]
      || body.split(String.fromCharCode(10)).filter(l => l.indexOf('return [h.') >= 0)[0];
    assert.ok(line, '絞り込みの行が見つかりません');
    assert.ok(/h\.operator/.test(line),
      '絞り込みが操作者を見ていません：' + line.trim());
  });
});
