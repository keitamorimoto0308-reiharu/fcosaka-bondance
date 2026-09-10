/**
 * 模擬サーバーが持っている**写しの定数**が、本番と同じか。
 *
 * ■ なぜ要るか（2026-09-10、けいた指摘「そういうエラーが多すぎる」）
 *   この案件が繰り返し踏んできた形：
 *
 *   > 同じ値を2か所に置くと、必ずどちらかが古くなる。
 *
 *   時刻は `test/times.test.js` が見張っている（それでも6か所目・7か所目が出た）。
 *   だが**模擬サーバーが持っている写し**は、誰も見ていなかった。
 *
 *   模擬が本番より**緩い**と、検証役が模擬で試して「守られている」と誤報する。
 *   模擬が本番より**厳しい**と、「模擬では落ちるのに本番では通る」で
 *   ありもしない不具合を追いかけることになる。
 *   どちらも、この案件で実際に起きている。
 *
 * ■ 本当は写しを持たないのがいちばんよい
 *   模擬は多くの場所で**本番のコードをそのまま vm で呼んで**いる（それが正しい）。
 *   ここに挙がるのは、そうできなかったぶん。
 *   **減らせるなら減らす。** 減らせないなら、ここで縛る。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join(NL);

const MOCK = read('src/mock.js');
const GAS = fs.readdirSync(path.join(ROOT, 'gas'))
  .filter(f => /\.gs$/.test(f))
  .map(f => read('gas/' + f))
  .join(NL);

/** `名前 = [ … ]` の中身を、文字列の並びとして読む */
function listOf(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const open = src.indexOf('[', i);
  if (open < 0) return null;
  let depth = 0, end = -1;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '[') depth++;
    else if (src[k] === ']') { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) return null;
  return src.slice(open + 1, end)
    .split(',')
    .map(x => x.trim().replace(/^['"]|['"]$/g, ''))
    .filter(x => x && !x.startsWith('//'));
}

/**
 * 突き合わせる組。
 *
 * 「模擬のここ」と「本番のここ」が同じ並びであること。
 */
const PAIRS = [
  { label: 'ステータス',
    mock: 'const STATUSES =', gas: 'function STATUS_LIST_' },

  { label: '当日ステータス',
    mock: 'const DAY_STATUSES =', gas: 'var DAY_STATUS =' },

  { label: '変えてよい項目',
    mock: 'const EDITABLE =', gas: 'function EDITABLE_', resolveCol: true },

  { label: 'ブラウザへ送らない列',
    mock: 'const NEVER_SEND =', gas: 'var NEVER_SEND =' },

  { label: 'レンタルの種類',
    mock: 'const RENTAL_KINDS =', gas: 'var RENTAL_KIND =', fromObject: true },

  { label: '開くと動くファイルの拡張子',
    mock: null, gas: 'var DOCS_DENY_EXT =',
    why: '模擬は本番から読んでいる（写しを持っていない）。この形がいちばんよい' },
];

/** COL.xxx の並びを、実際の列名に直す */
function resolveCols(list) {
  const i = GAS.indexOf('var COL = {');
  const body = GAS.slice(i, GAS.indexOf('};', i));
  const cols = {};
  for (const m of body.matchAll(/(\w+):\s*'([^']+)'/g)) cols[m[1]] = m[2];
  return list.filter(x => x.indexOf('COL.') === 0).map(x => cols[x.slice(4)]);
}

/** `var X = { A: 'a', B: 'b' }` の値だけを並びにする */
function objectValues(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const body = src.slice(i, src.indexOf('}', i));
  return [...body.matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);
}

describe('模擬が持っている写しの定数が、本番と同じか', () => {

  test('突き合わせる組を読めている（この検査が空振りしていないこと）', () => {
    const real = PAIRS.filter(p => p.mock);
    assert.ok(real.length >= 4,
      '突き合わせる組が ' + real.length + ' 件しかありません');
    assert.ok(listOf(MOCK, 'const STATUSES =').length === 7,
      '模擬のステータスを読めていません');
  });

  for (const p of PAIRS) {
    if (!p.mock) continue;
    test(p.label + ' が、模擬と本番で同じ', () => {
      const m = listOf(MOCK, p.mock);
      assert.ok(m, '模擬の「' + p.mock + '」を読めません');

      let g = p.fromObject ? objectValues(GAS, p.gas) : listOf(GAS, p.gas);
      assert.ok(g, '本番の「' + p.gas + '」を読めません');
      if (p.resolveCol) g = resolveCols(listOf(GAS, p.gas));

      assert.deepStrictEqual(m, g,
        NL + p.label + ' が、模擬と本番で違います。' + NL
        + '  模擬: ' + m.join('、') + NL
        + '  本番: ' + g.join('、') + NL
        + '→ **模擬が緩いと、検証役が「守られている」と誤って報告します。**' + NL
        + '  できれば写しをやめ、本番から読むこと'
        + '（src/mock.js の DENY_EXT が見本）');
    });
  }

  test('写しの数が増えていない', () => {
    /*
     * **写しは減らす方向にしか動かさない。**
     * 新しく `const XXX = [ … ]` を足したくなったら、まず
     * 「本番から読めないか」を考えること（読めるなら、そちらが正しい）。
     */
    const found = [...MOCK.matchAll(/^const ([A-Z][A-Z0-9_]*) = \[/gm)].map(m => m[1]);
    const known = ['PEOPLE', 'TYPES_JA', 'RENTAL_ITEMS', 'RENTAL_KINDS', 'STATUSES',
                   'DAY_STATUSES', 'NEVER_SEND', 'LIST_DEFAULT_COLUMNS', 'EDITABLE'];
    const added = found.filter(x => known.indexOf(x) < 0);
    assert.deepStrictEqual(added, [],
      NL + '模擬に新しい写しが増えています：' + added.join('、') + NL
      + '→ **本番から読めないか、先に考えてください。**'
      + '読めるならそちらが正しい（写しは必ずどちらかが古くなる）。' + NL
      + '  どうしても写しが要るなら、この検査の known に足し、'
      + 'PAIRS で本番と突き合わせること');
  });
});
