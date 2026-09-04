/**
 * 関係者の登録・変更を、実際に走らせて確かめるテスト。
 *
 * ■ なぜ要るか
 *   ここでの事故は「起きてから直す」ができない種類のものが混じる。
 *   最後の管理者が自分の権限を外すと、管理ページからは誰も設定に触れなくなる。
 *   スプレッドシートを直接開けば復旧できるが、それは
 *   「管理ページで完結させたい」という前提を壊す。
 *
 * ■ どうやって走らせるか
 *   gas/Admin.gs の関係者まわりの関数を、Nodeの変数が見えない箱に読み込む。
 *   シートの読み書きは差し替え可能な代役に置き換え、
 *   「何を書こうとしたか」を記録して確かめる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
/** 改行コードを揃えて読む。CRLF のままだと目印が見つからず切り出しに失敗する */
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/**
 * 関係者まわりの関数だけを切り出して動かす。
 * @param people いま登録されている人たち
 */
function load(people) {
  const written = [];
  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, Boolean,
    LOCK_WAIT_MS: 1000,
    SHEET: { PEOPLE: '関係者' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    getPeople: () => people.map(p => Object.assign({}, p)),
    sheet_: () => ({
      getLastRow: () => people.length + 1,
      // 箱の中で作られた配列は Node の配列と別物なので、素の値に写してから記録する
      getRange: (row) => ({ setValues: (vals) =>
        written.push({ row, values: JSON.parse(JSON.stringify(vals[0])) }) }),
    }),
    // 数式インジェクション対策の代役（本物と同じ形だけ用意する）
    safeCellText_: (v) => String(v == null ? '' : v),
  });

  const src = read('gas/Admin.gs');
  ['var PEOPLE_HEADERS_', 'function normalizePerson_', 'function adminPeople_',
   'function adminPeopleSave_'].forEach(marker => {
    const start = src.indexOf(marker);
    assert.ok(start >= 0, 'gas/Admin.gs に ' + marker + ' が見つかりません');
    const end = marker.indexOf('var ') === 0
      ? src.indexOf('\n', start) + 1
      : src.indexOf('\n}\n', start) + 3;
    assert.ok(end > start, marker + ' の終わりが見つかりません');
    vm.runInContext(src.slice(start, end), box);
  });

  return {
    save: (auth, payload) =>
      JSON.parse(JSON.stringify(vm.runInContext('adminPeopleSave_', box)(auth, payload))),
    list: (auth) =>
      JSON.parse(JSON.stringify(vm.runInContext('adminPeople_', box)(auth))),
    written,
  };
}

const admin = { name: '山田 太郎', org: 'FC大阪', dept: '事業推進部', email: 'yamada@example.com',
                formVisible: true, canLogin: true, role: '管理者', notify: true, row: 2 };
const staff = { name: '鈴木 花子', org: 'FC大阪', dept: '営業部', email: 'suzuki@example.com',
                formVisible: true, canLogin: true, role: '一般', notify: false, row: 3 };

const ME = { person: '山田 太郎', role: '管理者' };
const person = over => Object.assign({
  name: '佐藤 次郎', org: 'FC大阪', dept: '営業部', email: 'sato@example.com',
  formVisible: true, canLogin: false, role: '一般', notify: false,
}, over || {});

describe('関係者の登録（管理ページから）', () => {

  test('新しい方を追加できる', () => {
    const L = load([admin, staff]);
    const r = L.save(ME, { person: person() });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.added, true);
    assert.strictEqual(L.written.length, 1);
    assert.deepStrictEqual(L.written[0].values,
      ['佐藤 次郎', 'FC大阪', '営業部', 'sato@example.com', '有効', '無', '一般', 'OFF']);
  });

  test('既にいる方を書き換えられる', () => {
    const L = load([admin, staff]);
    const r = L.save(ME, { row: 3, person: person({ name: '鈴木 花子', dept: '事業推進部' }) });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.added, false);
    assert.strictEqual(L.written[0].row, 3);
  });

  test('同じ氏名は二重に登録できない', () => {
    // 担当社員のプルダウンは「氏名 - 部署」で表示する。
    // 同姓同名がいると、応募者はどちらを選んだのか区別できない。
    const L = load([admin, staff]);
    const r = L.save(ME, { person: person({ name: '鈴木 花子' }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'duplicate');
  });

  test('氏名が空なら受け付けない', () => {
    const L = load([admin, staff]);
    assert.strictEqual(L.save(ME, { person: person({ name: '  ' }) }).ok, false);
  });

  test('メールアドレスの形を見ている', () => {
    const L = load([admin, staff]);
    assert.strictEqual(L.save(ME, { person: person({ email: 'こわれた' }) }).ok, false);
  });

  test('管理ページを使う方には、メールアドレスを必須にする', () => {
    // 通知も本人確認も、届け先が無いと成立しない
    const L = load([admin, staff]);
    const r = L.save(ME, { person: person({ canLogin: true, email: '' }) });
    assert.strictEqual(r.ok, false);
    assert.ok(/メールアドレス/.test(r.message));
  });
});

describe('締め出しを作らない歯止め', () => {

  test('自分の管理者権限は外せない', () => {
    const L = load([admin, staff]);
    const r = L.save(ME, { row: 2, person: person({ name: '山田 太郎', canLogin: true, role: '一般' }) });
    assert.strictEqual(r.ok, false, '自分を降格できてしまいました');
    assert.strictEqual(r.error, 'lockout');
    assert.strictEqual(L.written.length, 0, '弾いたはずなのにシートへ書いています');
  });

  test('自分の管理ページ利用は止められない', () => {
    const L = load([admin, staff]);
    const r = L.save(ME, { row: 2, person: person({ name: '山田 太郎', canLogin: false, role: '管理者' }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'lockout');
  });

  test('管理者が0人になる変更は通さない', () => {
    // 管理者がその人ひとりの状態で、その人を一般に落とそうとする場面
    const only = Object.assign({}, admin, { name: '別の 管理者', row: 4 });
    const L = load([only]);
    const r = L.save({ person: '第三者', role: '管理者' },
                     { row: 4, person: person({ name: '別の 管理者', canLogin: true, role: '一般' }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'lockout');
  });

  test('管理者が2人いれば、片方は一般に落とせる', () => {
    const other = Object.assign({}, admin, { name: '別の 管理者', row: 4 });
    const L = load([admin, other]);
    const r = L.save(ME, { row: 4, person: person({ name: '別の 管理者', canLogin: true, role: '一般' }) });
    assert.strictEqual(r.ok, true, r.message);
  });

  test('退職者は行を消さず、無効にして残す', () => {
    // 過去の応募が持つ担当社員名の行き先を失わないため
    const L = load([admin, staff]);
    const r = L.save(ME, { row: 3,
      person: person({ name: '鈴木 花子', formVisible: false, canLogin: false }) });
    assert.strictEqual(r.ok, true, r.message);
    assert.deepStrictEqual(L.written[0].values.slice(4, 6), ['無効', '無']);
  });
});

describe('関係者の一覧は管理者だけ', () => {

  test('管理者だけが呼べる操作として登録されている', () => {
    // 一覧にはメールアドレスが含まれる。一般が見てよいものではない。
    const src = read('gas/Admin.gs');
    const m = src.match(/var adminOnly = \[([^\]]*)\]/);
    assert.ok(m, 'adminOnly の定義が見つかりません');
    assert.ok(m[1].includes('adminPeople'), '関係者の閲覧が管理者限定になっていません');
    assert.ok(m[1].includes('adminPeopleSave'), '関係者の保存が管理者限定になっていません');
  });
});
