/**
 * デモ用テストデータの投入（`gas/Seed.gs`）。
 *
 * ■ ここで確かめたいこと
 *   - **行の組み立てを写していない**（本番の appendApplication を通る）
 *   - **消せる状態でしか入らない**（設定のスイッチがONのときだけ）
 *   - **本物の応募が1件でもあれば断る**（混ざると見分けられない）
 *   - メールを送らない
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeSheet } = require('./_gasbox');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const LEDGER_HEADERS = ['受付ID', '企業名', '担当者氏名'];

function makeBox(opts) {
  opts = opts || {};
  const sheets = {
    '出店者': makeSheet(LEDGER_HEADERS, opts.rows || []),
  };
  const appended = [];
  const mailed = [];

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Boolean, Date,
    console: { log() {}, error() {} },
    SHEET: { LEDGER: '出店者' },
    sheet_: name => sheets[name],
    getConfig: k => (opts.config || {})[k],
    PURGE_SWITCH: 'テストデータの削除',
    asText_: v => (v == null ? '' : String(v)),
    // **本物の appendApplication の代役。**呼ばれたことと、渡された中身を見る
    appendApplication: (values, submissionId) => {
      appended.push({ values, submissionId });
      return { receiptId: 'SB-' + ('000' + appended.length).slice(-4) };
    },
    // 呼ばれたら検査が落ちる。テストデータ投入でメールは送らない
    MailApp: { sendEmail: () => { mailed.push(1); } },
    sendMail_: () => { mailed.push(1); },
  });

  vm.runInContext(read('gas/Seed.gs'), box);
  return { box, sheets, appended, mailed };
}

/** 落ちた理由を取り出す（落ちなければ空文字） */
const grab = fn => { try { fn(); return ''; } catch (e) { return (e && e.message) || String(e); } };

const run = (b, n) => {
  b.box.__n = n;
  return vm.runInContext('seedTestData(__n)', b.box);
};

describe('テストデータの投入', () => {

  test('スイッチがOFFなら、1件も入れない', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'OFF' } });
    /*
     * **見分けのつく文を、最初に落ちる判定に置く。**
     * assert.throws を先に書くと、断らなかったときは
     * 「例外が出ませんでした」で落ちるので、
     * test/break_purge.py がどの歯止めか見分けられない。
     */
    const threw = grab(() => run(b));
    assert.strictEqual(b.appended.length, 0, 'OFFなのに入れました');
    assert.match(String(threw), /テストデータの一括削除を許可/, '断っていません');
  });

  test('スイッチが空でも、入れない（未設定を「入れてよい」と読まない）', () => {
    const b = makeBox({ config: {} });
    assert.throws(() => run(b), /ONにしてから/);
    assert.strictEqual(b.appended.length, 0);
  });

  test('ONなら入る。件数を指定できる', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    const r = run(b, 3);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.added, 3, JSON.stringify(r));
    assert.strictEqual(b.appended.length, 3);
    // vm の中で作られた配列は別の realm のものなので、値にして比べる
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.receiptIds)),
                           ['SB-0001', 'SB-0002', 'SB-0003']);
  });

  test('件数を省くと、用意されている分をすべて入れる', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    const r = run(b);
    assert.ok(r.added >= 5, 'デモに足りる件数がありません：' + r.added);
    assert.strictEqual(b.appended.length, r.added);
  });

  test('行の組み立ては写さず、本番の appendApplication を通す', () => {
    /*
     * ここで行を自分で組むと、受付IDの採番も重複の検出も生データJSONも
     * 写しになる。「デモでは通ったのに本番で列がずれる」が起きる。
     */
    const src = read('gas/Seed.gs');
    assert.ok(src.indexOf('appendApplication(') >= 0,
      '本番の appendApplication を通っていません');
    ['buildRow_', 'nextReceiptId_', 'appendRow', 'rawJson_'].forEach(name => {
      assert.ok(src.indexOf(name) < 0,
        '行の組み立てを写しています（' + name + '）');
    });
  });

  test('メールは送らない', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    run(b, 2);
    assert.strictEqual(b.mailed.length, 0, 'メールを送ろうとしました');
  });

  test('本物の応募が1件でもあれば、断る', () => {
    /*
     * 混ざると、あとで「どれがテストか」を人が見分けることになる。
     * 一括削除は台帳を丸ごと空にするので、本物まで消える。
     */
    const b = makeBox({ config: { 'テストデータの削除': 'ON' },
                        rows: [['SB-0001', '株式会社ほんもの', '本物 太郎']] });
    const threw = grab(() => run(b));
    assert.strictEqual(b.appended.length, 0, '本物があるのに入れました');
    assert.match(String(threw), /本物の応募が 1 件あります/, '断っていません');
  });

  test('すでに入れたテストデータがあっても、足せる', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' },
                        rows: [['SB-0001', '【テスト】みどり食堂', '試験 太郎']] });
    const r = run(b, 2);
    assert.strictEqual(r.added, 2);
  });

  test('送るのは、実在しない企業と example.com のアドレスだけ', () => {
    // うっかり送信しても外に出ない。電話番号も明らかに嘘と分かる形にする
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    run(b);
    b.appended.forEach(({ values }) => {
      assert.match(values.companyName, /^【テスト】/,
        '企業名がテストと分かりません：' + values.companyName);
      assert.match(values.contactEmail, /@example\.com$/,
        '外に出るアドレスです：' + values.contactEmail);
      assert.match(values.contactPhone, /^000-/,
        '実在しうる電話番号です：' + values.contactPhone);
    });
  });

  test('入れる内容は、フォームの選択肢に実在する値だけ', () => {
    /*
     * ここがずれると、デモの一覧に「選択肢に無い値」が並ぶ。
     * 集計も色分けも効かなくなる。選択肢は gas/Schema.gs から読む。
     */
    const schema = read('gas/Schema.gs');
    const s = schema.indexOf('var FIELDS = [');
    const FIELDS = vm.runInNewContext(
      '(' + schema.slice(s + 13, schema.indexOf('\n];', s) + 2) + ')');
    const opt = key => {
      const f = FIELDS.filter(x => x.key === key)[0];
      return (f && f.options || []).map(o => (typeof o === 'string' ? o : o.value));
    };

    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    run(b);
    b.appended.forEach(({ values }) => {
      (values.boothTypes || []).forEach(v => {
        assert.ok(opt('boothTypes').indexOf(v) >= 0, '出店形態が選択肢にありません：' + v);
      });
      ['foodLicense', 'packaging', 'tableware', 'boothSize', 'power', 'tentChoice']
        .forEach(k => {
          if (!values[k]) return;
          assert.ok(opt(k).indexOf(values[k]) >= 0,
            k + ' が選択肢にありません：' + values[k]);
        });
    });
  });

  test('上限を超える件数は求めても入らない', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    const r = run(b, 999);
    assert.ok(r.added <= 30, '上限を超えました：' + r.added);
  });

  test('件数が読み取れないときは断る', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    assert.throws(() => run(b, 'たくさん'), /件数が読み取れません/);
    assert.strictEqual(b.appended.length, 0);
  });
});
