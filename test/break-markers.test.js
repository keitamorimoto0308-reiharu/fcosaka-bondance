/**
 * わざと壊す検査の「目印」が、**狙った場所にだけ当たるか。**
 *
 * ■ なぜ要るか（2026-09-10、けいた指摘「そういうエラーが多すぎる」）
 *   `swap()` は**最初の1件しか置き換えない**。目印が複数の場所に現れると、
 *   **狙いと違う場所を壊す**。しかも壊れてはいるので検査は落ち、
 *   期待文言を雑に合わせれば `[OK]` になってしまう。
 *   **まったく別の守りを検査している状態に、誰も気づけない。**
 *
 *   引き継ぎ書の失敗パターン4。2026-09-10 の1日で**2回**踏んだ：
 *     - `if (!list.length)` が adminBulkStatus_ と adminBulkLoadIn_ の両方にあった
 *     - `var plan = schedImportPlan_(rows, …)` が実行側と下見側の両方にあった
 *
 *   さらに引き継ぎ書は、同じ形の別の失敗も記録している：
 *     - 目印が見つからず「[??] 目印なし」＝**守りが黙って未検査**（パターン1・2・3）
 *
 * ■ この検査がやること
 *   全部の `test/break_*.py` から目印（swap の第2引数）を機械的に取り出し、
 *   対象ファイルに**ちょうど1回だけ**現れることを確かめる。
 *
 *   0回 … 目印なし。その守りは**検査されていない**
 *   2回以上 … **別の場所を壊している可能性がある**
 *
 * ■ 直し方
 *   目印に周りの文脈を足すのではなく、**コード側の書き方を一意にする**。
 *   （変数名を変える、条件の書き方を変える）。
 *   周りを足した目印は、いつか誰かが並べ替えて壊れる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);

/**
 * break_*.py から目印を取り出す。
 *
 * 形： (定数, '探す文字列', '置き換える文字列')
 * Python の文字列リテラルなので、素朴に読むと引用符の中の引用符で崩れる。
 * **崩れたら黙って飛ばさず、数えて報告する**（拾えていないのに緑、が最悪）。
 */
function markersOf(src) {
  const out = [];
  let skipped = 0;

  // ファイル定数（I = 'gas/SchedImport.gs' の形）を集める
  const files = {};
  for (const line of src.split(NL)) {
    const m = /^([A-Z][A-Z0-9_]*)\s*=\s*'([^']+\.(?:gs|js|py))'/.exec(line.trim());
    if (m) files[m[1]] = m[2];
  }

  /*
   * `(対象, '探す', '置き換える')` の塊を探し、2つ目を目印とする。
   *
   * **対象の書き方は2通りある。両方を拾うこと。**
   *   (I, '…')                  … 上で集めた定数
   *   ('gas/Notify.gs', '…')    … パスを直接書く
   * 片方しか拾わないと、**目印を1つも見つけられないのに緑**になる
   * （2026-09-10、実際にそう外れた）。
   */
  const re = /\(\s*(?:([A-Z][A-Z0-9_]*)|'([^']+\.(?:gs|js|py))')\s*,\s*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const file = m[1] ? files[m[1]] : m[2];
    if (!file) continue;
    const rest = src.slice(m.index + m[0].length);
    const lit = readPyString(rest);
    if (lit === null) { skipped++; continue; }
    out.push({ file, marker: lit });
  }
  return { markers: out, skipped };
}

/** Python の文字列リテラルを1つ読む。読めなければ null */
function readPyString(s) {
  const q = s[0];
  if (q !== "'" && q !== '"') return null;
  let v = '', i = 1;
  for (;;) {
    if (i >= s.length) return null;
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      if (n === 'n') v += NL;
      else if (n === 't') v += String.fromCharCode(9);
      else if (n === '\\') v += '\\';
      else if (n === "'") v += "'";
      else if (n === '"') v += '"';
      else v += '\\' + n;
      i += 2;
      continue;
    }
    if (c === q) {
      // 続けて連結（'a'\n  'b'）していれば、そこも読む
      const after = s.slice(i + 1);
      const cont = /^\s*(['"])/.exec(after);
      if (cont) {
        const more = readPyString(after.slice(cont[0].length - 1));
        if (more === null) return v;
        return v + more;
      }
      return v;
    }
    v += c;
    i++;
  }
}

/**
 * **確認済みの重複**（2026-09-10）。
 *
 * ここに載っているものは、`npm run break` が**期待どおりの理由で落ちること**を
 * 確かめたうえで、意図的に許している。1つ目が狙いの場所に当たっている。
 *
 * ⚠ **これは「安全」ではなく「いまは当たっている」という記録。**
 *   関数を並べ替えたり、上に似たコードを足した瞬間に、黙って別の場所を壊し始める。
 *   **その周りを触るときは、まず一意にすること。**
 *
 * ⚠ **新しい重複は、ここに足す前に必ず直すこと。**
 *   足すのは「コードを変えるほうが害になる」と判断できたときだけ。
 */
const KNOWN_DUPLICATES = [
  { file: 'src/mock.js',
    head: 'DB.history.unshift({ at: nowText(), who: auth.person, id: payload.id,',
    why: '模擬の履歴書き込みが2か所（枚数の打ち込みと、応募内容の修正）。'
       + '同じ形で書くのが正しく、変えると読みにくくなる' },

  { file: 'src/build-admin.js',
    head: 'ids: rows.map(function(x){ return x.id; }),',
    why: '選考結果の送信と一斉メールが、同じ形で宛先を組み立てている' },

  { file: 'gas/Notify.gs',
    head: "'ご不明な点がございましたら、本メールへのご返信でお問い合わせください。',",
    why: '**メール本文の同じ一文**（採択と不採択）。'
       + '検査のために文面を変えるのは本末転倒' },

  { file: 'gas/Sched.gs',
    head: "JSON.stringify(full), '', '');",
    why: '削除の履歴を全文で残す処理が、1件削除と一括削除の2か所にある' },

  { file: 'src/build-admin.js',
    head: 'linkifyDetail(r.detail, esc)',
    why: '①制作スケジュールと②タイムスケジュールが**同じ関数を共有**している'
       + '（写しではなく、共有しているのが正しい）' },

  { file: 'src/build-admin.js',
    head: '[hidden]{display:none!important}',
    why: '2つ目はこのCSSに言及している**コメント**。実体は1か所だけ' },
];

function isKnown(file, marker) {
  const head = marker.split(NL)[0].trim();
  return KNOWN_DUPLICATES.some(k => k.file === file && head.indexOf(k.head) === 0);
}

const BREAKS = fs.readdirSync(path.join(ROOT, 'test'))
  .filter(f => /^break_.*\.py$/.test(f) && f !== 'break_all.py')
  .sort();

describe('壊す検査の目印が、狙った場所にだけ当たるか', () => {

  test('壊し検査のファイルが見つかる（この検査が空振りしていないこと）', () => {
    assert.ok(BREAKS.length >= 15,
      '壊し検査が ' + BREAKS.length + ' 本しか見つかりません。拾い方が壊れています');
  });

  for (const name of BREAKS) {
    test(name + ' の目印は、それぞれ1か所だけを指している', () => {
      const src = fs.readFileSync(path.join(ROOT, 'test', name), 'utf8')
        .split('\r\n').join(NL);
      const { markers, skipped } = markersOf(src);

      assert.ok(markers.length > 0,
        name + ' から目印を1つも拾えていません（拾い方が壊れています）');

      const cache = {};
      const none = [], many = [];
      for (const { file, marker } of markers) {
        const p = path.join(ROOT, file);
        if (!fs.existsSync(p)) continue;          // 対象が消えていれば、別の検査の仕事
        if (!(file in cache)) {
          cache[file] = fs.readFileSync(p, 'utf8').split('\r\n').join(NL);
        }
        const n = cache[file].split(marker).length - 1;
        const head = marker.split(NL)[0].trim().slice(0, 70);
        if (n === 0) none.push(file + ' … ' + head);
        else if (n > 1 && !isKnown(file, marker)) {
          many.push(file + ' … ' + n + 'か所 … ' + head);
        }
      }

      assert.deepStrictEqual(none, [],
        NL + '【目印が見つからない】その守りは**検査されていません**（[??] 目印なし）：'
        + NL + none.join(NL));

      assert.deepStrictEqual(many, [],
        NL + '【目印が複数の場所にある】swap は最初の1件しか置き換えないので、'
        + '**狙いと違う場所を壊している可能性があります**：' + NL + many.join(NL)
        + NL + '→ 目印に周りを足すのではなく、**コード側の書き方を一意に**してください'
        + '（変数名を変える等）。'
        + (skipped ? NL + '（読み取れなかった目印が ' + skipped + ' 件あります）' : ''));
    });
  }
});
