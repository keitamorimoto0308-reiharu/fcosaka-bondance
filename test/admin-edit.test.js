/**
 * 管理ページからの「応募内容の修正」と「担当メモの積み上げ」を、
 * 実際に走らせて確かめるテスト。
 *
 * ■ なぜ要るか
 *   ここは**事業者さまが申告した内容**を、こちら側から書き換える操作。
 *   なぜ変えたのかが残らないと、あとで誰も判断できない。
 *   また、台帳のセルだけ直して生データを放置すると、
 *   事業者さまが修正画面を開いたときに古い値が出て、
 *   **こちらの修正が黙って巻き戻る**。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, 'gas', f), 'utf8')
  .split('\r\n').join('\n');
const S = require('../src/schema.js');

let WRITES, HISTORY, SHEET_ROWS;

const RAW = {
  companyName: '株式会社テスト', boothName: 'テスト出店',
  contactName: 'テスト太郎', contactEmail: 'test@example.com',
  contactPhone: '06-1234-5678',
  fcosakaStaff: 'その他',
  boothTypes: ['展示'], boothDescription: '展示の内容です。',
  boothSize: 'S1', power: '不要', tentChoice: '持ち込む',
  tentOwnWidth: 2.5, tentOwnDepth: 3, tentWeight: '持参する',
  rentalItems: {}, agreeAll: true,
};

/** gas/Admin.gs の該当部分だけを切り出して動かす */
function load(opts) {
  opts = opts || {};
  WRITES = []; HISTORY = [];

  const headers = ['受付ID', '企業名', '担当者電話', '担当メモ', 'ステータス', '生データ(JSON)'];
  SHEET_ROWS = [['SB-0007', RAW.companyName, RAW.contactPhone,
                 opts.memo || '', '未確認', JSON.stringify(RAW)]];

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, Boolean, Date, isFinite,
    Utilities: { formatDate: () => '2026/09/01 10:00' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} },
    LOCK_WAIT_MS: 1000,
    // 上限まわりの定数と、履歴・生データの書き込み。
    // 代役では素通しにせず、本番と同じ値を使う（緩めると意味が無い）
    MEMO_ADD_MAX: 2000, MEMO_TOTAL_MAX: 45000,
    FIELD_TEXT_MAX: 5000, REASON_MAX: 500,
    STATUS_NEEDS_REASON_: ['不採択', '辞退', 'キャンセル', '重複（無効）'],
    DAY_STATUS: ['未着', '搬入済', '設営完了', '撤収完了'],
    rawJson_: v => JSON.stringify(v),
    logError_: () => {},
    alertOperator_: () => {},
    COL: { id: '受付ID', memo: '担当メモ', status: 'ステータス',
           dayStatus: '当日ステータス', raw: '生データ(JSON)' },
    applyFields: () => S.applyFields(),
    validate_: opts.validate || (() => []),
    readLedger_: () => ({
      headers: headers.slice(),
      rows: SHEET_ROWS.map(r => r.slice()),
      sheet: {
        getRange: (row, col) => ({
          getValue: () => SHEET_ROWS[row - 2][col - 1],
          setValue: v => {
            WRITES.push({ header: headers[col - 1], value: v });
            SHEET_ROWS[row - 2][col - 1] = v;
          },
        }),
      },
    }),
    indexOf_: (arr, v) => arr.indexOf(v),
    asText_: v => String(v == null ? '' : v),
    safeCellText_: v => String(v == null ? '' : v),
    appendHistory: (...a) => { HISTORY.push(a); },
    STATUS_LIST_: () => ['未確認', '審査中', '採択', '不採択', '辞退', 'キャンセル', '重複（無効）'],
    EDITABLE_: () => ['ステータス', '担当メモ', '当日ステータス'],
    console,
  });
  box.globalThis = box;

  const src = read('Admin.gs');
  for (const marker of ['function recordHistory_', 'function applicantEditable_', 'function adminApplicantFields_',
                        'function adminApplicantUpdate_', 'function adminUpdate_']) {
    const start = src.indexOf(marker);
    assert.ok(start >= 0, 'gas/Admin.gs に ' + marker + ' がありません');
    const end = src.indexOf('\n}\n', start) + 3;
    vm.runInContext(src.slice(start, end), box);
  }
  return box;
}

const ME = { person: '山田 太郎', role: '管理者' };
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));

describe('担当メモは積み上げる', () => {

  test('前のメモを消さずに、上へ足す', () => {
    // 上書きにすると、前の担当が書いた経緯が黙って消える
    const A = load({ memo: '2026/08/30 10:00  佐藤 花子\n電話で確認済み' });
    const r = plain(A.adminUpdate_(ME, { id: 'SB-0007', patch: { '担当メモ': '追加の連絡あり' } }));
    assert.strictEqual(r.ok, true);
    const memo = WRITES.filter(w => w.header === '担当メモ').pop().value;
    assert.ok(memo.includes('追加の連絡あり'), '追記が入っていません');
    assert.ok(memo.includes('電話で確認済み'), '前のメモが消えています');
    assert.ok(memo.indexOf('追加の連絡あり') < memo.indexOf('電話で確認済み'),
      '新しいメモが下に来ています（新しいものを上に）');
  });

  test('いつ・誰が書いたかが自動で付く', () => {
    const A = load({ memo: '' });
    A.adminUpdate_(ME, { id: 'SB-0007', patch: { '担当メモ': 'はじめてのメモ' } });
    const memo = WRITES.filter(w => w.header === '担当メモ').pop().value;
    assert.ok(memo.includes('2026/09/01'), '日時が付いていません');
    assert.ok(memo.includes('山田 太郎'), '書いた人が付いていません');
  });

  test('空の追記では何も起きない', () => {
    const A = load({ memo: '前のメモ' });
    const r = plain(A.adminUpdate_(ME, { id: 'SB-0007', patch: { '担当メモ': '   ' } }));
    assert.strictEqual(r.changed, 0);
    assert.strictEqual(WRITES.length, 0, '空の追記で書き込んでいます');
  });
});

describe('応募内容の修正：理由なしには通さない', () => {

  test('理由が短ければ保存しない', () => {
    const A = load();
    const r = plain(A.adminApplicantUpdate_(ME,
      { id: 'SB-0007', patch: { contactPhone: '06-9999-0000' }, reason: '' }));
    assert.strictEqual(r.error, 'reason_required');
    assert.strictEqual(WRITES.length, 0, '理由が無いのに書き込んでいます');
  });

  test('理由があれば保存し、履歴に理由まで残す', () => {
    const A = load();
    const r = plain(A.adminApplicantUpdate_(ME, {
      id: 'SB-0007', patch: { contactPhone: '06-9999-0000' },
      reason: 'お電話で訂正のご連絡あり',
    }));
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.changed, 1);
    assert.strictEqual(HISTORY.length, 1);
    const [operator, id, item, before, after, reason] = HISTORY[0];
    assert.strictEqual(operator, '山田 太郎');
    assert.strictEqual(before, '06-1234-5678', '変更前が残っていません');
    assert.strictEqual(after, '06-9999-0000');
    assert.strictEqual(reason, 'お電話で訂正のご連絡あり', '理由が残っていません');
  });

  test('生データも一緒に直す', () => {
    // ここを忘れると、事業者さまが修正画面を開いたとき古い値が出て、
    // こちらの修正が黙って巻き戻る
    const A = load();
    A.adminApplicantUpdate_(ME, {
      id: 'SB-0007', patch: { contactPhone: '06-9999-0000' }, reason: '電話で訂正の連絡',
    });
    const raw = WRITES.filter(w => w.header === '生データ(JSON)').pop();
    assert.ok(raw, '生データを書いていません');
    assert.strictEqual(JSON.parse(raw.value).contactPhone, '06-9999-0000');
  });

  test('選択式の項目は、この画面から変えられない', () => {
    // 台帳には表示用のラベルが入るので、書き換えると生データと食い違う。
    // 選択肢の変更は、事業者さまご本人に直していただく
    const A = load();
    const r = plain(A.adminApplicantUpdate_(ME, {
      id: 'SB-0007', patch: { boothTypes: ['飲食'] }, reason: '変更のご連絡あり',
    }));
    assert.strictEqual(r.error, 'forbidden_field');
    assert.strictEqual(WRITES.length, 0);
  });

  test('応募時と同じ検証を通す', () => {
    const A = load({ validate: () => [{ key: 'contactEmail', message: 'だめ' }] });
    const r = plain(A.adminApplicantUpdate_(ME, {
      id: 'SB-0007', patch: { contactEmail: 'こわれた' }, reason: '訂正のご連絡あり',
    }));
    assert.strictEqual(r.error, 'validation');
    assert.strictEqual(WRITES.length, 0, '検証で弾いたのに書き込んでいます');
  });

  test('変更が無ければ、生データも履歴も触らない', () => {
    const A = load();
    const r = plain(A.adminApplicantUpdate_(ME, {
      id: 'SB-0007', patch: { contactPhone: '06-1234-5678' }, reason: '確認のため',
    }));
    assert.strictEqual(r.changed, 0);
    assert.strictEqual(HISTORY.length, 0);
    assert.strictEqual(WRITES.length, 0);
  });
});

describe('直せる項目の選び方', () => {

  test('記入欄と数値だけが対象になっている', () => {
    const A = load();
    const keys = A.applicantEditable_().map(f => f.key);
    const byKey = {};
    S.applyFields().forEach(f => { byKey[f.key] = f; });
    for (const k of keys) {
      assert.ok(['text', 'textarea', 'email', 'tel', 'url', 'number'].includes(byKey[k].type),
        k + ' は選択式なのに、直せる項目に入っています');
    }
    assert.ok(keys.includes('companyName'), '企業名が直せません');
    assert.ok(!keys.includes('boothTypes'), '複数選択が直せてしまいます');
    assert.ok(!keys.includes('agreeAll'), '同意欄が直せてしまいます');
  });
});

describe('検証役の指摘（同日）に対する守り', () => {

  test('理由や項目が長すぎるときは、書き込む前に断る', () => {
    // 理由に上限が無く、変更履歴の appendRow が長さで落ちていた。
    // 台帳は書き換わり、記録だけが消える＝一番まずい状態を作れた。
    const A = load();
    const long = 'あ'.repeat(60000);
    const r1 = plain(A.adminApplicantUpdate_(ME,
      { id: 'SB-0007', patch: { contactPhone: '06-9999-0000' }, reason: long }));
    assert.strictEqual(r1.error, 'too_long', '長すぎる理由が通ります');
    assert.strictEqual(WRITES.length, 0, '断ったのに書き込んでいます');

    const r2 = plain(A.adminApplicantUpdate_(ME,
      { id: 'SB-0007', patch: { boothDescription: long }, reason: '訂正のご連絡あり' }));
    assert.strictEqual(r2.error, 'too_long', '長すぎる項目が通ります');
  });

  test('constructor や toString を項目名にしても、許可リストを抜けられない', () => {
    // 素の {} だと、これらがプロトタイプ上の値を返して「実在する項目」と誤判定される
    const A = load();
    const r = plain(A.adminApplicantUpdate_(ME, {
      id: 'SB-0007',
      patch: { constructor: 'x', toString: 'y', hasOwnProperty: 'z' },
      reason: '訂正のご連絡あり',
    }));
    assert.strictEqual(r.error, 'forbidden_field', '許可リストの検査を抜けています');
    assert.strictEqual(WRITES.length, 0);
  });

  test('担当者メールの変更は、管理者だけ', () => {
    // このアドレスは事業者さまご本人の確認に使う。
    // 差し替えられると、その応募の修正画面を乗っ取れる
    const A = load();
    const r = plain(A.adminApplicantUpdate_({ person: '一般 太郎', role: '一般' }, {
      id: 'SB-0007', patch: { contactEmail: 'attacker@example.com' },
      reason: '訂正のご連絡あり',
    }));
    assert.strictEqual(r.error, 'forbidden_field', '一般がメールアドレスを変えられます');
    assert.strictEqual(WRITES.length, 0);
  });

  test('検証のために、生データを壊さない', () => {
    // validate_ は渡したオブジェクトを書き換える。
    // next をそのまま渡すと、企業名を1文字直しただけで
    // 無効にした品目が生データから消え、あとで請求額が黙って減る
    const A = load({ validate: v => { delete v.rentalItems; return []; } });
    A.adminApplicantUpdate_(ME, {
      id: 'SB-0007', patch: { companyName: '新しい会社名' }, reason: '訂正のご連絡あり',
    });
    const raw = WRITES.filter(w => w.header === '生データ(JSON)').pop();
    assert.ok(raw, '生データを書いていません');
    assert.ok('rentalItems' in JSON.parse(raw.value),
      '検証の副作用で、生データからレンタルが消えています');
  });

  test('担当メモの追記と全体に、上限がある', () => {
    // セルは5万字が上限。超えると書き込みごと失敗し、
    // 一度そこまで伸びると以後どれだけ短い追記も入らなくなる
    // 1回の追記が長すぎる場合は、黙って切らずに断る
    const A1 = load({ memo: '' });
    const r1 = plain(A1.adminUpdate_(ME, { id: 'SB-0007', patch: { '担当メモ': 'う'.repeat(9000) } }));
    assert.strictEqual(r1.error, 'too_long', '長すぎる追記が通ります');
    assert.strictEqual(WRITES.length, 0, '断ったのに書き込んでいます');

    // 積み上げた全体が上限を超える場合は、古い方を落として印を残す
    const A2 = load({ memo: 'い'.repeat(44500) });
    A2.adminUpdate_(ME, { id: 'SB-0007', patch: { '担当メモ': 'う'.repeat(1500) } });
    const memo = WRITES.filter(w => w.header === '担当メモ').pop().value;
    assert.ok(memo.length <= 45200, '積み上げたメモに上限がありません（' + memo.length + '字）');
    assert.ok(memo.includes('変更履歴'), '省略したことを伝えていません');
    assert.ok(memo.indexOf('う') < memo.indexOf('い'), '新しい追記が残っていません');
  });

  test('後戻りしにくいステータスは、理由なしに変えられない', () => {
    const A = load();
    for (const st of ['不採択', '辞退', 'キャンセル', '重複（無効）']) {
      const r = plain(A.adminUpdate_(ME, { id: 'SB-0007', patch: { 'ステータス': st } }));
      assert.strictEqual(r.error, 'reason_required', st + ' が理由なしで通ります');
    }
  });

  test('当日ステータスも、決められた値だけ', () => {
    const A = load();
    const r = plain(A.adminUpdate_(ME, { id: 'SB-0007', patch: { '当日ステータス': 'でたらめ' } }));
    assert.strictEqual(r.error, 'bad_value', '任意の文字列が入ります（集計がずれます）');
  });

  test('変更履歴を残せなかったら、成功として返さない', () => {
    // 台帳は書き換わったのに記録が無い、という状態を黙って通さない
    const A = load();
    A.appendHistory = function(){ throw new Error('シートが見つかりません'); };
    const r = plain(A.adminApplicantUpdate_(ME, {
      id: 'SB-0007', patch: { contactPhone: '06-9999-0000' }, reason: '訂正のご連絡あり',
    }));
    assert.strictEqual(r.ok, false, '履歴に残せなくても成功として返しています');
    assert.strictEqual(r.error, 'history_failed');
    assert.ok(/変更履歴/.test(r.message), '何が起きたのかが伝わりません');
  });
});
