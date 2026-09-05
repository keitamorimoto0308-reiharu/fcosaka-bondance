/**
 * GAS の代役（スプレッドシート・Utilities・キャッシュ）を1か所に置く。
 *
 * ■ なぜ1か所にするか
 *   ①（test/sched.test.js）が持っていたシートの代役を、②が写して持つと、
 *   片方だけ厳しくしたときに、もう片方は緩いまま通り続ける。
 *   2026-09-04 の検証役2体が見つけた【高】5件は、**どれも代役が本物より
 *   優しかったこと**が原因で、テスト832件が全通ししたまますり抜けていた。
 *
 * ■ ここに置くものの約束
 *   **本物より優しくしない。** 分からないときは「本物と同じ形で失敗する」ほうに倒す。
 *   - Utilities.formatDate は渡された Date を実際に整形する（固定値を返さない）
 *   - HMAC と SHA-256 は node の本物を使う。**署名を1文字変えたら本当に落ちる**
 *     代役でなければ、引換券の検査そのものが意味を持たない
 *   - getUuid は呼ぶたびに違う値を返す（定数だと「行を見分ける印」を検査できない）
 *   - setName は同名のシートがあれば例外を投げる（本物の挙動）
 *
 * ■ 制御文字を直接書かない
 *   引き継ぎ書§8。改行が要るところは String.fromCharCode(10) で組み立てる。
 */
const crypto = require('crypto');

/** GAS の byte[] は**符号つき**（-128〜127）。ここを合わせないと base64 がずれる */
function toSignedBytes(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) out.push(buf[i] > 127 ? buf[i] - 256 : buf[i]);
  return out;
}

function fromSignedBytes(arr) {
  return Buffer.from(arr.map(b => (b < 0 ? b + 256 : b)));
}

/** 渡されたものを Buffer にする。GAS は文字列も byte[] も受ける */
function asBuffer(v) {
  if (Buffer.isBuffer(v)) return v;
  if (Array.isArray(v)) return fromSignedBytes(v);
  return Buffer.from(String(v), 'utf8');
}

/**
 * シートの代役。書いた中身をあとから grid で見られる。
 *
 * @param {Array} headers 見出しの行
 * @param {Array} rows    見出しを除いた行
 */
function makeSheet(headers, rows, opts) {
  opts = opts || {};
  const grid = [headers.slice()].concat((rows || []).map(r => r.slice()));

  /*
   * **シートの行数（getMaxRows）を、実際に持つ。**
   *
   * 以前は `Math.max(grid.length, 1000)` を返し、`deleteRows` は splice するだけで、
   * `setValues` は足りなければ勝手に伸びていた。**本物より優しい代役**だったので、
   * 本物なら落ちる書き込みが必ず成功していた。
   *
   * 2026-09-05 の検証役が、これで隠れていた【高】を1件見つけた：
   * 本物の `deleteRows` は**シートの行数そのものを減らす**（補充されない）。
   * まるごと差し替えのたびに40行ずつ縮み、25回目の保存で範囲外になる。
   * しかも例外は行を消した**あと**に起きるので、**進行表が黙って空になる**。
   *
   * ①（gas/Purge.gs の deleteRows）も同じ代役を通っている。
   */
  let maxRows = Math.max(opts.maxRows || 1000, grid.length);

  const outside = (row, nRows) => {
    if (row < 1 || row + (nRows || 1) - 1 > maxRows) {
      throw new Error('範囲外です（シートは ' + maxRows + ' 行しかありません。'
        + (row + (nRows || 1) - 1) + ' 行目に触ろうとしました）');
    }
  };

  const sheet = {
    grid,
    name: '',
    getName: () => sheet.name,
    getLastRow: () => grid.length,
    getLastColumn: () => headers.length,
    getMaxRows: () => maxRows,
    getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
    getRange(row, col, nRows, nCols) {
      outside(row, nRows);
      return {
        getValues: () => {
          const out = [];
          for (let r = 0; r < (nRows || 1); r++) {
            const line = [];
            for (let c = 0; c < (nCols || 1); c++) line.push((grid[row - 1 + r] || [])[col - 1 + c]);
            out.push(line);
          }
          return out;
        },
        getValue: () => (grid[row - 1] || [])[col - 1],
        setValue: v => { while (grid.length < row) grid.push([]); grid[row - 1][col - 1] = v; },
        setValues: vals => {
          vals.forEach((line, r) => line.forEach((v, c) => {
            while (grid.length < row + r) grid.push([]);
            if (!grid[row - 1 + r]) grid[row - 1 + r] = [];
            grid[row - 1 + r][col - 1 + c] = v;
          }));
        },
        clearContent: () => {
          for (let r = 0; r < (nRows || 1); r++) {
            for (let c = 0; c < (nCols || 1); c++) {
              if (grid[row - 1 + r]) grid[row - 1 + r][col - 1 + c] = '';
            }
          }
        },
        setNumberFormat: () => {}, setWrap: () => {}, setDataValidation: () => {},
      };
    },
    appendRow: line => {
      grid.push(line.slice());
      if (grid.length > maxRows) maxRows = grid.length;   // 本物も足りなければ増える
    },
    deleteRow: n => { grid.splice(n - 1, 1); maxRows -= 1; },
    // **本物は、シートの行数そのものを減らす。**消した行は補充されない
    deleteRows: (n, count) => { grid.splice(n - 1, count); maxRows -= count; },
    insertRowsAfter: (after, count) => { maxRows += count; },
    setColumnWidth: () => {}, setFrozenRows: () => {},
  };
  return sheet;
}

/**
 * Utilities の代役。**暗号は本物を使う。**
 *
 * @param {Object} opts now … 「いま」を固定する Date（省略すると実時刻）
 */
function makeUtilities(opts) {
  opts = opts || {};
  let uuidN = 0;
  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    formatDate(d, tz, fmt) {
      const p = n => String(n).padStart(2, '0');
      const ymd = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      if (fmt === 'yyyy-MM-dd') return ymd;
      if (fmt === 'HH:mm') return p(d.getHours()) + ':' + p(d.getMinutes());
      return ymd + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    },
    // 呼ぶたびに違う値。定数にすると全行が同じIDになり、
    // 「行の並べ替えでも変わらない印」という肝心の性質を検査できない
    getUuid: () => {
      uuidN++;
      return ('0000000' + uuidN).slice(-8) + '-aaaa-bbbb-cccc-dddddddddddd';
    },
    newBlob(v) {
      const buf = asBuffer(v);
      return {
        getBytes: () => toSignedBytes(buf),
        getDataAsString: () => buf.toString('utf8'),
      };
    },
    // GAS には「ふつうの base64」と「URLで使える base64」の両方がある。
    // 片方だけ代役に置くと、本物では動くのに代役で落ちる（逆も起きる）
    base64Encode: v => asBuffer(v).toString('base64'),
    base64Decode: s => toSignedBytes(Buffer.from(String(s), 'base64')),
    base64EncodeWebSafe: v => asBuffer(v).toString('base64')
      .split('+').join('-').split('/').join('_'),
    base64DecodeWebSafe: s => toSignedBytes(
      Buffer.from(String(s).split('-').join('+').split('_').join('/'), 'base64')),
    // 本物の HMAC。ここを固定値にすると、券の署名の検査が丸ごと嘘になる
    computeHmacSha256Signature: (text, key) => toSignedBytes(
      crypto.createHmac('sha256', asBuffer(key)).update(asBuffer(text)).digest()),
    computeDigest: (alg, text) => toSignedBytes(
      crypto.createHash('sha256').update(asBuffer(text)).digest()),
    sleep: () => {},
  };
}

/**
 * CacheService の代役。**期限を実際に守る。**
 *
 * 期限を無視する代役にすると、「札が3分で消える」の検査が
 * 消えていないのに通ってしまう。
 */
function makeCache(clock) {
  const store = new Map();
  const now = () => (clock ? clock() : Date.now());
  const cache = {
    put(key, value, sec) {
      store.set(String(key), { v: String(value), e: now() + (sec || 600) * 1000 });
    },
    get(key) {
      const hit = store.get(String(key));
      if (!hit) return null;
      if (hit.e <= now()) { store.delete(String(key)); return null; }
      return hit.v;
    },
    remove(key) { store.delete(String(key)); },
  };
  return { getScriptCache: () => cache, getUserCache: () => cache, store };
}

/** 本番のソースから関数を1つ切り出す（写しを作らないため） */
function cutFunction(code, name) {
  const start = code.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + ' が見つかりません');
  // 制御文字を直接書かない（引き継ぎ書§8）。改行 + } + 改行 が関数の終わり
  const NL = String.fromCharCode(10);
  const end = code.indexOf(NL + '}' + NL, start) + 3;
  // 切り出せなかったら、その場で止める。**空文字のまま進むのがいちばん危ない**
  if (end <= start) throw new Error(name + ' の終わりが見つかりません');
  return code.slice(start, end);
}

module.exports = {
  makeSheet, makeUtilities, makeCache, cutFunction,
  toSignedBytes, fromSignedBytes,
};
