/**
 * 運用者への警報が、**受け取った人が動ける形**になっているか。
 *
 * ■ なぜ要るか
 *   2026-09-02 けいた指摘：
 *   「応募システムの異常っていうメールが頻発してるけどこれは何。
 *     …このメールの意味が分からない。ほんとのアラートだけでいい」
 *
 *   それまでは、深刻さの違う15種類が**すべて同じ件名**で飛び、
 *   本文は一言だけだった。受け取っても何をすればよいか分からない。
 *   警報が多すぎると、**本当の警報が埋もれる**。それがいちばん危ない。
 *
 * ■ 見るのは3つ
 *   1. すべての警報に「何が起きたか／いま困ること／すべきこと」がある
 *   2. 呼び出し側が、生の文字列ではなく**名前**で呼んでいる
 *      （文面を書く場所を1か所に閉じるため）
 *   3. 実際に組み立てて、件名と本文が期待どおりになる
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const MAIL = read('gas/Mail.gs');

/** 説明として意味をなす最低の長さ */
const MIN = 15;

/** ALERT_ を実際に読み込む（文字列の足し算があるので、目で見るのでは足りない） */
function loadAlerts() {
  const m = MAIL.match(/var ALERT_ = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'ALERT_ が見つかりません');
  return vm.runInNewContext('(' + m[1] + ')');
}

describe('警報：受け取った人が動ける文面か', () => {

  test('すべての警報に、3つの説明がそろっている', () => {
    const A = loadAlerts();
    const keys = Object.keys(A);
    assert.ok(keys.length >= 8, '警報を拾えていません：' + keys.length);
    keys.forEach(k => {
      const a = A[k];
      assert.ok(['至急', '要確認'].includes(a.level), k + ' の深刻さが変です：' + a.level);
      assert.ok((a.title || '').length >= 8, k + ' の見出しが短すぎます');
      ['what', 'impact', 'todo'].forEach(f => {
        assert.ok((a[f] || '').length >= MIN,
          k + ' の ' + f + ' が短すぎます（' + (a[f] || '').length + '文字）');
      });
    });
  });

  test('「していただきたいこと」が、動作を指している', () => {
    // 「ご確認ください」だけでは、どこを見ればよいか分からない
    const A = loadAlerts();
    Object.keys(A).forEach(k => {
      const todo = A[k].todo;
      const hasWhere = /シート|タブ|管理ページ|一覧|Drive|パスワード|ご相談/.test(todo);
      assert.ok(hasWhere, k + ' の todo に、どこを見ればよいかが書かれていません：' + todo);
    });
  });

  test('呼び出し側は、名前で呼んでいる（生の文面を書いていない）', () => {
    // 生の文字列を渡せると、文面が散らばって手当てできなくなる
    const A = loadAlerts();
    const files = fs.readdirSync(path.join(ROOT, 'gas')).filter(f => f.endsWith('.gs'));
    let calls = 0;
    files.forEach(f => {
      const src = read('gas/' + f);
      [...src.matchAll(/alertOperator_\(\s*'([^']*)'/g)].forEach(m => {
        calls++;
        assert.ok(Object.prototype.hasOwnProperty.call(A, m[1]),
          'gas/' + f + ' が知らない警報を呼んでいます：' + m[1]);
      });
      // 変数や文字列の足し算で渡していないか
      assert.ok(!/alertOperator_\(\s*'[^']*'\s*\+/.test(src),
        'gas/' + f + ' が警報に文字列を足しています（名前だけを渡すこと）');
    });
    assert.ok(calls >= 10, '呼び出しを拾えていません：' + calls);
  });

  test('定義したのに、どこからも呼ばれていない警報が無い', () => {
    const A = loadAlerts();
    const all = fs.readdirSync(path.join(ROOT, 'gas'))
      .filter(f => f.endsWith('.gs')).map(f => read('gas/' + f)).join('\n');
    Object.keys(A).forEach(k => {
      assert.ok(all.includes("alertOperator_('" + k + "'"),
        '警報「' + k + '」が、どこからも呼ばれていません');
    });
  });

  test('実際に組み立てると、件名と本文が読める形になる', () => {
    const sent = [];
    const box = vm.createContext({
      Array, Object, String, Number, JSON,
      console: { error() {} },
      configText: (k, d) => (k === '障害通知先' ? 'ops@test.example' : (d || '')),
      Utilities: { formatDate: () => '2026/10/01 12:00:00' },
      GmailApp: { sendEmail: (to, subject, body, opt) => sent.push({ to, subject, body, opt }) },
    });
    const i = MAIL.indexOf('var ALERT_ = {');
    const j = MAIL.indexOf('\n}\n', MAIL.indexOf('function alertOperator_')) + 3;
    vm.runInContext(MAIL.slice(i, j), box);

    vm.runInContext('alertOperator_', box)('ledgerWriteFailed', 'SB-0007', '退避に保存済み');
    assert.strictEqual(sent.length, 1, '送られていません');
    const m = sent[0];
    assert.strictEqual(m.to, 'ops@test.example');
    assert.ok(m.subject.startsWith('【至急】'), '深刻さが件名に出ていません：' + m.subject);
    assert.ok(m.subject.includes('応募を記録できませんでした'), m.subject);
    assert.ok(m.body.includes('■ いま困ること'), '「いま困ること」がありません');
    assert.ok(m.body.includes('■ していただきたいこと'), '「すべきこと」がありません');
    assert.ok(m.body.includes('退避に保存済み'), '詳細が入っていません');
    assert.ok(m.body.includes('SB-0007'), '受付IDが入っていません');
  });

  test('知らない名前で呼ばれても、落ちずに何も送らない', () => {
    // 呼び出し側の打ち間違いで、応募の記録まで巻き添えにしない
    const sent = [];
    const errs = [];
    const box = vm.createContext({
      Array, Object, String, Number, JSON,
      console: { error: m => errs.push(String(m)) },
      configText: () => 'ops@test.example',
      Utilities: { formatDate: () => '' },
      GmailApp: { sendEmail: () => sent.push(1) },
    });
    const i = MAIL.indexOf('var ALERT_ = {');
    const j = MAIL.indexOf('\n}\n', MAIL.indexOf('function alertOperator_')) + 3;
    vm.runInContext(MAIL.slice(i, j), box);
    vm.runInContext('alertOperator_', box)('そんな警報はない', '');
    assert.strictEqual(sent.length, 0, '知らない名前で送っています');
    assert.ok(errs.join('').includes('知らない警報'), '記録に残していません');
  });

  test('ハニーポットは、メールを送らない', () => {
    // 受け取っても、その場でできることが無い。
    // 退避シートに行があることは、ダッシュボードが拾う
    const api = read('gas/Api.gs');
    const i = api.indexOf('var hp = FIELDS.filter');
    const block = api.slice(i, api.indexOf('// 2)', i));
    assert.ok(block.includes('quarantine_('), '退避していません');
    assert.ok(!block.includes('alertOperator_('), 'ハニーポットでメールを送っています');
  });

  test('鍵の合わないアクセスは、続いたときだけ知らせる', () => {
    // 1回で鳴らすと、こちらの動作確認でも鳴る
    const notify = read('gas/Notify.gs');
    const fn = notify.slice(notify.indexOf('function confirmNoteFailure_'));
    assert.ok(/CONFIRM_ALERT_MIN/.test(fn), '回数を見ていません');
    assert.ok(/n < CONFIRM_ALERT_MIN\) return;/.test(fn), '回数が少なくても送っています');
    const min = Number((notify.match(/var CONFIRM_ALERT_MIN = (\d+);/) || [])[1]);
    assert.ok(min >= 10, '閾値が低すぎます：' + min);
  });
});
