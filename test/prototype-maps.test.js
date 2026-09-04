/**
 * 「一覧にあるものだけ通す」という関門が、prototype 経由で開いていないか。
 *
 * ■ 何が起きるか
 *   JavaScript の素の `{}` は、`constructor` `toString` `hasOwnProperty`
 *   `valueOf` `__proto__` などを**必ず持っている**（prototype から）。
 *   だから
 *       var allowed = {};
 *       allowed['staffCount'] = ...;
 *       if (!allowed[key]) 断る;
 *   と書くと、key に 'constructor' を入れるだけで **`if` を素通りする**。
 *   一覧に入れた覚えのない名前が「実在する項目」として扱われる。
 *
 * ■ このプロジェクトで実際に起きたところ
 *   ・アップロードの種別（UPLOAD_ALLOWED[mime]）
 *   ・応募内容の修正の許可リスト（adminApplicantUpdate_）
 *   ・枚数の打ち込みの許可リスト（adminConfirmSave_）
 *   ・通知の種類（NOTIFY_KINDS[kind]／模擬の MAIL_KINDS）
 *   直したあとも、**新しく書く人が素の {} を使えば、また開く**。
 *   だから1件ずつではなく、**書き方そのもの**を見る。
 *
 * ■ 直し方
 *   Object.create(null) は prototype を持たないので、この道が消える。
 *   すでに値が入った形で作りたいときは
 *   Object.assign(Object.create(null), { ... }) にする。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/** 外から来た文字列で索引する（＝関門になっている）入れ物の名前 */
const GUARD_MAPS = [
  ['gas/Drive.gs',   'UPLOAD_ALLOWED'],
  ['gas/Admin.gs',   'AGGREGATE_CONFIRM_STATUS_'],
  ['gas/Notify.gs',  'NOTIFY_KINDS'],
  ['src/mock.js',    'MAIL_KINDS'],
  ['src/mock.js',    'MOCK_ALLOWED'],
];

describe('外から来た文字列で引く入れ物に、prototype が付いていないこと', () => {
  GUARD_MAPS.forEach(([file, name]) => {
    test(file + ' の ' + name, () => {
      const src = read(file);
      const at = src.search(new RegExp('(var|const|let)\\s+' + name + '\\s*='));
      assert.ok(at >= 0, name + ' が ' + file + ' に見つかりません');
      const decl = src.slice(at, at + 200);
      assert.ok(/Object\.create\(null\)/.test(decl),
        name + ' が素の {} です。'
        + "外から 'constructor' を渡すだけで、この関門を抜けられます：\n"
        + decl.split(String.fromCharCode(10)).slice(0, 2).join(' '));
    });
  });

  test('許可リストを組み立てる場所も、素の {} で始めていない', () => {
    // `var allowed = {};` のあとに `allowed[なにか] = ...` と積む形が、
    // このプロジェクトで実際に3回書かれた
    const files = ['gas/Admin.gs', 'gas/Confirm.gs', 'gas/Docs.gs', 'gas/Drive.gs',
                   'gas/Notify.gs', 'gas/Rental.gs', 'gas/Upload.gs', 'src/mock.js'];
    const bad = [];
    files.forEach(f => {
      const lines = read(f).split(String.fromCharCode(10));
      lines.forEach((l, i) => {
        const m = l.match(/(?:var|const|let)\s+(allowed|known|roots|seen)\s*=\s*\{\s*\}\s*;/);
        if (m) bad.push(f + ':' + (i + 1) + '  ' + l.trim());
      });
    });
    assert.deepStrictEqual(bad, [],
      '許可リストを素の {} で作っています（Object.create(null) にしてください）：\n'
      + bad.join(String.fromCharCode(10)));
  });
});

describe('実際に prototype の名前を投げて、抜けられないこと', () => {
  function fresh() {
    const p = require.resolve('../src/mock.js');
    delete require.cache[p];
    return require(p);
  }
  function login(M) {
    return M.handle({ action: 'adminLogin', password: 'admin', person: '山田 太郎' }).token;
  }
  const NAMES = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'];

  test('枚数の打ち込みの許可リストを抜けられない', () => {
    const M = fresh();
    const tok = login(M);
    const id = M.DB.rows.filter(r => r['ステータス'] === '採択')[0]['受付ID'];
    NAMES.forEach(k => {
      const r = M.handle({ action: 'adminConfirmSave', token: tok, id,
                           values: { [k]: '1' } });
      assert.strictEqual(r.ok, false, '「' + k + '」が許可リストを抜けました');
      assert.strictEqual(r.error, 'forbidden_field',
        '「' + k + '」の断り方が違います：' + JSON.stringify(r));
    });
  });

  test('通知の種類に prototype の名前を渡しても、動き出さない', () => {
    const M = fresh();
    const tok = login(M);
    NAMES.forEach(k => {
      const r = M.handle({ action: 'adminNotifyPreview', token: tok, kind: k });
      assert.strictEqual(r.ok, false, '「' + k + '」が種類として通りました');
      assert.strictEqual(r.error, 'bad_request',
        '「' + k + '」の断り方が違います：' + JSON.stringify(r));
    });
  });

  test('送信でも同じ（下見だけ厳しくても意味がない）', () => {
    const M = fresh();
    const tok = login(M);
    NAMES.forEach(k => {
      const r = M.handle({ action: 'adminNotifySend', token: tok, confirm: true,
                           kind: k, ids: [] });
      assert.strictEqual(r.ok, false, '「' + k + '」で送信が動き出しました');
    });
  });
});
