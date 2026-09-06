/**
 * ① 制作スケジュール表：Excel の取り込み（`gas/SchedImport.gs`）を、
 * **実際に動かして**確かめる。
 *
 * 仕様は docs/internal/design_sched_import.md。
 *
 * ■ いちばん怖いのは「一時ファイルの消し忘れ」
 *   Drive が散らかるだけでなく、**台帳の中身がそのまま残る**。
 *   資料フォルダは全共有なので、残ったファイル次第では見えてしまう。
 *   だから成功しても失敗しても、**必ず**消えることを確かめる。
 *
 * ■ 代役は本物より優しくしない
 *   `UrlFetchApp` が失敗する道、`setTrashed` が例外を投げる道も試す。
 *   **Drive に触ったかどうか**も数えて、「触る前に断る」を確かめる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeSheet, makeUtilities, cutFunction } = require('./_gasbox');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/** 書き出しが作る並び（①の SCHED_HEADERS_ と同じ） */
const SHEET_HEADERS = [
  '種類', '日付', '終了日', '領域', '担当会社', '担当者', 'タスク名', '詳細',
  'ステータス', '備考', '完了日', '並び順', '起票者', '起票日', '更新者', '更新日時',
  'ID',
];

/**
 * gas/SchedImport.gs を、代役つきの箱で走らせる。
 *
 * @param {Object} opts
 *   xlsx        … 変換後の表の中身 [見出し, 行, 行…]
 *   uploadFails … Drive への取り込みが失敗する
 *   trashFails  … 一時ファイルの削除が例外を投げる
 */
function makeBox(opts) {
  opts = opts || {};
  const admin = read('gas/Admin.gs');
  // SCHED_HEADERS_ と schedDate_ は gas/Sched.gs にある。
  // 本番のGASは全ファイルが同じスコープなので、箱でも同じにそろえる
  const sched = read('gas/Sched.gs');
  const src = read('gas/SchedImport.gs');

  /** Drive に触った回数。「触る前に断る」を確かめるために数える */
  const touched = { upload: 0, trash: 0, open: 0 };
  const temps = [];

  const grid = opts.xlsx || [SHEET_HEADERS, []];
  const converted = makeSheet(grid[0] || [], grid.slice(1));

  /** 台帳（制作スケジュール）と関係者。照合と検証がここを見る */
  const sheets = {
    '制作スケジュール': makeSheet(SHEET_HEADERS, opts.ledger || []),
    '関係者': makeSheet(
      ['氏名', '所属', '部署', 'メール', 'フォーム表示', '管理ページ利用', '役割', '通知'],
      opts.people || [
        ['小谷', 'FC大阪', '事業部', 'k@example.com', 'する', 'する', '担当', 'ON'],
        ['山本', 'UPDATER', '', 'y@example.com', 'しない', 'する', '担当', 'OFF'],
      ]),
    '設定': makeSheet(['項目', '値', '説明'], []),
  };
  const history = [];

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Boolean, Date,
    console: { error() {}, log() {} },
    Utilities: makeUtilities(),
    ScriptApp: { getOAuthToken: () => 'token-abc' },
    UrlFetchApp: {
      fetch: () => {
        touched.upload++;
        if (opts.uploadFails) {
          return { getResponseCode: () => 500, getContentText: () => 'だめでした' };
        }
        const id = 'tmp-' + touched.upload;
        temps.push({ id, trashed: false });
        return { getResponseCode: () => 200,
                 getContentText: () => JSON.stringify({ id: id }) };
      },
    },
    SpreadsheetApp: {
      openById: () => {
        touched.open++;
        return { getSheets: () => [converted], getActiveSheet: () => converted };
      },
      flush() {},
    },
    DriveApp: {
      getFileById: id => ({
        setTrashed: v => {
          touched.trash++;
          if (opts.trashFails) throw new Error('消せませんでした');
          const hit = temps.filter(t => t.id === id)[0];
          if (hit) hit.trashed = !!v;
        },
      }),
    },
    logError_: () => {},
    SHEET: { SCHED: '制作スケジュール', PEOPLE: '関係者', CONFIG: '設定' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    LOCK_WAIT_MS: 30000,
    sheet_: name => {
      if (!sheets[name]) sheets[name] = makeSheet([], []);
      return sheets[name];
    },
    appendHistory: (operator, receiptId, item, before, after, reason) => {
      history.push({ operator, receiptId, item, before, after, reason });
    },
    configNumber: () => null,
  });

  const setup = read('gas/Setup.gs');
  const stamp = read('gas/Stamp.gs');
  vm.runInContext([
    cutFunction(admin, 'asText_'),
    cutFunction(admin, 'safeCellText_'),
    cutFunction(admin, 'normalizeDue_'),
    cutFunction(setup, 'findConfigRow_'),
  ].join(String.fromCharCode(10)), box);
  // **本番の①をそのまま読む。**検証（validateSchedRow_）に写しを作らない
  vm.runInContext(stamp, box);
  vm.runInContext(sched, box);
  vm.runInContext(src, box);
  return { box, temps, touched, converted, sheets, history };
}

/** 台帳の行を、列名で引ける形にする */
function ledgerRow(b, n) {
  const line = b.sheets['制作スケジュール'].grid[n - 1] || [];
  const o = {};
  SHEET_HEADERS.forEach((h, i) => { o[h] = line[i]; });
  return o;
}

function ledgerRows(b) {
  return b.sheets['制作スケジュール'].grid.slice(1)
    .filter(r => String(r[6] || '').trim());
}

/** Excel の1行ぶん（見出し名で書く） */
function xrow(o) {
  const line = SHEET_HEADERS.map(h => (o[h] === undefined ? '' : o[h]));
  return line;
}

/** 下見を作る */
function plan(b, rows) {
  b.box.__rows = rows;
  return JSON.parse(JSON.stringify(
    vm.runInContext('schedImportPlan_(__rows, schedPeople_())', b.box)));
}

/** 取り込む */
function apply(b, rows, person) {
  b.box.__auth = { person: person || '小谷' };
  b.box.__payload = { rows: rows };
  return JSON.parse(JSON.stringify(
    vm.runInContext('adminSchedImportApply_(__auth, __payload)', b.box) || null));
}

/** 台帳にすでにある1行（ID つき） */
const LEDGER_TASK = ['タスク', '2026-09-20', '', '制作', 'FC大阪', '小谷', '看板の入稿', '',
                     '未着手', '', '', 1, '小谷', '2026-09-01', '', '', 'aaaa1111'];

function readFile(b, base64, fileName) {
  b.box.__b64 = base64;
  b.box.__name = fileName === undefined ? 'kougyou.xlsx' : fileName;
  return JSON.parse(JSON.stringify(
    vm.runInContext('schedImportRead_(__b64, __name)', b.box) || null));
}

/** 適当な中身の base64（長さだけが意味を持つ） */
const SOME = Buffer.from('x'.repeat(400)).toString('base64');

describe('取り込み：xlsx を読む（§3-1・§3-4）', () => {

  test('読んだ行が、見出しつきで返る', () => {
    const b = makeBox({ xlsx: [SHEET_HEADERS,
      ['タスク', '2026-09-20', '', '制作', 'FC大阪', '', '看板の入稿', '', '未着手', '', '', '', '', '', '', '', 'aaaa1111'],
    ] });
    const r = readFile(b, SOME);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0]['タスク名'], '看板の入稿');
    assert.strictEqual(r.rows[0]['ID'], 'aaaa1111');
    // Excel の何行目かを持つ（下見で「3行目が…」と言うため）
    assert.strictEqual(r.rows[0].__row, 2);
  });

  test('列を入れ替えても読める（見出しで見分ける）', () => {
    /*
     * **並び順で見分けてはいけない。**人は Excel で列を入れ替えるし、
     * 余分な列を足す。「左から3列目が終了日」と決め打ちすると、
     * **黙って別の列を読む**ことになる。
     */
    const b = makeBox({ xlsx: [
      ['タスク名', 'ID', '領域', '日付', '種類'],
      ['看板の入稿', 'aaaa1111', '制作', '2026-09-20', 'タスク'],
    ] });
    const r = readFile(b, SOME);
    assert.strictEqual(r.rows[0]['タスク名'], '看板の入稿', '列を入れ替えると読めません');
    assert.strictEqual(r.rows[0]['領域'], '制作');
    assert.strictEqual(r.rows[0]['日付'], '2026-09-20');
  });

  test('知らない列は無視する（人がメモ用の列を足していてもよい）', () => {
    const b = makeBox({ xlsx: [
      ['タスク名', 'わたしのメモ', '領域'],
      ['看板の入稿', 'あとで確認', '制作'],
    ] });
    const r = readFile(b, SOME);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.rows[0]['タスク名'], '看板の入稿');
  });

  test('タスク名の列が無ければ、断る（黙って0件にしない）', () => {
    // 黙って0件を返すと、次の操作で何が起きるか分からなくなる（②で同じ判断をした）
    const b = makeBox({ xlsx: [['領域', '日付'], ['制作', '2026-09-20']] });
    const r = readFile(b, SOME);
    assert.strictEqual(r.ok, false, '見出しが無いのに読めています');
    assert.match(r.message, /タスク名/, r.message);
  });

  test('空の行は飛ばす（Excelの下のほうの空行）', () => {
    const b = makeBox({ xlsx: [SHEET_HEADERS,
      ['タスク', '2026-09-20', '', '制作', '', '', '看板の入稿', '', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ] });
    assert.strictEqual(readFile(b, SOME).rows.length, 1);
  });
});

describe('取り込み：一時ファイルの片づけ（§6-1 の 8・9）', () => {

  test('8. 成功しても、一時ファイルは必ず消える', () => {
    const b = makeBox({});
    readFile(b, SOME);
    assert.strictEqual(b.temps.length, 1, '一時ファイルが作られていません');
    assert.strictEqual(b.temps[0].trashed, true,
      '一時ファイルが残っています（Driveに台帳の中身が残ります）');
  });

  test('8b. 読み取りに失敗しても、一時ファイルは消える', () => {
    const b = makeBox({ xlsx: [['領域'], ['制作']] });   // タスク名が無くて断る道
    const r = readFile(b, SOME);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(b.temps[0].trashed, true,
      '断ったときに一時ファイルが残っています');
  });

  test('9. 消すのに失敗しても、読み取りは返す（そのうえで知らせる）', () => {
    /*
     * 消せなかったことを理由に取り込みを止めると、「使えるのに使えない」状態になる。
     * 消し漏れは**人に伝える**。黙って残すのがいちばん危ない。
     */
    const b = makeBox({ trashFails: true });
    const r = readFile(b, SOME);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.leftover, true, '消し漏れを伝えていません');
  });

  test('Driveへの取り込みに失敗したら、理由を添えて断る', () => {
    const b = makeBox({ uploadFails: true });
    const r = readFile(b, SOME);
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /読み取れませんでした|失敗/, r.message);
  });
});

describe('取り込み：Driveに触る前に断るもの（§3-4）', () => {

  test('2MBを超えたら断る。**Driveには触らない**', () => {
    const big = 'A'.repeat(3 * 1024 * 1024);   // base64 で3MB ≒ 元は2.25MB
    const b = makeBox({});
    const r = readFile(b, big);
    assert.strictEqual(r.ok, false, '大きすぎるファイルが通っています');
    assert.match(r.message, /2MB|大きすぎ/, r.message);
    assert.strictEqual(b.touched.upload, 0,
      'Driveに触ってから断っています（触る前に止めてください）');
  });

  test('xlsx でなければ断る。**Driveには触らない**', () => {
    // 画面の accept だけに頼らない。守りはサーバー側（§1-4）
    ['kougyou.csv', 'kougyou.xls', 'kougyou.numbers', 'kougyou', 'kougyou.xlsx.exe']
      .forEach(name => {
        const b = makeBox({});
        const r = readFile(b, SOME, name);
        assert.strictEqual(r.ok, false, '「' + name + '」が通っています');
        assert.match(r.message, /Excel|xlsx/, name + ': ' + r.message);
        assert.strictEqual(b.touched.upload, 0,
          '「' + name + '」で Drive に触っています');
      });
  });

  test('xlsx なら通る（検査そのものの前提を確かめる）', () => {
    // 「通らない」だけを見ると、**何をしても通らない実装**でも合格してしまう
    const b = makeBox({});
    assert.strictEqual(readFile(b, SOME, 'kougyou.xlsx').ok, true);
    assert.strictEqual(readFile(makeBox({}), SOME, 'KOUGYOU.XLSX').ok, true,
      '大文字の拡張子が通りません');
  });

  test('中身が空なら断る', () => {
    const b = makeBox({});
    const r = readFile(b, '');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(b.touched.upload, 0);
  });
});


describe('取り込み：照合（§3-3）', () => {

  test('1. IDが空の行は、新規として追加される', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const r = apply(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                          タスク名: '横断幕の入稿', ID: '' }]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(ledgerRows(b).length, 2, '追加されていません');
    // サーバーが8桁のIDを振る
    assert.match(String(ledgerRow(b, 3)['ID']), /^[0-9a-zA-Z]{8}$/);
  });

  test('2. IDが一致する行は、更新される（増えない）', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const r = apply(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-09-25', 領域: '制作',
                          タスク名: '看板の入稿（前倒し）', ID: 'aaaa1111' }]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(ledgerRows(b).length, 1, '行が増えています');
    assert.strictEqual(ledgerRow(b, 2)['タスク名'], '看板の入稿（前倒し）');
    // 起票者と起票日は引き継ぐ（取り込みで塗り替えない）
    assert.strictEqual(ledgerRow(b, 2)['起票者'], '小谷');
  });

  test('3. IDがあるのに台帳に無い行は、断る（黙って復活させない）', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const p = plan(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-09-20', 領域: '制作',
                         タスク名: '消された行', ID: 'zzzz9999' }]);
    assert.strictEqual(p.items[0].action, 'bad',
      '台帳に無いIDを、黙って追加しようとしています');
    assert.match(JSON.stringify(p.items[0].problems), /削除/, JSON.stringify(p.items[0]));
  });

  test('4. 同じIDが2行あれば、断る（Excelで行をコピーすると必ず起きる）', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const p = plan(b, [
      { __row: 2, 種類: 'タスク', 日付: '2026-09-20', 領域: '制作', タスク名: 'A', ID: 'aaaa1111' },
      { __row: 3, 種類: 'タスク', 日付: '2026-09-21', 領域: '制作', タスク名: 'B', ID: 'aaaa1111' },
    ]);
    assert.strictEqual(p.items[1].action, 'bad', '同じIDが2行あるのに通っています');
    assert.match(JSON.stringify(p.items[1].problems), /2つ/, JSON.stringify(p.items[1]));
  });

  test('6. Excel に無い行は、消さない', () => {
    // ①は全員が触れる。Excelを編集しているあいだに他の人が足した行を消さない
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const r = apply(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                          タスク名: '横断幕の入稿', ID: '' }]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(ledgerRows(b).length, 2,
      'Excelに無い行が消えました（消さない決まりです）');
    assert.strictEqual(ledgerRow(b, 2)['タスク名'], '看板の入稿');
  });

  test('6b. Excel に無い行の件数を、下見で知らせる', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const p = plan(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                         タスク名: '横断幕の入稿', ID: '' }]);
    assert.strictEqual(p.missing.length, 1, 'Excelに無い行を数えていません');
    assert.strictEqual(p.missing[0].title, '看板の入稿');
  });
});

describe('取り込み：検証と、変わらない行（§3-5・§3-6）', () => {

  test('10. 検証は validateSchedRow_ を通っている（画面・シートと同じ規則）', () => {
    // 関係者リストにいない担当者は、①の規則では通らない
    const b = makeBox({ ledger: [] });
    const p = plan(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-09-20', 領域: '制作',
                         タスク名: 'あ', 担当者: '田中', ID: '' }]);
    assert.strictEqual(p.items[0].action, 'bad',
      '関係者リストにいない担当者が通っています');
    assert.match(JSON.stringify(p.items[0].problems), /田中/, JSON.stringify(p.items[0]));
  });

  test('5. 1行でも通らなければ、何も書かない', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const before = JSON.stringify(b.sheets['制作スケジュール'].grid);
    const r = apply(b, [
      { __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作', タスク名: 'よい行', ID: '' },
      { __row: 3, 種類: 'タスク', 日付: '2026-10-02', 領域: '制作', タスク名: '', ID: '' },
    ]);
    assert.strictEqual(r.ok, false, '通らない行があるのに保存されました');
    assert.strictEqual(JSON.stringify(b.sheets['制作スケジュール'].grid), before,
      '通らない行があるのに台帳が書き換わりました');
  });

  test('7. 200行を超えたら断る', () => {
    const b = makeBox({ ledger: [] });
    const many = [];
    for (let i = 0; i < 201; i++) {
      many.push({ __row: i + 2, 種類: 'タスク', 日付: '2026-09-20', 領域: '制作',
                  タスク名: '予定' + i, ID: '' });
    }
    const r = apply(b, many);
    assert.strictEqual(r.ok, false, '201行が通っています');
    assert.match(r.message, /200/, r.message);
  });

  test('中身が1文字も違わない行は「変わらない」に数える', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const p = plan(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-09-20', 終了日: '', 領域: '制作',
                         担当会社: 'FC大阪', 担当者: '小谷', タスク名: '看板の入稿', 詳細: '',
                         ステータス: '未着手', 備考: '', ID: 'aaaa1111' }]);
    assert.strictEqual(p.items[0].action, 'same',
      '中身が同じなのに「更新」に数えています: ' + JSON.stringify(p.items[0]));
    assert.strictEqual(p.counts.same, 1);
  });

  test('更新者・更新日時・並び順が違うだけの行も「変わらない」', () => {
    // 比べると全部が「更新」になる（§3-6）
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const p = plan(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-09-20', 終了日: '', 領域: '制作',
                         担当会社: 'FC大阪', 担当者: '小谷', タスク名: '看板の入稿', 詳細: '',
                         ステータス: '未着手', 備考: '', 並び順: 99, 更新者: '別人',
                         更新日時: '2020-01-01 00:00', ID: 'aaaa1111' }]);
    assert.strictEqual(p.items[0].action, 'same',
      '更新者・更新日時・並び順の違いを「更新」に数えています');
  });

  test('件数の内訳が返る（下見に出すため）', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const p = plan(b, [
      { __row: 2, 種類: 'タスク', 日付: '2026-09-25', 領域: '制作', 担当会社: 'FC大阪',
        担当者: '小谷', タスク名: '看板の入稿', ステータス: '未着手', ID: 'aaaa1111' },
      { __row: 3, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作', タスク名: '新しい行', ID: '' },
      { __row: 4, 種類: 'タスク', 日付: '2026-10-02', 領域: '制作', タスク名: '', ID: '' },
    ]);
    assert.deepStrictEqual(
      { add: p.counts.add, update: p.counts.update, bad: p.counts.bad },
      { add: 1, update: 1, bad: 1 }, JSON.stringify(p.counts));
  });
});

describe('取り込み：記録（§3-7・§5-2）', () => {

  test('11. 取り込みは、変更履歴に1行だけ足す', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    apply(b, [
      { __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作', タスク名: 'A', ID: '' },
      { __row: 3, 種類: 'タスク', 日付: '2026-10-02', 領域: '制作', タスク名: 'B', ID: '' },
    ]);
    assert.strictEqual(b.history.length, 1, JSON.stringify(b.history));
    assert.strictEqual(b.history[0].item, '取り込み');
    assert.match(b.history[0].after, /追加2件/, b.history[0].after);
  });

  test('13. 取り込むと「最終取り込み」が記録される', () => {
    const b = makeBox({ ledger: [] });
    apply(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                タスク名: 'A', ID: '' }], '山本');
    const got = JSON.parse(JSON.stringify(
      vm.runInContext("lastActionGet_(SCHED_IMPORT_KEY_)", b.box)));
    assert.strictEqual(got.person, '山本', '最終取り込みが記録されていません');
    assert.ok(got.at > 0);
  });

  test('13b. 断ったときは、記録しない', () => {
    const b = makeBox({ ledger: [] });
    apply(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                タスク名: '', ID: '' }], '山本');
    const got = JSON.parse(JSON.stringify(
      vm.runInContext("lastActionGet_(SCHED_IMPORT_KEY_)", b.box)));
    assert.strictEqual(got.at, 0, '断ったのに取り込みが記録されました');
  });

  test('取り込みの実行時に、サーバーが全部を検証し直す', () => {
    // 下見で通ったことを根拠にしない（画面の変数は守りにならない）
    const b = makeBox({ ledger: [] });
    const r = apply(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: 'ステージ裏',
                          タスク名: 'A', ID: '' }]);
    assert.strictEqual(r.ok, false, '画面が送ってきた行を、検証せずに入れています');
    // 理由は**行ごと**に返る（画面がそのセルに色を付けるため）。
    // 上の message は「何行に問題があるか」だけを言う
    assert.match(JSON.stringify(r.items[0].problems), /領域/, JSON.stringify(r.items));
  });
});
