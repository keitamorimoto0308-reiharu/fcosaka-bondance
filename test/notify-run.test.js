/**
 * 採択通知と確定情報フォームを、**実際に動かして**確かめる。
 *
 * ■ なぜ別ファイルにするか
 *   test/notify.test.js は「コードの形」を見る検査（送信と記録の順序など）。
 *   形の検査は順序の取り違えには効くが、**入力に対する振る舞い**は分からない。
 *   実際、形の検査33件を全通ししたまま
 *   「配列で maxLength を回避できる」「受付IDが重複すると別の行に印を付ける」
 *   が残っていた（検証役が実行して発見）。
 *
 * ■ どう動かすか
 *   GmailApp・SpreadsheetApp・CacheService は Node に無いので、
 *   最小限の代役を箱の中に置いて、GASの関数をそのまま走らせる。
 *   代役は「本物と同じ形の失敗をする」ことだけを守る（送信を失敗させる等）。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

function cutFunction(code, name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' が見つかりません');
  const end = code.indexOf('\n}\n', start) + 3;
  assert.ok(end > start, name + ' の終わりが見つかりません');
  return code.slice(start, end);
}

const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

/** 台帳の代役。書き込みを記録して、あとから中身を見られるようにする */
function makeSheet(headers, rows) {
  const grid = [headers.slice()].concat(rows.map(r => r.slice()));
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => headers.length,
    getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
    getRange(row, col, nRows, nCols) {
      return {
        getValues: () => {
          const out = [];
          for (let r = 0; r < (nRows || 1); r++) {
            const line = [];
            for (let c = 0; c < (nCols || 1); c++) {
              line.push((grid[row - 1 + r] || [])[col - 1 + c]);
            }
            out.push(line);
          }
          return out;
        },
        setValue: v => { while (grid.length < row) grid.push([]); grid[row - 1][col - 1] = v; },
        setValues: vals => {
          vals.forEach((line, r) => line.forEach((v, c) => {
            while (grid.length < row + r) grid.push([]);
            grid[row - 1 + r][col - 1 + c] = v;
          }));
        },
      };
    },
    appendRow: line => grid.push(line.slice()),
  };
}

/**
 * 採択通知の一括送信を、代役つきで走らせる。
 * @returns {{result:Object, sentTo:string[], grid:Array}}
 */
function runNotify(rows, payload, opts) {
  opts = opts || {};
  const SCHEMA = require('../src/schema.js');
  const headers = SCHEMA.ledgerHeaders();
  const sheet = makeSheet(headers, rows.map(r => headers.map(h => (h in r ? r[h] : ''))));

  const sentTo = [];
  const history = [];
  const alerts = [];

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Date,
    console: { error() {} },
    // ── GAS の代役
    Utilities: {
      getUuid: () => '0123456789abcdef0123456789abcdef',
      formatDate: () => '2026-10-01 12:00',
    },
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { getRemainingDailyQuota: () => (opts.quota == null ? 1000 : opts.quota) },
    GmailApp: {
      sendEmail(to) {
        if (opts.failFor && opts.failFor.indexOf(to) >= 0) throw new Error('送信失敗');
        sentTo.push(to);
      },
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    // ── プロジェクト側の代役
    LOCK_WAIT_MS: 1000,
    EVENT_NAME: 'テスト祭',
    readLedger_: () => ({ headers, rows: sheet.getDataRange().getValues().slice(1), sheet }),
    configText: (k, d) => (opts.config && k in opts.config ? opts.config[k] : d),
    appendHistory: (...a) => history.push(a),
    alertOperator_: (m, id) => alerts.push([m, id]),
    logError_() {},
    mailOptions_: () => ({}),
    signature_: () => '--',
    eventFactsBlock_: () => '（開催概要）',
    diagnoseMail: () => ({ aliasRegistered: true, from: 'x@y.z', remainingQuota: 1000 }),
    formatJa: () => '', getDeadline: () => new Date(),
    safeEquals_: (a, b) => String(a) === String(b),
    sha256_: s => 'h' + String(s).length,
    asText_: v => (v == null ? '' : String(v)),
    cell_: (h, r, n) => { const i = h.indexOf(n); return i < 0 ? '' : r[i]; },
    liveRows_: (h, rs) => { const i = h.indexOf('受付ID');
                            return rs.filter(r => String(r[i] || '').trim() !== ''); },
    COL: { id: '受付ID', company: '企業名', shopName: '出店名', person: '担当者氏名',
           email: '担当者メール', staff: 'FC大阪担当社員', status: 'ステータス',
           notifiedAt: '採択通知送信日時', raw: '生データ(JSON)' },
  });

  // 文面は gas/MailTemplate.gs が組み立てる（2026-09-03 から）。
  // ここを読まないと buildAcceptMail_ が動かない。
  // シートは空にしておく ＝ **既定の文面**が使われる（本番の初期状態と同じ）
  box.SHEET = { MAILTPL: 'メール文面' };
  box.sheet_ = () => makeSheet(['種類', '件名', '本文', '更新日時', '更新者'], []);
  // 数の読み取りは gas/Num.gs にまとめてある（2026-09-04）。
  // これを読まないと numAmount_ / numCount_ が未定義で落ちる
  vm.runInContext(read('gas/Num.gs'), box);
  const TPL = read('gas/MailTemplate.gs');
  vm.runInContext(TPL.replace(/^\/\*\*[\s\S]*?\*\/\n/, ''), box);

  const NOTIFY = read('gas/Notify.gs');
  vm.runInContext(NOTIFY.replace(/^\/\*\*[\s\S]*?\*\/\n/, ''), box);

  const result = JSON.parse(JSON.stringify(
    vm.runInContext('adminNotifySend_', box)({ person: '検査' }, payload)));
  return { result, sentTo, grid: sheet.grid, headers, history, alerts };
}

/** 台帳の1行を作る簡便関数 */
function row(id, over) {
  return Object.assign({
    '受付ID': id, '企業名': id + '社', '出店名': '', '担当者氏名': '担当',
    '担当者メール': id.toLowerCase() + '@example.com',
    'FC大阪担当社員': '佐藤 花子', 'ステータス': '採択',
    '採択通知送信日時': '', '素材トークン': TOKEN_A, '生データ(JSON)': '{}',
  }, over || {});
}

const BASE_CONFIG = { '確定情報フォームURL': 'https://x.test/confirm.html' };

describe('採択通知を実際に走らせる', () => {

  test('採択かつ未送信だけに送り、送信日時が入る', () => {
    const r = runNotify(
      [row('SB-0001'), row('SB-0002', { 'ステータス': '審査中' }),
       row('SB-0003', { '採択通知送信日時': '2026-09-30 10:00' })],
      { confirm: true, ids: ['SB-0001'] }, { config: BASE_CONFIG });
    assert.strictEqual(r.result.ok, true, JSON.stringify(r.result));
    assert.deepStrictEqual(r.sentTo, ['sb-0001@example.com']);
    const c = r.headers.indexOf('採択通知送信日時');
    assert.strictEqual(r.grid[1][c], '2026-10-01 12:00', '送った行に日時が入っていません');
    assert.strictEqual(r.grid[2][c], '', '送っていない行に日時が入っています');
  });

  test('1社抜けて1社増えても、件数が同じなら送らない（検証役の再現）', () => {
    // プレビューでは SB-0001/0002/0003 を見せた。
    // その後 SB-0001 が辞退し、SB-0004 が採択になった。件数は3のまま。
    const r = runNotify(
      [row('SB-0001', { 'ステータス': '辞退' }), row('SB-0002'), row('SB-0003'),
       row('SB-0004', { '企業名': 'まだ見せていない会社' })],
      { confirm: true, ids: ['SB-0001', 'SB-0002', 'SB-0003'] }, { config: BASE_CONFIG });
    assert.strictEqual(r.result.ok, false);
    assert.strictEqual(r.result.error, 'changed');
    assert.deepStrictEqual(r.sentTo, [], '画面で見ていない会社に送っています');
    assert.ok(/SB-0004/.test(r.result.message), '増えた相手を伝えていません');
  });

  test('確認が無ければ1通も送らない', () => {
    const r = runNotify([row('SB-0001')], { ids: ['SB-0001'] }, { config: BASE_CONFIG });
    assert.strictEqual(r.result.error, 'not_confirmed');
    assert.deepStrictEqual(r.sentTo, []);
  });

  test('確定情報フォームURLが空なら1通も送らない', () => {
    const r = runNotify([row('SB-0001')], { confirm: true, ids: ['SB-0001'] },
      { config: { '確定情報フォームURL': '' } });
    assert.strictEqual(r.result.error, 'no_url');
    assert.deepStrictEqual(r.sentTo, []);
  });

  test('送信可能数が足りなければ1通も送らない', () => {
    const r = runNotify([row('SB-0001'), row('SB-0002')],
      { confirm: true, ids: ['SB-0001', 'SB-0002'] }, { config: BASE_CONFIG, quota: 1 });
    assert.strictEqual(r.result.error, 'quota');
    assert.deepStrictEqual(r.sentTo, []);
  });

  test('送信に失敗した行は「未送信」のまま残る', () => {
    const r = runNotify([row('SB-0001'), row('SB-0002')],
      { confirm: true, ids: ['SB-0001', 'SB-0002'] },
      { config: BASE_CONFIG, failFor: ['sb-0002@example.com'] });
    assert.strictEqual(r.result.ok, true);
    assert.strictEqual(r.result.failed.length, 1);
    const c = r.headers.indexOf('採択通知送信日時');
    assert.strictEqual(r.grid[1][c], '2026-10-01 12:00');
    assert.strictEqual(r.grid[2][c], '',
      '送信に失敗した行が「送信済み」になっています（誰も気づけません）');
    assert.ok(r.alerts.length, '失敗を運用者に知らせていません');
  });

  test('受付IDが重複していたら、その行には書かない（検証役の再現）', () => {
    // 手でコピーした行があると、先頭一致では送った行と印を付ける行がずれ、
    // 同じ会社に何度でも届き続ける
    const r = runNotify(
      [row('SB-0001', { '企業名': '古い行', 'ステータス': '不採択' }),
       row('SB-0001', { '企業名': '新しい行' })],
      { confirm: true, ids: ['SB-0001'] }, { config: BASE_CONFIG });
    assert.strictEqual(r.result.ok, true);
    assert.deepStrictEqual(r.sentTo, [], '重複した受付IDに送っています');
    assert.strictEqual(r.result.failed.length, 1, '失敗として報告していません');
  });

  test('宛先の形が壊れている行は対象から外れる', () => {
    const r = runNotify(
      [row('SB-0001', { '担当者メール': 'not-an-email' }), row('SB-0002')],
      { confirm: true, ids: ['SB-0002'] }, { config: BASE_CONFIG });
    assert.strictEqual(r.result.ok, true, JSON.stringify(r.result));
    assert.deepStrictEqual(r.sentTo, ['sb-0002@example.com']);
  });

  test('本文に、紙面から外した行と専用リンクが入る', () => {
    const r = runNotify([row('SB-0001')], { confirm: true, ids: ['SB-0001'] },
      { config: BASE_CONFIG });
    assert.strictEqual(r.result.ok, true);
    // 送った本文を組み直して中身を確かめる
    const box = vm.createContext({ Array, Object, String, Number, JSON,
      // スタブが空文字を返すと、それ自体が空行になって本文の検査が狂う。
      // 本番と同じく「中身のある塊」を返させる。
      EVENT_NAME: 'テスト祭',
      eventFactsBlock_: () => '開催日：2026年10月24日（土）',
      signature_: () => '実行委員会',
      confirmDeadlineText_: () => '5営業日以内',
      RegExp, console: { error() {} },
      asText_: v => (v == null ? '' : String(v)),
      logError_() {},
      configText: (k, d) => d || '',
      // 文面のシートは空 ＝ 既定の文面（本番の初期状態と同じ）
      SHEET: { MAILTPL: 'メール文面' },
      sheet_: () => makeSheet(['種類', '件名', '本文', '更新日時', '更新者'], []) });
    // 本文は gas/MailTemplate.gs が組み立てる（2026-09-03 から）
    vm.runInContext(read('gas/Num.gs'), box);
    vm.runInContext(read('gas/MailTemplate.gs'), box);
    vm.runInContext(cutFunction(read('gas/Notify.gs'), 'buildAcceptMail_'), box);
    const mail = vm.runInContext('buildAcceptMail_', box)(
      { id: 'SB-0001', company: 'A社', person: '担当', shopName: '' },
      { confirm: 'https://x.test/c.html?id=SB-0001&t=' + TOKEN_A, upload: '' });
    // 一覧を直書きしない。content.js の afterAcceptRows をそのまま読む
    const C = require('../src/content.js');
    const rows = Object.values(C.PDF.afterAcceptRows || {}).flat();
    assert.ok(rows.length >= 3, '紙面から外した行を拾えていません：' + rows.length);
    rows.forEach(k => {
      assert.ok(mail.body.includes(k), '本文に「' + k + '」がありません');
    });
    assert.ok(mail.body.includes('https://x.test/c.html?id=SB-0001'), '専用リンクがありません');
    assert.ok(mail.body.includes('5営業日以内'), '提出期限がありません');
    assert.ok(!/\n\n\n/.test(mail.body), '空行が3つ以上続いています（出店名が無い場合の穴）');
  });
});

// ───────────────────────────── 検証の型（応募フォームにも効く）

describe('入力の型を、実際に送って確かめる', () => {
  const box = vm.createContext({ Array, Object, String, Number, JSON, RegExp, Math, isFinite,
    getStaffOptions: () => [], getRentalQtyItems: () => [] });
  vm.runInContext(read('gas/Num.gs'), box);   // 数の読み取り（2026-09-04 から）
  vm.runInContext(read('gas/Schema.gs'), box);
  const api = read('gas/Api.gs');
  ['validateFieldList_', 'validate_'].forEach(n => vm.runInContext(cutFunction(api, n), box));
  const vfl = vm.runInContext('validateFieldList_', box);
  const confirmFields = vm.runInContext('confirmFields', box);

  const OK = { siteManagerName: '田中', siteManagerPhone: '090-1111-2222',
    vehicleCount: 1, vehicleType: '軽自動車・軽トラック', vehicleHeight: '2.1m以下',
    parkingRequest: '希望する', loadInSlot1: '9:30〜9:45', staffCount: 2,
    // 数を集める項目（2026-09-03 追加）。必須なので、通る例には必ず入れる
    passCount: 2, parkingPassCount: 1, ticketCount: 0,
    rainPolicy: '雨天でも出店する', boothTypes: [] };
  const run = over => JSON.parse(JSON.stringify(
    vfl(confirmFields(), Object.assign({}, OK, over))));

  test('正しい入力は通る', () => {
    assert.deepStrictEqual(run({}), []);
  });

  test('配列で maxLength を回避できない（検証役の再現）', () => {
    const e = run({ siteManagerName: ['あ'.repeat(400)] });
    assert.ok(e.length, '配列で上限を素通りしています');
  });

  test('オブジェクトを送っても "[object Object]" が保存されない', () => {
    assert.ok(run({ siteManagerName: {} }).length, 'オブジェクトが通っています');
  });

  test('toString を細工されても例外にならない', () => {
    let e;
    assert.doesNotThrow(() => { e = run({ siteManagerName: { toString: 1 } }); });
    assert.ok(e.length, '細工したオブジェクトが通っています');
  });

  test('1行の欄に改行は入れられない（メールの件名が切れる）', () => {
    assert.ok(run({ siteManagerName: '田中\n悪意' }).length, '改行が通っています');
  });

  test('長文の欄では改行を許す', () => {
    assert.deepStrictEqual(run({ notes: '1行目\n2行目' }), []);
  });

  test('素の文字数超過は、これまでどおり弾く', () => {
    const e = run({ siteManagerName: 'あ'.repeat(60) });
    assert.ok(e.some(x => /50文字/.test(x.message)), '上限の検査が効いていません');
  });

  test('チェックボックスに文字列以外を混ぜられない', () => {
    assert.ok(run({ boothTypes: ['飲食'], fireUse: ['ガス', { x: 1 }] }).length,
      '選択肢に細工した値が通っています');
  });
});
