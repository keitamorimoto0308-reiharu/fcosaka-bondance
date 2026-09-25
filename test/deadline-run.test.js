/**
 * 締切の振る舞いを「実際に走らせて」確かめる。
 *
 * ■ なぜ要るか（2026-09-25 に気づいた穴）
 *   gas/Api.gs の submit_ には「2) 締切：フロントと両側で制御する」と書いてあり、
 *   gas/Config.gs の isClosed は「締切後に受け続ける失敗は回復できない」と
 *   コメントしている。**それなのに、この判定を確かめる検査が1件も無かった。**
 *   `if (isClosed())` を丸ごと消しても、テストは全部緑のままだった。
 *
 *   引き継ぎ書の教訓そのもの：
 *   「検査は『呼んでいるか』しか見ていなかった」「判定を逆にしても誰も気づかない」。
 *   締切（2026-09-30 18:00）を過ぎて応募を受け続けると、
 *   **出店できない会社に受付完了メールを送る**ことになり、取り返しがつかない。
 *
 * ■ どうやって走らせるか
 *   submit_ と、締切の判定（isClosed / getDeadline）を**本物のまま**箱に入れる。
 *   時計（Date）だけを差し替えて、締切の前・ちょうど・後を作る。
 *   台帳とメールは代役にして、**呼ばれたかどうか**を記録する。
 *   代役は本物と同じ引数の数にそろえる
 *   （引き継ぎ書：代役が本物より優しいと、本番で必ず失敗するコードが通る）。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const { validApplication, rentalItemsStub } = require('./_application');

/** 改行コードを揃えて読む。CRLF のままだと目印が見つからず切り出しに失敗する */
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/** 名前で関数を1つ切り出す。関数の終わりは行頭の `}` */
function cutFunction(code, name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' が見つかりません');
  const end = code.indexOf('\n}\n', start) + 3;
  assert.ok(end > start, name + ' の終わりが見つかりません');
  return code.slice(start, end);
}

/** 締切日時（日本時間）に対する、UTCでの絶対時刻 */
const DEADLINE_JST = '2026-09-30 18:00';
const JUST_BEFORE  = '2026-09-30T08:59:00.000Z';   // 17:59 JST
const EXACTLY      = '2026-09-30T09:00:00.000Z';   // 18:00 JST ちょうど
const JUST_AFTER   = '2026-09-30T09:01:00.000Z';   // 18:01 JST

/**
 * submit_ を、締切の判定だけ本物のまま走らせる。
 * @param {Object} opt - { now: ISO文字列, deadline: 設定シートの「締切日時」の値 }
 */
function loadSubmit(opt) {
  opt = opt || {};
  const now = opt.now || JUST_BEFORE;
  const deadline = ('deadline' in opt) ? opt.deadline : DEADLINE_JST;

  // 呼ばれたことの記録。**締切後に1件でも入っていたら事故**
  const calls = { appended: [], receipt: [], notify: [], quarantined: [], alerts: [] };

  // 時計の差し替え。引数なしの new Date() だけを固定する
  // （getDeadline は new Date(Date.UTC(...)) を使うので、引数ありは本物のまま）
  class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(now); else super(...args);
    }
    static now() { return new Date(now).getTime(); }
  }
  FixedDate.UTC = Date.UTC;
  FixedDate.parse = Date.parse;

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Error,
    Date: FixedDate,
    console: { log: () => {}, error: () => {} },

    // ── 設定シートの代役。**getConfig は引数を取らない**（本物と同じ形）
    getConfig: () => ({ '締切日時': deadline }),
    configText: (key, fallback) => (fallback === undefined ? '' : fallback),

    // ── 台帳・メールの代役。引数の数は本物に合わせる
    //    appendApplication(values, submissionId) / quarantine_(values, reason)
    appendApplication: (values, submissionId) => {
      calls.appended.push({ values, submissionId });
      return { receiptId: 'SB-0009', duplicateFlag: '' };
    },
    quarantine_: (values, reason) => { calls.quarantined.push(reason); },
    sendReceiptMail: (values, receiptId) => { calls.receipt.push(receiptId); },
    sendNotifyMail: (values, receiptId, duplicateFlag, adminUrl) => {
      calls.notify.push(receiptId);
      return { sent: 1, failed: [] };
    },
    writeMailStatus_: (receiptId, receiptStatus, notifyStatus) => {},
    logError_: (where, err) => {},
    alertOperator_: (key, receiptId, extra) => { calls.alerts.push(key); },

    // ── 検証が使うもの（test/validate.test.js と同じ代役）
    getStaffOptions: () => [{ label: 'その他' }],
    getRentalQtyItems: () => rentalItemsStub(),

    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (algo, text) => [1, 2, 3, 4],
      formatDate: (d, tz, fmt) => '09/30 17:59',
    },
    ss_: () => ({ getSpreadsheetTimeZone: () => 'Asia/Tokyo' }),
  });

  vm.runInContext(read('gas/Num.gs'), box);
  vm.runInContext(read('gas/Schema.gs'), box);

  // 締切の判定は**本物**を入れる。ここを確かめたい
  const config = read('gas/Config.gs');
  ['getDeadline', 'isClosed'].forEach(n => {
    vm.runInContext(cutFunction(config, n), box);
  });

  const api = read('gas/Api.gs');
  ['validateFieldList_', 'validate_', 'nowText_', 'submit_'].forEach(n => {
    vm.runInContext(cutFunction(api, n), box);
  });

  const fn = vm.runInContext('submit_', box);
  return {
    calls,
    submit: payload => JSON.parse(JSON.stringify(fn(payload))),
  };
}

/** 応募フォームが送る形（src/build-form.js と同じ） */
function payloadOf(values) {
  return { action: 'submit', submissionId: 'test-0001', values: values };
}

describe('締切（サーバー側を実際に動かす）', () => {

  test('締切の前なら、応募は通って台帳に記録される', () => {
    // これが通らないと、**締切前なのに1社も応募できない**。
    // 「締切後に弾く」の検査だけを書くと、弾きすぎる事故に気づけない
    const { submit, calls } = loadSubmit({ now: JUST_BEFORE });
    const r = submit(payloadOf(validApplication()));
    assert.strictEqual(r.ok, true, '締切前の応募が弾かれています：' + JSON.stringify(r));
    assert.strictEqual(calls.appended.length, 1, '台帳に記録されていません');
    assert.strictEqual(calls.receipt.length, 1, '受付確認メールが送られていません');
    assert.strictEqual(calls.notify.length, 1, '運営への通知が送られていません');
  });

  test('締切を過ぎたら、応募を受け付けない', () => {
    const { submit } = loadSubmit({ now: JUST_AFTER });
    const r = submit(payloadOf(validApplication()));
    assert.strictEqual(r.ok, false, '締切後の応募が通ってしまいます');
    assert.strictEqual(r.error, 'closed', '締切以外の理由で弾いています：' + JSON.stringify(r));
  });

  test('締切を過ぎた応募は、台帳にもメールにも一切行かない', () => {
    // いちばん怖い形：弾いたつもりで記録だけ残る、
    // あるいは**出店できない会社に受付完了メールが届く**
    const { submit, calls } = loadSubmit({ now: JUST_AFTER });
    submit(payloadOf(validApplication()));
    assert.strictEqual(calls.appended.length, 0, '締切後なのに台帳へ記録しています');
    assert.strictEqual(calls.receipt.length, 0, '締切後なのに受付確認メールを送っています');
    assert.strictEqual(calls.notify.length, 0, '締切後なのに運営へ通知しています');
  });

  test('締切ちょうど（18:00:00）は、まだ受け付ける', () => {
    // 境界を決めておく。「18:00 まで」と案内しているので、
    // 18:00:00 に押された応募を落とすと、案内と食い違う
    const { submit } = loadSubmit({ now: EXACTLY });
    const r = submit(payloadOf(validApplication()));
    assert.strictEqual(r.ok, true, '締切ちょうどの応募が弾かれています：' + JSON.stringify(r));
  });

  test('締切日時が空なら、受付を止める（安全側に倒す）', () => {
    // gas/Config.gs の設計：受付を止めすぎる失敗は電話で回復できるが、
    // 締切後に受け続ける失敗は回復できない
    const { submit, calls } = loadSubmit({ now: JUST_BEFORE, deadline: '' });
    const r = submit(payloadOf(validApplication()));
    assert.strictEqual(r.ok, false, '締切が空なのに応募を受け付けています');
    assert.strictEqual(r.error, 'closed');
    assert.strictEqual(calls.appended.length, 0, '締切が空なのに台帳へ記録しています');
  });

  test('締切日時が読めない書式なら、受付を止める', () => {
    const { submit } = loadSubmit({ now: JUST_BEFORE, deadline: '9月30日ごろ' });
    const r = submit(payloadOf(validApplication()));
    assert.strictEqual(r.ok, false, '締切を解釈できないのに応募を受け付けています');
    assert.strictEqual(r.error, 'closed');
  });

  test('締切後にハニーポットが埋まっていても、台帳には記録しない', () => {
    // ハニーポットの判定は締切より手前にある。
    // ボットに「弾かれた」と学習させないため、成功と同じ形を返す仕様
    const honeypot = require('../src/schema.js').FIELDS
      .filter(f => f.type === 'honeypot')[0];
    assert.ok(honeypot, 'ハニーポットの項目が見つかりません');

    const { submit, calls } = loadSubmit({ now: JUST_AFTER });
    const values = validApplication();
    values[honeypot.key] = 'bot';
    const r = submit(payloadOf(values));
    assert.strictEqual(r.discarded, true, 'ハニーポットが効いていません');
    assert.strictEqual(calls.appended.length, 0, '台帳へ記録しています');
    assert.strictEqual(calls.quarantined.length, 1, '退避シートに残していません');
  });
});
