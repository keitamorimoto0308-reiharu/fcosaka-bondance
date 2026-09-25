/**
 * ダッシュボードの「問い合わせメール」に、システムの警報を出さない（けいた指摘・2026-09-25）。
 *
 * 警報（gas/Mail.gs の alertOperator_）は問い合わせと同じ宛先に届く。
 * 混ざると、出店者からの本物の問い合わせが警報の下に埋もれる。
 *
 * 本番の adminInbox_ を切り出し、GmailApp だけ代役にして**呼んで**確かめる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cutFunction } = require('./_gasbox');

const ROOT = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'gas', 'Admin.gs'), 'utf8');
const MAIL = fs.readFileSync(path.join(ROOT, 'gas', 'Mail.gs'), 'utf8');

const ADDR = 'fcosaka_bondance@kreha-c.com';
const SYS = '"サステナ盆踊り 応募システム" <hello@kreha-c.com>';
const US = '"FC大阪サステナ盆踊り実行委員会" <' + ADDR + '>';

function msg(from) {
  return { getFrom: () => from, getPlainBody: () => '本文' };
}
function thread(id, subject, froms) {
  const ms = froms.map(msg);
  return {
    getId: () => id, getFirstMessageSubject: () => subject, getMessages: () => ms,
    getLastMessageDate: () => new Date('2026-09-25T00:00:00Z'), isUnread: () => false,
    getPermalink: () => 'https://mail.google.com/' + id,
  };
}

function box(threads) {
  const seen = {};
  const ctx = {
    GmailApp: { search: (q, start, max) => { seen.q = q; seen.max = max; return threads.slice(0, max); } },
    configText: (k) => (k === '問い合わせメール' ? ADDR : ''),
    logError_: () => {},
    Utilities: { formatDate: () => '2026-09-25 09:00' },
  };
  vm.createContext(ctx);
  // 定数は本番のソースから取る（写さない）
  const consts = ADMIN.match(/var INBOX_[A-Z]+ = \d+;/g).join('\n');
  const sender = MAIL.match(/var ALERT_SENDER_NAME_ = '[^']*';/)[0];
  vm.runInContext(consts + '\n' + sender + '\n' + cutFunction(ADMIN, 'adminInbox_'), ctx);
  return { run: () => JSON.parse(JSON.stringify(ctx.adminInbox_({}))), seen };
}

describe('問い合わせメールに、システムの警報を出さない', () => {

  test('警報だけのスレッドは出ない／問い合わせは出る', () => {
    const b = box([
      thread('a1', '【要確認】サステナ盆踊り｜専用リンクへの不一致アクセスが続いています', [SYS]),
      thread('q1', '出店の件でご質問です', ['田中 <tanaka@example.com>']),
      thread('a2', '【要確認】サステナ盆踊り 応募システムの異常', [SYS]),
    ]);
    const r = b.run();
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.rows.map(x => x.id), ['q1']);
  });

  test('こちらが返信した問い合わせは、消えない', () => {
    const b = box([
      thread('q2', 'Re: 受付完了のお知らせ', ['鈴木 <suzuki@example.com>', US]),
    ]);
    const r = b.run();
    assert.deepStrictEqual(r.rows.map(x => x.id), ['q2'], '返信済みの問い合わせが消えています');
    assert.strictEqual(r.rows[0].replied, true);
  });

  // 外すのは「すべての1通がシステム」のときだけ。警報に人が返信したら、それは会話なので出す
  test('警報に人が返信したスレッドは、出す', () => {
    const b = box([thread('h1', '【要確認】警報', [SYS, '小谷 <kotani@example.com>'])]);
    assert.deepStrictEqual(b.run().rows.map(x => x.id), ['h1'],
      '人の返信が入ったスレッドまで消えています（返信済みの問い合わせが消えています）');
  });

  test('警報が多くても、問い合わせが押し出されない', () => {
    const list = [];
    for (let i = 0; i < 50; i++) list.push(thread('a' + i, '【至急】警報', [SYS]));
    for (let i = 0; i < 40; i++) list.push(thread('q' + i, '質問' + i, ['客 <c' + i + '@example.com>']));
    const b = box(list);
    const r = b.run();
    assert.ok(r.rows.length >= 30,
      '画面に出す件数ぶんしか読んでいません（警報に押し出されて ' + r.rows.length + '件）');
    assert.ok(r.rows.length <= 30, '画面に出す上限（30件）を守っていません');
    assert.ok(r.rows.every(x => x.id.startsWith('q')), '警報が混ざっています');
  });

  test('警報の差出人名は、送る側と読む側で同じ定数を使う', () => {
    const send = cutFunction(MAIL, 'alertOperator_');
    assert.ok(send.includes('name: ALERT_SENDER_NAME_'),
      '警報の差出人名が直書きです。定数を変えたとき、問い合わせ欄に警報が混ざり始めます');
    assert.ok(cutFunction(ADMIN, 'adminInbox_').includes('ALERT_SENDER_NAME_'));
  });
});
