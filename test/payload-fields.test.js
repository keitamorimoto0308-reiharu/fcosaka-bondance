/**
 * 画面が送っている値を、**サーバーがちゃんと読んでいるか。**
 *
 * ■ なぜ要るか（2026-09-10、けいた指摘「そういうエラーが多すぎる」）
 *   この案件で重い不具合が2件、同じ日に同じ形で出た：
 *
 *   1. `adminBulkLoadIn` が振り分けに登録されていなかった
 *      → ボタンを押した瞬間に「不明な操作です」。テスト1445件は全部緑だった
 *   2. `adminSchedImportRead` が `replace` を**読み捨てて**いた
 *      → 「全部消して置き換える」に印を付けても33行すべてが赤くなり、
 *        **ボタンが押せないまま**。テストは全部緑だった
 *
 *   どちらも、検査がサーバーの関数を**直接**呼んでいて、
 *   **画面 → 振り分け → 関数 の経路を一度も通っていなかった**のが原因。
 *
 *   1 は「action が登録されているか」の検査（test/admin.test.js）で塞いだ。
 *   **2 は、どの検査も見ていなかった。** それがこの検査。
 *
 * ■ やること
 *   画面の `api('名前', { 値: … })` を機械的に集めて、
 *   その名前を扱うサーバーの関数の中に、**値の名前が出てくるか**を見る。
 *
 *   出てこない ＝ 画面は送っているのに、サーバーが読んでいない。
 *
 * ■ 限界（正直に書いておく）
 *   「名前が出てくる」しか見ていないので、**読んだあと使っていない**のは捕まえられない。
 *   それでも、今日の2件はどちらもこれで止まる。
 *   振る舞いまで見たいものは、`test/*-run.test.js` の側で通しに動かすこと。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join(NL);

const PAGE = read('src/build-admin.js');
const MOCK = read('src/mock.js');
const GAS = fs.readdirSync(path.join(ROOT, 'gas'))
  .filter(f => /\.gs$/.test(f))
  .map(f => ({ name: 'gas/' + f, src: read('gas/' + f) }));

/**
 * どの action でも共通に付いてくるもの。中身の受け渡しではないので見ない。
 */
const COMMON = ['action', 'token', 'person', 'password'];

/**
 * **読まなくてよい値**（理由つき）。
 * ここに足すのは「送っているが、サーバーが読む必要がない」と言い切れるときだけ。
 */
const NOT_READ = [
  { action: 'adminSchedImportRead', field: 'fileName',
    why: '読み口（schedImportRead_）が受け取る。振り分けの関数は素通しする' },
];

/** 画面から api('名前', { … }) を集める */
function callsInPage(src) {
  const out = [];
  let i = 0;
  for (;;) {
    const k = src.indexOf("api('", i);
    if (k < 0) break;
    const q = src.indexOf("'", k + 5);
    if (q < 0) break;
    const action = src.slice(k + 5, q);
    i = q;

    // 直後の { … } を、括弧の対応で取り出す
    const rest = src.slice(q + 1, q + 1 + 2000);
    const open = rest.indexOf('{');
    if (open < 0 || rest.slice(0, open).indexOf(')') >= 0) {
      out.push({ action, fields: [] });      // 値なしの呼び出し
      continue;
    }
    let depth = 0, end = -1;
    for (let p = open; p < rest.length; p++) {
      if (rest[p] === '{') depth++;
      else if (rest[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
    }
    if (end < 0) { out.push({ action, fields: [] }); continue; }
    const body = rest.slice(open + 1, end);

    // 直下のキーだけを拾う（入れ子の中は数えない）
    const fields = [];
    let d = 0;
    for (const seg of body.split(',')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(seg);
      if (d === 0 && m) fields.push(m[1]);
      for (const ch of seg) {
        if (ch === '{' || ch === '[' || ch === '(') d++;
        else if (ch === '}' || ch === ']' || ch === ')') d--;
      }
    }
    out.push({ action, fields });
  }
  return out;
}

/** action を扱う関数の名前を、振り分けから探す */
function handlerOf(action) {
  for (const { src } of GAS) {
    let m = new RegExp("case '" + action + "':\\s*return\\s+([A-Za-z_][A-Za-z0-9_]*)\\(")
      .exec(src);
    if (m) return m[1];
    m = new RegExp("action === '" + action + "'\\)\\s*return\\s+([A-Za-z_][A-Za-z0-9_]*)\\(")
      .exec(src);
    if (m) return m[1];
  }
  return '';
}

/** 関数の中身を、括弧の対応で切り出す */
function bodyOf(src, fnName) {
  const i = src.indexOf('function ' + fnName + '(');
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  return '';
}

function gasBodyOf(fnName) {
  for (const { src } of GAS) {
    const b = bodyOf(src, fnName);
    if (b) return b;
  }
  return '';
}

/**
 * 振り分けの関数の中身に、**payload を手渡している補助関数の中身も足す。**
 *
 * `var got = schedRowArg_(payload);` のように、読み取りを助手に任せる形がある。
 * 追いかけないと「読んでいない」と誤って言う（2026-09-10、実際にそう外れた）。
 * 1段だけ追う。それ以上は追わない（追いすぎると何でも通ってしまう）。
 */
function withHelpers(body) {
  let out = body;
  const seen = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*payload\s*[,)]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const fn = m[1];
    if (seen[fn]) continue;
    seen[fn] = true;
    out += NL + gasBodyOf(fn);
  }
  return out;
}

/**
 * その action を扱う模擬の塊。
 *
 * ⚠ **連続した case（フォールスルー）に気をつける。**
 *   `case 'A':` の直後に `case 'B': {` と続く形があり、
 *   「次の case まで」で切ると**中身が1行も入らない**。
 *   括弧の対応で、実際の塊まで取ること（2026-09-10、実際にそう外れた）。
 */
function mockChunkOf(action) {
  const i = MOCK.indexOf("case '" + action + "'");
  if (i < 0) return '';
  const rest = MOCK.slice(i);

  // 続く case ラベルを読み飛ばして、最初の { を探す
  const open = rest.indexOf('{');
  if (open < 0) return rest.slice(0, 6000);
  const upto = rest.slice(0, open);
  // { までのあいだに case 以外の中身があれば、フォールスルーではない
  if (!/^[^;]*$/.test(upto.replace(/case '[^']*':/g, ''))) {
    const next = rest.indexOf(NL + "    case '", 10);
    return next > 0 ? rest.slice(0, next) : rest.slice(0, 6000);
  }
  let depth = 0;
  for (let k = open; k < rest.length; k++) {
    if (rest[k] === '{') depth++;
    else if (rest[k] === '}') { depth--; if (depth === 0) return rest.slice(0, k + 1); }
  }
  return rest.slice(0, 6000);
}


/**
 * その値を、**payload から読んでいるか。**
 *
 * ⚠ 「名前が出てくるか」では**まったく足りない**（2026-09-10、実際にそう外れた）。
 *   `replace` という値を見ようとしたとき、`String.replace()` や
 *   `{ replace: wantReplace }` にも同じ語が出るので、
 *   **読み捨てていても素通りした**。今日の不具合そのものを見逃した。
 *
 *   だから「payload から取り出しているか」を見る。
 */
function readsField(body, f) {
  return body.indexOf('payload.' + f) >= 0
      || body.indexOf("payload['" + f + "']") >= 0
      || body.indexOf('payload["' + f + '"]') >= 0;
}

const CALLS = callsInPage(PAGE);

describe('画面が送っている値を、サーバーが読んでいるか', () => {

  test('画面の呼び出しを拾えている（この検査が空振りしていないこと）', () => {
    assert.ok(CALLS.length > 20,
      '呼び出しを ' + CALLS.length + ' 件しか拾えていません。拾い方が壊れています');
    const withFields = CALLS.filter(c => c.fields.length);
    assert.ok(withFields.length > 10,
      '値つきの呼び出しを ' + withFields.length + ' 件しか拾えていません');
  });

  test('本番が、画面の送る値を読んでいる', () => {
    const missing = [];
    for (const { action, fields } of CALLS) {
      if (action.indexOf('admin') !== 0) continue;
      const fn = handlerOf(action);
      if (!fn) continue;                       // 登録の有無は admin.test.js の仕事
      const body = withHelpers(gasBodyOf(fn));
      if (!body) continue;
      for (const f of fields) {
        if (COMMON.indexOf(f) >= 0) continue;
        if (NOT_READ.some(x => x.action === action && x.field === f)) continue;
        if (!readsField(body, f)) missing.push(action + ' … ' + f + '（' + fn + ' が読んでいない）');
      }
    }
    assert.deepStrictEqual(missing, [],
      NL + '画面は送っているのに、本番が読んでいない値：' + NL + missing.join(NL)
      + NL + '（画面で指定したのに効かない、という形の不具合になります。'
      + '2026-09-10 の「置き換えが効かない」がこれでした）');
  });

  test('模擬も、画面の送る値を読んでいる', () => {
    const missing = [];
    for (const { action, fields } of CALLS) {
      if (action.indexOf('admin') !== 0) continue;
      const chunk = mockChunkOf(action);
      if (!chunk) continue;                    // 登録の有無は admin.test.js の仕事
      /*
       * **payload をまるごと本番の関数へ渡している**なら、全部読んでいる。
       * 模擬が本番のコードをそのまま呼ぶのは、この案件が推奨している形
       * （規則の写しを作らない）。名前が出てこないのは当たり前なので数えない。
       */
      if (/\(\s*auth\s*,\s*payload\s*\)|,\s*payload\s*\)/.test(chunk)) continue;
      // 模擬も、**本番の補助関数を借りて**読むことがある（SCHED.schedRowArg_(payload) など）。
      // 追いかけないと「読んでいない」と誤って言う
      const full = withHelpers(chunk);
      for (const f of fields) {
        if (COMMON.indexOf(f) >= 0) continue;
        if (NOT_READ.some(x => x.action === action && x.field === f)) continue;
        if (!readsField(full, f)) missing.push(action + ' … ' + f);
      }
    }
    assert.deepStrictEqual(missing, [],
      NL + '画面は送っているのに、模擬が読んでいない値：' + NL + missing.join(NL)
      + NL + '（**模擬で試すと動くのに本番で落ちる**、あるいはその逆になります）');
  });
});
