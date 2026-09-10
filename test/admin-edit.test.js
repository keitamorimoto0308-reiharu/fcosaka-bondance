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

  // 列は**本物と同じだけ持たせる**。代役のほうが狭いと、
  // 本番で通る道を一度も通らないまま緑になる（引き継ぎ書の学び）
  const headers = ['受付ID', '企業名', '担当者電話', '担当メモ', 'ステータス',
                   '搬入予定時刻', '生データ(JSON)'];
  SHEET_ROWS = [['SB-0007', RAW.companyName, RAW.contactPhone,
                 opts.memo || '', '未確認', opts.inAt || '', JSON.stringify(RAW)]];

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
           inAt: '搬入予定時刻',
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
    // 本物（gas/Admin.gs の EDITABLE_）と**同じ並び**にする。
    // 代役のほうが狭いと、本番で通る道を一度も通らないまま緑になる（引き継ぎ書の学び）
    EDITABLE_: () => ['ステータス', '担当メモ', '搬入予定時刻', '撤収予定時刻',
                      '当日ステータス', '主形態'],
    console,
  });
  box.globalThis = box;

  const src = read('Admin.gs');
  /*
   * 上限の値は**本物から読む**。ここに 60 と書き写すと、
   * 本番だけ変えたときに代役が古いまま緑になる（この案件が繰り返し踏んだ形）。
   */
  {
    const m = /var BULK_MAX = (\d+);/.exec(src);
    assert.ok(m, 'gas/Admin.gs に BULK_MAX がありません');
    box.BULK_MAX = Number(m[1]);
  }
  for (const marker of ['function recordHistory_', 'function applicantEditable_', 'function adminApplicantFields_',
                        'function adminApplicantUpdate_', 'function adminUpdate_',
                        'function bulkTooMany_',
                        'function adminBulkStatus_', 'function adminBulkLoadIn_']) {
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

/*
 * ■ 複数まとめてステータスを変える（けいた指示・2026-09-08）
 *
 *   出店者一覧で選んだ相手に、メール送信だけでなくステータス変更もできるように。
 *
 * ■ 一斉メールとは守りの重さを変える
 *   メール送信は**取り消せない**ので、一度きりの札・プレビュー必須・40件上限を
 *   置いた。ステータス変更は**変更履歴に前の値ごと残り、戻せる**。
 *   同じ重さの守りを掛けると、人は迂回路（シートを直接いじる）を探す。
 *
 * ■ 規則を写さない
 *   1件ずつの adminUpdate_ が持っている規則
 *   （変えてよい項目・値の妥当性・理由が要るステータス・変更履歴）を
 *   **そのまま通す**。ここに写しを作ると、片方だけ緩くなる。
 */
describe('まとめてステータスを変える', () => {
  const bulk = (A, payload) => plain(A.adminBulkStatus_(ME, payload));

  test('選んだ全員のステータスが変わる', () => {
    const A = load();
    const r = bulk(A, { ids: ['SB-0007'], status: '採択' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.done, ['SB-0007']);
    assert.ok(HISTORY.length >= 1, '変更履歴に残っていません');
  });

  test('知らないステータスは、1件も変えない', () => {
    const A = load();
    const r = bulk(A, { ids: ['SB-0007'], status: 'でたらめ' });
    assert.strictEqual(r.ok, false,
      '知らないステータスを、先に断っていません（1件ずつの結果で返しています）：'
      + JSON.stringify(r));
    assert.strictEqual(HISTORY.length, 0, '弾いたのに書いています');
  });

  /*
   * 1件ずつのときは「不採択・辞退・キャンセル・重複」に理由が要る。
   * まとめてのときだけ要らない、では筋が通らない
   * （むしろ、まとめて変えるほうが影響が大きい）。
   */
  test('理由が要るステータスは、まとめてでも理由が要る', () => {
    const A = load();
    const r = bulk(A, { ids: ['SB-0007'], status: '不採択' });
    assert.strictEqual(r.ok, false,
      '理由が要るステータスなのに、先に断っていません（1件ずつの結果で返しています）：'
      + JSON.stringify(r));
    assert.ok(/理由/.test(r.message || ''), r.message);
    assert.strictEqual(HISTORY.length, 0, '理由が無いのに書いています');
  });

  test('理由があれば、理由が要るステータスにも変えられる', () => {
    const A = load();
    const r = bulk(A, { ids: ['SB-0007'], status: '不採択',
                        reason: '出店形態が募集の対象外のため' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });

  test('相手を1件も選んでいなければ、何もしない', () => {
    const A = load();
    const r = bulk(A, { ids: [], status: '採択' });
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    assert.strictEqual(HISTORY.length, 0);
  });

  /*
   * **値の検査は、1件目に触る前に済ませる。**
   * 途中で気づく形だと、前半だけ変わって後半が変わらない状態が残り、
   * 何が起きたのか誰にも分からなくなる。
   */
  test('値が不正なときは、実在する相手が混ざっていても1件も変えない', () => {
    const A = load();
    const r = bulk(A, { ids: ['SB-0007', 'SB-9999'], status: 'でたらめ' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(HISTORY.length, 0, '1件でも書いています');
  });

  /*
   * 同じ相手が2回入っていると、2回書いて**変更履歴が二重に増える**。
   * 画面のチェック欄では起きにくいが、通信を細工すれば起きる
   * （守りはサーバー側だけ・引き継ぎ書 §4）。
   */
  test('同じ受付IDが2回入っていても、1回だけ変える', () => {
    const A = load();
    const r = bulk(A, { ids: ['SB-0007', 'SB-0007'], status: '採択' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.done, ['SB-0007'],
      '同じ相手を2回変えています：' + JSON.stringify(r.done));
    assert.strictEqual(HISTORY.length, 1,
      '変更履歴が二重に増えています：' + HISTORY.length);
  });

  test('見つからない相手は、変えた相手と分けて返す', () => {
    const A = load();
    const r = bulk(A, { ids: ['SB-0007', 'SB-9999'], status: '採択' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.done, ['SB-0007']);
    assert.deepStrictEqual((r.failed || []).map(x => x.id), ['SB-9999']);
  });
});

/**
 * まとめて搬入予定時刻を入れる（2026-09-09）。
 *
 * ■ なぜ要るか
 *   搬入は 9:30〜10:30 の**1時間**に最大50社。1社ずつ詳細を開いて打つと、
 *   50回くり返しても**全体の混み具合が一度も見えない**。
 *
 * ■ 規則を写さない／守りは軽く（まとめてステータスと同じ）
 *   搬入時刻は変更履歴に前の値ごと残り、**戻せる**。
 *
 * ■ ただし書式だけは非対称でよい
 *   1件ずつは自由入力（人が1つ打つだけ）。まとめては**間違いが50行に増幅される**。
 */
describe('まとめて搬入予定時刻を入れる', () => {
  const bulk = (A, payload) => plain(A.adminBulkLoadIn_(ME, payload));

  test('選んだ相手に時刻が入り、変更履歴に残る', () => {
    const A = load();
    const r = bulk(A, { assign: [{ id: 'SB-0007', at: '9:30' }] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.done, ['SB-0007']);
    /*
     * **変更履歴を先に見る。**
     * 書き込みを先に見ると、adminUpdate_ を通さず自前で書くように壊したときも
     * 「搬入予定時刻を書いていません」で落ちてしまい、
     * 「規則を写した」のか「列を間違えた」のか、壊し検査で見分けられない。
     */
    assert.ok(HISTORY.length >= 1, '変更履歴に残っていません');
    const w = WRITES.filter(x => x.header === '搬入予定時刻').pop();
    assert.ok(w, '搬入予定時刻を書いていません');
    assert.strictEqual(w.value, '9:30');
  });

  /*
   * **書式の検査は、1件目に触る前に済ませる。**
   * 途中で気づく形だと、前半だけ入って後半が入らない状態が残る。
   */
  test('書式が違うものが混ざっていたら、1件も入れない', () => {
    const A = load();
    const r = bulk(A, { assign: [{ id: 'SB-0007', at: '9:30' },
                                 { id: 'SB-0008', at: 'あさ' }] });
    assert.strictEqual(r.ok, false,
      '書式違いを先に断っていません：' + JSON.stringify(r));
    assert.strictEqual(HISTORY.length, 0, '弾いたのに書いています');
    assert.strictEqual(WRITES.filter(x => x.header === '搬入予定時刻').length, 0,
      '1件でも書いています');
  });

  test('ありえない時刻（25:00・9:75）も断る', () => {
    for (const bad of ['25:00', '9:75', '9:3', '930', ':30', '9:']) {
      const A = load();
      const r = bulk(A, { assign: [{ id: 'SB-0007', at: bad }] });
      assert.strictEqual(r.ok, false, '「' + bad + '」を通しています：' + JSON.stringify(r));
    }
  });

  /*
   * 空は「時刻を消す」。入れ間違えたときに戻す道が無いと、
   * 人はシートを直接いじりに行く（＝変更履歴に残らない）。
   */
  test('空を送ると、時刻を消せる', () => {
    // すでに入っている状態から始める。
    // 元から空だと adminUpdate_ は「変わらないので書かない」ので、検査にならない
    const A = load({ inAt: '9:30' });
    const r = bulk(A, { assign: [{ id: 'SB-0007', at: '' }] });
    assert.strictEqual(r.ok, true, '空（時刻を消す）を断っています：' + JSON.stringify(r));
    const w = WRITES.filter(x => x.header === '搬入予定時刻').pop();
    assert.ok(w, '搬入予定時刻を書いていません');
    assert.strictEqual(w.value, '');
  });

  /*
   * 窓（9:30〜10:30）の外は**止めない**。
   * 当日の事情で早く入れる社は現実にあり、止めると人は迂回路を探す。
   * 混雑と窓外は画面が警告する——**報せるが、止めない**。
   */
  test('搬入の窓の外でも、止めない', () => {
    const A = load();
    const r = bulk(A, { assign: [{ id: 'SB-0007', at: '7:00' }] });
    assert.strictEqual(r.ok, true,
      '窓の外を断っています。ここは止めない約束です：' + JSON.stringify(r));
  });

  test('相手を1件も選んでいなければ、何もしない', () => {
    const A = load();
    const r = bulk(A, { assign: [] });
    assert.strictEqual(r.ok, false, '相手が0件なのに通しています：' + JSON.stringify(r));
    assert.strictEqual(HISTORY.length, 0);
  });

  /*
   * 同じ相手が2回入っていると、2回書いて**変更履歴が二重に増える**。
   * 画面では起きにくいが、通信を細工すれば起きる（守りはサーバー側だけ）。
   */
  test('同じ受付IDが2回入っていても、1回だけ入れる', () => {
    const A = load();
    const r = bulk(A, { assign: [{ id: 'SB-0007', at: '9:30' },
                                 { id: 'SB-0007', at: '10:00' }] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.done, ['SB-0007'],
      '変更履歴が二重に増えています（同じ相手を2回入れています）：' + JSON.stringify(r.done));
    assert.strictEqual(HISTORY.length, 1,
      '変更履歴が二重に増えています：' + HISTORY.length);
  });

  test('見つからない相手は、入れた相手と分けて返す', () => {
    const A = load();
    const r = bulk(A, { assign: [{ id: 'SB-0007', at: '9:30' },
                                 { id: 'SB-9999', at: '9:40' }] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.done, ['SB-0007']);
    assert.deepStrictEqual((r.failed || []).map(x => x.id), ['SB-9999']);
  });
});
