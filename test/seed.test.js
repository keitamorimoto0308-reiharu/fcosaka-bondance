/**
 * デモ用テストデータの投入（`gas/Seed.gs`）。
 *
 * ■ ここで確かめたいこと
 *   - **行の組み立てを写していない**（本番の appendApplication を通る）
 *   - **消せる状態でしか入らない**（設定のスイッチがONのときだけ）
 *   - **本物の応募が1件でもあれば断る**（混ざると見分けられない）
 *   - メールを送らない
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeSheet } = require('./_gasbox');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const LEDGER_HEADERS = ['受付ID', '企業名', '担当者氏名'];

function makeBox(opts) {
  opts = opts || {};
  const sheets = {
    '出店者': makeSheet(LEDGER_HEADERS, opts.rows || []),
  };
  const appended = [];
  const mailed = [];

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Boolean, Date,
    console: { log() {}, error() {} },
    SHEET: { LEDGER: '出店者' },
    sheet_: name => sheets[name],
    /*
     * **本物と同じ形にする。**
     * getConfig は引数を取らない（設定全部を返す）。
     * ここを `k => cfg[k]` という別の形にしていたので、
     * 本番では常にOFFと判定されるのに、検査だけが通っていた
     * （2026-09-07、けいたが「ONにしているのに入れられない」と報告）。
     */
    getConfig: () => (opts.config || {}),
    configBool: k => String((opts.config || {})[k] || '').toUpperCase() === 'ON',
    PURGE_SWITCH: 'テストデータの削除',
    asText_: v => (v == null ? '' : String(v)),
    // **本物の appendApplication の代役。**呼ばれたことと、渡された中身を見る
    appendApplication: (values, submissionId) => {
      appended.push({ values, submissionId });
      return { receiptId: 'SB-' + ('000' + appended.length).slice(-4) };
    },
    // 呼ばれたら検査が落ちる。テストデータ投入でメールは送らない
    MailApp: { sendEmail: () => { mailed.push(1); } },
    sendMail_: () => { mailed.push(1); },
  });

  vm.runInContext(read('gas/Seed.gs'), box);
  return { box, sheets, appended, mailed };
}

/** 落ちた理由を取り出す（落ちなければ空文字） */
const grab = fn => { try { fn(); return ''; } catch (e) { return (e && e.message) || String(e); } };

const run = (b, n) => {
  b.box.__n = n;
  return vm.runInContext('seedTestData(__n)', b.box);
};

describe('テストデータの投入', () => {

  test('スイッチがOFFなら、1件も入れない', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'OFF' } });
    /*
     * **見分けのつく文を、最初に落ちる判定に置く。**
     * assert.throws を先に書くと、断らなかったときは
     * 「例外が出ませんでした」で落ちるので、
     * test/break_purge.py がどの歯止めか見分けられない。
     */
    const threw = grab(() => run(b));
    assert.strictEqual(b.appended.length, 0, 'OFFなのに入れました');
    assert.match(String(threw), /テストデータの一括削除を許可/, '断っていません');
  });

  test('スイッチが空でも、入れない（未設定を「入れてよい」と読まない）', () => {
    const b = makeBox({ config: {} });
    assert.throws(() => run(b), /ONにしてから/);
    assert.strictEqual(b.appended.length, 0);
  });

  test('ONなら入る。件数を指定できる', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    const r = run(b, 3);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.added, 3, JSON.stringify(r));
    assert.strictEqual(b.appended.length, 3);
    // vm の中で作られた配列は別の realm のものなので、値にして比べる
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.receiptIds)),
                           ['SB-0001', 'SB-0002', 'SB-0003']);
  });

  test('件数を省くと、用意されている分をすべて入れる', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    const r = run(b);
    assert.ok(r.added >= 5, 'デモに足りる件数がありません：' + r.added);
    assert.strictEqual(b.appended.length, r.added);
  });

  test('行の組み立ては写さず、本番の appendApplication を通す', () => {
    /*
     * ここで行を自分で組むと、受付IDの採番も重複の検出も生データJSONも
     * 写しになる。「デモでは通ったのに本番で列がずれる」が起きる。
     */
    const src = read('gas/Seed.gs');
    assert.ok(src.indexOf('appendApplication(') >= 0,
      '本番の appendApplication を通っていません');
    ['buildRow_', 'nextReceiptId_', 'appendRow', 'rawJson_'].forEach(name => {
      assert.ok(src.indexOf(name) < 0,
        '行の組み立てを写しています（' + name + '）');
    });
  });

  test('メールは送らない', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    run(b, 2);
    assert.strictEqual(b.mailed.length, 0, 'メールを送ろうとしました');
  });

  test('本物の応募が1件でもあれば、断る', () => {
    /*
     * 混ざると、あとで「どれがテストか」を人が見分けることになる。
     * 一括削除は台帳を丸ごと空にするので、本物まで消える。
     */
    const b = makeBox({ config: { 'テストデータの削除': 'ON' },
                        rows: [['SB-0001', '株式会社ほんもの', '本物 太郎']] });
    const threw = grab(() => run(b));
    assert.strictEqual(b.appended.length, 0, '本物があるのに入れました');
    assert.match(String(threw), /本物の応募が 1 件あります/, '断っていません');
  });

  test('すでに入れたテストデータがあっても、足せる', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' },
                        rows: [['SB-0001', '【テスト】みどり食堂', '試験 太郎']] });
    const r = run(b, 2);
    assert.strictEqual(r.added, 2);
  });

  test('送るのは、実在しない企業と example.com のアドレスだけ', () => {
    // うっかり送信しても外に出ない。電話番号も明らかに嘘と分かる形にする
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    run(b);
    b.appended.forEach(({ values }) => {
      assert.match(values.companyName, /^【テスト】/,
        '企業名がテストと分かりません：' + values.companyName);
      assert.match(values.contactEmail, /@example\.com$/,
        '外に出るアドレスです：' + values.contactEmail);
      assert.match(values.contactPhone, /^000-/,
        '実在しうる電話番号です：' + values.contactPhone);
    });
  });

  test('入れる内容は、フォームの選択肢に実在する値だけ', () => {
    /*
     * ここがずれると、デモの一覧に「選択肢に無い値」が並ぶ。
     * 集計も色分けも効かなくなる。選択肢は gas/Schema.gs から読む。
     */
    const schema = read('gas/Schema.gs');
    const s = schema.indexOf('var FIELDS = [');
    const FIELDS = vm.runInNewContext(
      '(' + schema.slice(s + 13, schema.indexOf('\n];', s) + 2) + ')');
    const opt = key => {
      const f = FIELDS.filter(x => x.key === key)[0];
      return (f && f.options || []).map(o => (typeof o === 'string' ? o : o.value));
    };

    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    run(b);
    b.appended.forEach(({ values }) => {
      (values.boothTypes || []).forEach(v => {
        assert.ok(opt('boothTypes').indexOf(v) >= 0, '出店形態が選択肢にありません：' + v);
      });
      ['foodLicense', 'packaging', 'tableware', 'boothSize', 'power', 'tentChoice']
        .forEach(k => {
          if (!values[k]) return;
          assert.ok(opt(k).indexOf(values[k]) >= 0,
            k + ' が選択肢にありません：' + values[k]);
        });
    });
  });

  test('上限を超える件数は求めても入らない', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    const r = run(b, 999);
    assert.ok(r.added <= 30, '上限を超えました：' + r.added);
  });

  test('件数が読み取れないときは断る', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    assert.throws(() => run(b, 'たくさん'), /件数が読み取れません/);
    assert.strictEqual(b.appended.length, 0);
  });
});

/*
 * 管理ページからの入口（2026-09-07 けいた指示「管理ページにつけて」）。
 *
 * Apps Script の editor を開いて関数を選んで実行、は人に頼めない手順だった。
 * 削除ボタンと同じ場所・同じ鍵で押せるようにする。
 */
describe('管理ページからの投入', () => {

  test('adminSeedTestData_ は、seedTestData を呼ぶだけ', () => {
    // 中身を写すと、editor から実行したときと画面から押したときで
    // 振る舞いが分かれる（この案件が繰り返し避けてきた形）
    const src = read('gas/Seed.gs');
    assert.ok(src.indexOf('function adminSeedTestData_') >= 0,
      '管理ページからの入口がありません');
    const s = src.indexOf('function adminSeedTestData_');
    const f = src.slice(s, src.indexOf('\n}\n', s));
    assert.match(f, /seedTestData\(/, '本体を呼んでいません');
  });

  test('断るときは、例外ではなく理由を返す（画面が読める形）', () => {
    /*
     * editor から実行するときは例外でよい（赤く出る）。
     * 画面から押すときは、`{ ok:false, message }` でないと
     * 「読み取れませんでした」としか出せない。
     */
    const b = makeBox({ config: { 'テストデータの削除': 'OFF' } });
    b.box.__auth = { person: '山田 太郎', role: '管理者' };
    const r = JSON.parse(JSON.stringify(
      vm.runInContext('adminSeedTestData_(__auth, {})', b.box)));
    assert.strictEqual(r.ok, false, 'OFFなのに入れました');
    assert.match(r.message, /テストデータの一括削除を許可/, '理由が読めません');
    assert.strictEqual(b.appended.length, 0);
  });

  test('入れられたら、件数と受付IDを返す', () => {
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    b.box.__auth = { person: '山田 太郎', role: '管理者' };
    const r = JSON.parse(JSON.stringify(
      vm.runInContext('adminSeedTestData_(__auth, { count: 3 })', b.box)));
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.added, 3);
    assert.match(r.message, /3 件/, '何件入ったかを言っていません');
  });

  test('件数が読み取れなくても、例外を投げない', () => {
    // 画面から変な値が来ても、白い画面にしない
    const b = makeBox({ config: { 'テストデータの削除': 'ON' } });
    b.box.__auth = { person: '山田 太郎', role: '管理者' };
    const r = JSON.parse(JSON.stringify(
      vm.runInContext('adminSeedTestData_(__auth, { count: "たくさん" })', b.box)));
    assert.strictEqual(r.ok, false, '読み取れない件数が通りました');
    assert.match(r.message, /件数/);
  });

  test('管理者だけが呼べる（一般権限には出さない）', () => {
    // gas/Admin.gs の adminOnly に入っていること
    const admin = read('gas/Admin.gs');
    const s = admin.indexOf('var adminOnly = [');
    const list = admin.slice(s, admin.indexOf('];', s));
    assert.ok(list.indexOf("'adminSeedTestData'") >= 0,
      'adminSeedTestData が管理者専用になっていません');
  });

  test('入口が登録されている（画面から呼べる）', () => {
    const admin = read('gas/Admin.gs');
    assert.match(admin, /case 'adminSeedTestData':\s*return adminSeedTestData_\(auth, payload\);/,
      '入口が登録されていません（画面から呼んでも届きません）');
  });
});

describe('管理ページの画面（ボタン）', () => {
  const A = read('src/build-admin.js');

  test('入れるボタンがある', () => {
    assert.ok(A.indexOf('id="seedBox"') >= 0, 'テストデータを入れる箱がありません');
    assert.ok(A.indexOf('id="seedRun"') >= 0, '入れるボタンがありません');
  });

  test('削除と同じ鍵で、同時に出し入れする', () => {
    /*
     * 片方だけ出ていると「入れたのに消せない」「消せるのに入れられない」になる。
     * 開け閉ての判断は1か所（loadPurgeBox）にまとめる。
     */
    const s = A.indexOf('function loadPurgeBox()');
    const f = A.slice(s, A.indexOf('\n}\n', s));
    assert.match(f, /\$\('#seedBox'\)\.hidden = !on \|\| S\.role !== '管理者';/,
      '入れる側が、削除と同じ鍵で開け閉めされていません');
  });

  test('押す前に確認する', () => {
    // 本番の台帳に行が入る。「試しに押してみた」で入らないようにする
    const s = A.indexOf('function seedRun()');
    const f = A.slice(s, A.indexOf('\n}\n', s));
    assert.match(f, /if \(!confirm\(/, '押す前に止めていません');
    assert.match(f, /8社/, '何件入るかを言っていません');
  });

  test('入れたあと、一覧を読み直す', () => {
    // 押しただけで何も変わらないように見せない
    const s = A.indexOf('function seedRun()');
    const f = A.slice(s, A.indexOf('\n}\n', s));
    assert.match(f, /loadList\(\);/, '一覧を読み直していません');
  });

  test('赤くしない（取り返しがつくものを、つかない色で出さない）', () => {
    /*
     * 消す側（.purge）は赤い枠。入れる側まで赤くすると、
     * 赤の意味が薄れて、消す側の警告が効かなくなる。
     */
    const flat = A.split(String.fromCharCode(10)).join('');
    assert.match(flat, /\.seed\{[^}]*border:1px solid var\(--border\)/,
      '入れる側が、消す側と同じ見た目になっています');
  });
});

describe('設定の読み方は、削除側とそろえる', () => {

  test('スイッチは configBool で読む（getConfig に引数を渡さない）', () => {
    /*
     * `getConfig()` は**引数を取らない**（設定を全部返す）。
     * `getConfig(PURGE_SWITCH)` と書くと、返るのは設定の入れ物そのもので、
     * どう比べてもONにならない。
     * 2026-09-07、けいたが「ONにしているのに入れられない」と報告。
     * 読む口が2つあると、片方だけ間違える。削除側（gas/Purge.gs）と同じにする。
     */
    /*
     * **コメントを外してから見る。**
     * 直した理由をコメントに書くと、そこに昔の書き方がそのまま残る。
     * 素で探すと「まだ直っていない」と誤って言う（この案件で4度目）。
     */
    const src = read('gas/Seed.gs').split(String.fromCharCode(10))
      .map(l => l.replace(/^\s*\*.*$/, '').replace(/^\s*\/\/.*$/, ''))
      .join(String.fromCharCode(10));
    assert.ok(src.indexOf('getConfig(PURGE_SWITCH)') < 0,
      'getConfig に引数を渡しています（常にOFF扱いになります）');
    assert.match(src, /if \(!configBool\(PURGE_SWITCH\)\)/,
      '削除側と同じ読み方になっていません');

    const purge = read('gas/Purge.gs');
    assert.match(purge, /configBool\(PURGE_SWITCH\)/,
      '削除側の読み方が変わっています（そろえ直してください）');
  });
});
