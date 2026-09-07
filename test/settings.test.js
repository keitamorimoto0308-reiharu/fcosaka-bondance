/**
 * 設定タブを、実際に走らせて確かめるテスト。
 *
 * ■ 守りたいこと
 *   1) **いま入っているパスワードを返さない。**
 *      返してしまうと、一般パスワードで入れた人が管理者パスワードを読める。
 *   2) **変更履歴にパスワードを書かない。** 履歴は一般も見られる。
 *   3) **締切が壊れると応募が止まる。**
 *      `isClosed()` は締切を読めないとき「締切済み」に倒す（安全側）ので、
 *      書式を間違えた瞬間から誰も応募できなくなる。保存の前に必ず確かめる。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, 'gas', f), 'utf8')
  .split('\r\n').join('\n');

let CONFIG, WRITES, HISTORY, SPACES;

function load() {
  WRITES = []; HISTORY = [];
  CONFIG = {
    '締切日時': '2026-09-30 18:00',
    '区画総数': '50',
    '目標出店社数': '',
    '要対応_経過日数': '3',
    '担当社員への結果通知': 'ON',
    '問い合わせメール': 'a@example.com',
    // 本番の設定シートにある行は、代役にも置く。
    // 行が無いと「書き込めなかった」のか「断られた」のか見分けられない
    'テストデータの削除': 'OFF',
    '事務局の連絡先': '事務局（a@example.com）',
    '管理者パスワード': 'admin-password-0123456789',
    '一般パスワード': 'staff-password-0123456789',
  };
  const keys = Object.keys(CONFIG);

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, Boolean, Date, isFinite,
    MIN_PASSWORD_LEN: 16,
    LOCK_WAIT_MS: 1000,
    REASON_MAX: 500,
    SHEET: { CONFIG: '設定', SPACES: '区画' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} },
    configText: (k, fb) => (k in CONFIG ? String(CONFIG[k]) : (fb || '')),
    sheet_: (name) => {
      if (name === '区画') {
        return { getDataRange: () => ({ getValues: () => SPACES }) };
      }
      return {
        getRange: (row, col) => ({
          getValue: () => CONFIG[keys[row - 2]],
          setValue: v => {
            WRITES.push({ key: keys[row - 2], value: v });
            CONFIG[keys[row - 2]] = v;
          },
        }),
      };
    },
    findConfigRow_: (sh, key) => {
      const i = keys.indexOf(key);
      return i < 0 ? 0 : i + 2;
    },
    safeCellText_: v => String(v == null ? '' : v),
    recordHistory_: (person, id, changed) => {
      changed.forEach(c => HISTORY.push({ person, id, ...c }));
      return '';
    },
    console,
  });
  box.globalThis = box;

  const src = read('Admin.gs');
  // safeCellText_ も要る（設定の text をシートに書く前に通す）
  for (const marker of ['function safeCellText_', 'var SETTING_KEYS_', 'var PASSWORD_KEYS_',
                        'function adminSettings_', 'function checkSetting_',
                        'function adminSettingsSave_']) {
    const start = src.indexOf(marker);
    assert.ok(start >= 0, 'gas/Admin.gs に ' + marker + ' がありません');
    const end = marker.indexOf('var ') === 0
      ? src.indexOf('];', start) + 3
      : src.indexOf('\n}\n', start) + 3;
    // 数の読み取りは gas/Num.gs にまとめてある（2026-09-04）。
    // これを読まないと numAmount_ / numCount_ が未定義で落ちる
    vm.runInContext(read('Num.gs'), box);
    vm.runInContext(src.slice(start, end), box);
  }
  return box;
}

const ME = { person: '山田 太郎', role: '管理者' };
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));

beforeEach(() => {
  SPACES = [['区画番号', 'X', 'Y', '割当受付ID'], [1, 0, 0, ''], [20, 0, 0, 'SB-0003']];
});

describe('設定：パスワードを外に出さない', () => {

  test('いま入っているパスワードを返さない', () => {
    const A = load();
    const r = plain(A.adminSettings_(ME));
    const json = JSON.stringify(r);
    assert.ok(!json.includes('admin-password-0123456789'),
      '管理者パスワードが返っています');
    assert.ok(!json.includes('staff-password-0123456789'),
      '一般パスワードが返っています');
  });

  test('設定済みかどうかと、短すぎないかだけを返す', () => {
    const A = load();
    const r = plain(A.adminSettings_(ME));
    const admin = r.passwords.filter(p => p.key === '管理者パスワード')[0];
    assert.strictEqual(admin.set, true);
    assert.strictEqual(admin.weak, false);

    CONFIG['一般パスワード'] = 'みじかい';
    const r2 = plain(A.adminSettings_(ME));
    const user = r2.passwords.filter(p => p.key === '一般パスワード')[0];
    assert.strictEqual(user.weak, true, '短いパスワードを見逃しています');
  });

  test('変更履歴にパスワードの値を書かない', () => {
    // 履歴は一般も見られる。値を残すと、そこから読めてしまう
    const A = load();
    A.adminSettingsSave_(ME, { values: {}, passwords: { '管理者パスワード': 'new-password-0123456789' } });
    const json = JSON.stringify(HISTORY);
    assert.ok(!json.includes('new-password-0123456789'),
      '変更履歴にパスワードが残っています');
    assert.ok(json.includes('変更しました'), '変更したことすら残っていません');
  });

  test('短いパスワードは受け付けない', () => {
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: {}, passwords: { '一般パスワード': 'みじかい' } }));
    assert.strictEqual(r.error, 'weak_password');
    assert.strictEqual(WRITES.length, 0, '断ったのに書き込んでいます');
  });

  test('空欄は「変えない」の意味', () => {
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: {}, passwords: { '管理者パスワード': '' } }));
    assert.strictEqual(r.changed, 0);
    assert.strictEqual(WRITES.length, 0, '空欄でパスワードを消しています');
  });

  test('パスワードを変えたら、入り直しが要ることを伝える', () => {
    const A = load();
    const r = plain(A.adminSettingsSave_(ME,
      { values: {}, passwords: { '管理者パスワード': 'new-password-0123456789' } }));
    assert.strictEqual(r.passwordChanged, true,
      'パスワードを変えたのに、入り直しが要ることを伝えていません');
  });
});

describe('設定：締切が壊れると応募が止まる', () => {

  test('読み取れない書き方は保存しない', () => {
    // isClosed() は締切を読めないとき「締切済み」に倒す。
    // つまり書式を間違えた瞬間から、誰も応募できなくなる
    const A = load();
    for (const bad of ['9/30 18時', '来週の火曜', '', '2026-09-30']) {
      const r = plain(A.adminSettingsSave_(ME, { values: { '締切日時': bad } }));
      assert.strictEqual(r.error, 'bad_value', '通ってしまった値: ' + JSON.stringify(bad));
    }
    assert.strictEqual(WRITES.length, 0, '断ったのに書き込んでいます');
  });

  test('正しい書き方は、形をそろえて保存する', () => {
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: { '締切日時': '2026/10/1 9:05' } }));
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(WRITES[0].value, '2026-10-01 09:05', '形がそろっていません');
  });

  test('ありえない日時は弾く', () => {
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: { '締切日時': '2026-13-40 99:99' } }));
    assert.strictEqual(r.error, 'bad_value');
  });
});

describe('設定：数と選択肢', () => {

  test('区画の総数を、割り当て済みより小さくしない', () => {
    // 20番が割り当て済みなのに総数を10にすると、その割当が消える
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: { '区画総数': '10' } }));
    // 落ちたときの文は、この検査だけのものにする
    // （test/break_settings.py がどの歯止めか見分けるため）
    assert.strictEqual(r.error, 'bad_value',
      '割り当て済みより小さい総数が通りました');
    assert.ok(/20/.test(r.message), '何番が消えるのかを伝えていません');
    assert.strictEqual(WRITES.length, 0);
  });

  test('割り当て済みより大きければ通る', () => {
    const A = load();
    assert.strictEqual(plain(A.adminSettingsSave_(ME, { values: { '区画総数': '60' } })).ok, true);
  });

  test('整数でない値・範囲外を弾く', () => {
    const A = load();
    for (const bad of ['あ', '1.5', '0', '9999']) {
      assert.strictEqual(
        plain(A.adminSettingsSave_(ME, { values: { '要対応_経過日数': bad } })).error,
        'bad_value', '通ってしまった値: ' + bad);
    }
  });

  test('目標社数だけは空欄でよい', () => {
    const A = load();
    assert.strictEqual(plain(A.adminSettingsSave_(ME, { values: { '目標出店社数': '' } })).ok, true);
  });

  test('ON / OFF 以外を受け付けない', () => {
    const A = load();
    assert.strictEqual(
      plain(A.adminSettingsSave_(ME, { values: { '担当社員への結果通知': 'はい' } })).error,
      'bad_value');
  });

  test('問い合わせ先の形を見ている', () => {
    const A = load();
    assert.strictEqual(
      plain(A.adminSettingsSave_(ME, { values: { '問い合わせメール': 'こわれた' } })).error,
      'bad_value');
  });
});

describe('設定：一覧に無い項目は触らせない', () => {

  test('知らないキーを送っても書き込まない', () => {
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: { '管理者パスワード': 'x' } }));
    assert.strictEqual(r.error, 'forbidden_field',
      'values 経由でパスワードを書けてしまいます');
    assert.strictEqual(WRITES.length, 0);
  });

  test('1つでも通らなければ、1件も書かない', () => {
    // 途中まで書いて止まると、設定が中途半端な状態になる
    const A = load();
    const r = plain(A.adminSettingsSave_(ME,
      { values: { '区画総数': '60', '要対応_経過日数': 'あ' } }));
    assert.strictEqual(r.error, 'bad_value');
    assert.strictEqual(WRITES.length, 0, '一部だけ書き込んでいます');
  });

  test('管理者だけが呼べる操作として登録されている', () => {
    const src = read('Admin.gs');
    const m = src.match(/var adminOnly = \[([^\]]*)\]/);
    assert.ok(m, 'adminOnly の定義が見つかりません');
    assert.ok(m[1].includes('adminSettings'), '設定の閲覧が管理者限定になっていません');
    assert.ok(m[1].includes('adminSettingsSave'), '設定の保存が管理者限定になっていません');
  });
});

/*
 * 2026-09-07 けいた報告：
 * 「テストデータの一括削除を許可のボタンをONにして保存しても
 *   不明な項目ですと出て保存されません」
 *
 * 原因は、`checkSetting_` に **text 型の分岐が無かった**こと。
 * 画面は全項目をまとめて送るので、text の項目が1つ混ざっているだけで
 * **どの設定も1件も保存できない**。「テストデータの削除」は巻き添えだった。
 */
describe('設定：全部の型を保存できる', () => {

  test('SETTING_KEYS_ の型は、全部 checkSetting_ が扱える', () => {
    /*
     * ここが本体。項目を足すときに型を新しくすると、
     * **その項目だけでなく、設定タブ全体が保存できなくなる。**
     * 型の一覧どうしを突き合わせる。
     */
    const A = load();
    const kinds = [...new Set(A.SETTING_KEYS_.map(d => d.type))];
    const bad = kinds.filter(t => {
      const r = A.checkSetting_({ key: 'x', label: 'x', type: t, allowBlank: true }, 'あ');
      return r && r.message === '不明な項目です。';
    });
    assert.deepStrictEqual(bad, [],
      'checkSetting_ が扱えない型があります: ' + bad.join(', ')
      + '（この型の項目が1つあるだけで、設定タブ全体が保存できなくなります）');
  });

  test('事務局の連絡先（text）を保存できる', () => {
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: {
      '事務局の連絡先': '実行委員会事務局（森本啓太／a@example.com）' } }));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    // 書き込みは WRITES に積まれる（この検査の代役シートの作り）
    assert.strictEqual(WRITES.length, 1, '書き込んでいません');
    assert.strictEqual(WRITES[0].value,
      '実行委員会事務局（森本啓太／a@example.com）');
  });

  test('text の項目が混ざっていても、ON/OFF が保存できる', () => {
    // けいたが実際に踏んだ形。画面は全項目をまとめて送る
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: {
      'テストデータの削除': 'ON',
      '事務局の連絡先': '事務局（a@example.com）' } }));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const on = WRITES.filter(w => w.value === 'ON');
    assert.strictEqual(on.length, 1, 'ON にできていません（巻き添えで断られています）');
  });

  test('1つでも通らなければ、1件も書かない', () => {
    /*
     * 通ったものだけ書く形にすると、**一部だけ保存された**状態が生まれる。
     * 画面は全項目をまとめて送るので、どれが書かれたのか人には分からない。
     */
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: {
      '区画総数': '60',            // これは通る
      '締切日時': 'こわれた書き方' } }));   // これは通らない
    assert.strictEqual(WRITES.length, 0,
      '通らない項目が混ざっているのに、書き込んでいます');
    assert.strictEqual(r.ok, false);
  });

  test('text も、長すぎるものは断る', () => {
    const A = load();
    const r = plain(A.adminSettingsSave_(ME, { values: {
      '事務局の連絡先': 'あ'.repeat(400) } }));
    assert.strictEqual(r.ok, false, '長すぎるものが通りました');
    assert.match(r.message, /長すぎます/);
  });

  test('text は、数式として解釈される形を持ち込ませない', () => {
    // 設定はシートのセルに書かれる。= で始まると数式になる
    const A = load();
    A.adminSettingsSave_(ME, { values: { '事務局の連絡先': '=1+1' } });
    assert.ok(WRITES.length === 0 || String(WRITES[0].value).indexOf('=') !== 0,
      'シートに数式として書き込まれます');
  });
});
