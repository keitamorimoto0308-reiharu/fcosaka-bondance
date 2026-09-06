/**
 * ① Excel の取り込みを、**模擬サーバーで通しに動かして**確かめる。
 *
 * ■ なぜ要るか（①で実際に起きたこと）
 *   2026-09-04、①の模擬の保存が **100%落ちる**状態だったのに、
 *   **テスト832件は全部通っていた**。模擬を通しで呼ぶ検査が無かったため。
 *   画面を作っても一度も動かせない状態のまま、誰も気づけなかった。
 *
 * ■ xlsx の変換は、本番でしか動かない
 *   `UrlFetchApp` で Drive に上げて変換するので、模擬では作れない。
 *   だから模擬だけの入口（`mockSchedImportSeed`）で「読んだ結果」を差し込める形にする
 *   （`?probe=` と同じ扱い。**本番のGASにこの経路は無い**）。
 *   **照合と検証は本番の関数をそのまま呼ぶ。**写しを持つと
 *   「模擬で通るのに本番で落ちる」が起きる。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

/** 模擬サーバーを、毎回まっさらに読み直す */
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

/** Excel の1行（見出し名で書く） */
function xrow(row, o) {
  return Object.assign({ __row: row }, o);
}

describe('① Excelの取り込み：模擬サーバーで通しに動かす', () => {
  let M, tok;

  beforeEach(() => {
    M = fresh();
    tok = login(M, 'admin', '山田 太郎');
  });

  test('読み込むと、下見が返る（台帳には書かない）', () => {
    const before = M.handle({ action: 'adminSched', token: tok }).rows.length;
    M.handle({ action: 'mockSchedImportSeed', token: tok, rows: [
      xrow(2, { 種類: 'タスク', 日付: '2026-10-01', 領域: '制作', タスク名: '横断幕の入稿' }),
    ] });
    const r = M.handle({ action: 'adminSchedImportRead', token: tok,
                         base64: 'ZHVtbXk=', fileName: 'kougyou.xlsx' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.items[0].action, 'add');
    assert.strictEqual(M.handle({ action: 'adminSched', token: tok }).rows.length, before,
      '下見なのに台帳が書き換わりました');
  });

  test('取り込むと、台帳に反映される', () => {
    const before = M.handle({ action: 'adminSched', token: tok }).rows.length;
    const r = M.handle({ action: 'adminSchedImportApply', token: tok, rows: [
      xrow(2, { 種類: 'タスク', 日付: '2026-10-01', 領域: '制作', タスク名: '横断幕の入稿' }),
    ] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.added, 1);
    const after = M.handle({ action: 'adminSched', token: tok });
    assert.strictEqual(after.rows.length, before + 1);
    assert.ok(after.rows.some(x => x.title === '横断幕の入稿'), '取り込んだ行が見えません');
  });

  test('Excel に無い行は、消さない', () => {
    // ①は全員が触れる。Excelを編集しているあいだに他の人が足した行を消さない
    const before = M.handle({ action: 'adminSched', token: tok }).rows;
    M.handle({ action: 'adminSchedImportApply', token: tok, rows: [
      xrow(2, { 種類: 'タスク', 日付: '2026-10-01', 領域: '制作', タスク名: '横断幕の入稿' }),
    ] });
    const after = M.handle({ action: 'adminSched', token: tok }).rows;
    before.forEach(r => {
      assert.ok(after.some(x => x.title === r.title),
        '「' + r.title + '」が消えました（Excelに無い行は消さない決まりです）');
    });
  });

  test('IDが一致する行は、更新される（増えない）', () => {
    const rows = M.handle({ action: 'adminSched', token: tok }).rows;
    const target = rows[0];
    const n = rows.length;
    const r = M.handle({ action: 'adminSchedImportApply', token: tok, rows: [
      xrow(2, { 種類: target.kind, 日付: target.date, 終了日: target.endDate || '',
                領域: target.area, 担当会社: (target.companies || []).join(', '),
                担当者: (target.people || []).join(', '),
                タスク名: target.title + '（直した）',
                ステータス: target.status || '', ID: target.id }),
    ] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const after = M.handle({ action: 'adminSched', token: tok }).rows;
    assert.strictEqual(after.length, n, '行が増えています');
    assert.ok(after.some(x => x.title === target.title + '（直した）'), '更新されていません');
  });

  test('問題のある行があると断られ、台帳は変わらない', () => {
    const before = JSON.stringify(M.handle({ action: 'adminSched', token: tok }).rows);
    const r = M.handle({ action: 'adminSchedImportApply', token: tok, rows: [
      xrow(2, { 種類: 'タスク', 日付: '2026-10-01', 領域: '制作', タスク名: 'よい行' }),
      xrow(3, { 種類: 'タスク', 日付: '2026-10-02', 領域: '制作', タスク名: '' }),
    ] });
    assert.strictEqual(r.ok, false, '通らない行があるのに取り込まれました');
    assert.strictEqual(JSON.stringify(M.handle({ action: 'adminSched', token: tok }).rows),
      before, '通らない行があるのに台帳が書き換わりました');
  });

  test('一般権限でも取り込める（①は全員が触れる）', () => {
    const staff = login(M, 'staff', '佐藤 花子');
    const r = M.handle({ action: 'adminSchedImportApply', token: staff, rows: [
      xrow(2, { 種類: 'タスク', 日付: '2026-10-01', 領域: '制作', タスク名: '一般が入れた行' }),
    ] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });

  test('入室していないと取り込めない（守りはサーバー側）', () => {
    const r = M.handle({ action: 'adminSchedImportApply', rows: [] });
    assert.strictEqual(r.ok, false, JSON.stringify(r));
  });

  test('xlsx でなければ断る（画面の accept だけに頼らない）', () => {
    const r = M.handle({ action: 'adminSchedImportRead', token: tok,
                         base64: 'ZHVtbXk=', fileName: 'kougyou.csv' });
    assert.strictEqual(r.ok, false, 'CSVが通っています');
    assert.match(r.message, /xlsx|Excel/, r.message);
  });

  test('取り込むと「最終取り込み」が記録され、タブの上に出せる', () => {
    M.handle({ action: 'adminSchedImportApply', token: tok, rows: [
      xrow(2, { 種類: 'タスク', 日付: '2026-10-01', 領域: '制作', タスク名: 'A' }),
    ] });
    const got = M.handle({ action: 'adminSched', token: tok });
    assert.ok(got.stamps, '最後に誰がいつ、が返っていません');
    assert.strictEqual(got.stamps.import.person, '山田 太郎');
    assert.ok(got.stamps.import.at > 0);
  });

  test('何もしていなければ、記録は空で返る（無いものは画面に出さない）', () => {
    const got = M.handle({ action: 'adminSched', token: tok });
    assert.strictEqual(got.stamps.import.at, 0, '取り込んでいないのに記録があります');
    assert.strictEqual(got.stamps.edit.at, 0, '編集していないのに記録があります');
  });
});
