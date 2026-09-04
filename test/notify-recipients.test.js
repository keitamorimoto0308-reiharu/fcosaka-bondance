/**
 * 応募通知の宛先を、**実際に動かして**確かめる。
 *
 *   通知ON  … すべての応募が届く
 *   通知OFF … 自分が担当社員として選ばれた応募だけ届く
 *
 * ■ ここが壊れると何が起きるか
 *   応募は台帳に入るのに、**誰にも気づかれない**。
 *   応募者から見れば受付完了しているので、催促も来ない。
 *   気づくのは締切後に一覧を開いたときで、そのときには手遅れ。
 *
 * ■ 役割で絞らない（2026-09-02 変更）
 *   それまで「管理者かつ通知ON」だった。一般権限の人がONにしても
 *   **何も届かない**ので、スイッチが嘘をついていた。
 *   一般権限でも出店者一覧は全部見られるので、通知だけ止めても守るものが無い。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/** 関係者。label は「氏名 - 部署（無ければ所属）」で組まれる */
const PEOPLE = [
  { name: '小谷', org: 'FC大阪', dept: '', email: 'kotani@t.test', role: '管理者', notify: true },
  { name: '森本', org: 'KREHA', dept: 'KREHA', email: 'keita@t.test', role: '管理者', notify: true },
  // 一般権限で通知ON。ここが届かないと、スイッチが嘘をつく
  { name: '成田', org: 'FC大阪', dept: '', email: 'narita@t.test', role: '一般', notify: true },
  // 通知OFF。担当に選ばれたときだけ届く
  { name: '木口', org: 'FC大阪', dept: '', email: 'kiguchi@t.test', role: '一般', notify: false },
  // 通知ONだがメール未登録。宛先に入れてはいけない
  { name: '阿部', org: 'FC大阪', dept: '', email: '', role: '一般', notify: true },
];

function call(staffLabel, people) {
  const box = vm.createContext({ Array, Object, String, Number,
    getPeople: () => (people || PEOPLE) });
  const src = read('gas/Config.gs');
  const s = src.indexOf('function getNotifyRecipients(');
  assert.ok(s >= 0, 'getNotifyRecipients が見つかりません');
  vm.runInContext(src.slice(s, src.indexOf('\n}\n', s) + 3), box);
  return vm.runInContext('getNotifyRecipients', box)(staffLabel).sort();
}

test('通知ONの人には、担当かどうかに関係なく届く', () => {
  const to = call('木口 - FC大阪');
  assert.ok(to.includes('kotani@t.test'), '管理者・通知ONに届いていません');
  assert.ok(to.includes('keita@t.test'), '管理者・通知ONに届いていません');
});

test('一般権限でも、通知ONなら届く（スイッチが嘘をつかない）', () => {
  // ここが落ちるということは、ONにしても何も来ない状態に戻っている
  const to = call('木口 - FC大阪');
  assert.ok(to.includes('narita@t.test'),
    '一般権限・通知ONに届いていません（設定が効いていません）');
});

test('通知OFFでも、担当社員に選ばれていれば届く', () => {
  const to = call('木口 - FC大阪');
  assert.ok(to.includes('kiguchi@t.test'), '担当社員に届いていません');
});

test('通知OFFで、担当でもなければ届かない', () => {
  const to = call('成田 - FC大阪');
  assert.ok(!to.includes('kiguchi@t.test'),
    '関係のない応募まで届いています：' + to.join('／'));
});

test('メールが未登録の人は、宛先に入らない', () => {
  // 空の宛先を混ぜると GmailApp が落ち、**通知が全員に届かなくなる**
  const to = call('阿部 - FC大阪');
  assert.ok(to.every(a => a && a.indexOf('@') > 0),
    '空の宛先が混ざっています：' + JSON.stringify(to));
  assert.ok(!to.includes(''), '空文字が宛先に入っています');
});

test('同じ人が二重に入らない（担当かつ通知ON）', () => {
  const to = call('成田 - FC大阪');
  assert.strictEqual(new Set(to).size, to.length, '宛先が重複しています：' + to.join('／'));
});

test('担当社員が「その他」でも落ちない', () => {
  // 応募者は「その他」を選べる。誰にも一致しないラベルが来る
  const to = call('その他');
  assert.ok(to.includes('kotani@t.test'), '通知ONの人にすら届いていません');
  assert.ok(!to.includes('kiguchi@t.test'), '通知OFFの人に届いています');
});

test('関係者が誰もいなければ、宛先は空になる（落ちない）', () => {
  assert.deepStrictEqual(call('小谷 - FC大阪', []), []);
});
