/**
 * Excel の書き出し（`gas/Export.gs`）を、**実際に動かして**確かめる。
 *
 * 仕様は design_timetable.md §6-2・§6-3、§7-3 の15。
 *
 * ■ ①と②で、同じ関数を共有する
 *   制作スケジュール表とタイムスケジュールの両方が、ここを通る。
 *   写しを2つ書くと、片方だけ直したときに気づけない。
 *
 * ■ いちばん怖いのは「一時ファイルの消し忘れ」
 *   Driveが散らかるだけでなく、**台帳の中身がそのまま残る**。
 *   資料フォルダは全共有なので、残ったファイルの置き場所によっては見えてしまう。
 *   だから成功しても失敗しても、**必ず**消えることを確かめる。
 *
 * ■ 代役は本物より優しくしない
 *   `UrlFetchApp` が失敗する道、`setTrashed` が例外を投げる道も試す。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeSheet, makeUtilities, cutFunction } = require('./_gasbox');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/**
 * gas/Export.gs を、代役つきの箱で走らせる。
 *
 * @param {Object} opts
 *   fetchFails  … /export?format=xlsx の取得が失敗する
 *   trashFails  … 一時ファイルの削除が例外を投げる
 *   createFails … 一時ファイルを作れない
 */
function makeBox(opts) {
  opts = opts || {};
  const admin = read('gas/Admin.gs');
  const src = read('gas/Export.gs');

  /** 作られた一時ファイルの記録。消されたかどうかを見る */
  const temps = [];

  const madeSheets = {};

  function fakeSpreadsheet(name) {
    const rec = { name: name, id: 'tmp-' + (temps.length + 1), trashed: false, sheets: {} };
    temps.push(rec);
    const api = {
      getId: () => rec.id,
      getUrl: () => 'https://example.com/' + rec.id,
      getName: () => rec.name,
      rename: n => { rec.name = n; },
      getSheets: () => [api.getActiveSheet()],
      getActiveSheet: () => {
        if (!rec.active) rec.active = makeSheet([], []);
        return rec.active;
      },
      insertSheet: n => { rec.sheets[n] = makeSheet([], []); return rec.sheets[n]; },
      deleteSheet: () => {},
    };
    madeSheets[rec.id] = api;
    return api;
  }

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Boolean, Date,
    console: { error() {}, log() {} },
    Utilities: makeUtilities(),
    SpreadsheetApp: {
      create: name => {
        if (opts.createFails) throw new Error('作れませんでした');
        return fakeSpreadsheet(name);
      },
      flush() {},
    },
    DriveApp: {
      getFileById: id => ({
        setTrashed: v => {
          if (opts.trashFails) throw new Error('消せませんでした');
          const hit = temps.filter(t => t.id === id)[0];
          if (hit) hit.trashed = !!v;
        },
      }),
    },
    ScriptApp: { getOAuthToken: () => 'token-abc' },
    UrlFetchApp: {
      fetch: () => {
        if (opts.fetchFails) throw new Error('取得できませんでした');
        return {
          getResponseCode: () => 200,
          getBlob: () => ({ getBytes: () => [80, 75, 3, 4] }),   // PK.. = zip の頭
        };
      },
    },
    logError_: () => {},
  });

  vm.runInContext(cutFunction(admin, 'safeCellText_'), box);
  vm.runInContext(src, box);
  return { box, temps };
}

function plain(v) { return JSON.parse(JSON.stringify(v === undefined ? null : v)); }

function build(b, payload) {
  b.box.__payload = payload;
  return plain(vm.runInContext('exportXlsx_(__payload.name, __payload.sheets)', b.box));
}

/** 見本：①と②の両方の形を用意しておく */
const SCHED_SHEET = {
  name: '制作スケジュール',
  headers: ['種類', '日付', 'タスク名'],
  rows: [['タスク', '2026-09-20', '看板の入稿']],
  widths: [80, 100, 300],
};
const TT_SHEET = {
  name: 'タイムスケジュール',
  headers: ['時刻', '全体', 'イベント', '備考'],
  rows: [['11:00', '', 'オープニングセレモニー', '']],
  widths: [70, 200, 200, 200],
};

describe('書き出し：Excel（§6-2）', () => {

  test('xlsx を Base64 で返す', () => {
    const b = makeBox({});
    const r = build(b, { name: '進行表', sheets: [TT_SHEET] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.ok(r.base64 && r.base64.length > 0, 'Base64 が空です');
    assert.match(r.filename, /\.xlsx$/);
  });

  test('①と②の両方が、同じ関数を通る', () => {
    const b = makeBox({});
    assert.strictEqual(build(b, { name: '制作スケジュール', sheets: [SCHED_SHEET] }).ok, true);
    assert.strictEqual(build(b, { name: '進行表', sheets: [TT_SHEET] }).ok, true);
  });

  test('15. 一時ファイルは、成功しても必ず消える', () => {
    const b = makeBox({});
    build(b, { name: '進行表', sheets: [TT_SHEET] });
    assert.strictEqual(b.temps.length, 1, '一時ファイルが作られていません');
    assert.strictEqual(b.temps[0].trashed, true,
      '一時ファイルが残っています（Driveに台帳の中身が残ります）');
  });

  test('15b. 取得に失敗しても、一時ファイルは消える', () => {
    const b = makeBox({ fetchFails: true });
    const r = build(b, { name: '進行表', sheets: [TT_SHEET] });
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    assert.strictEqual(b.temps[0].trashed, true,
      '失敗したときに一時ファイルが残っています');
  });

  test('15c. 消すのに失敗しても、書き出しは返す（そのうえで記録に残す）', () => {
    // 消せなかったことを理由に書き出しを失敗させると、
    // 「使えるのに使えない」状態になる。消し漏れは記録して、人に伝える
    const b = makeBox({ trashFails: true });
    const r = build(b, { name: '進行表', sheets: [TT_SHEET] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.leftover, true, '消し漏れを伝えていません');
  });

  test('一時ファイルを作れなければ、理由を添えて断る', () => {
    const b = makeBox({ createFails: true });
    const r = build(b, { name: '進行表', sheets: [TT_SHEET] });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /書き出/, r.message);
  });

  test('Drive に置いたリンクは返さない（資料フォルダは全共有）', () => {
    const b = makeBox({});
    const r = build(b, { name: '進行表', sheets: [TT_SHEET] });
    assert.ok(!r.url, 'Drive のURLを返しています（§6-2 で禁じています）');
  });

  test('数式になりうる文字で始まる値は、そのままセルに入れない', () => {
    const b = makeBox({});
    build(b, { name: '進行表', sheets: [{
      name: '進行表', headers: ['タイトル'], rows: [['=1+1']], widths: [200],
    }] });
    const grid = b.temps[0].active.grid;
    assert.strictEqual(grid[1][0], "'=1+1");
  });

  test('シートの中身が空でも、書き出せる（0件は0件と返す）', () => {
    const b = makeBox({});
    const r = build(b, { name: '進行表', sheets: [{
      name: '進行表', headers: ['時刻'], rows: [], widths: [70],
    }] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.rows, 0);
  });

  test('ファイル名に、日付と中身の名前が入る', () => {
    const b = makeBox({});
    const r = build(b, { name: '進行表', sheets: [TT_SHEET] });
    assert.match(r.filename, /進行表/);
    assert.match(r.filename, /\d{4}-\d{2}-\d{2}/);
  });

  test('ファイル名に使えない文字は落とす', () => {
    const b = makeBox({});
    const r = build(b, { name: '進行/表:*?"<>|', sheets: [TT_SHEET] });
    assert.ok(!/[\/:*?"<>|]/.test(r.filename), 'ファイル名に使えない文字が残っています: ' + r.filename);
  });
});
