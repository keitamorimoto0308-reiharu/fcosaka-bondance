/**
 * 検査台の「代役」が、**本物と同じ形か。**
 *
 * ■ なぜ要るか（2026-09-10、けいた指摘「そういうエラーが多すぎる」）
 *   引き継ぎ書がいちばん強く書いている学びがこれ：
 *
 *   > 今日見つけた重い不具合は、どれもテスト1200件超が緑のまま本番で壊れていた。
 *   > 原因はほぼ同じで、**検査の代役が本物より優しい**か、
 *   > **検査が写しのほうを見ている**。
 *   >   - `getConfig` の代役が引数を取る形だった → 本番で必ず失敗するコードが通っていた
 *   >   - 代役シートに `getValue` が無かった → 設定シートを読む道を一度も通っていなかった
 *
 *   2026-09-10 にも同じ形を踏んだ。`test/admin-edit.test.js` の代役が
 *   `COL` に `inAt` を持たず、`EDITABLE_` も本物より狭かった。
 *   そのため**搬入予定時刻を書く道を、検査が一度も通れなかった**。
 *
 * ■ やること
 *   検査台がベタ書きしている代役を集めて、**本物（gas/*.gs）と突き合わせる。**
 *   狭い・値が違う・そもそも本物に無い、を見つける。
 *
 * ■ 限界
 *   代役は「本物より狭くてよい」場面もある（その検査で使わない列など）。
 *   だから**狭いこと自体は止めず、理由を書いて明示的に許す**形にしてある。
 *   無言で狭いのと、理由付きで狭いのは別物。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join(NL);

const GAS = fs.readdirSync(path.join(ROOT, 'gas'))
  .filter(f => /\.gs$/.test(f))
  .map(f => ({ name: 'gas/' + f, src: read('gas/' + f) }))
  .reduce((a, x) => a + NL + x.src, '');

/** 本物の COL（キー→列名） */
function realCol() {
  const i = GAS.indexOf('var COL = {');
  assert.ok(i >= 0, 'gas に COL がありません');
  const body = GAS.slice(i, GAS.indexOf('};', i));
  const out = {};
  for (const m of body.matchAll(/(\w+):\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

/** 本物の EDITABLE_（COL.xxx の並びを列名に直す） */
function realEditable() {
  const i = GAS.indexOf('function EDITABLE_');
  assert.ok(i >= 0, 'gas に EDITABLE_ がありません');
  const seg = GAS.slice(i, GAS.indexOf('}', GAS.indexOf('return', i)));
  const cols = realCol();
  return seg.slice(seg.indexOf('[') + 1, seg.indexOf(']'))
    .split(',').map(x => x.trim()).filter(x => x.indexOf('COL.') === 0)
    .map(x => cols[x.slice(4)]);
}

/** 本物の数の上限（var NAME = 123;） */
function realNumber(name) {
  const m = new RegExp('var ' + name + '\\s*=\\s*([0-9*\\s]+);').exec(GAS);
  if (!m) return null;
  // 「2 * 1024 * 1024」のような書き方も読む
  return m[1].split('*').map(x => Number(x.trim())).reduce((a, b) => a * b, 1);
}

/** 関数の中身を、括弧の対応で切り出す（gas 全体から探す） */
function gasBodyOf(fnName) {
  const i = GAS.indexOf('function ' + fnName + '(');
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let k = i; k < GAS.length; k++) {
    const c = GAS[k];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return GAS.slice(i, k + 1); }
  }
  return '';
}

const SELF = path.basename(__filename);
const TESTS = fs.readdirSync(path.join(ROOT, 'test'))
  // **自分自身は見ない。** この検査は目印の文字列を持っているので、
  // 対象に入れると自分を代役と誤認する（2026-09-10、実際にそう外れた）
  .filter(f => /\.test\.js$/.test(f) && f !== SELF)
  .sort();

describe('検査台の代役が、本物と同じ形か', () => {

  test('本物を読めている（この検査が空振りしていないこと）', () => {
    const cols = realCol();
    assert.ok(Object.keys(cols).length > 10,
      'COL を ' + Object.keys(cols).length + ' 個しか読めていません');
    assert.ok(realEditable().length >= 4, 'EDITABLE_ を読めていません');
    assert.strictEqual(cols.inAt, '搬入予定時刻');
  });

  test('代役の COL が、本物に無いキーを持っていない', () => {
    /*
     * **狭いより、こちらのほうが危ない。**
     * 本物に無い列名を代役が持っていると、検査だけが通る道ができる
     * （本番では必ず落ちるコードが、緑のまま残る）。
     */
    const real = realCol();
    const bad = [];
    for (const f of TESTS) {
      const src = read('test/' + f);
      const i = src.indexOf('COL: {');
      if (i < 0) continue;
      const body = src.slice(i, src.indexOf('}', i));
      for (const m of body.matchAll(/(\w+):\s*'([^']+)'/g)) {
        if (!(m[1] in real)) bad.push(f + ' … COL.' + m[1] + ' は本物に無い');
        else if (real[m[1]] !== m[2]) {
          bad.push(f + ' … COL.' + m[1] + ' が「' + m[2] + '」（本物は「'
                 + real[m[1]] + '」）');
        }
      }
    }
    assert.deepStrictEqual(bad, [],
      NL + '代役の COL が本物と食い違っています：' + NL + bad.join(NL));
  });

  test('代役の COL が、その検査が通る道で使う列を全部持っている', () => {
    /*
     * ■ 「本物の全部を持て」ではない
     *   検査台は、通らない道の列を持つ必要がない。
     *   正しい基準は「**その検査が読み込んでいる関数が使う列**を持っているか」。
     *   これなら自動で追随するし、通る道の列が抜けたら必ず落ちる。
     *
     * ■ 2026-09-10 に起きたこと
     *   admin-edit.test.js が adminBulkLoadIn_ を読み込んだのに、
     *   代役の COL に inAt が無かった。
     *   → **搬入予定時刻を書く道を、検査が一度も通れなかった。**
     */
    const real = realCol();
    const bad = [];
    for (const f of TESTS) {
      const src = read('test/' + f);
      const i = src.indexOf('COL: {');
      if (i < 0) continue;
      const body = src.slice(i, src.indexOf('}', i));
      const have = new Set([...body.matchAll(/(\w+):/g)].map(m => m[1]));

      // その検査が vm に読み込んでいる関数（'function xxx_' の並び）
      const loaded = [...src.matchAll(/'function ([A-Za-z_][A-Za-z0-9_]*)'/g)]
        .map(m => m[1]);
      if (!loaded.length) continue;

      const need = new Set();
      for (const fn of loaded) {
        const b = gasBodyOf(fn);
        for (const m of b.matchAll(/COL\.([A-Za-z_][A-Za-z0-9_]*)/g)) need.add(m[1]);
      }
      for (const k of need) {
        if (have.has(k)) continue;
        if (!(k in real)) continue;                 // 本物に無いなら別の話
        bad.push(f + ' … COL.' + k + '（' + real[k] + '）が無い。'
               + 'この検査が読み込む関数が使っています');
      }
    }
    assert.deepStrictEqual(bad, [],
      NL + '代役の COL に、通る道の列が足りません：' + NL + bad.join(NL)
      + NL + '→ 足りないと、**本番で通る道を一度も通らないまま緑**になります'
      + NL + '（2026-09-10、inAt が無くて搬入予定時刻の道を通れなかった）');
  });

  test('代役の EDITABLE_ が、本物と同じ並び', () => {
    /*
     * ここは狭くしてはいけない。
     * 狭いと「本番では変えられるのに、検査では forbidden_field になる」ので、
     * **本番で通る道を一度も通らないまま緑**になる。
     */
    const real = realEditable();
    const bad = [];
    for (const f of TESTS) {
      const src = read('test/' + f);
      const i = src.indexOf('EDITABLE_:');
      if (i < 0) continue;
      const open = src.indexOf('[', i);
      const list = src.slice(open + 1, src.indexOf(']', open))
        .split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      const missing = real.filter(x => list.indexOf(x) < 0);
      const extra = list.filter(x => real.indexOf(x) < 0);
      if (missing.length) bad.push(f + ' … 足りない: ' + missing.join('、'));
      if (extra.length) bad.push(f + ' … 本物に無い: ' + extra.join('、'));
    }
    assert.deepStrictEqual(bad, [],
      NL + '代役の EDITABLE_ が本物と違います：' + NL + bad.join(NL));
  });

  test('代役の上限の数が、本物と同じ', () => {
    /*
     * 上限を緩めると、**本番では断られる入力が検査では通る**。
     * 「模擬で通るのに本番で落ちる」の、検査台版。
     */
    const names = ['MEMO_ADD_MAX', 'MEMO_TOTAL_MAX', 'FIELD_TEXT_MAX', 'REASON_MAX',
                   'UPLOAD_MAX_BYTES', 'BULK_MAX', 'SCHED_IMPORT_ROWS_MAX'];
    const bad = [];
    for (const f of TESTS) {
      const src = read('test/' + f);
      for (const n of names) {
        const real = realNumber(n);
        if (real === null) continue;
        const m = new RegExp(n + ':\\s*([0-9]+)').exec(src);
        if (!m) continue;
        if (Number(m[1]) !== real) {
          bad.push(f + ' … ' + n + ' が ' + m[1] + '（本物は ' + real + '）');
        }
      }
    }
    assert.deepStrictEqual(bad, [],
      NL + '代役の上限が本物と違います：' + NL + bad.join(NL)
      + NL + '→ 数を書き写さず、**本物から読む**のがいちばん安全'
      + '（test/admin-edit.test.js の BULK_MAX が見本）');
  });

  test('代役のステータス一覧が、本物と同じ', () => {
    const listOf = (src, marker) => {
      const i = src.indexOf(marker);
      if (i < 0) return null;
      const open = src.indexOf('[', i);
      return src.slice(open + 1, src.indexOf(']', open))
        .split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    };
    const realStatus = listOf(GAS, 'function STATUS_LIST_');
    const realNeeds = listOf(GAS, 'var STATUS_NEEDS_REASON_');
    const realDay = listOf(GAS, 'var DAY_STATUS');
    assert.ok(realStatus && realNeeds && realDay, '本物の一覧を読めていません');

    const bad = [];
    for (const f of TESTS) {
      const src = read('test/' + f);
      for (const [marker, real, label] of [
        ['STATUS_LIST_:', realStatus, 'ステータス'],
        ['STATUS_NEEDS_REASON_:', realNeeds, '理由が要るステータス'],
        ['DAY_STATUS:', realDay, '当日ステータス'],
      ]) {
        const got = listOf(src, marker);
        if (!got) continue;
        if (got.join('|') !== real.join('|')) {
          bad.push(f + ' … ' + label + ' が違う' + NL
                 + '      代役: ' + got.join('、') + NL
                 + '      本物: ' + real.join('、'));
        }
      }
    }
    assert.deepStrictEqual(bad, [],
      NL + '代役の一覧が本物と違います：' + NL + bad.join(NL));
  });
});
