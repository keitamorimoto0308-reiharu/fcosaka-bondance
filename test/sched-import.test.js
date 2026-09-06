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
  });

  vm.runInContext(cutFunction(admin, 'asText_'), box);
  vm.runInContext([
    // 見出しの一覧と、日付の読み口（写しを作らない）
    sched.slice(sched.indexOf('var SCHED_HEADERS_ = ['),
                sched.indexOf('var SCHED_ID_COL_')),
    cutFunction(sched, 'schedDate_'),
  ].join(String.fromCharCode(10)), box);
  vm.runInContext(src, box);
  return { box, temps, touched, converted };
}

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
