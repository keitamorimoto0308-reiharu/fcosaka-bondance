/**
 * 設定シートの1行を読み書きする道具と、「最後に誰がいつ」（`gas/Stamp.gs`）。
 *
 * ■ なぜ①と②で共有するか
 *   ②が `タイムスケジュール最終更新` を持ち、①が `制作スケジュール最終編集`ほか3つを持つ。
 *   同じことを2か所に書くと、片方だけ直したときに気づけない。
 *
 * ■ **設定の読み取りキャッシュを通してはいけない**
 *   `getConfig()` は1回の実行内でキャッシュする（gas/Config.gs）。
 *   版番号やスタンプは実行中に変わるので、キャッシュ越しに読むと
 *   **書いた直後に古い値が返る**。②のぶつかりの検出は、それだと丸ごと壊れる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeSheet, makeUtilities, cutFunction } = require('./_gasbox');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const CONFIG_HEADERS = ['項目', '値', '説明'];

/**
 * gas/Stamp.gs を、代役つきの箱で走らせる。
 *
 * @param {Array} rows 設定シートの既存行（[キー, 値] の配列）
 */
function makeBox(rows) {
  const admin = read('gas/Admin.gs');
  const setup = read('gas/Setup.gs');
  const src = read('gas/Stamp.gs');

  const configRows = (rows || []).map(r => [r[0], r[1], '']);
  const sheets = { '設定': makeSheet(CONFIG_HEADERS, configRows) };

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Date,
    console: { error() {}, log() {} },
    Utilities: makeUtilities(),
    SHEET: { CONFIG: '設定' },
    sheet_: name => sheets[name],
    /*
     * **キャッシュを通していないことを、ここで確かめる。**
     * `getConfig` を呼んだら例外になるようにしておく。
     * 通していたら、テストが「getConfig を通しています」で落ちる。
     */
    getConfig: () => { throw new Error('getConfig を通しています（キャッシュ越しに読んでいます）'); },
    configText: () => { throw new Error('configText を通しています（キャッシュ越しに読んでいます）'); },
  });

  vm.runInContext([
    cutFunction(admin, 'asText_'),
    cutFunction(admin, 'safeCellText_'),
    cutFunction(setup, 'findConfigRow_'),
  ].join(String.fromCharCode(10)), box);

  vm.runInContext(src, box);
  return { box, sheets };
}

function call(b, expr) {
  return JSON.parse(JSON.stringify(vm.runInContext(expr, b.box)));
}

describe('設定シートの1行（gas/Stamp.gs）', () => {

  test('書いた値が、そのまま読める', () => {
    const b = makeBox([['ある項目', '12']]);
    assert.strictEqual(call(b, "configRaw_('ある項目')"), '12');
  });

  test('無いキーは空で返る（例外にしない）', () => {
    assert.strictEqual(call(makeBox([]), "configRaw_('無い項目')"), '');
  });

  test('行が無ければ、足して書く', () => {
    const b = makeBox([]);
    vm.runInContext("setConfigValue_('新しい項目', 7)", b.box);
    assert.strictEqual(call(b, "configRaw_('新しい項目')"), 7);
    // 人が設定シートを開いたときに、何なのか分かる説明を添える
    const grid = b.sheets['設定'].grid;
    assert.ok(String(grid[1][2]).indexOf('手で変えないでください') >= 0,
      '説明が添えられていません: ' + grid[1][2]);
  });

  test('既にある行は、足さずに書き換える', () => {
    const b = makeBox([['ある項目', '1']]);
    vm.runInContext("setConfigValue_('ある項目', 2)", b.box);
    assert.strictEqual(b.sheets['設定'].grid.length, 2, '行が増えています');
    assert.strictEqual(call(b, "configRaw_('ある項目')"), 2);
  });

  test('設定の読み取りキャッシュを通さない', () => {
    // getConfig を通していたら、箱の中で例外になる
    const b = makeBox([['ある項目', '1']]);
    assert.doesNotThrow(() => call(b, "configRaw_('ある項目')"));
  });
});

describe('最後に誰がいつ（gas/Stamp.gs）', () => {

  test('書いた人と時刻が読める', () => {
    const b = makeBox([]);
    vm.runInContext("lastActionSet_('制作スケジュール最終編集', '小谷', 1757222520000)", b.box);
    assert.deepStrictEqual(call(b, "lastActionGet_('制作スケジュール最終編集')"),
      { person: '小谷', at: 1757222520000 });
  });

  test('まだ記録が無ければ、空で返る（画面はこれを見て何も出さない）', () => {
    assert.deepStrictEqual(call(makeBox([]), "lastActionGet_('まだ無い')"),
      { person: '', at: 0 });
  });

  test('= で始まる氏名でも、読むときに ' + "'" + ' が付かない', () => {
    // 書くときに safeCellText_ を通すので、セルには '=山田 が入る。
    // そのまま帯に出すと「'山田さんが変更しています」になる
    const b = makeBox([]);
    vm.runInContext("lastActionSet_('あるキー', '=山田', 1000)", b.box);
    assert.strictEqual(call(b, "lastActionGet_('あるキー')").person, '=山田');
  });

  test('名前に | が入っていても、時刻を読み違えない', () => {
    // 中身は 名前|時刻 の形。名前に | があると、素朴に split すると壊れる
    const b = makeBox([]);
    vm.runInContext("lastActionSet_('あるキー', 'A|B', 1234)", b.box);
    assert.deepStrictEqual(call(b, "lastActionGet_('あるキー')"),
      { person: 'A|B', at: 1234 });
  });

  test('壊れた値でも、読み出しは止まらない', () => {
    const b = makeBox([['あるキー', 'こわれた']]);
    assert.deepStrictEqual(call(b, "lastActionGet_('あるキー')"),
      { person: '', at: 0 });
  });
});
