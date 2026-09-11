/**
 * FC大阪の担当社員の整理を、**実際に動かして**確かめる。
 *
 * 2026-09-02 FC大阪（小谷様）より
 *   「小谷、成田、田中、木口、阿部、その他 にて表記お願いします」
 * けいた指示：苗字だけ。メールは後日ヒアリングするので、いったん登録だけ。
 *
 * ■ ここが壊れると何が起きるか
 *   ・応募フォームの担当者プルダウンに、FC大阪以外の人が並ぶ
 *   ・同じ人が「小谷　成太」と「小谷」で二重に並ぶ
 *   ・既に入っているメールや役割を、こちらが消してしまう
 *   どれも本番のシートでしか起きないので、**偽のシートで先に確かめる**。
 *
 * ■ 本番のスプレッドシートには一切触らない
 *   vm の中に閉じた偽物だけを使う。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const HEAD = ['氏名', '所属', '部署', 'メール', 'フォーム表示',
              '管理ページ利用', '役割', '通知'];

/** 偽の関係者シート。getRange/appendRow だけ本物に似せる */
function makeSheet(rows) {
  const grid = [HEAD.slice()].concat(rows.map(r => r.slice()));
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => HEAD.length,
    appendRow(r) { grid.push(r.slice()); },
    getRange(row, col, nRows, nCols) {
      nRows = nRows || 1; nCols = nCols || 1;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nRows; i++) {
            out.push(grid[row - 1 + i].slice(col - 1, col - 1 + nCols));
          }
          return out;
        },
        setValue(v) { grid[row - 1][col - 1] = v; },
      };
    },
  };
}

function run(rows) {
  const sheet = makeSheet(rows);
  const logs = [];
  const box = vm.createContext({
    Array, Object, String, Number, JSON, console: { log: m => logs.push(String(m)) },
    SHEET: { PEOPLE: '関係者' },
  });
  const src = read('gas/Setup.gs');
  // ensureFcosakaStaff_ と、そこが使う定数だけを持ち込む
  ['var FCOSAKA_STAFF', 'var STAFF_RENAME'].forEach(marker => {
    const i = src.indexOf(marker);
    assert.ok(i >= 0, marker + ' が見つかりません');
    vm.runInContext(src.slice(i, src.indexOf('\n', i) + 1), box);
  });
  const s = src.indexOf('function ensureFcosakaStaff_(');
  assert.ok(s >= 0, 'ensureFcosakaStaff_ が見つかりません');
  vm.runInContext(src.slice(s, src.indexOf('\n}\n', s) + 3), box);

  vm.runInContext('ensureFcosakaStaff_', box)({ getSheetByName: () => sheet });
  return { grid: sheet.grid, logs };
}

/** 氏名 → 行（見出しを除く） */
function byName(grid) {
  const out = {};
  grid.slice(1).forEach(r => {
    const key = String(r[0]).trim() + (String(r[1]).trim() ? '@' + String(r[1]).trim() : '');
    out[key] = r;
  });
  return out;
}

const NOW = [
  ['小谷　成太', 'FC大阪', '', 'kotani@fcosaka.test', '有効', '有', '管理者', 'ON'],
  ['西村　玲奈', 'FC大阪', '', 'nishimura@fcosaka.test', '有効', '有', '一般', 'OFF'],
  ['森本　啓太', 'KREHA Creative', 'KREHA Creative', 'keita@kreha.test', '有効', '有', '管理者', 'ON'],
  ['田中　浩弥', 'LOP', 'LOP', 'tanaka@lop.test', '有効', '無', '一般', 'OFF'],
];

test('フルネームで入っていた人が、苗字だけになる', () => {
  const { grid } = run(NOW);
  const p = byName(grid);
  assert.ok(p['小谷@FC大阪'], '小谷がいません');
  assert.ok(!p['小谷　成太@FC大阪'], 'フルネームのまま残っています');
});

test('名前を直しても、メール・役割・管理ページ利用は消えない', () => {
  const { grid } = run(NOW);
  const r = byName(grid)['小谷@FC大阪'];
  assert.strictEqual(r[3], 'kotani@fcosaka.test', 'メールが消えました');
  assert.strictEqual(r[5], '有', '管理ページ利用が消えました');
  assert.strictEqual(r[6], '管理者', '役割が消えました');
});

test('足りない6人が、メール空で登録される', () => {
  const { grid } = run(NOW);
  const p = byName(grid);
  ['成田', '田中', '木口', '阿部', '佐藤', '奥村'].forEach(n => {
    const r = p[n + '@FC大阪'];
    assert.ok(r, n + ' が登録されていません');
    assert.strictEqual(r[1], 'FC大阪');
    assert.strictEqual(r[3], '', n + ' にメールが入っています');
    assert.strictEqual(r[4], '有効', n + ' がフォームに出ません');
  });
});

test('FC大阪の田中と、LOPの田中が別人として並ぶ', () => {
  // けいた確認済み（2026-09-02）：小谷様の「田中」は田中 浩弥様とは別人。
  // 同じ苗字を1人にまとめると、**通知が別の会社の人に飛ぶ**
  const { grid } = run(NOW);
  const p = byName(grid);
  assert.ok(p['田中@FC大阪'], 'FC大阪の田中がいません');
  assert.ok(p['田中　浩弥@LOP'], 'LOPの田中が消えました');
  assert.strictEqual(p['田中　浩弥@LOP'][3], 'tanaka@lop.test', 'LOPの田中のメールが消えました');
});

test('フォームに出るのは、FC大阪の7名だけ', () => {
  // 2026-09-11 けいた指示で佐藤・奥村が加わった（5名 → 7名）
  const { grid } = run(NOW);
  const shown = grid.slice(1).filter(r => String(r[4]).trim() === '有効')
                    .map(r => String(r[0]).trim()).sort();
  assert.deepStrictEqual(shown,
    ['小谷', '成田', '木口', '田中', '阿部', '佐藤', '奥村'].sort(),
    'フォームに出る人が想定と違います：' + shown.join('／'));
});

test('管理ページで先に登録した人は、行を足さずにフォームへ出し、メールを残す', () => {
  // 2026-09-11 の本番がこの形：佐藤・奥村は管理ページの「FC大阪の担当者」タブで
  // 先に登録した（メールあり・フォームには「出さない」）。
  // そのあと setup() が走っても、**2人目の佐藤を足したり、メールを消したり**してはいけない
  const rows = NOW.concat([
    ['佐藤', 'FC大阪', '', 'sato@fcosaka.test', '無効', '無', '一般', 'OFF'],
    ['奥村', 'FC大阪', '', 'okumura@fcosaka.test', '無効', '無', '一般', 'OFF'],
  ]);
  const { grid } = run(rows);
  [['佐藤', 'sato@fcosaka.test'], ['奥村', 'okumura@fcosaka.test']].forEach(([n, mail]) => {
    const hits = grid.slice(1).filter(r => String(r[0]).trim() === n);
    assert.strictEqual(hits.length, 1, n + ' が ' + hits.length + ' 行になりました');
    assert.strictEqual(hits[0][3], mail, n + ' のメールが消えました');
    assert.strictEqual(hits[0][4], '有効', n + ' がフォームに出ません');
  });
});

test('外した人も、行は消さない（1クリックで戻せる）', () => {
  const { grid } = run(NOW);
  const p = byName(grid);
  ['西村　玲奈@FC大阪', '森本　啓太@KREHA Creative', '田中　浩弥@LOP'].forEach(k => {
    assert.ok(p[k], k + ' の行が消えました');
    assert.strictEqual(String(p[k][4]).trim(), '無効', k + ' がまだフォームに出ます');
  });
});

test('2回流しても増えない（同じ結果になる）', () => {
  // setup() は何度も押される。押すたびに人が増えると台帳が汚れる
  const first = run(NOW);
  const second = run(first.grid.slice(1));
  assert.strictEqual(second.grid.length, first.grid.length,
    '2回目で行が増えました：' + first.grid.length + ' → ' + second.grid.length);
  assert.deepStrictEqual(second.logs, [], '2回目に変更が出ています：' + second.logs.join('／'));
});

test('見出しが違うシートでは、何もせずに戻る', () => {
  // 見出しを探せないまま列番号で書くと、**別の列を壊す**
  const sheet = makeSheet([]);
  sheet.grid[0] = ['なまえ', 'しょぞく'];
  const logs = [];
  const box = vm.createContext({
    Array, Object, String, Number, JSON, console: { log: m => logs.push(String(m)) },
    SHEET: { PEOPLE: '関係者' },
  });
  const src = read('gas/Setup.gs');
  ['var FCOSAKA_STAFF', 'var STAFF_RENAME'].forEach(marker => {
    const i = src.indexOf(marker);
    vm.runInContext(src.slice(i, src.indexOf('\n', i) + 1), box);
  });
  const s = src.indexOf('function ensureFcosakaStaff_(');
  vm.runInContext(src.slice(s, src.indexOf('\n}\n', s) + 3), box);
  vm.runInContext('ensureFcosakaStaff_', box)({ getSheetByName: () => sheet });

  assert.strictEqual(sheet.grid.length, 1, '見出しが違うのに書き込んでいます');
  assert.ok(logs.join('').includes('見出し'), '飛ばした理由を残していません');
});
