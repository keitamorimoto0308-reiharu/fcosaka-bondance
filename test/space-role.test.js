/**
 * 区画の割り当ては管理者だけ（けいた確定・2026-09-25・decisions_pending I6）。
 *
 * ■ 何を守っているか
 *   UPDATER の指摘「一般でも区画割当ができる。共催者アカウントとしては広すぎる。
 *   誤って動かす事故のほうが怖い」。一般パスワードは社外（UPDATER）にも渡している。
 *
 * ■ 外しすぎないことも見る
 *   マップを**見る**のと、搬入時刻を入れるのは一般に残す（当日の誘導は営業の仕事）。
 *   守りを足すついでに、これらまで管理者だけにすると、一般の人が当日マップを開けない。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Admin.gs'), 'utf8');

function adminOnlyList() {
  const s = ADMIN.indexOf('var adminOnly = [');
  const e = ADMIN.indexOf('];', s);
  assert.ok(s >= 0 && e > s, 'adminOnly の一覧が見つかりません');
  // コメントの中の語を拾わないよう、引用符で囲まれた action 名だけを取る
  return (ADMIN.slice(s, e).replace(/\/\/[^\n]*/g, '').match(/'[A-Za-z]+'/g) || [])
    .map(x => x.slice(1, -1));
}

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

describe('区画の割り当ては管理者だけ（I6）', () => {

  test('本番：割り当てと解除が adminOnly に入っている', () => {
    const only = adminOnlyList();
    ['adminAssign', 'adminUnassign'].forEach(a => {
      assert.ok(only.includes(a), a + ' が adminOnly に入っていません（一般が区画を動かせます）');
    });
  });

  test('本番：見る・搬入時刻は一般に残っている', () => {
    const only = adminOnlyList();
    ['adminSpaces', 'adminBulkLoadIn'].forEach(a => {
      assert.ok(!only.includes(a), a + ' まで管理者だけになっています（一般が当日マップを使えません）');
    });
  });

  test('模擬：一般は割り当ても解除もはじかれ、区画は動かない', () => {
    const M = fresh();
    const st = login(M, 'staff', '佐藤 花子');
    const sp0 = M.handle({ action: 'adminSpaces', token: st });
    assert.strictEqual(sp0.ok, true, '一般がマップを見られません：' + JSON.stringify(sp0));
    const id = Object.keys(sp0.owners)[0];
    assert.ok(id, '見本の出店者がいません');
    const before = JSON.stringify(sp0.spaces);

    const a = M.handle({ action: 'adminAssign', token: st, id: id, start: 1 });
    assert.strictEqual(a.ok, false, '一般で割り当てできています');
    assert.strictEqual(a.error, 'forbidden', JSON.stringify(a));
    const u = M.handle({ action: 'adminUnassign', token: st, id: id });
    assert.strictEqual(u.ok, false, '一般で解除できています');
    assert.strictEqual(u.error, 'forbidden', JSON.stringify(u));

    const sp1 = M.handle({ action: 'adminSpaces', token: st });
    assert.strictEqual(JSON.stringify(sp1.spaces), before, 'はじいたのに区画が動いています');
  });

  test('模擬：管理者は割り当てられる（守りが強すぎないこと）', () => {
    const M = fresh();
    const ad = login(M, 'admin', '山田 太郎');
    const sp = M.handle({ action: 'adminSpaces', token: ad });
    const id = Object.keys(sp.owners).find(k => !sp.owners[k].start);
    const free = sp.spaces.filter(s => !s.id).map(s => s.no);
    // 2区画の相手でも入るよう、続いて2つ空いている番号を選ぶ
    const start = free.find(n => free.includes(n + 1));
    assert.ok(id && start, '見本に空きがありません');
    const r = M.handle({ action: 'adminAssign', token: ad, id: id, start: start });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });

  test('画面：一般には操作を隠し、「見るだけ」と書く', () => {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'build-admin.js'), 'utf8');
    // 操作のかたまりが admin-only で包まれている
    assert.ok(/class="admin-only" id="aCtl" hidden>[\s\S]*?id="aWho"[\s\S]*?id="aDel"/.test(SRC),
      '割り当ての操作が admin-only で包まれていません');
    assert.ok(SRC.includes('id="aReadOnly"'), '一般向けの「見るだけ」の説明がありません');
    // マスを押したとき、一般は割り当ての道に入らない
    const f = SRC.slice(SRC.indexOf('function onSpaceClick'), SRC.indexOf('function unassign'));
    assert.ok(f.indexOf("S.role !== '管理者'") >= 0 && f.indexOf("S.role !== '管理者'") < f.indexOf("api('adminAssign'"),
      '一般がマスを押すと割り当ての確認が出ます');
  });
});
