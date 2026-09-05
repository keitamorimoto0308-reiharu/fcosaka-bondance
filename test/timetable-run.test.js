/**
 * ② タイムスケジュール（gas/Timetable.gs）を、**実際に動かして**確かめる。
 *
 * 仕様は docs/internal/design_timetable.md（§7-3 の 1〜6・12〜14）。
 *
 * ■ なぜ形の検査ではなく、動かす検査にするか
 *   引き継ぎ書§9のとおり、ソース文字列を見る検査は順序の取り違えには効くが、
 *   **入力に対する振る舞い**は捕まえられない。
 *   ①では形の検査33件を全通ししたまま「配列で文字数制限を回避」が残っていた。
 *
 * ■ 代役は本物より優しくしない（test/_gasbox.js）
 *   とくに**暗号は本物**を使う。署名を固定値にすると、
 *   「券の署名を1文字変えたら断る」が、断っていなくても通ってしまう。
 *
 * ■ 前提（検証役に伝えているものと同じ）
 *   公開URL・匿名アクセス・守りはサーバー側のみ・台帳に個人情報・
 *   **この画面は全員が追加・編集・削除できる**（けいた確定）。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { makeSheet, makeUtilities, makeCache, cutFunction } = require('./_gasbox');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/** 仕様書 §2-1 の列。ここがずれたら、シートの見出しと実装の両方を疑う */
const TT_HEADERS = ['ID', 'レーン', '開始', '所要分', 'タイトル', '出演者', '詳細', 'ロック', '並び順'];

const CONFIG_HEADERS = ['項目', '値', '説明'];

/** 引換券の鍵。本番は authSecret_() + '|timetable' */
const SECRET = 'test-secret-0123456789';

/**
 * gas/Timetable.gs を、代役つきの箱で走らせる。
 *
 * @param {Object} opts
 *   rows     … タイムスケジュールシートの既存行（見出しを除く2次元配列）
 *   version  … 設定シートの「タイムスケジュール版」の初期値
 *   settings … 設定シートに足す行（[キー, 値] の配列）
 *   now      … 「いま」を固定する（ミリ秒）
 */
function makeBox(opts) {
  opts = opts || {};
  const admin = read('gas/Admin.gs');
  const auth = read('gas/Auth.gs');
  const setup = read('gas/Setup.gs');
  const src = read('gas/Timetable.gs');

  const configRows = [['タイムスケジュール版', opts.version === undefined ? 0 : opts.version, '']];
  (opts.settings || []).forEach(r => configRows.push([r[0], r[1], '']));

  const sheets = {
    'タイムスケジュール': makeSheet(TT_HEADERS, opts.rows || []),
    '設定': makeSheet(CONFIG_HEADERS, configRows),
  };
  const history = [];

  // 「いま」を1か所で動かせるようにする。券の期限と札の期限の両方が、これを見る
  let nowMs = opts.now === undefined ? Date.UTC(2026, 9, 20, 3, 0, 0) : opts.now;
  class BoxDate extends Date {
    constructor(...a) { if (a.length === 0) super(nowMs); else super(...a); }
    static now() { return nowMs; }
  }

  const cache = makeCache(() => nowMs);

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, parseInt, Boolean,
    Date: BoxDate,
    console: { error() {}, log() {} },
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    LOCK_WAIT_MS: 30000,
    CacheService: cache,
    Utilities: makeUtilities(),
    SHEET: { TIMETABLE: 'タイムスケジュール', CONFIG: '設定', HISTORY: '変更履歴', PEOPLE: '関係者' },
    // 引換券の鍵のもと。本番は gas/Auth.gs（パスワードの指紋を含む）
    authSecret_: () => SECRET,
    sheet_: name => {
      if (!sheets[name]) sheets[name] = makeSheet([], []);
      return sheets[name];
    },
    appendHistory: (operator, receiptId, item, before, after, reason) => {
      history.push({ operator, receiptId, item, before, after, reason });
    },
    logError_: () => {},
    // 自動保存の間隔だけは設定から読む。版番号は**設定の読み取りキャッシュを通さない**
    // （getConfig() は1回の実行内でキャッシュするので、保存した直後に読むと古い）
    configNumber: key => {
      const hit = configRows.find(r => r[0] === key);
      if (!hit || hit[1] === '' || hit[1] === null || hit[1] === undefined) return null;
      const n = Number(hit[1]);
      return isFinite(n) ? n : null;
    },
  });

  // 道具は**本番のソースから借りる**（写しを置かない）
  vm.runInContext([
    cutFunction(admin, 'asText_'),
    cutFunction(admin, 'safeCellText_'),
    cutFunction(auth, 'safeEquals_'),
    cutFunction(setup, 'findConfigRow_'),
  ].join(String.fromCharCode(10)), box);

  vm.runInContext(src, box);

  return {
    box, sheets, history, cache,
    /** 箱の中の「いま」を進める（券の期限・札の期限を試すため） */
    advance(ms) { nowMs += ms; },
    now: () => nowMs,
  };
}

/** VMのオブジェクトは deepStrictEqual で一致しないので、素の値に写す */
function plain(v) { return JSON.parse(JSON.stringify(v === undefined ? null : v)); }

function load(b, person) {
  b.box.__auth = { person: person || '小谷', role: '担当' };
  return plain(vm.runInContext('adminTimetable_(__auth)', b.box));
}

function save(b, payload, person) {
  b.box.__auth = { person: person || '小谷', role: '担当' };
  b.box.__payload = payload;
  return plain(vm.runInContext('adminTimetableSave_(__auth, __payload)', b.box));
}

function beat(b, person) {
  b.box.__auth = { person: person || '小谷', role: '担当' };
  return plain(vm.runInContext('adminTimetableHeartbeat_(__auth)', b.box));
}

/** シートに実際に書かれた行を、列名で引ける形にする */
function rowAt(b, n) {
  const line = b.sheets['タイムスケジュール'].grid[n - 1] || [];
  const o = {};
  TT_HEADERS.forEach((h, i) => { o[h] = line[i]; });
  return o;
}

function sheetRows(b) {
  return b.sheets['タイムスケジュール'].grid.slice(1);
}

const OPENING = { id: 'aaaa1111', lane: 'イベント', start: '11:00', min: 10,
                  title: 'オープニングセレモニー', casts: [], detail: '', locked: false };
const GATE    = { id: 'bbbb2222', lane: '全体', start: '10:30', min: 0,
                  title: 'ゲートオープン', casts: [], detail: '', locked: false };

/** いまの券と版を取ってから保存する、という普通の流れ */
function loadThenSave(b, rows, person) {
  const got = load(b, person);
  return save(b, { ticket: got.ticket, rows: rows }, person);
}

describe('② タイムスケジュール：読み出し', () => {

  test('レーンの一覧はサーバーが返す（画面に直書きさせない）', () => {
    const got = load(makeBox({}));
    assert.deepStrictEqual(got.lanes, ['全体', 'イベント', '備考']);
  });

  test('版番号と、それに署名した引換券が返る', () => {
    const got = load(makeBox({ version: 12 }));
    assert.strictEqual(got.version, 12);
    assert.ok(got.ticket && got.ticket.indexOf('.') > 0, '券が返っていません: ' + got.ticket);
  });

  test('行が無くても ok で返る（0件は「0件でした」と返す）', () => {
    const got = load(makeBox({}));
    assert.strictEqual(got.ok, true);
    assert.deepStrictEqual(got.rows, []);
  });

  test('すでに使われた出演者名が候補として返る', () => {
    const b = makeBox({ rows: [
      ['aaaa1111', 'イベント', '13:00', 30, '盆踊り講習', '○○バンド, △△先生', '', '', 1],
      ['bbbb2222', 'イベント', '15:00', 30, 'ライブ', '○○バンド', '', '', 2],
    ] });
    const got = load(b);
    assert.deepStrictEqual(got.casts, ['○○バンド', '△△先生']);
  });

  test('入室している人の名前を返す（画面が名乗らない）', () => {
    assert.strictEqual(load(makeBox({}), '成田').me.person, '成田');
  });
});

describe('② タイムスケジュール：版番号と引換券（§7-3 の 1〜5）', () => {

  test('1. 版が合えば保存できて、版が1つ進む', () => {
    const b = makeBox({ version: 12 });
    const r = loadThenSave(b, [OPENING]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.version, 13);
    assert.strictEqual(load(b).version, 13);
    assert.strictEqual(rowAt(b, 2)['タイトル'], 'オープニングセレモニー');
  });

  test('1b. 保存すると、次に使える新しい券が返る', () => {
    const b = makeBox({ version: 12 });
    const r = loadThenSave(b, [OPENING]);
    const again = save(b, { ticket: r.ticket, rows: [OPENING, GATE] });
    assert.strictEqual(again.ok, true, JSON.stringify(again));
    assert.strictEqual(again.version, 14);
  });

  test('2. 版が進んでいたら断り、シートを1文字も変えない', () => {
    const b = makeBox({ version: 12 });
    const mine = load(b).ticket;
    // 別の人が先に保存した
    const other = loadThenSave(b, [GATE], '成田');
    assert.strictEqual(other.ok, true, JSON.stringify(other));

    const before = JSON.stringify(sheetRows(b));
    const r = save(b, { ticket: mine, rows: [OPENING] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'conflict', JSON.stringify(r));
    assert.strictEqual(JSON.stringify(sheetRows(b)), before, 'シートが書き換わっています');
  });

  test('2b. 断るときは、最新の行と新しい券を一緒に返す（入れ直せるように）', () => {
    const b = makeBox({ version: 12 });
    const mine = load(b).ticket;
    loadThenSave(b, [GATE], '成田');

    const r = save(b, { ticket: mine, rows: [OPENING] });
    assert.strictEqual(r.error, 'conflict');
    assert.strictEqual(r.version, 13);
    assert.ok(r.ticket, '新しい券が返っていません');
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].title, 'ゲートオープン');
    // 誰がいつ変えたかを言えないと、帯の文面（§4-4）が書けない
    assert.strictEqual(r.by, '成田');
  });

  test('2c. 返された新しい券で、そのまま保存し直せる', () => {
    const b = makeBox({ version: 12 });
    const mine = load(b).ticket;
    loadThenSave(b, [GATE], '成田');
    const ng = save(b, { ticket: mine, rows: [OPENING] });

    const ok = save(b, { ticket: ng.ticket, rows: [GATE, OPENING] });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    assert.strictEqual(ok.version, 14);
  });

  test('3. 券の署名を1文字変えたら断る', () => {
    const b = makeBox({ version: 12 });
    const t = load(b).ticket;
    const parts = t.split('.');
    // 最後の1文字を別の文字に差し替える（長さは変えない）
    const last = parts[1].slice(-1);
    const bad = parts[0] + '.' + parts[1].slice(0, -1) + (last === 'A' ? 'B' : 'A');

    const r = save(b, { ticket: bad, rows: [OPENING] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'bad_ticket', JSON.stringify(r));
    assert.strictEqual(sheetRows(b).length, 0, 'シートが書き換わっています');
  });

  test('3b. 中身だけ書き換えて版を偽っても断る（署名が合わない）', () => {
    const b = makeBox({ version: 12 });
    const t = load(b).ticket;
    loadThenSave(b, [GATE], '成田');            // 版は 13 になった

    // 版13の中身を自分で作って、署名は古いものを付け直す。
    // **期限は箱の中の時計で作る。** 本物の Date.now() で作ると、
    // 箱の「いま」との差でいきなり期限切れになり、署名を見る前に断られる
    // （4b がそれを実際に捕まえた）
    const forged = Buffer.from(JSON.stringify({ v: 13, e: b.now() + 3600000 }))
      .toString('base64').split('+').join('-').split('/').join('_');
    const r = save(b, { ticket: forged + '.' + t.split('.')[1], rows: [OPENING] });
    assert.strictEqual(r.error, 'bad_ticket', JSON.stringify(r));
  });

  test('4. |purge の鍵で作った券では通らない（鍵が分かれている）', () => {
    const b = makeBox({ version: 12 });
    // 一括削除と同じ作り方で、鍵だけ '|purge' にした券を組む
    const payload = Buffer.from(JSON.stringify({ v: 12, e: b.now() + 3600000 }))
      .toString('base64').split('+').join('-').split('/').join('_');
    const sig = crypto.createHmac('sha256', SECRET + '|purge')
      .update(payload).digest('base64').split('+').join('-').split('/').join('_');

    const r = save(b, { ticket: payload + '.' + sig, rows: [OPENING] });
    assert.strictEqual(r.error, 'bad_ticket', JSON.stringify(r));
  });

  test('4b. 逆に、この画面の鍵で作った券なら通る（検査そのものの前提を確かめる）', () => {
    // 「通らない」の検査だけだと、**何をしても通らない実装**でも合格してしまう。
    // 引き継ぎ書§5「検査の前提も検査する」
    const b = makeBox({ version: 12 });
    const payload = Buffer.from(JSON.stringify({ v: 12, e: b.now() + 3600000 }))
      .toString('base64').split('+').join('-').split('/').join('_');
    const sig = crypto.createHmac('sha256', SECRET + '|timetable')
      .update(payload).digest('base64').split('+').join('-').split('/').join('_');

    const r = save(b, { ticket: payload + '.' + sig, rows: [OPENING] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });

  test('5. 券は6時間で切れる', () => {
    const b = makeBox({ version: 12 });
    const t = load(b).ticket;

    b.advance(6 * 3600 * 1000 - 60000);         // 5時間59分
    assert.strictEqual(save(b, { ticket: t, rows: [OPENING] }).ok, true, '6時間以内は通るはず');
  });

  test('5b. 6時間を過ぎた券は断る', () => {
    const b = makeBox({ version: 12 });
    const t = load(b).ticket;

    b.advance(6 * 3600 * 1000 + 60000);         // 6時間1分
    const r = save(b, { ticket: t, rows: [OPENING] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'expired_ticket', JSON.stringify(r));
  });

  test('5c. 一括削除の10分では切れない（編集は長くかかる）', () => {
    const b = makeBox({ version: 12 });
    const t = load(b).ticket;
    b.advance(30 * 60000);
    assert.strictEqual(save(b, { ticket: t, rows: [OPENING] }).ok, true,
      '30分で切れています。編集の途中で普通に切れてしまいます');
  });

  test('券が無ければ断る（版番号だけでは保存させない）', () => {
    const b = makeBox({ version: 12 });
    const r = save(b, { version: 12, rows: [OPENING] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'no_ticket', JSON.stringify(r));
  });
});

describe('② タイムスケジュール：まるごと差し替え（§3-3）', () => {

  test('保存すると、送った行だけが残る（消した行は消える）', () => {
    const b = makeBox({ version: 1, rows: [
      ['aaaa1111', 'イベント', '11:00', 10, '古い予定', '', '', '', 1],
      ['bbbb2222', '全体', '10:30', 0, 'ゲートオープン', '', '', '', 2],
    ] });
    const r = loadThenSave(b, [GATE]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(sheetRows(b).length, 1);
    assert.strictEqual(rowAt(b, 2)['タイトル'], 'ゲートオープン');
  });

  test('変更履歴には1回の保存につき1行だけ足す', () => {
    const b = makeBox({ version: 1 });
    loadThenSave(b, [OPENING, GATE]);
    assert.strictEqual(b.history.length, 1, JSON.stringify(b.history));
    assert.strictEqual(b.history[0].receiptId, '（進行表）');
    assert.strictEqual(b.history[0].operator, '小谷');
  });

  test('保存しても中身が変わっていなければ、変更履歴に足さない', () => {
    // ステータスのチップと同じ理屈（①）。自動保存が2〜3分おきに走るので、
    // 変わっていないのに残すと**本当の変更が埋もれる**
    const b = makeBox({ version: 1 });
    const first = loadThenSave(b, [OPENING]);
    save(b, { ticket: first.ticket, rows: [OPENING] });
    assert.strictEqual(b.history.length, 1, JSON.stringify(b.history));
  });

  test('IDを持たない行には、サーバーが8桁のIDを振る', () => {
    const b = makeBox({ version: 1 });
    const r = loadThenSave(b, [{ lane: '備考', start: '09:00', min: 0, title: '会場入り' }]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.match(String(rowAt(b, 2)['ID']), /^[0-9a-z]{8}$/);
  });

  test('数式になりうる文字で始まるタイトルは、そのままセルに入れない', () => {
    const b = makeBox({ version: 1 });
    loadThenSave(b, [Object.assign({}, OPENING, { title: '=1+1' })]);
    assert.strictEqual(rowAt(b, 2)['タイトル'], "'=1+1");
  });

  test('ロックは TRUE / 空 で持つ', () => {
    const b = makeBox({ version: 1 });
    loadThenSave(b, [Object.assign({}, OPENING, { locked: true }), GATE]);
    assert.strictEqual(rowAt(b, 2)['ロック'], 'TRUE');
    assert.strictEqual(rowAt(b, 3)['ロック'], '');
    // 読み出しでは真偽値に戻る
    const got = load(b);
    assert.strictEqual(got.rows[0].locked, true);
    assert.strictEqual(got.rows[1].locked, false);
  });

  test('開始時刻は**テキスト**でシートに入る（Date にしない）', () => {
    // シートの時刻値は GAS では Date として読まれ、タイムゾーンで化ける（§2-1）
    const b = makeBox({ version: 1 });
    loadThenSave(b, [OPENING]);
    assert.strictEqual(typeof rowAt(b, 2)['開始'], 'string');
    assert.strictEqual(rowAt(b, 2)['開始'], '11:00');
  });

  test('シートが Date を返してきても、時刻として読める', () => {
    // 人がシートの表示形式を時刻に変えると、Sheets は Date を返してくる。
    // ①で実際に踏んだ形（日付列に表示形式を付けたら 2026-09-20 00:00 になった）
    const b = makeBox({ version: 1, rows: [
      ['aaaa1111', 'イベント', new Date(2026, 9, 24, 11, 0, 0), 10, '開会', '', '', '', 1],
    ] });
    assert.strictEqual(load(b).rows[0].start, '11:00');
  });
});

describe('② タイムスケジュール：入力の検証（§3-4・§7-3 の 6・12・13）', () => {

  /** 既存行が1件ある箱。「何も書かない」を確かめる土台にする */
  function withOne() {
    return makeBox({ version: 5, rows: [
      ['cccc3333', '全体', '09:30', 60, '設営', '', '', '', 1],
    ] });
  }

  test('6. 1行でも通らなければ、何も書かない', () => {
    const b = withOne();
    const before = JSON.stringify(sheetRows(b));
    const r = loadThenSave(b, [
      OPENING,
      { lane: 'イベント', start: '13:00', min: 30, title: '' },   // タイトルが空
      GATE,
    ]);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'bad_value', JSON.stringify(r));
    assert.strictEqual(JSON.stringify(sheetRows(b)), before, 'シートが書き換わっています');
  });

  test('6b. 断るときは、何件目の何が悪いかを言う', () => {
    const b = withOne();
    const r = loadThenSave(b, [OPENING, { lane: 'イベント', start: '13:00', min: 30, title: '' }]);
    assert.match(r.message, /2件目/, r.message);
    assert.match(r.message, /タイトル/, r.message);
  });

  test('6c. 断っても、版番号は進めない', () => {
    const b = withOne();
    loadThenSave(b, [{ lane: 'イベント', start: '13:00', min: 30, title: '' }]);
    assert.strictEqual(load(b).version, 5);
  });

  test('12. 全角の時刻を半角に直して受ける', () => {
    const b = makeBox({ version: 1 });
    const r = loadThenSave(b, [Object.assign({}, OPENING, { start: '１１：００' })]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(rowAt(b, 2)['開始'], '11:00');
  });

  test('12b. 全角の所要分も受ける', () => {
    const b = makeBox({ version: 1 });
    const r = loadThenSave(b, [Object.assign({}, OPENING, { min: '３０' })]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(rowAt(b, 2)['所要分'], 30);
  });

  test('12c. 「9:00」は「09:00」にそろえて受ける', () => {
    const b = makeBox({ version: 1 });
    loadThenSave(b, [Object.assign({}, OPENING, { start: '9:00' })]);
    assert.strictEqual(rowAt(b, 2)['開始'], '09:00');
  });

  test('12d. 時刻でないものは断る（数字を拾って作らない）', () => {
    const b = makeBox({ version: 1 });
    ['25:00', '11:60', '1100', '11時', '', '11:0', 'あ11:00'].forEach(bad => {
      const r = loadThenSave(makeBox({ version: 1 }), [Object.assign({}, OPENING, { start: bad })]);
      assert.strictEqual(r.ok, false, '「' + bad + '」が通っています');
      assert.match(r.message, /開始時刻/, '「' + bad + '」: ' + r.message);
    });
  });

  test('13. 開始＋所要が 24:00 を超えたら断る', () => {
    const r = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { start: '23:30', min: 60 })]);
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /翌日/, r.message);
  });

  test('13b. ちょうど 24:00 で終わるものは受ける', () => {
    const r = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { start: '23:30', min: 30 })]);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });

  test('レーンの許可リストは constructor で開かない（§7-2）', () => {
    const r = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { lane: 'constructor' })]);
    assert.strictEqual(r.ok, false, JSON.stringify(r));
    assert.match(r.message, /レーン/, r.message);
  });

  test('toString も __proto__ もレーンとして通らない', () => {
    ['toString', '__proto__', 'hasOwnProperty', 'valueOf'].forEach(bad => {
      const r = loadThenSave(makeBox({ version: 1 }), [Object.assign({}, OPENING, { lane: bad })]);
      assert.strictEqual(r.ok, false, '「' + bad + '」が通っています');
    });
  });

  test('レーンが空なら「空です」と言う（「正しくありません」では直せない）', () => {
    const r = loadThenSave(makeBox({ version: 1 }), [Object.assign({}, OPENING, { lane: '' })]);
    assert.match(r.message, /空/, r.message);
  });

  test('タイトルは100字まで', () => {
    const ok = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { title: 'あ'.repeat(100) })]);
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    const ng = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { title: 'あ'.repeat(101) })]);
    assert.strictEqual(ng.ok, false);
  });

  test('配列や入れ物でタイトルの字数制限を回避できない', () => {
    // ①で検証役が見つけた抜け道。**先に長さを見ると配列で回避できる**
    [['あ'.repeat(200)], { toString: 1 }, {}, true, () => 1].forEach(bad => {
      const r = loadThenSave(makeBox({ version: 1 }), [Object.assign({}, OPENING, { title: bad })]);
      assert.strictEqual(r.ok, false, JSON.stringify(bad) + ' が通っています');
      assert.match(r.message, /読み取れませんでした/, r.message);
    });
  });

  test('詳細は500字まで', () => {
    const ng = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { detail: 'あ'.repeat(501) })]);
    assert.strictEqual(ng.ok, false);
    assert.match(ng.message, /詳細/, ng.message);
  });

  test('出演者は10人まで・ひとり30字まで', () => {
    const many = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { casts: Array.from({ length: 11 }, (x, i) => '人' + i) })]);
    assert.strictEqual(many.ok, false);
    assert.match(many.message, /10人/, many.message);

    const long = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { casts: ['あ'.repeat(31)] })]);
    assert.strictEqual(long.ok, false);
    assert.match(long.message, /30文字/, long.message);
  });

  test('出演者名にカンマは使えない（区切りに化けるため）', () => {
    const r = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { casts: ['○○バンド, 別人'] })]);
    assert.strictEqual(r.ok, false, JSON.stringify(r));
  });

  test('所要分は0以上600以下の整数だけ', () => {
    [-10, 0.5, 601, 'たくさん', {}, [30], true, Infinity].forEach(bad => {
      const r = loadThenSave(makeBox({ version: 1 }), [Object.assign({}, OPENING, { min: bad })]);
      assert.strictEqual(r.ok, false, JSON.stringify(bad) + ' が通っています');
    });
    const zero = loadThenSave(makeBox({ version: 1 }), [Object.assign({}, OPENING, { min: 0 })]);
    assert.strictEqual(zero.ok, true, '0（時刻だけの目印）は通るはず');
  });

  test('行は200件まで', () => {
    const make = n => Array.from({ length: n }, (x, i) => ({
      lane: '備考', start: '09:00', min: 0, title: '予定' + i }));
    assert.strictEqual(loadThenSave(makeBox({ version: 1 }), make(200)).ok, true);
    const over = loadThenSave(makeBox({ version: 1 }), make(201));
    assert.strictEqual(over.ok, false);
    assert.match(over.message, /200件/, over.message);
  });

  test('同じIDが2つ送られたら断る（片方が消える保存を作らない）', () => {
    const r = loadThenSave(makeBox({ version: 1 }),
      [OPENING, Object.assign({}, GATE, { id: OPENING.id })]);
    assert.strictEqual(r.ok, false, JSON.stringify(r));
  });

  test('IDの形が違えば断る（勝手に振り直さない）', () => {
    const r = loadThenSave(makeBox({ version: 1 }),
      [Object.assign({}, OPENING, { id: 'ずるい' })]);
    assert.strictEqual(r.ok, false, JSON.stringify(r));
  });

  test('rows が配列でなければ断る', () => {
    [null, undefined, '', 'あ', {}, 5].forEach(bad => {
      const b = makeBox({ version: 1 });
      const r = save(b, { ticket: load(b).ticket, rows: bad });
      assert.strictEqual(r.ok, false, JSON.stringify(bad) + ' が通っています');
      assert.strictEqual(r.error, 'bad_value');
    });
  });

  test('券が無いときは、行の中身を見る前に断る', () => {
    // 検証を先にすると、券を持たない人が「何を送ると通るか」を試せる
    const r = save(makeBox({ version: 1 }), { rows: [{ lane: 'だめ', start: 'だめ', title: '' }] });
    assert.strictEqual(r.error, 'no_ticket', JSON.stringify(r));
  });
});

describe('② タイムスケジュール：編集中の札（§4-6・§7-3 の 14）', () => {

  test('14. 自分の札は返らない', () => {
    const b = makeBox({ version: 1 });
    const r = beat(b, '小谷');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.editors, []);
  });

  test('14b. ほかの人が叩いていれば、その人が見える', () => {
    const b = makeBox({ version: 1 });
    beat(b, '成田');
    const r = beat(b, '小谷');
    assert.strictEqual(r.editors.length, 1, JSON.stringify(r.editors));
    assert.strictEqual(r.editors[0].person, '成田');
  });

  test('14c. 何秒前に叩いたかが返る（「2分前」と出すため）', () => {
    const b = makeBox({ version: 1 });
    beat(b, '成田');
    b.advance(120000);
    const r = beat(b, '小谷');
    assert.strictEqual(r.editors[0].agoSec, 120);
  });

  test('14d. 3分以上更新が無い札は消える', () => {
    const b = makeBox({ version: 1 });
    beat(b, '成田');
    b.advance(179000);
    assert.strictEqual(beat(b, '小谷').editors.length, 1, '3分以内はまだ見えるはず');

    b.advance(2000);                       // 合計3分1秒
    assert.deepStrictEqual(beat(b, '小谷').editors, []);
  });

  test('14e. 叩き直せば、札は立ち続ける', () => {
    const b = makeBox({ version: 1 });
    beat(b, '成田');
    b.advance(150000); beat(b, '成田');
    b.advance(150000);
    assert.strictEqual(beat(b, '小谷').editors.length, 1);
  });

  test('14f. 札はシートに書かない（1分ごとの書き込みは遅すぎる・§2-2）', () => {
    const b = makeBox({ version: 1, rows: [['aaaa1111', '全体', '09:00', 0, '設営', '', '', '', 1]] });
    const before = JSON.stringify(b.sheets['タイムスケジュール'].grid)
                 + JSON.stringify(b.sheets['設定'].grid);
    beat(b, '成田'); beat(b, '小谷'); beat(b, '田中');
    assert.strictEqual(
      JSON.stringify(b.sheets['タイムスケジュール'].grid) + JSON.stringify(b.sheets['設定'].grid),
      before, 'シートに書き込んでいます');
  });

  test('14g. 読み出しでも、いまの札が一緒に返る（往復を増やさない）', () => {
    const b = makeBox({ version: 1 });
    beat(b, '成田');
    const got = load(b, '小谷');
    assert.strictEqual(got.editors.length, 1);
    assert.strictEqual(got.editors[0].person, '成田');
  });

  test('14h. 名前の無い人は札を立てない（空の札が並ばない）', () => {
    const b = makeBox({ version: 1 });
    b.box.__auth = { person: '', role: '担当' };
    vm.runInContext('adminTimetableHeartbeat_(__auth)', b.box);
    assert.deepStrictEqual(beat(b, '小谷').editors, []);
  });

  test('14i. 札が壊れていても、読み出しは止まらない', () => {
    // キャッシュの中身は誰かが書き換えうるものではないが、
    // **読めないものが来ても画面が開けなくなってはいけない**
    const b = makeBox({ version: 1 });
    beat(b, '成田');
    b.cache.getScriptCache().put('tt-editors', 'こわれた', 600);
    assert.strictEqual(load(b, '小谷').ok, true);
  });

  test('14j. 自動保存の間隔を設定から返す（既定3分）', () => {
    assert.strictEqual(load(makeBox({ version: 1 })).autosaveMin, 3);
    assert.strictEqual(
      load(makeBox({ version: 1, settings: [['進行表の自動保存分', 5]] })).autosaveMin, 5);
  });

  test('14k. 自動保存の間隔が読めなければ3に落とす（0にしない）', () => {
    // 0 に倒すと自動保存が一度も走らなくなる。
    // 「単価が空欄で0円」と同じ倒し方をしない
    [0, -1, 'あ', '', 2.5, 999].forEach(bad => {
      const got = load(makeBox({ version: 1, settings: [['進行表の自動保存分', bad]] }));
      assert.ok(got.autosaveMin >= 1 && got.autosaveMin <= 30,
        JSON.stringify(bad) + ' → ' + got.autosaveMin);
    });
  });
});

describe('② タイムスケジュール：配線（§4-8 の「4か所を必ず一緒に」のサーバー側）', () => {
  const config = read('gas/Config.gs');
  const setupSrc = read('gas/Setup.gs');
  const adminSrc = read('gas/Admin.gs');
  /** 空白をつぶして照合する。正規表現を文字列から組むとバックスラッシュが1層落ちる */
  const flat = s => s.split(' ').join('').split(String.fromCharCode(9)).join('');

  test('シート名は gas/Config.gs の SHEET に持つ（直書きしない）', () => {
    assert.match(config, /TIMETABLE:\s*'タイムスケジュール'/);
  });

  test('setup() が タイムスケジュールのシートを作る', () => {
    assert.ok(setupSrc.indexOf('function setupTimetableSheet_') >= 0,
      'setupTimetableSheet_ がありません');
    assert.ok(flat(setupSrc).indexOf('setupTimetableSheet_(ss);') >= 0,
      'setup() から呼ばれていません');
  });

  test('setup() は 0件でもログに出す（「黙って正常」を作らない）', () => {
    const i = setupSrc.indexOf('function setupTimetableSheet_');
    const body = setupSrc.slice(i, setupSrc.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), i));
    assert.ok(body.indexOf('console.log') >= 0, 'ログを出していません');
  });

  test('3つの action が adminDispatch_ に登録されている', () => {
    ['adminTimetable', 'adminTimetableSave', 'adminTimetableHeartbeat'].forEach(a => {
      assert.ok(flat(adminSrc).indexOf("case'" + a + "':") >= 0, a + ' がありません');
    });
  });

  test('adminOnly には入れない（全員が触れる・けいた確定）', () => {
    // 管理者だけにすると、結局シートを直接開くことになって形骸化する（①と同じ）
    const i = adminSrc.indexOf('var adminOnly = [');
    const list = adminSrc.slice(i, adminSrc.indexOf('];', i));
    assert.ok(list.indexOf('adminTimetable') < 0,
      'adminOnly に入っています: ' + list);
  });

  /**
   * 設定タブに出ている項目の**キーだけ**を拾う。
   *
   * 最初は「この塊の中に文字列があるか」で見ていたが、
   * **説明のコメントに「タイムスケジュール版」と書いただけで落ちた**。
   * コメントで壊れる検査は検査になっていない。
   */
  function settingKeys() {
    const i = adminSrc.indexOf('var SETTING_KEYS_ = [');
    const list = adminSrc.slice(i, adminSrc.indexOf(String.fromCharCode(10) + '];', i));
    const out = [];
    list.replace(/\{\s*key:\s*'([^']+)'/g, (m, k) => { out.push(k); return m; });
    return out;
  }

  test('版番号は設定タブに出さない（人が触るものではない）', () => {
    // 触られると「ぶつかり」の検出が壊れる。設定シートには行があるが、画面には出さない
    const keys = settingKeys();
    assert.ok(keys.length > 5, '設定の項目を読み出せていません: ' + keys.length);
    assert.ok(keys.indexOf('タイムスケジュール版') < 0, '設定タブに版番号が出ています');
    assert.ok(keys.indexOf('タイムスケジュール最終更新') < 0, '設定タブに最終更新が出ています');
  });

  test('自動保存の間隔と進行表の日付は、設定タブから変えられる', () => {
    const keys = settingKeys();
    assert.ok(keys.indexOf('進行表の自動保存分') >= 0, '自動保存の間隔が設定タブにありません');
    assert.ok(keys.indexOf('進行表の日付') >= 0, '進行表の日付が設定タブにありません');
  });

  test('設定シートの既定に、進行表の日付と自動保存分がある', () => {
    assert.match(config, /'進行表の日付',\s*'2026-10-24'/);
    assert.match(config, /'進行表の自動保存分'/);
  });
});
