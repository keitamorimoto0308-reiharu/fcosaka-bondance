/**
 * ① 制作スケジュール表（gas/Sched.gs）を、**実際に動かして**確かめる。
 *
 * ■ なぜ形の検査ではなく、動かす検査にするか
 *   引き継ぎ書§9のとおり、ソース文字列を見る検査は順序の取り違えには効くが、
 *   **入力に対する振る舞い**は捕まえられない。
 *   実際、形の検査33件を全通ししたまま「配列で文字数制限を回避」が残っていた。
 *   仕様書 design_schedule_plan.md §5-3 も「呼べるようにして呼ぶ」と指定している。
 *
 * ■ 代役は本物より緩くしない
 *   検証に使う関数（asText_ / safeCellText_ / normalizeDue_）は、
 *   **本番のソースから切り出して**箱に入れる。ここに写しを置くと、
 *   本番だけ直してテストが古いまま通る、という形になる。
 *   （src/mock.js が本番より緩くて本番のバグを見逃した、と同じ轍）
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

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/** 本番のソースから関数を1つ切り出す（写しを作らないため） */
function cutFunction(code, name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' が見つかりません');
  const end = code.indexOf('\n}\n', start) + 3;
  assert.ok(end > start, name + ' の終わりが見つかりません');
  return code.slice(start, end);
}

/** 仕様書 §2-1 の列。ここがずれたら、シートの見出しと実装の両方を疑う */
const SCHED_HEADERS = [
  '種類', '日付', '終了日', '領域', '担当会社', '担当者', 'タスク名', '詳細',
  'ステータス', '備考', '完了日', '並び順', '起票者', '起票日', '更新者', '更新日時',
];

const PEOPLE_HEADERS = ['氏名', '所属', '部署', 'メール', 'フォーム表示', '管理ページ利用', '役割', '通知'];

/** シートの代役。書いた中身をあとから見られるようにする */
function makeSheet(headers, rows) {
  const grid = [headers.slice()].concat((rows || []).map(r => r.slice()));
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => headers.length,
    getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
    getRange(row, col, nRows, nCols) {
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
        setValue: v => { while (grid.length < row) grid.push([]); grid[row - 1][col - 1] = v; },
        setValues: vals => {
          vals.forEach((line, r) => line.forEach((v, c) => {
            while (grid.length < row + r) grid.push([]);
            if (!grid[row - 1 + r]) grid[row - 1 + r] = [];
            grid[row - 1 + r][col - 1 + c] = v;
          }));
        },
      };
    },
    appendRow: line => grid.push(line.slice()),
    deleteRow: n => { grid.splice(n - 1, 1); },
  };
}

/**
 * gas/Sched.gs を、代役つきの箱で走らせる。
 * @param {Object} opts
 *   rows    … 制作スケジュールシートの既存行（見出しを除く2次元配列）
 *   people  … 関係者シートの行
 *   today   … サーバーが返す「今日」
 * @returns 箱（関数も、書き込まれたシートも、記録した履歴も見られる）
 */
function makeBox(opts) {
  opts = opts || {};
  const admin = read('gas/Admin.gs');
  const sched = read('gas/Sched.gs');
  const today = opts.today || '2026-09-10';

  const sheets = {
    '制作スケジュール': makeSheet(SCHED_HEADERS, opts.rows || []),
    '関係者': makeSheet(PEOPLE_HEADERS, opts.people || [
      ['小谷', 'FC大阪', '事業部', 'kotani@example.com', 'する', 'する', '担当', 'ON'],
      ['山本', 'UPDATER', '', 'yamamoto@example.com', 'しない', 'する', '担当', 'OFF'],
    ]),
  };
  const history = [];

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Date, parseInt,
    console: { error() {}, log() {} },
    // ── GAS の代役。本物と同じ形の失敗だけを守る
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    LOCK_WAIT_MS: 30000,
    Utilities: {
      formatDate(d, tz, fmt) {
        // 本番は台帳のタイムゾーンで整形する。ここでは「サーバーの今日」を固定して返し、
        // **端末の日付を見ていないこと**（§5-3-9）を確かめられるようにする
        if (fmt === 'yyyy-MM-dd') return today;
        return today + ' 12:00';
      },
    },
    SHEET: { SCHED: '制作スケジュール', PEOPLE: '関係者', TODO: '確認事項', HISTORY: '変更履歴' },
    sheet_: name => {
      if (!sheets[name]) sheets[name] = makeSheet([], []);
      return sheets[name];
    },
    appendHistory: (operator, receiptId, item, before, after, reason) => {
      history.push({ operator, receiptId, item, before, after, reason });
    },
  });

  // 検証に使う関数は**本番のソースから借りる**（写しを置かない）
  vm.runInContext([
    cutFunction(admin, 'asText_'),
    cutFunction(admin, 'safeCellText_'),
    cutFunction(admin, 'normalizeDue_'),
  ].join('\n'), box);

  vm.runInContext(sched, box);
  return { box, sheets, history, today };
}

/** 保存を1回呼ぶ。返り値は素の値に写す（VMのオブジェクトは deepStrictEqual で一致しない） */
function save(b, payload, person) {
  const auth = { person: person || '小谷', company: 'FC大阪' };
  b.box.__auth = auth; b.box.__payload = payload;
  return JSON.parse(JSON.stringify(
    vm.runInContext('adminSchedSave_(__auth, __payload)', b.box) || null));
}

function load(b, person) {
  b.box.__auth = { person: person || '小谷', company: 'FC大阪' };
  return JSON.parse(JSON.stringify(vm.runInContext('adminSched_(__auth)', b.box) || null));
}

/** シートに実際に書かれた行を、列名で引ける形にする */
function rowAt(b, n) {
  const line = b.sheets['制作スケジュール'].grid[n - 1] || [];
  const o = {};
  SCHED_HEADERS.forEach((h, i) => { o[h] = line[i]; });
  return o;
}

function del(b, row, person) {
  b.box.__auth = { person: person || '小谷', company: 'FC大阪' };
  b.box.__payload = { row: row };
  return JSON.parse(JSON.stringify(
    vm.runInContext('adminSchedDelete_(__auth, __payload)', b.box) || null));
}

const TASK = { kind: 'タスク', date: '2026-09-20', area: '制作', title: '看板の入稿' };

describe('① 制作スケジュール表：追加と読み出し', () => {

  test('追加すると、読み出しに現れる', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: TASK });
    assert.strictEqual(r.ok, true, JSON.stringify(r));

    const got = load(b);
    assert.strictEqual(got.rows.length, 1);
    assert.strictEqual(got.rows[0].title, '看板の入稿');
    assert.strictEqual(got.rows[0].kind, 'タスク');
    assert.strictEqual(got.rows[0].date, '2026-09-20');
    assert.strictEqual(got.rows[0].area, '制作');
  });

  test('ステータスを省くと「未着手」になる', () => {
    const b = makeBox({});
    save(b, { row: 0, item: TASK });
    assert.strictEqual(load(b).rows[0].status, '未着手');
  });

  test('起票者は名乗らせず、入室している人の名前を使う', () => {
    // 自称できると、変更履歴も起票者も意味を失う（adminTodoSave_ と同じ作法）
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK, { author: '別人' }) }, '小谷');
    assert.strictEqual(rowAt(b, 2)['起票者'], '小谷');
  });

  test('選択肢は、サーバーが持っているものが返る（画面に直書きさせない）', () => {
    const got = load(makeBox({}));
    assert.deepStrictEqual(got.areas, ['全体', '会議', '企画', '営業', '制作', '運営']);
    assert.deepStrictEqual(got.statuses,
      ['未着手', '進行中', '確認中', '完了', '停滞中', '見送り']);
  });
});

describe('① 制作スケジュール表：受け付けない入力', () => {

  test('タスク名が空なら断る', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TASK, { title: '  ' }) });
    assert.strictEqual(r.ok, false);
    assert.ok(r.message && r.message.length > 0, '理由を返していません: ' + JSON.stringify(r));
  });

  test('タスク名が200字を超えたら断る', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TASK, { title: 'あ'.repeat(201) }) });
    assert.strictEqual(r.ok, false, '201字が通りました');
  });

  test('配列を送って文字数制限を回避できない', () => {
    // 検証役が実際に見つけた抜け道（引き継ぎ書§9）。String() を通す前に length を見ると通る
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TASK, { title: ['あ'.repeat(300)] }) });
    assert.strictEqual(r.ok, false, '配列で制限を回避できました');
  });

  test('知らない種類・領域・ステータスは断る', () => {
    for (const bad of [{ kind: 'なにか' }, { area: '未知の領域' }, { status: 'できた' }]) {
      const b = makeBox({});
      const r = save(b, { row: 0, item: Object.assign({}, TASK, bad) });
      assert.strictEqual(r.ok, false, JSON.stringify(bad) + ' が通りました');
    }
  });

  test('constructor を種類・領域・ステータスに送っても通らない', () => {
    // 2026-09-02 に UPLOAD_ALLOWED が素の {} だったため .exe が置けた穴と同じ形。
    // 許可リストは Object.create(null) か配列の indexOf で照合すること（§5-2）
    for (const key of ['kind', 'area', 'status']) {
      for (const word of ['constructor', 'toString', '__proto__']) {
        const b = makeBox({});
        const item = Object.assign({}, TASK); item[key] = word;
        const r = save(b, { row: 0, item: item });
        assert.strictEqual(r.ok, false, key + ' に ' + word + ' が通りました');
      }
    }
  });

  test('数式になりうる文字列は、そのままシートに書かない', () => {
    // 変更履歴で =IMAGE(...) が動いた件（gas/Ledger.gs の historyCell_ のコメント）と同じ
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK, { title: '=IMAGE("http://x/a.png")' }) });
    const written = String(rowAt(b, 2)['タスク名']);
    assert.ok(written.charAt(0) !== '=', '先頭の = がそのまま書かれました: ' + written);
  });
});

describe('① 制作スケジュール表：完了日は自動で入る（§5-3-1,2）', () => {

  test('完了にすると、完了日にサーバーの今日が入る', () => {
    const b = makeBox({ today: '2026-09-15' });
    save(b, { row: 0, item: TASK });
    save(b, { row: 2, item: Object.assign({}, TASK, { status: '完了' }) });
    assert.strictEqual(rowAt(b, 2)['完了日'], '2026-09-15',
      '完了にしたのに完了日が入りません');
  });

  test('見送りにしたときも、完了日に日付が入る', () => {
    // 列名は「完了日」だが、正確には決着日。見送りにした日もここに入る（§2-1）
    const b = makeBox({ today: '2026-09-15' });
    save(b, { row: 0, item: TASK });
    save(b, { row: 2, item: Object.assign({}, TASK, { status: '見送り' }) });
    assert.strictEqual(rowAt(b, 2)['完了日'], '2026-09-15');
  });

  test('完了から戻すと、完了日は空になる', () => {
    const b = makeBox({ today: '2026-09-15' });
    save(b, { row: 0, item: TASK });
    save(b, { row: 2, item: Object.assign({}, TASK, { status: '完了' }) });
    save(b, { row: 2, item: Object.assign({}, TASK, { status: '進行中' }) });
    assert.strictEqual(rowAt(b, 2)['完了日'], '');
  });

  test('手で入れた完了日は、上書きしない', () => {
    // 実際の日付とシステムの日付がずれることがある（あとから記録した等）。
    // 人が直した値を、保存のたびに今日で塗り替えてはいけない（§3-3）
    const b = makeBox({ today: '2026-09-15' });
    save(b, { row: 0, item: TASK });
    save(b, { row: 2, item: Object.assign({}, TASK, { status: '完了' }) });
    b.sheets['制作スケジュール'].grid[1][10] = '2026-09-01';   // 人が手で直した
    save(b, { row: 2, item: Object.assign({}, TASK, { status: '完了', memo: 'あとから記録' }) });
    assert.strictEqual(rowAt(b, 2)['完了日'], '2026-09-01', '手で入れた値を上書きしました');
  });

  test('端末の日付ではなく、サーバーの日付を使う（§5-3-9）', () => {
    // 端末の時計が狂っていると、遅れが見えなくなる。判定はサーバーの日付で行う
    const b = makeBox({ today: '2026-09-15' });
    assert.strictEqual(load(b).today, '2026-09-15');
    save(b, { row: 0, item: TASK });
    save(b, { row: 2, item: Object.assign({}, TASK, { status: '完了' }) });
    assert.strictEqual(rowAt(b, 2)['完了日'], '2026-09-15');
  });
});

describe('① 制作スケジュール表：期間とマイルストーン（§5-3-5,6）', () => {

  const TERM = { kind: '期間', date: '2026-09-01', endDate: '2026-09-30',
                 area: '営業', title: '募集期間' };

  test('期間は、終了日まで保存される', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: TERM });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(load(b).rows[0].endDate, '2026-09-30');
  });

  test('期間に終了日が無ければ断る', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TERM, { endDate: '' }) });
    assert.strictEqual(r.ok, false, '終了日の無い期間が通りました');
  });

  test('期間の終了日が開始日より前なら断る', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TERM, { endDate: '2026-08-01' }) });
    assert.strictEqual(r.ok, false, '終了日が開始日より前の期間が通りました');
  });

  test('期間にステータスを送っても、無視して空にする', () => {
    // 期間に「完了」はありえない。断らずに落とすのは、画面が誤って送っても
    // 人の作業を止めないため（§3-2）
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TERM, { status: '完了' }) });
    assert.strictEqual(rowAt(b, 2)['ステータス'], '');
  });

  test('マイルストーンもステータスは空になる／終了日は持たない', () => {
    const b = makeBox({});
    save(b, { row: 0, item: { kind: 'マイルストーン', date: '2026-10-24', area: '全体',
                              title: '本番', status: '完了', endDate: '2026-10-25' } });
    assert.strictEqual(rowAt(b, 2)['ステータス'], '');
    assert.strictEqual(rowAt(b, 2)['終了日'], '');
  });

  test('タスクは終了日を持たない', () => {
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK, { endDate: '2026-09-30' }) });
    assert.strictEqual(rowAt(b, 2)['終了日'], '');
  });
});

describe('① 制作スケジュール表：日付の読み取り（§5-3-7）', () => {

  test('全角数字の日付を、半角に直して受ける', () => {
    // 日本語IMEでは全角数字が普通に出る。**値は同じ**なので直して受ける。
    // （Number('５') が 5 になる「黙って別の値になる」変換とは別もので、
    //   こちらは文字の書き分けを揃えているだけ）
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TASK, { date: '２０２６-０９-２０' }) });
    assert.strictEqual(r.ok, true, '全角の日付が断られました: ' + JSON.stringify(r));
    assert.strictEqual(load(b).rows[0].date, '2026-09-20');
  });

  test('日付として読めないものは、理由を添えて断る', () => {
    for (const bad of ['きょう', '2026-13-01', '2026-09-99', 'あ']) {
      const b = makeBox({});
      const r = save(b, { row: 0, item: Object.assign({}, TASK, { date: bad }) });
      assert.strictEqual(r.ok, false, bad + ' が通りました');
      assert.ok(r.message && r.message.length > 0, bad + ' の理由がありません');
    }
  });

  test('制御文字を混ぜても、シートには日付の形しか書かれない', () => {
    // 制御文字は**この行に直接書かない**。ソースに1文字混ざると、
    // 「エラーも出さずに何にもマッチしない」正規表現ができる（引き継ぎ書§8）。
    // 実際、この検査を書くときに1度混入させた。必ず fromCharCode で組み立てる。
    const TAB = String.fromCharCode(9);
    const NUL = String.fromCharCode(0);
    for (const bad of ['2026-09-20' + TAB, NUL + '2026-09-20', '2026' + NUL + '-09-20']) {
      const b = makeBox({});
      const r = save(b, { row: 0, item: Object.assign({}, TASK, { date: bad }) });
      if (!r.ok) continue;                       // 断るのも正しい振る舞い
      const written = String(rowAt(b, 2)['日付']);
      assert.match(written, /^\d{4}-\d{2}-\d{2}$/,
        '日付の形以外がシートに書かれました: ' + JSON.stringify(written));
    }
  });
});


describe('① 制作スケジュール表：担当者と担当会社（§5-3-3,4）', () => {

  test('担当者を選ぶと、その人の所属が担当会社に足される', () => {
    // 「担当者は小谷さん（FC大阪）なのに担当会社はUPDATERだけ」を作れなくする（§2-2）
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK, { people: ['小谷'] }) });
    assert.deepStrictEqual(load(b).rows[0].companies, ['FC大阪'],
      '担当者の所属が担当会社に足されていません');
  });

  test('担当者が複数なら、それぞれの所属が足される', () => {
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK, { people: ['小谷', '山本'] }) });
    const got = load(b).rows[0].companies;
    assert.ok(got.indexOf('FC大阪') >= 0 && got.indexOf('UPDATER') >= 0, got.join('/'));
  });

  test('関係者シートに無い担当者は断る', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TASK, { people: ['存在しない人'] }) });
    assert.strictEqual(r.ok, false, '知らない担当者が通りました');
    assert.ok(r.message && r.message.indexOf('存在しない人') >= 0,
      '誰が問題なのかを伝えていません: ' + JSON.stringify(r));
  });

  test('会社だけ決まっていて担当者が未定でも保存できる', () => {
    // 印刷会社など。これが「担当会社をデータに残す」唯一の理由（§2-2）
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TASK,
      { people: [], companies: ['○○印刷'] }) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(load(b).rows[0].companies, ['○○印刷']);
    assert.deepStrictEqual(load(b).rows[0].people, []);
  });

  test('会社を選んでも、担当者は勝手に入らない', () => {
    // 逆（会社→人）はやらない。人を勝手に割り当てると、本人が知らない担当が生まれる
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK, { companies: ['FC大阪'] }) });
    assert.deepStrictEqual(load(b).rows[0].people, []);
  });

  test('同じ会社が二重に入らない', () => {
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK,
      { people: ['小谷'], companies: ['FC大阪'] }) });
    assert.deepStrictEqual(load(b).rows[0].companies, ['FC大阪']);
  });

  test('会社ごとに分かれた担当者の一覧が返る', () => {
    const got = load(makeBox({}));
    assert.deepStrictEqual(got.peopleByCompany['FC大阪'], ['小谷']);
    assert.deepStrictEqual(got.peopleByCompany['UPDATER'], ['山本']);
  });

  test('会社の候補に、すでに使われた自由入力が混ざる', () => {
    // そうしないと「FC大阪」「FC大阪株式会社」「fc大阪」が並ぶ（§2-2）
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK, { companies: ['○○印刷'] }) });
    const got = load(b).companies;
    for (const c of ['FC大阪', 'UPDATER', 'LOP', '○○印刷']) {
      assert.ok(got.indexOf(c) >= 0, c + ' が候補にありません: ' + got.join('/'));
    }
  });
});

describe('① 制作スケジュール表：削除（§5-3-8）', () => {

  test('削除すると、読み出しから消える', () => {
    const b = makeBox({});
    save(b, { row: 0, item: TASK });
    assert.strictEqual(load(b).rows.length, 1);
    const r = del(b, 2);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(load(b).rows.length, 0);
  });

  test('削除は、変更履歴に行の全文を残す', () => {
    // これが唯一の復元手段になる。要約を残しても戻せない（§3-4）
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK,
      { detail: '入稿データはAさんが持っている', memo: '締切厳守' }) });
    b.history.length = 0;
    del(b, 2);

    assert.strictEqual(b.history.length, 1, '履歴が1件残っていません');
    const h = b.history[0];
    assert.strictEqual(h.receiptId, '（スケジュール）');
    // before に行の全文が入っていること。中身まで見る
    assert.ok(h.before && h.before.indexOf('看板の入稿') >= 0,
      'タスク名が履歴に残っていません: ' + h.before);
    assert.ok(h.before.indexOf('入稿データはAさんが持っている') >= 0,
      '詳細が履歴に残っていません: ' + h.before);
    assert.ok(h.before.indexOf('締切厳守') >= 0,
      '備考が履歴に残っていません: ' + h.before);
  });

  test('削除した人の名前が残る', () => {
    const b = makeBox({});
    save(b, { row: 0, item: TASK });
    b.history.length = 0;
    del(b, 2, '成田');
    assert.strictEqual(b.history[0].operator, '成田');
  });

  test('存在しない行の削除は断る', () => {
    const b = makeBox({});
    save(b, { row: 0, item: TASK });
    for (const bad of [0, 1, 99, -1]) {
      const r = del(b, bad);
      assert.strictEqual(r.ok, false, bad + ' 行目の削除が通りました');
    }
    assert.strictEqual(load(b).rows.length, 1, '行が消えました');
  });

  test('見出しの行（1行目）は削除できない', () => {
    const b = makeBox({});
    save(b, { row: 0, item: TASK });
    del(b, 1);
    assert.deepStrictEqual(b.sheets['制作スケジュール'].grid[0], SCHED_HEADERS);
  });
});

// ─────────────────────────────── 確認事項からの移行（§5-3-10）
/** setup() の移行だけを、体裁づけ（色・幅・入力規則）と切り離して動かす */
function makeMigrationBox(todoRows, opts) {
  opts = opts || {};
  const admin = read('gas/Admin.gs');
  const sched = read('gas/Sched.gs');
  const TODO_HEADERS = ['状態', '内容', '担当', '期日', '起票者', '起票日', '完了日', 'メモ'];

  const sheets = {
    '確認事項': makeSheet(TODO_HEADERS, todoRows || []),
    '制作スケジュール': makeSheet(SCHED_HEADERS, []),
    '関係者': makeSheet(PEOPLE_HEADERS, opts.people || [
      ['小谷', 'FC大阪', '事業部', 'kotani@example.com', 'する', 'する', '担当', 'ON'],
    ]),
  };
  const renamed = [];
  Object.keys(sheets).forEach(name => {
    sheets[name].setName = to => { renamed.push({ from: name, to: to }); };
  });
  const logs = [];

  const ss = {
    getSheetByName: name => sheets[name] || null,
  };

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Date, parseInt,
    console: { error() {}, log: m => logs.push(String(m)) },
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    LOCK_WAIT_MS: 30000,
    Utilities: { formatDate: () => '2026-09-10' },
    SHEET: { SCHED: '制作スケジュール', PEOPLE: '関係者', TODO: '確認事項', HISTORY: '変更履歴' },
    sheet_: name => sheets[name],
    appendHistory: () => {},
  });
  vm.runInContext([
    cutFunction(admin, 'asText_'),
    cutFunction(admin, 'safeCellText_'),
    cutFunction(admin, 'normalizeDue_'),
  ].join('\n'), box);
  vm.runInContext(sched, box);

  box.__ss = ss;
  const moved = vm.runInContext('schedMigrateTodos_(__ss)', box);
  return { sheets, renamed, logs, moved, box };
}

/** 移行後の制作スケジュールの行を、列名で引ける形にする */
function migratedRow(m, n) {
  const line = m.sheets['制作スケジュール'].grid[n - 1] || [];
  const o = {};
  SCHED_HEADERS.forEach((h, i) => { o[h] = line[i]; });
  return o;
}

describe('① 確認事項からの移行（§5-3-10）', () => {

  const TODOS = [
    ['未着手', '会場図の最終版をもらう', '小谷', '2026-09-12', 'けいた', '2026-09-01', '', '9/7の定例で'],
    ['完了', '電源の可否を確認', '小谷', '2026-09-07', 'けいた', '2026-09-01', '2026-09-07', ''],
    ['確認中', '搬入経路の図面', '', '', 'けいた', '2026-09-02', '', ''],
  ];

  test('確認事項の行が、全部移る', () => {
    const m = makeMigrationBox(TODOS);
    assert.strictEqual(m.moved, 3, '移した件数が合いません');
    assert.strictEqual(m.sheets['制作スケジュール'].grid.length, 4);  // 見出し＋3行
  });

  test('内容・期日・メモ・起票者が、対応する列に入る', () => {
    const m = makeMigrationBox(TODOS);
    const r = migratedRow(m, 2);
    assert.strictEqual(r['タスク名'], '会場図の最終版をもらう');
    assert.strictEqual(r['日付'], '2026-09-12');
    assert.strictEqual(r['備考'], '9/7の定例で');
    assert.strictEqual(r['起票者'], 'けいた');
    assert.strictEqual(r['起票日'], '2026-09-01');
  });

  test('状態がステータスに移り、完了日も引き継ぐ', () => {
    const m = makeMigrationBox(TODOS);
    assert.strictEqual(migratedRow(m, 2)['ステータス'], '未着手');
    assert.strictEqual(migratedRow(m, 3)['ステータス'], '完了');
    assert.strictEqual(migratedRow(m, 3)['完了日'], '2026-09-07');
    assert.strictEqual(migratedRow(m, 4)['ステータス'], '確認中');
  });

  test('種類は「タスク」、領域は「会議」になる', () => {
    // 確認事項は打ち合わせの宿題なので、領域は会議（§3-5）
    const m = makeMigrationBox(TODOS);
    assert.strictEqual(migratedRow(m, 2)['種類'], 'タスク');
    assert.strictEqual(migratedRow(m, 2)['領域'], '会議');
  });

  test('関係者にいる担当は、担当者と担当会社に入る', () => {
    const m = makeMigrationBox(TODOS);
    assert.strictEqual(migratedRow(m, 2)['担当者'], '小谷');
    assert.strictEqual(migratedRow(m, 2)['担当会社'], 'FC大阪');
  });

  test('関係者にいない担当は、担当者にせず備考に残す', () => {
    // ここは仕様書に無い判断。担当者には「関係者シートに実在する人」しか入れられないので、
    // 知らない名前をそのまま担当者に書くと、**その行はもう画面から保存できなくなる**
    // （保存のたびに「関係者リストにありません」で断られる）。
    // 名前を捨てるわけにもいかないので、備考に残す。
    const m = makeMigrationBox([
      ['未着手', '看板の見積', '外部の田中さん', '2026-09-12', 'けいた', '2026-09-01', '', 'メモ'],
    ]);
    assert.strictEqual(migratedRow(m, 2)['担当者'], '', '知らない名前が担当者に入りました');
    assert.ok(String(migratedRow(m, 2)['備考']).indexOf('外部の田中さん') >= 0,
      '担当の名前が消えました: ' + migratedRow(m, 2)['備考']);
    assert.ok(String(migratedRow(m, 2)['備考']).indexOf('メモ') >= 0,
      '元の備考が消えました: ' + migratedRow(m, 2)['備考']);
  });

  test('元のシートは消さず、名前を変えるだけ', () => {
    // 移行に失敗した行があったときに取り返せなくなる（§3-5）
    const m = makeMigrationBox(TODOS);
    assert.strictEqual(m.sheets['確認事項'].grid.length, 4, '元シートの行が消えました');
    assert.deepStrictEqual(m.renamed, [{ from: '確認事項', to: '確認事項（移行済み）' }],
      '元シートの名前を変えていません');
  });

  test('2回実行しても、二重に移らない', () => {
    // setup() は何度でも押せる。押すたびに増えては困る
    const m = makeMigrationBox(TODOS);
    m.box.__ss = { getSheetByName: name => (name === '確認事項' ? null : m.sheets[name]) };
    const again = vm.runInContext('schedMigrateTodos_(__ss)', m.box);
    assert.strictEqual(again, 0);
    assert.strictEqual(m.sheets['制作スケジュール'].grid.length, 4, '二重に移りました');
  });

  test('0件でも「0件でした」とログに出す（黙って正常を作らない）', () => {
    // 2026-09-03 に「列を足しました」のログが出ない道があって、
    // けいたが実行できたか分からなくなった（§3-5）。
    // 2026-09-04 には setup() の戻り値がログに出ないことで、また同じ迷いが起きた
    const m = makeMigrationBox([]);
    assert.strictEqual(m.moved, 0);
    assert.ok(m.logs.length > 0, 'ログが1行も出ていません');
    assert.ok(m.logs.join(' ').indexOf('0') >= 0,
      '0件だったことが読み取れません: ' + m.logs.join(' / '));
  });

  test('移した件数がログに出る', () => {
    const m = makeMigrationBox(TODOS);
    assert.ok(m.logs.join(' ').indexOf('3') >= 0,
      '件数がログにありません: ' + m.logs.join(' / '));
  });
});

describe('① 制作スケジュール表：担当者の許可リストも、親を持たない入れ物か', () => {

  test('担当者に constructor を送っても、実在する人として通らない', () => {
    // 種類・領域・ステータスは配列の indexOf で照合しているので安全だが、
    // 担当者は「氏名 → 所属」の**入れ物のキー**で照合している。
    // 素の {} だと 'constructor' in {} が true になり、知らない名前が通る。
    for (const word of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const b = makeBox({});
      const r = save(b, { row: 0, item: Object.assign({}, TASK, { people: [word] }) });
      assert.strictEqual(r.ok, false, '担当者に ' + word + ' が通りました');
    }
  });

  test('移行のときも、constructor は担当者にならない', () => {
    const m = makeMigrationBox([
      ['未着手', '看板の見積', 'constructor', '2026-09-12', 'けいた', '2026-09-01', '', ''],
    ]);
    assert.strictEqual(migratedRow(m, 2)['担当者'], '',
      'constructor が担当者として移りました');
  });
});
