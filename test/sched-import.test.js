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
  // 人が打った数の読み取りは gas/Num.gs にまとめてある。**本物を読む**
  // （代役を書くと、本物より優しくなって「本番だけ弾かれる」が起きる）
  vm.runInContext(read('gas/Num.gs'), box);
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
      // ID列は必ず要る（無いと全行が「追加」になり、台帳が二重になる）
      ['タスク名', 'わたしのメモ', '領域', 'ID'],
      ['看板の入稿', 'あとで確認', '制作', ''],
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

describe('取り込み：直したあとの下見を作り直す（画面から）', () => {

  /** 画面から：ファイルではなく、いま持っている行を送る */
  function replan(b, rows, person) {
    b.box.__auth = { person: person || '小谷' };
    b.box.__payload = { rows: rows };
    return JSON.parse(JSON.stringify(
      vm.runInContext('adminSchedImportRead_(__auth, __payload)', b.box) || null));
  }

  test('行を送ると、ファイルを読まずに下見を作り直す', () => {
    /*
     * 画面で赤い行を直したあと、**同じ規則で見直す**必要がある。
     * 画面側で判定を写すと、サーバーとズレる（この案件が繰り返し避けてきた形）。
     */
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const r = replan(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                           タスク名: '横断幕の入稿', ID: '' }]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.items[0].action, 'add');
    assert.strictEqual(b.touched.upload, 0, 'ファイルを読みに行っています');
  });

  test('直せば、赤が消える（同じ行を送り直すと通る）', () => {
    const b = makeBox({ ledger: [] });
    const bad = replan(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                             タスク名: '', ID: '' }]);
    assert.strictEqual(bad.items[0].action, 'bad');

    const good = replan(b, [{ __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                              タスク名: '直した', ID: '' }]);
    assert.strictEqual(good.items[0].action, 'add', '直しても赤のままです');
    assert.strictEqual(good.counts.bad, 0);
  });

  test('行も base64 も無ければ、断る', () => {
    const b = makeBox({ ledger: [] });
    const r = replan(b, undefined);
    assert.strictEqual(r.ok, false, JSON.stringify(r));
  });
});

/*
 * ここから下は、検証役3体（2026-09-07）が見つけた【高】の穴。
 * どれも「テストは全部緑なのに、本番でだけ壊れている」形だった。
 */
describe('検証役の指摘（2026-09-07）', () => {
  /**
   * 【高】記録の帯が本番で一度も出ない。
   *
   * 画面（src/build-admin.js）も模擬（src/mock.js）も stamps に対応済みだったのに、
   * **本番の adminSched_ だけが返していなかった**。
   * 検査も模擬側しか見ていなかったので、1158件が緑のまま機能が死んでいた。
   * だからこの検査は、**本番の gas/Sched.gs を動かして**確かめる。
   */
  test('adminSched_ は、最終編集・取り込み・書き出しの記録を返す', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    b.box.__auth = { person: '小谷' };
    const r = JSON.parse(JSON.stringify(
      vm.runInContext('adminSched_(__auth)', b.box)));

    assert.ok(r.stamps, 'stamps を返していません（画面の帯が出ません）');
    ['edit', 'import', 'export'].forEach(k => {
      assert.ok(r.stamps[k], k + ' がありません');
      assert.strictEqual(typeof r.stamps[k].person, 'string');
      assert.strictEqual(typeof r.stamps[k].at, 'number');
    });
  });

  test('編集して保存すると、最終編集の記録が adminSched_ から返る', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    b.box.__auth = { person: '小谷' };
    b.box.__payload = { row: 2, id: 'aaaa1111', item: {
      kind: 'タスク', date: '2026-09-21', area: '制作', companies: ['FC大阪'],
      people: ['小谷'], title: '看板の入稿', detail: '', status: '未着手', memo: '' } };
    const saved = vm.runInContext('adminSchedSave_(__auth, __payload)', b.box);
    assert.strictEqual(saved.ok, true, JSON.stringify(saved));

    const r = JSON.parse(JSON.stringify(vm.runInContext('adminSched_(__auth)', b.box)));
    assert.strictEqual(r.stamps.edit.person, '小谷',
                       '編集したのに、最終編集が記録されていません');
    assert.ok(r.stamps.edit.at > 0, '編集の時刻が記録されていません');
  });

  test('書き出すと、書き出しの記録が adminSched_ から返る', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    b.box.__auth = { person: '小谷' };
    // xlsx を組むところ（gas/Export.gs）は test/export-run.test.js で見ている。
    // ここで確かめたいのは「書き出せたら記録が残る」の一点だけ
    b.box.exportXlsx_ = () => ({ ok: true, base64: '', fileName: 'x.xlsx' });
    const out = vm.runInContext('adminSchedExport_(__auth)', b.box);
    assert.strictEqual(out.ok, true, JSON.stringify(out));

    const r = JSON.parse(JSON.stringify(vm.runInContext('adminSched_(__auth)', b.box)));
    assert.strictEqual(r.stamps.export.person, '小谷',
                       '書き出したのに、記録されていません');
  });

  /**
   * 【高】台帳に同じIDの行が2つあると、関係ない行を上書きする。
   *
   * `ledger[lid] = …` は**後勝ち**、`schedImportFindRow_` は**先勝ち**。
   * このずれで、直したい行は無傷のまま、別の行が丸ごと消えて
   * 「更新1件・成功」が返っていた。変更履歴にも要約1行しか残らない。
   *
   * SCHED_HEADERS_ のコメントが書いている「甲がBを保存したつもりでCを
   * 上書きし、ok:true が返っていた」事故の、ID経路での再発。
   */
  test('台帳に同じIDの行が2つあるときは、赤にして止める', () => {
    const A = ['タスク', '2026-09-20', '', '制作', 'FC大阪', '小谷', '看板A', '',
               '未着手', '', '', 1, '小谷', '2026-09-01', '', '', 'dup00001'];
    const B = ['タスク', '2026-09-21', '', '制作', 'FC大阪', '小谷', '看板B', '',
               '未着手', '', '', 2, '山本', '2026-09-02', '', '', 'dup00001'];
    const b = makeBox({ ledger: [A, B] });

    const p = plan(b, [xrowObj({ ID: 'dup00001', 種類: 'タスク', 日付: '2026-09-30',
                                 領域: '制作', 担当会社: 'FC大阪', 担当者: '小谷',
                                 タスク名: '看板B（日付だけ直した）',
                                 ステータス: '未着手' })]);
    assert.strictEqual(p.items[0].action, 'bad',
                       '同じIDが2つあるのに、そのまま更新しようとしています');
    const why = p.items[0].problems.map(x => x.why).join(' / ');
    assert.match(why, /制作スケジュールに同じIDの行が2つあります/,
                 '理由が「制作スケジュールのほうを直して」になっていません：' + why);
  });

  test('同じIDが2つあるまま取り込んでも、台帳は書き換わらない', () => {
    const A = ['タスク', '2026-09-20', '', '制作', 'FC大阪', '小谷', '看板A', '',
               '未着手', '', '', 1, '小谷', '2026-09-01', '', '', 'dup00001'];
    const B = ['タスク', '2026-09-21', '', '制作', 'FC大阪', '小谷', '看板B', '',
               '未着手', '', '', 2, '山本', '2026-09-02', '', '', 'dup00001'];
    const b = makeBox({ ledger: [A, B] });

    apply(b, [{ ID: 'dup00001', 種類: 'タスク', 日付: '2026-09-30', 領域: '制作',
                担当会社: 'FC大阪', 担当者: '小谷', タスク名: 'すり替え',
                ステータス: '未着手' }]);

    assert.strictEqual(ledgerRow(b, 2)['タスク名'], '看板A',
                       '関係のない行が書き換わりました');
    assert.strictEqual(ledgerRow(b, 3)['タスク名'], '看板B',
                       '行が書き換わりました');
  });
});

/** Excel の1行ぶんを、列名つきの入れ物で作る（下見はこの形を受ける） */
function xrowObj(o) {
  const r = { __row: 2 };
  SHEET_HEADERS.forEach(h => { r[h] = o[h] === undefined ? '' : o[h]; });
  return r;
}

describe('検証役の指摘：読み取り側の守り', () => {
  test('200行を超えるファイルは、読んだ時点で断る（直し終えてからではない）', () => {
    const many = [];
    for (let i = 0; i < 205; i++) {
      many.push(xrow({ 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                       担当会社: 'FC大阪', 担当者: '小谷',
                       タスク名: '行' + (i + 1), ステータス: '未着手' }));
    }
    const b = makeBox({ xlsx: [SHEET_HEADERS].concat(many) });
    const r = readFile(b, 'UEsDBA==');
    assert.strictEqual(r.ok, false, '205行が下見に出てしまいました');
    assert.match(r.message, /200行までです/);
    assert.match(r.message, /分けて/, 'どうすればいいかが書かれていません');
    // 断っても一時ファイルは残さない
    assert.deepStrictEqual(b.temps.map(t => t.trashed), [true]);
  });

  test('断る道でも、一時ファイルの消し漏れは呼び出し側に伝わる', () => {
    // 「タスク名」の列が無い＝断る道。そのうえで片づけが失敗する
    const b = makeBox({ xlsx: [['やること', '日付'], [['掃除', '2026-10-01']]],
                        trashFails: true });
    const r = readFile(b, 'UEsDBA==');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.leftover, true,
                       '断ったときは、消し漏れが黙って捨てられています');
  });
});

describe('検証役の指摘：直し方が分かるように', () => {
  test('ID列が無いファイルは断る（全行が「追加」になって台帳が二重になる）', () => {
    /*
     * 2MB超の断り文が「いらない列を消してからお試しください」と案内しているので、
     * ID列を消す人は実際に出る。そのまま通すと、台帳にすでにある行が
     * 全部「追加」として入り、同じ工程表が2セット並ぶ。
     */
    const b = makeBox({ xlsx: [
      ['種類', '日付', '領域', 'タスク名', 'ステータス'],
      ['タスク', '2026-09-20', '制作', '看板の入稿', '未着手'],
    ], ledger: [LEDGER_TASK] });
    const r = readFile(b, 'UEsDBA==');
    assert.strictEqual(r.ok, false, 'ID列が無いのに読めています');
    assert.match(r.message, /ID/);
    assert.match(r.message, /Excelで保存/, '直し方が書かれていません');
  });

  test('領域が違うときは、何なら正しいのかを書く', () => {
    const b = makeBox({ ledger: [] });
    const p = plan(b, [xrowObj({ 種類: 'タスク', 日付: '2026-10-01', 領域: '会場',
                                 タスク名: 'なにか', ステータス: '未着手' })]);
    const why = p.items[0].problems.map(x => x.why).join(' ');
    assert.match(why, /会場/, 'どの値が駄目なのかが書かれていません：' + why);
    assert.match(why, /全体/, '正しい選択肢が書かれていません：' + why);
    assert.match(why, /運営/, '選択肢が途中で切れています：' + why);
  });

  test('種類とステータスも、同じように選択肢を書く', () => {
    const b = makeBox({ ledger: [] });
    const k = plan(b, [xrowObj({ 種類: 'よてい', 日付: '2026-10-01', 領域: '制作',
                                 タスク名: 'なにか' })]);
    assert.match(k.items[0].problems.map(x => x.why).join(' '), /マイルストーン/);

    const s = plan(b, [xrowObj({ 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
                                 タスク名: 'なにか', ステータス: 'やってる' })]);
    const why = s.items[0].problems.map(x => x.why).join(' ');
    assert.match(why, /やってる/, 'どの値が駄目なのかが書かれていません');
    assert.match(why, /見送り/, '正しい選択肢が書かれていません：' + why);
  });

  test('開始日が空の期間は、日付のセルを赤くする（タスク名ではない）', () => {
    const b = makeBox({ ledger: [] });
    const p = plan(b, [xrowObj({ 種類: '期間', 日付: '', 終了日: '2026-10-01',
                                 領域: '制作', タスク名: '開始日が空の期間' })]);
    const pr = p.items[0].problems.filter(x => /開始日/.test(x.why))[0];
    assert.ok(pr, '「期間には開始日が必要です」が出ていません');
    /*
     * 落ちたときの文は**固定にする**。`pr.field` を混ぜると、
     * 欄が空文字のときに「赤くする欄が「」に…」となって、
     * test/break_sched.py が目印として拾えない（この案件で繰り返した形）。
     */
    assert.strictEqual(pr.field, '日付',
                       '開始日が空なのに、日付のセルが赤くなりません');
  });

  test('取り込みで書き換えた行は、変更履歴に全文が残る', () => {
    /*
     * 設計§7 は「同時に直されても見ない」理由に
     * 「更新は変更履歴に全文が残るので、あとから追える」を挙げている。
     * ところが取り込みは要約1行しか残していなかった（設計と実装の食い違い）。
     */
    const b = makeBox({ ledger: [LEDGER_TASK] });
    apply(b, [{ ID: 'aaaa1111', 種類: 'タスク', 日付: '2026-09-25', 領域: '制作',
                担当会社: 'FC大阪', 担当者: '小谷', タスク名: '看板の入稿',
                ステータス: '進行中' }]);
    const upd = b.history.filter(h => /取り込み/.test(h.item) && h.before);
    assert.strictEqual(upd.length, 1, '書き換えた行の全文が残っていません');
    assert.match(upd[0].before, /看板の入稿/);
    assert.match(upd[0].after, /進行中/, '書き換えたあとの中身が残っていません');
  });
});

describe('検証役の指摘：書き出したExcelに、読み方を付ける', () => {
  test('2枚目に「はじめにお読みください」が付く', () => {
    /*
     * 17列すべてが並ぶだけの表だったので、完了日や起票者も直せると
     * 思って直す人が出る。取り込みが見るのは10列だけで、残りは黙って捨てる。
     * **1枚目に注意書きの行は入れない。**取り込みは見出しの下を
     * すべて中身として読むので、注意書きが1行のタスクになってしまう。
     */
    const b = makeBox({ ledger: [LEDGER_TASK] });
    let got = null;
    b.box.exportXlsx_ = (name, sheets) => { got = sheets; return { ok: true }; };
    b.box.__auth = { person: '小谷' };
    vm.runInContext('adminSchedExport_(__auth)', b.box);

    assert.strictEqual(got.length, 2, 'シートが2枚になっていません');
    assert.strictEqual(got[0].name, '制作スケジュール');
    assert.strictEqual(got[1].name, 'はじめにお読みください',
      '2枚目が読み方になっていません');
    // 1枚目は台帳そのまま。注意書きの行を混ぜない
    assert.strictEqual(got[0].rows.length, 1, '1枚目に余計な行が入っています');
    assert.strictEqual(got[0].rows[0][6], '看板の入稿');
  });

  test('読み方には、選択肢と「直していいか」が入る', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    let got = null;
    b.box.exportXlsx_ = (name, sheets) => { got = sheets; return { ok: true }; };
    b.box.__auth = { person: '小谷' };
    vm.runInContext('adminSchedExport_(__auth)', b.box);

    const by = {};
    got[1].rows.forEach(r => { by[r[0]] = { can: r[1], how: r[2] }; });
    assert.strictEqual(by['ID'].can, '触らないでください');
    assert.match(by['ID'].how, /新しい行として足されます/);
    assert.strictEqual(by['領域'].can, '直せます');
    assert.match(by['領域'].how, /全体・会議・企画・営業・制作・運営/,
      '選択肢が書かれていません');
    assert.match(by['ステータス'].how, /未着手・進行中・確認中・完了・停滞中・見送り/);
    assert.strictEqual(by['完了日'].can, '直しても反映されません');
    assert.strictEqual(by['起票者'].can, '直しても反映されません');
  });

  test('読み方の選択肢は、定数から組む（写しを作らない）', () => {
    // 選択肢を足したときに、片方だけ古くなるのを防ぐ
    const src = read('gas/Sched.gs');
    const s = src.indexOf('function schedGuideOf_');
    const f = src.slice(s, src.indexOf('\n}\n', s));
    ['SCHED_KINDS_', 'SCHED_AREAS_', 'SCHED_STATUSES_'].forEach(name => {
      assert.ok(f.indexOf(name) >= 0, name + ' から組んでいません');
    });
  });
});

/*
 * ■ 置き換え（けいた指示・2026-09-08）
 *
 *   けいたが Excel に書き出したあと、一括削除で制作スケジュールを空にした。
 *   その Excel を取り込もうとすると、**33行すべて**が
 *   「この行は制作スケジュールから削除されています。ID列を空にしてください」で
 *   止まった。Excel に戻って33セル消すのは現実的でない。
 *
 *   けいたの選択：**いまの制作スケジュールを全部消して、Excelの内容に置き換える。**
 *
 *   ここで大事なのは、**消すだけでは1行も進まない**こと。
 *   空にしても Excel の行にはIDが残っているので、同じ理由で弾かれる。
 *   置き換えでは**IDを見ない**（全部を新しい行として扱う）必要がある。
 */
describe('置き換え：いまの内容を全部消して、Excelの内容にする', () => {

  const planReplace = (b, rows) => {
    b.box.__rows = rows;
    return JSON.parse(JSON.stringify(vm.runInContext(
      'schedImportPlan_(__rows, schedPeople_(), { replace: true })', b.box)));
  };

  /** 台帳から消えたIDを持つ行（けいたが踏んだ形） */
  const staleRow = (title, id) => xrowObj({
    '種類': 'タスク', '日付': '2026-09-20', '領域': '制作', '担当会社': 'FC大阪',
    '担当者': '小谷', 'タスク名': title, 'ステータス': '未着手', 'ID': id,
  });

  test('ふつうの取り込みでは、消えたIDの行は止まる（いまの動き）', () => {
    const b = makeBox({ ledger: [] });
    const r = plan(b, [staleRow('看板の入稿', 'zzzz9999'),
                       staleRow('チラシ校了', 'yyyy8888')]);
    assert.strictEqual(r.counts.bad, 2, JSON.stringify(r.counts));
    /*
     * **理由まで見る。** 件数だけを見ていたとき、行の作り方を間違えて
     * 全項目が空になり、「別の理由で2件落ちている」のを
     * 「IDで止まっている」と読み違えた（2026-09-08）。
     */
    const why = (r.items[0].problems || []).map(p => p.field + ':' + p.why).join(' ');
    assert.ok(/ID/.test(why) && /削除されて/.test(why),
      'IDが理由で止まっていません：' + why);
  });

  test('置き換えなら、消えたIDの行も「足す」になる', () => {
    const b = makeBox({ ledger: [] });
    const r = planReplace(b, [staleRow('看板の入稿', 'zzzz9999'),
                              staleRow('チラシ校了', 'yyyy8888')]);
    assert.strictEqual(r.counts.bad, 0,
      '置き換えなのにIDで止まっています：'
      + JSON.stringify((r.items[0] || {}).problems));
    assert.strictEqual(r.counts.add, 2, JSON.stringify(r.counts));
    assert.strictEqual(r.counts.update, 0, '置き換えでは書き換えにならない');
  });

  test('置き換えでも、内容の間違いは止まる（IDだけを見逃す）', () => {
    const b = makeBox({ ledger: [] });
    const bad = xrowObj({ '種類': 'タスク', '日付': '2026-09-20', '領域': '制作',
                       '担当会社': 'FC大阪', '担当者': '小谷',
                       'タスク名': '', 'ステータス': '未着手', 'ID': 'zzzz9999' });
    const r = planReplace(b, [bad]);
    assert.strictEqual(r.counts.bad, 1,
      'タスク名が空なのに通っています（IDだけを見逃すはずが、検証ごと外れている）');
  });

  test('置き換えでは、Excelに無い行を「残る」と言わない', () => {
    // 全部消すので「台帳にだけ残る行」は存在しない。
    // ここで missing を返すと、画面が「消えません」と嘘を言う
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const r = planReplace(b, [staleRow('看板の入稿', 'zzzz9999')]);
    assert.deepStrictEqual(r.missing, [], JSON.stringify(r.missing));
  });
});

/*
 * 取り込みの実行側。**消すのと入れるのは、ひとつながりで行う。**
 * 別々に呼ぶと、消えたのに入らなかったとき、制作スケジュールが空のまま残る。
 */
describe('置き換えの実行', () => {
  const staleRow = (title, id) => xrowObj({
    '種類': 'タスク', '日付': '2026-09-20', '領域': '制作', '担当会社': 'FC大阪',
    '担当者': '小谷', 'タスク名': title, 'ステータス': '未着手', 'ID': id,
  });

  const applyReplace = (b, rows, over) => {
    b.box.__auth = Object.assign({ person: '小谷', role: '管理者' }, (over || {}).auth || {});
    b.box.__payload = Object.assign({ rows: rows, replace: true, count: 1 },
                                    (over || {}).payload || {});
    return JSON.parse(JSON.stringify(
      vm.runInContext('adminSchedImportApply_(__auth, __payload)', b.box) || null));
  };

  test('いまの行が消えて、Excelの行だけになる', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const r = applyReplace(b, [staleRow('看板の入稿', 'zzzz9999')]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const after = ledgerRows(b).map(r => r[6]);
    assert.deepStrictEqual(after, ['看板の入稿'],
      '置き換わっていません：' + JSON.stringify(after));
  });

  test('管理者でなければ、1行も消さない', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const r = applyReplace(b, [staleRow('看板の入稿', 'zzzz9999')],
                           { auth: { role: '一般' } });
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    const after = ledgerRows(b).map(r => r[6]);
    assert.strictEqual(after.length, 1, '一般権限で消えています');
  });

  /*
   * 一括削除と同じ守り。取り返しがつかないので、
   * **いま何件あるかを人に打ってもらう**（gas/Sched.gs の adminSchedPurge_ と同じ）
   */
  test('件数が合わなければ、1行も消さない', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const r = applyReplace(b, [staleRow('看板の入稿', 'zzzz9999')],
                           { payload: { count: 99 } });
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    assert.ok(/1/.test(r.message || ''), 'いま何件あるかを伝えていません：' + r.message);
    const after = ledgerRows(b).map(r => r[6]);
    assert.strictEqual(after.length, 1, '件数が違うのに消えています');
  });

  test('Excelの中身に問題があれば、1行も消さない', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    const bad = xrowObj({ '種類': 'タスク', '日付': '2026-09-20', '領域': '制作',
                          '担当会社': 'FC大阪', '担当者': '小谷',
                          'タスク名': '', 'ステータス': '未着手' });
    const r = applyReplace(b, [bad]);
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    const after = ledgerRows(b).map(r => r[6]);
    assert.strictEqual(after.length, 1,
      '入れる中身が通らないのに、先に消しています（空のまま残る）');
  });

  test('消した中身が、変更履歴に丸ごと残る', () => {
    const b = makeBox({ ledger: [LEDGER_TASK] });
    applyReplace(b, [staleRow('看板の入稿', 'zzzz9999')]);
    // makeBox の history は { operator, item, before, … } の形（配列ではない）
    const h = (b.history || []).map(a => JSON.stringify(a)).join(' | ');
    assert.ok(/看板の入稿/.test(h),
      '消した中身が変更履歴に残っていません：' + h);
  });
});

/**
 * 置き換えの下見が、**「置き換える」を受け取っているか。**
 *
 * ■ けいたが本番で踏んだ不具合（2026-09-10）
 *   「いまの制作スケジュールを全部消して、この内容に置き換える」に印を付けても、
 *   33行すべてが「ID列を空にしてください」で赤くなり、
 *   **「全部消して、この 0件に置き換える」ボタンが押せないまま**だった。
 *
 * ■ なぜ起きたか
 *   実行側（adminSchedImportApply_）は schedImportPlan_ に
 *   `{ replace: replace }` を渡していたのに、
 *   **下見側（adminSchedImportRead_）が渡していなかった。**
 *   画面は replace を送っていたが、サーバーが読み捨てていた。
 *
 * ■ なぜテストが緑だったか
 *   検査は schedImportPlan_ を**直接**呼んで {replace:true} を渡していた。
 *   **action の経路を一度も通っていなかった。**
 *   さらに src/mock.js は正しく渡していたので、
 *   **模擬で試すと動くのに、本番でだけ動かない**状態だった。
 */
describe('置き換えの下見（action の経路を通す）', () => {

  function readAs(b, rows, opts) {
    b.box.__auth = { person: '小谷', role: (opts && opts.role) || '管理者' };
    b.box.__payload = { rows: rows, replace: !!(opts && opts.replace) };
    return JSON.parse(JSON.stringify(
      vm.runInContext('adminSchedImportRead_(__auth, __payload)', b.box) || null));
  }

  /** 台帳に無いIDを持つ行（＝書き出したあと一括削除した、けいたの状況） */
  const STALE = [
    { __row: 2, 種類: 'タスク', 日付: '2026-10-01', 領域: '制作',
      タスク名: '横断幕の入稿', ID: 'gone0001' },
    { __row: 3, 種類: 'タスク', 日付: '2026-10-02', 領域: '制作',
      タスク名: '看板の入稿', ID: 'gone0002' },
  ];

  test('ふつうの取り込みでは、台帳に無いIDは赤くなる（これは正しい）', () => {
    const b = makeBox({ ledger: [] });
    const r = readAs(b, STALE, { replace: false });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.counts.bad, 2,
      '台帳から消えた行を、黙って追加しようとしています');
  });

  /*
   * **ここが本体。**
   * 置き換えは「全部消して入れ直す」なので、IDを見る意味がない。
   * 見てしまうと、書き出す → 一括削除 → 置き換える、という
   * いちばん自然な使い方で**1行も通らなくなる**。
   */
  test('置き換えなら、台帳に無いIDでも通る', () => {
    const b = makeBox({ ledger: [] });
    const r = readAs(b, STALE, { replace: true });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.counts.bad, 0,
      '置き換えなのに、IDを見て赤くしています。'
      + '画面の「全部消して、この 0件に置き換える」が押せなくなります：'
      + JSON.stringify(r.items.map(x => x.problems)));
    assert.strictEqual(r.counts.add, 2,
      '置き換えでは、全部が新しい行になるはずです：' + JSON.stringify(r.counts));
  });

  /*
   * 下見と実行で判定が違うと、**下見で通ったのに実行で弾かれる**（またはその逆）。
   * 同じ入力を両方に通して、赤の数が一致することを見る。
   */
  test('下見と実行で、赤の数が一致する', () => {
    const b = makeBox({ ledger: [] });
    const preview = readAs(b, STALE, { replace: true });

    const b2 = makeBox({ ledger: [] });
    b2.box.__rows = STALE;
    const plan = JSON.parse(JSON.stringify(vm.runInContext(
      'schedImportPlan_(__rows, schedPeople_(), { replace: true })', b2.box)));

    assert.strictEqual(preview.counts.bad, plan.counts.bad,
      '下見と実行で、赤の数が違います（下見 ' + preview.counts.bad
      + ' / 実行 ' + plan.counts.bad + '）');
    assert.strictEqual(preview.counts.add, plan.counts.add,
      '下見と実行で、追加の数が違います');
  });
});
