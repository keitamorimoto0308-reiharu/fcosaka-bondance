/**
 * ② タイムスケジュールを、**模擬サーバーで通しに動かして**確かめる。
 *
 * ■ なぜ要るか（①で実際に起きたこと）
 *   2026-09-04、①の模擬の保存が **100%「asText_ is not defined」で落ちる**状態だった。
 *   切り出しが CRLF で空文字になっていたのが原因で、
 *   **テスト832件は全部通っていた**。模擬を通しで呼ぶ検査が無かったため。
 *   画面を作っても一度も動かせない状態のまま、誰も気づけなかった。
 *
 * ■ 版のぶつかりは、ここでしか試せない
 *   本番のGASで「2人が同時に保存する」は起こせない。
 *   模擬に `mockTimetableBumpVersion`（模擬だけの入口）を置いてある。
 *   一括削除で同じ判断をした（`test/purge.test.js`）。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

/** 模擬サーバーを、毎回まっさらに読み直す（前の保存を引きずらない） */
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

describe('② タイムスケジュール：模擬サーバーで通しに動かす', () => {
  let M, tok;

  beforeEach(() => {
    M = fresh();
    tok = login(M, 'admin', '山田 太郎');
  });

  test('読み出せる（見本の時間割が入っている）', () => {
    const r = M.handle({ action: 'adminTimetable', token: tok });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.ok(r.rows.length > 0, '見本が入っていません');
    assert.deepStrictEqual(r.lanes, ['全体', 'イベント', '備考']);
    assert.ok(r.ticket, '引換券が返っていません');
    assert.strictEqual(r.day, '2026-10-24');
  });

  test('保存できて、次に読むと反映されている', () => {
    const got = M.handle({ action: 'adminTimetable', token: tok });
    const rows = got.rows.concat([{ lane: '備考', start: '12:00', min: 0, title: '休憩' }]);
    const r = M.handle({ action: 'adminTimetableSave', token: tok, ticket: got.ticket, rows });
    assert.strictEqual(r.ok, true, JSON.stringify(r));

    const again = M.handle({ action: 'adminTimetable', token: tok });
    assert.strictEqual(again.rows.length, got.rows.length + 1);
    assert.strictEqual(again.version, got.version + 1);
    assert.ok(again.rows.some(x => x.title === '休憩'));
  });

  test('一般権限でも保存できる（全員が編集できる・けいた確定）', () => {
    const staff = login(M, 'staff', '佐藤 花子');
    const got = M.handle({ action: 'adminTimetable', token: staff });
    const r = M.handle({ action: 'adminTimetableSave', token: staff,
                         ticket: got.ticket, rows: got.rows });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });

  test('ほかの人が先に保存していたら断られ、最新と新しい券が返る', () => {
    const got = M.handle({ action: 'adminTimetable', token: tok });
    const bumped = M.handle({ action: 'mockTimetableBumpVersion', token: tok });
    assert.strictEqual(bumped.ok, true, JSON.stringify(bumped));

    const r = M.handle({ action: 'adminTimetableSave', token: tok,
                         ticket: got.ticket, rows: got.rows });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'conflict', JSON.stringify(r));
    assert.strictEqual(r.by, '佐藤 花子');
    assert.ok(r.ticket, '新しい券が返っていません');
    assert.ok(r.rows.some(x => x.title.indexOf('佐藤 花子が変更') >= 0),
      '最新の行が返っていません');
  });

  test('断られたあと、返された券で保存し直せる', () => {
    const got = M.handle({ action: 'adminTimetable', token: tok });
    M.handle({ action: 'mockTimetableBumpVersion', token: tok });
    const ng = M.handle({ action: 'adminTimetableSave', token: tok,
                          ticket: got.ticket, rows: got.rows });
    const ok = M.handle({ action: 'adminTimetableSave', token: tok,
                          ticket: ng.ticket, rows: ng.rows });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
  });

  test('入室していないと読めない（守りはサーバー側）', () => {
    const r = M.handle({ action: 'adminTimetable' });
    assert.strictEqual(r.ok, false, JSON.stringify(r));
  });

  test('通らない行を送ると、理由が返って何も変わらない', () => {
    const got = M.handle({ action: 'adminTimetable', token: tok });
    const r = M.handle({ action: 'adminTimetableSave', token: tok, ticket: got.ticket,
                         rows: [{ lane: 'ステージ裏', start: '11:00', min: 10, title: 'あ' }] });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /レーン/, r.message);
    assert.strictEqual(M.handle({ action: 'adminTimetable', token: tok }).version, got.version);
  });

  test('札は、ほかの人のぶんだけ見える', () => {
    const staff = login(M, 'staff', '佐藤 花子');
    M.handle({ action: 'adminTimetableHeartbeat', token: staff });
    const mine = M.handle({ action: 'adminTimetableHeartbeat', token: tok });
    assert.strictEqual(mine.ok, true, JSON.stringify(mine));
    assert.deepStrictEqual(mine.editors.map(e => e.person), ['佐藤 花子']);
  });

  test('自動保存の間隔は、設定タブで変えたものが届く', () => {
    // 模擬が設定の写しを持っていると、ここがずれる
    const before = M.handle({ action: 'adminTimetable', token: tok }).autosaveMin;
    assert.strictEqual(before, 3);
    M.handle({ action: 'adminSettingsSave', token: tok,
               values: { '進行表の自動保存分': '7' } });
    assert.strictEqual(M.handle({ action: 'adminTimetable', token: tok }).autosaveMin, 7);
  });
});
