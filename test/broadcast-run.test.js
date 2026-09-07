/**
 * 一斉メールを、**模擬サーバーで通しに動かして**確かめる。
 *
 * ■ なぜ test/broadcast.test.js と別に要るか
 *   あちらは gas/Broadcast.gs の関数を直接呼ぶので、
 *   「画面から呼ぶ経路が繋がっているか」は分からない。
 *   2026-09-04、①の模擬の保存が **100%「asText_ is not defined」で落ちる**状態で、
 *   テスト832件は全部通っていた。模擬を通しで呼ぶ検査が無かったため。
 *
 * ■ 権限はここでしか確かめられない
 *   adminOnly の一覧に入れ忘れると、一般権限が50社にメールを送れる。
 *   関数を直接呼ぶ検査は、入室の経路を通らないので気づけない。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

/** 模擬サーバーを、毎回まっさらに読み直す（前の送信を引きずらない） */
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

const BODY = '{{お名前}} 様' + String.fromCharCode(10) + 'よろしくお願いいたします。';

describe('一斉メール：模擬サーバーで通しに動かす', () => {
  let M, tok, ids;

  beforeEach(() => {
    M = fresh();
    tok = login(M, 'admin', '山田 太郎');
    const list = M.handle({ action: 'adminList', token: tok });
    assert.ok(list.ok, JSON.stringify(list));
    ids = list.rows.slice(0, 2).map(r => r['受付ID']);
    assert.strictEqual(ids.length, 2, '見本の応募が2件ありません');
  });

  const preview = (over) => M.handle(Object.assign(
    { action: 'adminBroadcastPreview', token: tok,
      ids: ids, subject: '当日のご案内', body: BODY }, over || {}));

  test('プレビューが、選んだ相手と見本を返す', () => {
    const r = preview();
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.rows.map(x => x.id), ids);
    assert.ok(r.sample, '見本が返っていません');
    assert.ok(r.sample.body.indexOf('{{') < 0,
      '見本の差し込みが解決されていません：' + r.sample.body);
    assert.ok(r.ticket, '札が返っていません');
  });

  test('プレビューだけでは1通も送らない', () => {
    preview();
    assert.deepStrictEqual(M.__broadcastSent(), []);
  });

  test('プレビュー → 送信 が通る', () => {
    const p = preview();
    const r = M.handle({ action: 'adminBroadcastSend', token: tok, confirm: true,
      ids: ids, subject: '当日のご案内', body: BODY, ticket: p.ticket });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.sent, ids);
    assert.strictEqual(M.__broadcastSent().length, 2);
  });

  test('送ると、変更履歴に1行だけ残る', () => {
    const p = preview();
    const before = M.handle({ action: 'adminHistory', token: tok }).rows.length;
    M.handle({ action: 'adminBroadcastSend', token: tok, confirm: true,
      ids: ids, subject: '当日のご案内', body: BODY, ticket: p.ticket });
    const after = M.handle({ action: 'adminHistory', token: tok }).rows.length;
    assert.strictEqual(after - before, 1,
      '変更履歴が送信ごとに1行になっていません（' + (after - before) + '行）');
  });

  test('同じ札で二度押しても、2通目は届かない', () => {
    const p = preview();
    const send = () => M.handle({ action: 'adminBroadcastSend', token: tok, confirm: true,
      ids: ids, subject: '当日のご案内', body: BODY, ticket: p.ticket });
    assert.strictEqual(send().ok, true);
    assert.strictEqual(send().ok, false, '同じ札で2回送れています');
    assert.strictEqual(M.__broadcastSent().length, 2, '同じ人に2通届いています');
  });

  /*
   * adminOnly の一覧に入れ忘れると、一般権限が50社にメールを送れる。
   * **プレビューも塞ぐ**：あれは選んだ全社の氏名と宛先を返すので、
   * 送信だけ止めても名簿がそのまま出る。
   */
  test('一般権限では、送信もプレビューもできない', () => {
    const st = login(M, 'staff', '佐藤 花子');
    ['adminBroadcastPreview', 'adminBroadcastSend'].forEach(a => {
      const r = M.handle({ action: a, token: st, confirm: true,
        ids: ids, subject: '件名', body: BODY, ticket: 'x' });
      assert.strictEqual(r.ok, false, a + ' が一般権限で通っています');
      assert.strictEqual(r.error, 'forbidden', a + '：' + JSON.stringify(r));
    });
    assert.deepStrictEqual(M.__broadcastSent(), []);
  });

  test('入室していなければ、はじかれる', () => {
    const r = M.handle({ action: 'adminBroadcastPreview', ids: ids,
      subject: '件名', body: BODY });
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(M.__broadcastSent(), []);
  });

  test('文面に知らない差し込みがあると、札が出ない', () => {
    const r = preview({ body: '{{担当者}} 様' });
    assert.strictEqual(r.ticket, '', '送れない文面なのに札が出ています');
    assert.ok(r.errors.length > 0);
  });

  test('プレビューのあとに本文を変えたら、送れない', () => {
    const p = preview();
    const r = M.handle({ action: 'adminBroadcastSend', token: tok, confirm: true,
      ids: ids, subject: '当日のご案内', body: 'すり替えた本文', ticket: p.ticket });
    assert.strictEqual(r.ok, false, '画面で見ていない本文が送れています');
    assert.deepStrictEqual(M.__broadcastSent(), []);
  });

  test('送信履歴に、本文まで残る', () => {
    const p = preview();
    M.handle({ action: 'adminBroadcastSend', token: tok, confirm: true,
      ids: ids, subject: '当日のご案内', body: BODY, ticket: p.ticket });
    const log = M.__broadcastLog();
    assert.strictEqual(log.length, 1, '履歴が1行ではありません');
    assert.strictEqual(log[0]['件名'], '当日のご案内');
    assert.strictEqual(log[0]['本文'], BODY, '本文が原文のまま残っていません');
    assert.strictEqual(log[0]['宛先の受付ID'], ids.join(','));
    assert.ok(/^BC-\d{8}-\d+$/.test(log[0]['送信ID']), log[0]['送信ID']);
  });

  test('2回送ると、送信IDの連番が進む', () => {
    const a = preview();
    M.handle({ action: 'adminBroadcastSend', token: tok, confirm: true,
      ids: ids, subject: '当日のご案内', body: BODY, ticket: a.ticket });
    const b = preview({ subject: '素材のご提出のお願い' });
    M.handle({ action: 'adminBroadcastSend', token: tok, confirm: true,
      ids: ids, subject: '素材のご提出のお願い', body: BODY, ticket: b.ticket });
    const log = M.__broadcastLog();
    assert.strictEqual(log.length, 2);
    assert.notStrictEqual(log[0]['送信ID'], log[1]['送信ID'], '送信IDが重複しています');
  });

  /*
   * 押し間違いと意図した再送は機械には区別できないので、**止めずに報せる**。
   * 報せそのものが出ないと、二重送信に誰も気づけない。
   */
  test('同じ件名を続けて送ろうとすると、プレビューが報せる', () => {
    const p = preview();
    M.handle({ action: 'adminBroadcastSend', token: tok, confirm: true,
      ids: ids, subject: '当日のご案内', body: BODY, ticket: p.ticket });
    const again = preview();
    assert.deepStrictEqual(again.recent.ids, ids,
      '24時間以内の同じ件名を報せていません：' + JSON.stringify(again.recent));
    assert.ok(again.ticket, '報せるだけで、送れなくしてはいけません');
  });
});
