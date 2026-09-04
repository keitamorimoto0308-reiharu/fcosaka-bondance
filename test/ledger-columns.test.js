/**
 * 応募一覧に列を足したとき、データを保ったまま差し込めるか。
 *
 * ■ なぜ要るか
 *   それまでは、列が1つ増えるだけで setup() が止まっていた。
 *   項目を1つ足すたびに「応募一覧を空にしてください」と頼むことになり、
 *   **FC大阪がテストを始めたあとは、項目を足せなくなる**。
 *
 * ■ ただし、動かしてよいのは「増えただけ」のときだけ
 *   並べ替え・改名・削除が混ざったまま自動で移行すると、
 *   **どの値がどの列のものか分からなくなる**。
 *   そのときは今までどおり止めて、人に判断させる。
 *
 * ■ 本番の台帳でしか起きない事故なので、偽のシートで動かす
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/** 見出し1行＋データ行を持つ、偽のシート */
function makeSheet(headers, rows) {
  const grid = [headers.slice()].concat(rows.map(r => r.slice()));
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => grid[0].length,
    insertColumnBefore(col) {
      grid.forEach(r => r.splice(col - 1, 0, ''));
    },
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

function load() {
  const src = read('gas/Setup.gs');
  const i = src.indexOf('function insertMissingLedgerColumns_');
  assert.ok(i >= 0, 'insertMissingLedgerColumns_ がありません');
  const box = vm.createContext({ String, Array, console: { log() {} } });
  vm.runInContext(src.slice(i, src.indexOf('\n}\n', i) + 3), box);
  return vm.runInContext('insertMissingLedgerColumns_', box);
}

const HEAD = ['受付ID', '企業名', 'ステータス', '生データ(JSON)'];
const ROWS = [
  ['SB-0001', '大阪フードサービス', '採択', '{"a":1}'],
  ['SB-0002', 'まちのパン工房', '審査中', '{"b":2}'],
];

test('末尾に列を足しても、データは動かない', () => {
  const fn = load();
  const sh = makeSheet(HEAD, ROWS);
  const want = HEAD.concat(['不採択通知送信日時']);

  assert.strictEqual(fn(sh, HEAD.slice(), want), true);
  assert.deepStrictEqual(sh.grid[0], want, '見出しの並びがずれています');
  assert.deepStrictEqual(sh.grid[1], ['SB-0001', '大阪フードサービス', '採択', '{"a":1}', ''],
    'の値がずれています');
  assert.deepStrictEqual(sh.grid[2], ['SB-0002', 'まちのパン工房', '審査中', '{"b":2}', ''],
    'の値がずれています');
});

test('途中に列を足しても、値がずれない', () => {
  // ここがいちばん危ない。ずれると、企業名の欄にステータスが入る
  const fn = load();
  const sh = makeSheet(HEAD, ROWS);
  const want = ['受付ID', '企業名', '不採択通知送信日時', 'ステータス', '生データ(JSON)'];

  assert.strictEqual(fn(sh, HEAD.slice(), want), true);
  assert.deepStrictEqual(sh.grid[0], want, '見出しの並びがずれています');
  // 元の値が、元の見出しの下に残っているか
  want.forEach((h, c) => {
    const before = HEAD.indexOf(h);
    if (before < 0) {
      assert.strictEqual(sh.grid[1][c], '', h + ' が空になっていません');
      return;
    }
    assert.strictEqual(sh.grid[1][c], ROWS[0][before], h + ' の値がずれています');
    assert.strictEqual(sh.grid[2][c], ROWS[1][before], h + ' の値がずれています');
  });
});

test('複数の列を足しても、全部そろう', () => {
  const fn = load();
  const sh = makeSheet(HEAD, ROWS);
  const want = ['受付ID', '不採択通知送信日時', '企業名', 'ステータス',
                '不採択理由', '生データ(JSON)'];

  assert.strictEqual(fn(sh, HEAD.slice(), want), true);
  assert.deepStrictEqual(sh.grid[0], want, '見出しの並びがずれています');
  assert.strictEqual(sh.grid[1][0], 'SB-0001', 'の値がずれています');
  assert.strictEqual(sh.grid[1][2], '大阪フードサービス', 'の値がずれています');
  assert.strictEqual(sh.grid[1][5], '{"a":1}', 'の値がずれています');
});

test('並べ替えが混ざっていたら、触らずに断る', () => {
  // 自動で動かすと、どの値がどの列のものか分からなくなる
  const fn = load();
  const sh = makeSheet(HEAD, ROWS);
  const want = ['受付ID', 'ステータス', '企業名', '生データ(JSON)'];  // 入れ替え

  assert.strictEqual(fn(sh, HEAD.slice(), want), false, '並べ替えを通しています');
  assert.deepStrictEqual(sh.grid[0], HEAD, '断ったのに書き換えています');
  assert.deepStrictEqual(sh.grid[1], ROWS[0], '断ったのにデータが動いています');
});

test('列が消えていたら、触らずに断る', () => {
  const fn = load();
  const sh = makeSheet(HEAD, ROWS);
  const want = ['受付ID', 'ステータス', '生データ(JSON)'];   // 企業名が無い

  assert.strictEqual(fn(sh, HEAD.slice(), want), false, '削除を通しています');
  assert.deepStrictEqual(sh.grid[0], HEAD, '断ったのに書き換えています');
});

test('改名が混ざっていたら、触らずに断る', () => {
  const fn = load();
  const sh = makeSheet(HEAD, ROWS);
  const want = ['受付ID', '会社名', 'ステータス', '生データ(JSON)'];  // 企業名→会社名

  assert.strictEqual(fn(sh, HEAD.slice(), want), false, '改名を通しています');
  assert.deepStrictEqual(sh.grid[0], HEAD, '断ったのに書き換えています');
});

test('末尾の空の列は、比較から外す', () => {
  // シートには列だけ余っていることがある。それを「知らない見出し」と数えない
  const fn = load();
  const sh = makeSheet(HEAD.concat(['', '']), ROWS.map(r => r.concat(['', ''])));
  const want = HEAD.concat(['不採択通知送信日時']);

  assert.strictEqual(fn(sh, HEAD.concat(['', '']), want), true);
  assert.strictEqual(sh.grid[0][4], '不採択通知送信日時');
});

test('見出しの行が消えていたら、触らずに断る', () => {
  // **いちばん危ない形**。見出しが空だと「知っている見出しが1つも無い」ので、
  // 素直に読むと「全部足りない」になり、データの左側に列を全部差し込んでしまう。
  // 受付IDの列に企業名が入る
  const fn = load();
  const sh = makeSheet(['', '', '', ''], ROWS);

  assert.strictEqual(fn(sh, ['', '', '', ''], HEAD.slice()), false,
    '見出しが空なのに差し込みました');
  assert.deepStrictEqual(sh.grid[1], ROWS[0], '断ったのにデータが動いています');
  assert.strictEqual(sh.grid[1].length, 4, '列が増えています（値が横にずれます）');
});

test('変わっていなければ、何もしない', () => {
  const fn = load();
  const sh = makeSheet(HEAD, ROWS);
  assert.strictEqual(fn(sh, HEAD.slice(), HEAD.slice()), true);
  assert.deepStrictEqual(sh.grid[0], HEAD);
  assert.deepStrictEqual(sh.grid[1], ROWS[0]);
});

test('setup() は、断られたら止まる', () => {
  // 断ったのに続けると、ずれた列のまま応募を受け続ける
  const src = read('gas/Setup.gs');
  const i = src.indexOf('function setupLedgerSheet_');
  const fn = src.slice(i, src.indexOf('\n}\n', i));
  assert.ok(/if \(!insertMissingLedgerColumns_\(sh, current, headers\)\) \{/.test(fn),
    '差し込みの結果を見ていません');
  const guard = fn.indexOf('insertMissingLedgerColumns_');
  const thr = fn.indexOf('throw new Error');
  assert.ok(guard >= 0 && guard < thr, '断られたときに止めていません');
});
