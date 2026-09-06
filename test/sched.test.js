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

/*
 * 関数の終わりの目印（改行 + } + 改行）。
 * **この行に制御文字を直接書かない。**Python やヒアドキュメントを経由して
 * 書くと本物の改行に化ける（引き継ぎ書§8。この検査を書くときにも踏んだ）。
 * fromCharCode で組み立てれば、経路によらず同じものになる。
 */
const NL = String.fromCharCode(10);
const CUT_END = NL + '}' + NL;

/** 本番のソースから関数を1つ切り出す（写しを作らないため） */
function cutFunction(code, name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' が見つかりません');
  const end = code.indexOf('\n}\n', start) + 3;
  assert.ok(end > start, name + ' の終わりが見つかりません');
  return code.slice(start, end);
}

/**
 * 仕様書 §2-1 の列 ＋ **ID**。ここがずれたら、シートの見出しと実装の両方を疑う。
 *
 * IDは仕様書に無いが、②タイムスケジュール（§2-1 の1列目）が
 * 「行の並べ替えでも変わらない印」として持っているものと同じ。
 * ①だけ行番号で指していたため、他人が1行消すと別の行を壊せた（検証役2体が指摘）。
 * 人がシートを直接見る順番を崩さないよう、**末尾**に置く。
 */
const SCHED_HEADERS = [
  '種類', '日付', '終了日', '領域', '担当会社', '担当者', 'タスク名', '詳細',
  'ステータス', '備考', '完了日', '並び順', '起票者', '起票日', '更新者', '更新日時',
  'ID',
];

const PEOPLE_HEADERS = ['氏名', '所属', '部署', 'メール', 'フォーム表示', '管理ページ利用', '役割', '通知'];

/*
 * シートの代役は **src/gasbox.js の共有のものを使う。**
 *
 * ここには写しの代役があった。それが `getValue` を持っていなかったせいで、
 * `adminSched_` に「最後に誰がいつ」を足したとたん、この検査だけが
 * `sh.getRange(...).getValue is not a function` で落ちた。
 * つまり**この検査は、設定シートを読む道を一度も通っていなかった**。
 *
 * 代役の写しを2つ持つと、片方だけが本物から遅れる。
 * 共有のほうは maxRows を数え、範囲外の getRange で例外を投げる
 * （②で `deleteRows` がシートを縮める事故を見つけたのは、この厳しさ）。
 */
const { makeSheet } = require('../src/gasbox');

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
  // 設定シートの読み書きと「最後に誰がいつ」は gas/Stamp.gs にある（②と共有・2026-09-07）
  const stamp = read('gas/Stamp.gs');
  const setup = read('gas/Setup.gs');
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
  let uuidN = 0;

  /** 箱の中の「いま」を today に固定する。引数つきの new Date(...) は素通し */
  const NOW = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1,
                       Number(today.slice(8, 10)), 12, 0, 0);
  class BoxDate extends Date {
    constructor(...a) { if (a.length === 0) super(NOW.getTime()); else super(...a); }
  }

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, parseInt,
    console: { error() {}, log() {} },
    // ── GAS の代役。本物と同じ形の失敗だけを守る
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    LOCK_WAIT_MS: 30000,
    Utilities: {
      /*
       * 渡された Date を**実際に整形する**。
       * 以前はどんな Date でも `today` を返していたので、
       * 「シートが Date を返してくる」場合の取り違えを一度も再現できなかった
       * （検証役の指摘・2026-09-04）。代役が本物より優しいと、そのぶん穴が開く。
       */
      formatDate(d, tz, fmt) {
        const p = n => String(n).padStart(2, '0');
        const ymd = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        if (fmt === 'yyyy-MM-dd') return ymd;
        return ymd + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      },
      // 呼ぶたびに違う値を返す。定数にすると全行が同じIDになり、
      // 「行を見分ける印」という肝心の性質を検査できない
      getUuid: () => { uuidN++; return ('0000000' + uuidN).slice(-8) + '-aaaa-bbbb'; },
    },
    // 「サーバーの今日」を固定する。new Date() だけを差し替えるので、
    // schedToday_() は today を返し、シートから来る Date はそのまま扱われる
    Date: BoxDate,
    SHEET: { SCHED: '制作スケジュール', PEOPLE: '関係者', TODO: '確認事項', HISTORY: '変更履歴' },
    // 設定シートの読み取りの代役。本番は gas/Config.gs の configNumber
    configNumber: (k) => {
      if (k !== 'スケジュールの警告日数') return null;
      const v = opts.warnDays;
      if (v === undefined) return 3;
      const n = Number(v);
      return (typeof v === 'number' || typeof v === 'string') && isFinite(n) ? n : null;
    },
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

  vm.runInContext(cutFunction(setup, 'findConfigRow_'), box);
  vm.runInContext(stamp, box);
  vm.runInContext(sched, box);
  return { box, sheets, history, today };
}

/**
 * 保存を1回呼ぶ。返り値は素の値に写す（VMのオブジェクトは deepStrictEqual で一致しない）。
 *
 * 既存行を指すときは **ID も一緒に送るのが新しい約束**（他人が1行消しても
 * 別の行を壊さないため）。呼び出し側が id を書いていなければ、
 * いまシートに入っている値を自動で添える。
 * 「IDを送らなかったらどうなるか」を確かめたいときは、明示的に id:'' を渡す。
 */
function save(b, payload, person) {
  if (payload && payload.row > 0 && !('id' in payload)) {
    const cur = b.sheets['制作スケジュール'].grid[payload.row - 1] || [];
    payload = Object.assign({}, payload, { id: cur[16] });
  }
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
  const cur = b.sheets['制作スケジュール'].grid[row - 1] || [];
  return del2(b, row, cur[16], person);
}

function del2(b, row, id, person) {
  b.box.__auth = { person: person || '小谷', company: 'FC大阪' };
  b.box.__payload = { row: row, id: id };
  return JSON.parse(JSON.stringify(
    vm.runInContext('adminSchedDelete_(__auth, __payload)', b.box) || null));
}

const TASK = { kind: 'タスク', date: '2026-09-20', area: '制作', title: '看板の入稿' };

describe('① 制作スケジュール表：中身が変わらない保存（2026-09-07）', () => {

  test('中身が変わらない保存では、更新者と更新日時を書き換えない', () => {
    /*
     * **窓を開いて何も直さずに閉じただけで「小谷が編集」と残っていた。**
     * 変更履歴のほうは「変わっていなければ残さない」と正しく判断しているのに、
     * 行のスタンプだけが毎回押されていた（けいた指摘・2026-09-07）。
     */
    const b = makeBox({});
    save(b, { row: 0, item: TASK }, '小谷');
    const before = rowAt(b, 2);
    save(b, { row: 2, item: TASK }, '山本');          // 中身は同じ、別の人が保存
    const after = rowAt(b, 2);
    assert.strictEqual(after['更新者'], before['更新者'],
      '中身が同じなのに更新者が書き換わりました');
    assert.strictEqual(after['更新日時'], before['更新日時'],
      '中身が同じなのに更新日時が書き換わりました');
  });

  test('中身が変われば、更新者と更新日時は書き換わる', () => {
    // 「書き換えない」だけを見ると、**何をしても書き換えない実装**でも通ってしまう
    const b = makeBox({});
    save(b, { row: 0, item: TASK }, '小谷');
    save(b, { row: 2, item: Object.assign({}, TASK, { title: '看板の再入稿' }) }, '山本');
    assert.strictEqual(rowAt(b, 2)['更新者'], '山本',
      '中身が変わったのに更新者が書き換わりません');
  });

  test('中身が変わらなければ、変更履歴にも足さない', () => {
    const b = makeBox({});
    save(b, { row: 0, item: TASK }, '小谷');
    const n = b.history.length;
    save(b, { row: 2, item: TASK }, '山本');
    assert.strictEqual(b.history.length, n, '変わっていないのに変更履歴が増えました');
  });
});

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
    // **同名のシートがあれば例外**。本物の Sheets はそうする。
    // 以前の代役は衝突しても成功していたので、
    // 「2回目以降の setup() が落ちる」事故を絶対に捕まえられなかった（検証役の指摘）
    sheets[name].setName = to => {
      if (sheets[to]) throw new Error('シート「' + to + '」は既にあります');
      sheets[to] = sheets[name];
      delete sheets[name];
      renamed.push({ from: name, to: to });
    };
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
    Utilities: {
      formatDate: () => '2026-09-10',
      getUuid: () => 'ab' + Math.random().toString(16).slice(2, 10) + 'cd',
    },
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
    // 先に「改名したか」を見る。改名していないと下の行が
    // TypeError になって、理由が読み取れなくなる
    assert.deepStrictEqual(m.renamed, [{ from: '確認事項', to: '確認事項（移行済み）' }],
      '元シートの名前を変えていません');
    assert.strictEqual(m.sheets['確認事項（移行済み）'].grid.length, 4,
      '元シートの行が消えました');
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

// ─────────────────────────── 模擬サーバーを通しで動かす
/** 模擬サーバーを、毎回まっさらに読み直す */
function freshMock() {
  const p = require.resolve('../src/mock.js');
  delete require.cache[p];
  return require(p);
}
function mockLogin(M, pw, person) {
  const r = M.handle({ action: 'adminLogin', password: pw, person: person });
  assert.ok(r.ok, '入室できません：' + JSON.stringify(r));
  return r.token;
}

describe('① 模擬サーバーが、本番と同じように動くか', () => {

  test('模擬でも、ふつうに追加できる', () => {
    // 検証役の指摘（2026-09-04）：模擬の切り出しが CRLF で空になり、
    // 保存が 100% "asText_ is not defined" で落ちていた。
    // 画面を作っても一度も動かせない状態だったのに、テスト832件は全部通っていた。
    const M = freshMock();
    const tok = mockLogin(M, 'admin', '山田 太郎');
    const r = M.handle({ action: 'adminSchedSave', token: tok, row: 0,
      item: { kind: 'タスク', date: '2026-09-20', area: '制作', title: '模擬から追加' } });
    assert.strictEqual(r.ok, true, '模擬で保存できません：' + JSON.stringify(r));
  });

  test('模擬でも、本番と同じ理由で断る', () => {
    const M = freshMock();
    const tok = mockLogin(M, 'admin', '山田 太郎');
    const r = M.handle({ action: 'adminSchedSave', token: tok, row: 0,
      item: { kind: 'タスク', date: '2026-09-20', area: '制作', title: '' } });
    assert.strictEqual(r.ok, false);
    assert.ok(/タスク名/.test(r.message || ''), '本番と違う理由です：' + JSON.stringify(r));
  });

  test('模擬でも、知らない種類は断る', () => {
    const M = freshMock();
    const tok = mockLogin(M, 'admin', '山田 太郎');
    const r = M.handle({ action: 'adminSchedSave', token: tok, row: 0,
      item: { kind: 'constructor', date: '2026-09-20', area: '制作', title: 'x' } });
    assert.strictEqual(r.ok, false, '模擬で constructor が通りました');
  });

  test('模擬の「今日」が、日本時間である', () => {
    // 模擬が UTC だと、JST 00:00〜09:00 のあいだ模擬だけ1日前になり、
    // 遅れの境目を模擬で確かめると本番とずれる
    const M = freshMock();
    const tok = mockLogin(M, 'admin', '山田 太郎');
    const got = M.handle({ action: 'adminSched', token: tok });
    const jst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    assert.strictEqual(got.today, jst, '模擬の today が日本時間ではありません');
  });
});

describe('① 行の取り違え：他人が消しても、別の行を壊さない', () => {

  const A = { kind: 'タスク', date: '2026-09-10', area: '制作', title: 'Aの行' };
  const B = { kind: 'タスク', date: '2026-09-11', area: '制作', title: 'Bの行' };
  const C = { kind: 'タスク', date: '2026-09-12', area: '制作', title: 'Cの行' };

  test('追加すると、行を見分けるIDが付く', () => {
    const b = makeBox({});
    save(b, { row: 0, item: A });
    save(b, { row: 0, item: B });
    const rows = load(b).rows;
    assert.match(String(rows[0].id), /^[0-9a-z]{8}$/i, 'IDが8桁ではありません: ' + rows[0].id);
    assert.notStrictEqual(rows[0].id, rows[1].id, '同じIDが2行に付きました');
  });

  test('他人がAを消したあと、古い行番号でBを保存しても、Cを壊さない', () => {
    // 検証役2体が独立に見つけた最重要の指摘（2026-09-04）。
    // 行を「何行目か」だけで指していたため、
    // Cの中身がBの内容で丸ごと上書きされ、ok:true が返っていた。
    const b = makeBox({});
    save(b, { row: 0, item: A });
    save(b, { row: 0, item: B });
    save(b, { row: 0, item: C });
    const bId = load(b).rows[1].id;

    del(b, 2);                       // 乙がAを消す。BとCが1つずつ繰り上がる

    // 甲は「row 3 ＝ Bの行」のつもりで保存する（IDはBのもの）
    const r = save(b, { row: 3, id: bId, item: Object.assign({}, B, { title: 'Bを直した' }) });
    assert.strictEqual(r.ok, true, 'IDが合っているのに断られました：' + JSON.stringify(r));

    const after = load(b).rows;
    assert.strictEqual(after.length, 2);
    assert.strictEqual(after[0].title, 'Bを直した', 'Bが更新されていません');
    assert.strictEqual(after[1].title, 'Cの行', 'Cが壊れました：' + after[1].title);
  });

  test('他人が消した行を保存しようとしたら、断る', () => {
    const b = makeBox({});
    save(b, { row: 0, item: A });
    save(b, { row: 0, item: B });
    const aId = load(b).rows[0].id;
    del(b, 2);                       // Aが消える

    const r = save(b, { row: 2, id: aId, item: Object.assign({}, A, { title: 'Aを直した' }) });
    assert.strictEqual(r.ok, false, '消えた行への保存が通りました');
    assert.ok(/読み込み直|削除/.test(r.message || ''),
      '次に何をすればよいか書かれていません：' + JSON.stringify(r));
    assert.strictEqual(load(b).rows[0].title, 'Bの行', 'Bが壊れました');
  });

  test('同じ削除を2回送っても、2回目は別の行を消さない', () => {
    const b = makeBox({});
    save(b, { row: 0, item: A });
    save(b, { row: 0, item: B });
    const aId = load(b).rows[0].id;

    const r1 = del2(b, 2, aId);
    assert.strictEqual(r1.ok, true, JSON.stringify(r1));
    const r2 = del2(b, 2, aId);
    assert.strictEqual(r2.ok, false, '2回目の削除が通りました（Bが消えます）');
    assert.strictEqual(load(b).rows.length, 1);
    assert.strictEqual(load(b).rows[0].title, 'Bの行', 'Bが消えました');
  });

  test('IDを送らずに更新しようとしたら、断る', () => {
    // 古い画面や、壊れた送信。黙って別の行を書くより、断って読み直させる
    const b = makeBox({});
    save(b, { row: 0, item: A });
    const r = save(b, { row: 2, id: '', item: Object.assign({}, A, { title: '直した' }) });
    assert.strictEqual(r.ok, false, 'IDなしの更新が通りました');
  });
});

describe('① 自社の担当だけ：me.company は本番でも入るか', () => {

  test('入室している人の所属が、me.company に入る', () => {
    // gas/Auth.gs が返す auth は { person, role } だけで、company を持たない。
    // 「自社の担当だけ」の絞り込み（仕様§4-3）が本番で必ず死んでいた。
    // テストが auth を自分で作って company を持たせていたので気づけなかった
    const b = makeBox({});
    b.box.__auth = { person: '小谷', role: '一般' };   // 本番と同じ形
    const got = JSON.parse(JSON.stringify(
      vm.runInContext('adminSched_(__auth)', b.box)));
    assert.strictEqual(got.me.company, 'FC大阪',
      'me.company が入っていません：' + JSON.stringify(got.me));
  });

  test('関係者にいない人が入室しても、落ちない', () => {
    const b = makeBox({});
    b.box.__auth = { person: '知らない人', role: '一般' };
    const got = JSON.parse(JSON.stringify(
      vm.runInContext('adminSched_(__auth)', b.box)));
    assert.strictEqual(got.me.company, '');
  });
});

describe('① 日付は、読み戻しても yyyy-MM-dd のまま', () => {

  test('シートが日付を Date で返しても、yyyy-MM-dd で返す', () => {
    // 日付列に m/d(ddd) の表示形式を付けたので、Sheets は値を Date として持つ。
    // asText_ は Date を「2026-09-20 00:00」に整形するため、
    // 仕様§3-1 の date:"2026-09-08" という約束が破れていた。
    // 代役シートが文字列を返していたので、テストでは一度も再現しなかった
    const b = makeBox({ rows: [[
      'タスク', new Date(2026, 8, 20), '', '制作', '', '', '看板の入稿', '',
      '完了', '', new Date(2026, 8, 2), 1, '小谷', new Date(2026, 8, 1), '', '',
    ]] });
    const r = load(b).rows[0];
    assert.strictEqual(r.date, '2026-09-20', 'date が化けました: ' + r.date);
    assert.strictEqual(r.doneDate, '2026-09-02', 'doneDate が化けました: ' + r.doneDate);
    assert.strictEqual(r.createdAt, '2026-09-01', 'createdAt が化けました: ' + r.createdAt);
  });
});

describe('① 模擬も、行の取り違えを防いでいるか', () => {

  test('模擬でも、追加した行にIDが付く', () => {
    const M = freshMock();
    const tok = mockLogin(M, 'admin', '山田 太郎');
    M.handle({ action: 'adminSchedSave', token: tok, row: 0,
      item: { kind: 'タスク', date: '2026-09-20', area: '制作', title: '模擬の行' } });
    const rows = M.handle({ action: 'adminSched', token: tok }).rows;
    const added = rows[rows.length - 1];
    assert.match(String(added.id), /^[0-9a-z]{8}$/i, 'IDが付いていません: ' + added.id);
  });

  test('模擬でも、他人が消した行への保存は断る', () => {
    // 模擬が本番より緩いと、画面の作り込みで「模擬では動くのに本番で壊れる」が起きる
    const M = freshMock();
    const tok = mockLogin(M, 'admin', '山田 太郎');
    const before = M.handle({ action: 'adminSched', token: tok }).rows;
    const first = before[0];

    const d = M.handle({ action: 'adminSchedDelete', token: tok, row: first.row, id: first.id });
    assert.strictEqual(d.ok, true, JSON.stringify(d));

    const r = M.handle({ action: 'adminSchedSave', token: tok, row: first.row, id: first.id,
      item: { kind: 'タスク', date: '2026-09-20', area: '制作', title: '消えた行を直す' } });
    assert.strictEqual(r.ok, false, '消えた行への保存が通りました');
    assert.ok(/読み込み直|削除/.test(r.message || ''),
      '次に何をすればよいか書かれていません：' + JSON.stringify(r));
  });

  test('模擬でも、同じ削除を2回送ると2回目は断る', () => {
    const M = freshMock();
    const tok = mockLogin(M, 'admin', '山田 太郎');
    const rows = M.handle({ action: 'adminSched', token: tok }).rows;
    const target = rows[0];
    const n = rows.length;

    assert.strictEqual(M.handle({ action: 'adminSchedDelete', token: tok,
      row: target.row, id: target.id }).ok, true);
    assert.strictEqual(M.handle({ action: 'adminSchedDelete', token: tok,
      row: target.row, id: target.id }).ok, false, '2回目が通りました');
    assert.strictEqual(M.handle({ action: 'adminSched', token: tok }).rows.length, n - 1,
      '2件消えました');
  });

  test('模擬でも、追加が変更履歴に残る', () => {
    const M = freshMock();
    const tok = mockLogin(M, 'admin', '山田 太郎');
    const before = M.DB.history.length;
    M.handle({ action: 'adminSchedSave', token: tok, row: 0,
      item: { kind: 'タスク', date: '2026-09-20', area: '制作', title: '履歴に残るか' } });
    assert.strictEqual(M.DB.history.length, before + 1, '追加が履歴に残りません');
  });
});

describe('① setup() を何度押しても壊れないか（§5-3-10 の続き）', () => {

  const TODOS2 = [
    ['未着手', '会場図の最終版をもらう', '小谷', '2026-09-12', 'けいた', '2026-09-01', '', ''],
  ];

  test('移行が済んでいれば、確認事項シートを作り直さない', () => {
    // setup() は setupTodoSheet_ → setupSchedSheet_ の順で走る。
    // 2回目に確認事項シートを作り直すと、一本化が破れて
    // 「確認事項」と「確認事項（移行済み）」が並ぶ（検証役の指摘・2026-09-04）
    const m = makeMigrationBox(TODOS2);
    assert.strictEqual(m.moved, 1);
    const ss = { getSheetByName: name => m.sheets[name] || null };
    m.box.__ss = ss;
    assert.strictEqual(
      vm.runInContext('schedTodoMigrated_(__ss)', m.box), true,
      '移行済みの印を見つけられません');
  });

  test('移行の前は、移行済みの印は無い', () => {
    const m = makeMigrationBox([]);
    m.box.__ss = { getSheetByName: name => m.sheets[name] || null };
    assert.strictEqual(vm.runInContext('schedTodoMigrated_(__ss)', m.box), false);
  });

  test('改名先が既にあっても、移行が例外で止まらない', () => {
    // 3回目の setup() で setName が衝突して、setup() 全体が落ちていた。
    // しかも行は追加済みなので、押すたびに増え続けた
    const m = makeMigrationBox(TODOS2);
    // もう一度「確認事項」を作り、移行済みシートも残っている状態を作る
    m.sheets['確認事項'] = m.sheets['確認事項（移行済み）'];
    m.box.__ss = { getSheetByName: name => m.sheets[name] || null };
    const again = vm.runInContext('schedMigrateTodos_(__ss)', m.box);
    assert.ok(typeof again === 'number', '例外で止まりました');
  });
});

describe('① 更新も、変更履歴に残るか', () => {

  test('タスク名を書き換えると、前の値が変更履歴に残る', () => {
    // 削除は全文を残すのに、**上書きは痕跡ゼロ**だった（検証役2体が指摘）。
    // 全員が編集できる画面では、削除より上書きのほうが復元しにくいのは逆
    const b = makeBox({});
    save(b, { row: 0, item: Object.assign({}, TASK, { detail: '大事な詳細' }) });
    b.history.length = 0;
    save(b, { row: 2, item: Object.assign({}, TASK, { title: '別の名前に変えた' }) });

    assert.strictEqual(b.history.length, 1, '更新が履歴に残っていません');
    const h = b.history[0];
    assert.strictEqual(h.receiptId, '（スケジュール）');
    assert.ok(String(h.before).indexOf('看板の入稿') >= 0,
      '前のタスク名が残っていません: ' + h.before);
    assert.ok(String(h.before).indexOf('大事な詳細') >= 0,
      '前の詳細が残っていません: ' + h.before);
    assert.ok(String(h.after).indexOf('別の名前に変えた') >= 0,
      '後の値が残っていません: ' + h.after);
  });

  test('何も変えずに保存したときは、履歴を増やさない', () => {
    // ステータスのチップを押すたびに履歴が増えると、本当の変更が埋もれる
    const b = makeBox({});
    save(b, { row: 0, item: TASK });
    b.history.length = 0;
    save(b, { row: 2, item: TASK });
    assert.strictEqual(b.history.length, 0, '変わっていないのに履歴が増えました');
  });
});

describe('① 担当会社の上限（際限なく書けない）', () => {

  test('担当会社が多すぎたら断る', () => {
    // タスク名200・詳細1000・備考500 は効いているのに、担当会社だけ素通しだった。
    // 検証役が 3,000件（18万字）を通し、10万件で9分52秒かかることを実測
    const b = makeBox({});
    const many = new Array(3000).fill(0).map((_, i) => 'company-' + i);
    const r = save(b, { row: 0, item: Object.assign({}, TASK, { companies: many }) });
    assert.strictEqual(r.ok, false, '3000社が通りました');
    assert.ok(r.message && r.message.length > 0, '理由がありません');
  });

  test('担当者が多すぎたら断る', () => {
    const b = makeBox({});
    const many = new Array(3000).fill('小谷');
    const r = save(b, { row: 0, item: Object.assign({}, TASK, { people: many }) });
    assert.strictEqual(r.ok, false, '3000人が通りました');
  });

  test('ふつうの件数は通る', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TASK,
      { companies: ['FC大阪', 'UPDATER', 'LOP', '○○印刷'] }) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });
});

describe('① 型を見る：読み取れないものは、読み取れないと返す', () => {

  test('タスク名にオブジェクトを入れても「[object Object]」にしない', () => {
    // 検証役の指摘（2026-09-04）：配列での文字数回避は塞いだのに、
    // オブジェクトは素通りして台帳に「[object Object]」の行が残っていた
    const b = makeBox({});
    // ラベルは typeof で作る。String({toString:1}) は例外を投げるので、
    // 検査のメッセージを組むところで落ちてしまう（実際に落ちた）
    for (const bad of [{}, { toString: 1 }, [], [[]], () => 1, true, false]) {
      const r = save(b, { row: 0, item: Object.assign({}, TASK, { title: bad }) });
      assert.strictEqual(r.ok, false,
        typeof bad + ' の値が通りました：' + JSON.stringify(r));
    }
    assert.strictEqual(load(b).rows.length, 0, '行が作られました');
  });

  test('詳細・備考も、オブジェクトなら断る', () => {
    for (const key of ['detail', 'memo']) {
      const b = makeBox({});
      const item = Object.assign({}, TASK); item[key] = { a: 1 };
      const r = save(b, { row: 0, item: item });
      assert.strictEqual(r.ok, false, key + ' にオブジェクトが通りました');
    }
  });

  test('文字と数は、そのまま受ける', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TASK, { title: '第1期', memo: 3 }) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });

  test('row が読めないときは、黙って新規追加にしない', () => {
    // Number(payload.row) || 0 だったので、"2abc" や {} が全部「新規」になり、
    // 画面が壊れて row を落とすたびに重複行が増えていた
    const b = makeBox({});
    save(b, { row: 0, item: TASK });
    for (const bad of ['2abc', {}, [], 'あ', '２', true, 2.5, Infinity]) {
      const r = save(b, { row: bad, id: 'x', item: TASK });
      assert.strictEqual(r.ok, false,
        'row=' + typeof bad + ' が通りました：' + JSON.stringify(r));
    }
    assert.strictEqual(load(b).rows.length, 1, '行が増えました');
  });

  test('row を省いたときだけ、新規追加になる', () => {
    const b = makeBox({});
    assert.strictEqual(save(b, { item: TASK }).ok, true);
    assert.strictEqual(save(b, { row: 0, item: TASK }).ok, true);
    assert.strictEqual(load(b).rows.length, 2);
  });

  test('payload や item が壊れていたら、そう伝える', () => {
    // 「領域が正しくありません。」と返っていたので、読んだ人は領域欄を探しに行く
    const b = makeBox({});
    for (const bad of [null, 'もじ', [], 0, true]) {
      const r = save(b, { row: 0, item: bad });
      assert.strictEqual(r.ok, false);
      assert.ok(!/領域/.test(r.message || ''),
        '関係のない「領域」が理由に出ました：' + JSON.stringify(r));
    }
  });

  test('領域を選んでいないときは、そう言う', () => {
    const b = makeBox({});
    const item = Object.assign({}, TASK); delete item.area;
    const r = save(b, { row: 0, item: item });
    assert.strictEqual(r.ok, false);
    assert.ok(/領域をお選び/.test(r.message || ''),
      '「正しくありません」では、何をすればよいか分かりません：' + JSON.stringify(r));
  });
});

describe('① 日付は、日付の形のものだけ受ける', () => {

  test('文字列の一部から日付を拾わない', () => {
    // normalizeDue_ の正規表現に ^…$ が無いので、任意の文字列から
    // 4桁の並びを拾っていた（検証役の指摘）
    const b = makeBox({});
    for (const bad of ['鈴木2026-09-08です', 'javascript:2026-01-01', 'x 2026-09-08']) {
      const r = save(b, { row: 0, item: Object.assign({}, TASK, { date: bad }) });
      assert.strictEqual(r.ok, false, bad + ' が通りました');
    }
  });

  test('実在しない日付は断る', () => {
    const b = makeBox({});
    for (const bad of ['2026-02-31', '2026-04-31', '2027-02-29']) {
      const r = save(b, { row: 0, item: Object.assign({}, TASK, { date: bad }) });
      assert.strictEqual(r.ok, false, bad + ' が通りました');
    }
  });

  test('うるう年の2/29は通る', () => {
    const b = makeBox({});
    const r = save(b, { row: 0, item: Object.assign({}, TASK, { date: '2028-02-29' }) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
  });

  test('ふつうの書き方は通る', () => {
    for (const ok of ['2026-09-08', '2026/9/8', '9/8', '２０２６-０９-０８']) {
      const b = makeBox({});
      const r = save(b, { row: 0, item: Object.assign({}, TASK, { date: ok }) });
      assert.strictEqual(r.ok, true, ok + ' が断られました：' + JSON.stringify(r));
    }
  });

  test('マイルストーンには日付が要る', () => {
    // 日付が空だと、どの週にも入らず画面から見えなくなる。期間は必須にしてあるのに
    // マイルストーンだけ空で通っていた
    const b = makeBox({});
    const r = save(b, { row: 0, item: { kind: 'マイルストーン', area: '全体', title: '本番' } });
    assert.strictEqual(r.ok, false, '日付のないマイルストーンが通りました');
  });
});

describe('① 画面：hidden が効く形になっているか', () => {

  const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

  test('display を持つ入れ物に、hidden を効かせる規則がある', () => {
    // ブラウザ既定の [hidden]{display:none} は詳細度 0,1,0 しかないので、
    // .editrow{display:grid} や .sch-bar{display:flex} に負ける。
    // 2026-09-04、「種類がタスクなのに終了日の欄が出る」形で実際に踏んだ。
    // HTMLもJSも正しいのに CSS だけで機能が死ぬので、目で見るまで気づけない
    for (const sel of ['.editrow[hidden]', '.sch-bar[hidden]', '.sch-terms[hidden]']) {
      assert.ok(ADMIN.indexOf(sel) >= 0,
        sel + ' の規則がありません。hidden を付けても消えません');
    }
  });

  test('画面が、選択肢の一覧を自分で持っていない（§5-5）', () => {
    /*
     * 危ないのは**一覧を2か所に持つこと**。選択肢を1つ足したときに、
     * 画面側だけ古いまま残る。正は gas/Sched.gs の
     * SCHED_AREAS_ / SCHED_STATUSES_ で、画面は adminSched が返した配列から組む。
     *
     * 「完了にしたらえふし君を出す」のように、**その値そのものが意味を持つ**
     * 処理は別もの。最初これも禁じる書き方にしてしまい、
     * 正しいコードが落ちた（検査が厳しすぎた）。
     * ここでは「名前が2つ以上、近くに並んでいる＝一覧」を探す。
     */
    const js = ADMIN.slice(ADMIN.indexOf('// ─────────────────────────────────────────── ① 制作スケジュール表'));
    const near = (a, b) => {
      const i = js.indexOf("'" + a + "'");
      if (i < 0) return false;
      return js.slice(i, i + 90).indexOf("'" + b + "'") >= 0;
    };
    assert.ok(!near('未着手', '進行中'), 'ステータスの一覧が画面に直書きされています');
    assert.ok(!near('確認中', '完了'), 'ステータスの一覧が画面に直書きされています');
    assert.ok(!near('全体', '会議'), '領域の一覧が画面に直書きされています');
    assert.ok(!near('企画', '営業'), '領域の一覧が画面に直書きされています');
  });

  test('タブの4か所が、そろって足されている', () => {
    // ボタン／showTab の許可リスト／HOWTO／<section> のどれかを忘れると、
    // 「タブはあるのに開かない」「開くのに中身が無い」になる
    assert.ok(ADMIN.indexOf('data-tab="sched"') >= 0, 'タブのボタンがありません');
    assert.ok(ADMIN.indexOf("'sched'") >= 0, 'showTab の許可リストにありません');
    assert.ok(ADMIN.indexOf('id="v-sched"') >= 0, '中身の <section> がありません');
    assert.ok(ADMIN.indexOf('制作スケジュール表の見かた') >= 0, 'HOWTO がありません');
  });

  test('詳細のURLは、共有のリンク化関数を通している', () => {
    // src/linkify.js を .toString() で埋め込んでいること＋実際に呼んでいること。
    // どちらか片方だけだと、素の esc で済ませても誰も止められない
    assert.ok(ADMIN.indexOf('function linkifyDetail(text, esc)') >= 0,
      'linkifyDetail が画面に埋め込まれていません');
    /*
     * **①のコードの中を見る。**
     * 2026-09-05、②も同じ関数を共有したので、ファイル全体を見る形だと
     * 「どこかにあればよい」になり、①側を素の esc に戻しても通ってしまった
     * （わざと壊す検査が [NG] 落ちず を出して発覚）。
     */
    const at = ADMIN.indexOf('linkifyDetail(r.detail, esc)');
    const ttStarts = ADMIN.indexOf('var TT = { rows: []');
    assert.ok(ttStarts > 0, '②の始まりを見つけられませんでした');
    assert.ok(at >= 0 && at < ttStarts,
      '詳細の描画が linkifyDetail を通っていません');
  });
});

describe('① 画面の規則を、実際に呼んで確かめる（§5-4 の 5・6・6b）', () => {
  /*
   * 画面の中の関数を、admin.html から切り出して呼ぶ。
   * 「終わったもの」の判定は**目で見ても正しさが分からない**（隠れたものは見えない）。
   * 呼べるようにして呼ぶ、が引き継ぎ書§9 の結論。
   */
  function screenBox(today){
    const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    const cut = (name) => {
      const s = html.indexOf('function ' + name + '(');
      assert.ok(s >= 0, name + ' が画面にありません');
      const e = html.indexOf('\n}\n', s) + 3;
      assert.ok(e > s, name + ' の終わりが見つかりません');
      return html.slice(s, e);
    };
    const box = vm.createContext({ Math, Date, Number, String, Array, Object });
    vm.runInContext('var SCH = { today: ' + JSON.stringify(today) + ' };\n'
      + cut('schIsDone') + cut('schIsLate') + cut('schIsSoon') + cut('schDayDiff'), box);
    return box;
  }
  const call = (box, fn, row) => {
    box.__r = row;
    return vm.runInContext(fn + '(__r)', box);
  };

  const B = () => screenBox('2026-09-10');

  test('未着手は、期日を過ぎても「終わったもの」にしない', () => {
    // v2では「完了を隠す」だったので、遅れているものが消えかねなかった
    for (const st of ['未着手', '進行中', '確認中', '停滞中']) {
      assert.strictEqual(
        call(B(), 'schIsDone', { kind: 'タスク', status: st, date: '2026-09-01' }), false,
        st + ' が「終わったもの」に入りました');
    }
  });

  test('期日が来ていない完了は、隠さない', () => {
    // 先の予定を早めに終わらせたものが消えると、やったことが見えなくなる
    assert.strictEqual(
      call(B(), 'schIsDone', { kind: 'タスク', status: '完了', date: '2026-09-20' }), false,
      '期日前の完了が隠れました');
  });

  test('期日を過ぎて決着したものは、隠す', () => {
    for (const st of ['完了', '見送り']) {
      assert.strictEqual(
        call(B(), 'schIsDone', { kind: 'タスク', status: st, date: '2026-09-01' }), true,
        st + ' が隠れません');
    }
  });

  test('終わった期間・過ぎたマイルストーンも「終わったもの」', () => {
    assert.strictEqual(call(B(), 'schIsDone',
      { kind: '期間', date: '2026-08-01', endDate: '2026-09-01' }), true);
    assert.strictEqual(call(B(), 'schIsDone',
      { kind: '期間', date: '2026-09-01', endDate: '2026-09-30' }), false);
    assert.strictEqual(call(B(), 'schIsDone',
      { kind: 'マイルストーン', date: '2026-09-01' }), true);
    assert.strictEqual(call(B(), 'schIsDone',
      { kind: 'マイルストーン', date: '2026-10-24' }), false);
  });

  test('遅れの判定は、決着したものを含めない', () => {
    assert.strictEqual(call(B(), 'schIsLate',
      { kind: 'タスク', status: '未着手', date: '2026-09-01' }), true);
    assert.strictEqual(call(B(), 'schIsLate',
      { kind: 'タスク', status: '完了', date: '2026-09-01' }), false);
    assert.strictEqual(call(B(), 'schIsLate',
      { kind: 'タスク', status: '未着手', date: '' }), false);
  });

  test('遅れの判定は、サーバーの今日を使っている（端末の日付を見ない・§5-4の10）', () => {
    // SCH.today だけを差し替えて、結果が変わることを見る。
    // 端末の日付を見ていたら、ここを変えても結果は変わらない
    const early = screenBox('2026-08-01');
    const late = screenBox('2026-09-10');
    const row = { kind: 'タスク', status: '未着手', date: '2026-09-01' };
    assert.strictEqual(call(early, 'schIsLate', row), false,
      'サーバーの today を無視して、端末の日付で判定しています');
    assert.strictEqual(call(late, 'schIsLate', row), true,
      'サーバーの today を無視して、端末の日付で判定しています');
  });

  test('「あと3日」の注意は、未着手と停滞中だけに出す', () => {
    const b = () => screenBox('2026-09-10');
    assert.strictEqual(call(b(), 'schIsSoon',
      { kind: 'タスク', status: '未着手', date: '2026-09-12' }), true);
    assert.strictEqual(call(b(), 'schIsSoon',
      { kind: 'タスク', status: '進行中', date: '2026-09-12' }), false,
      '進行中にまで注意が出ています');
    assert.strictEqual(call(b(), 'schIsSoon',
      { kind: 'タスク', status: '未着手', date: '2026-09-20' }), false);
  });

  test('「終わったもの」のボタンは、件数を出し、0件なら出さない（§5-4の6b）', () => {
    const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    assert.ok(html.indexOf("db.hidden = doneCount === 0") >= 0,
      '0件のときにボタンを隠していません');
    assert.ok(html.indexOf("'終わったもの ' + doneCount + '件を表示'") >= 0,
      'ボタンに隠れている件数が出ていません');
  });

  test('曜日は列として持たず、表示のときに付ける（§5-4の7）', () => {
    const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    assert.ok(html.indexOf('function schShowDate') >= 0, '曜日を付ける関数がありません');
    assert.ok(html.indexOf("'曜日'") < 0, '曜日を列として持とうとしています');
  });
});

describe('①「まもなく」の日数は、設定から変えられる（§4-4）', () => {

  test('サーバーが、警告日数を返す', () => {
    const b = makeBox({});
    assert.strictEqual(typeof load(b).warnDays, 'number',
      'warnDays を返していません');
    assert.ok(load(b).warnDays >= 1, '既定値が入っていません');
  });

  test('設定を変えると、返る値も変わる', () => {
    const b = makeBox({ warnDays: 7 });
    assert.strictEqual(load(b).warnDays, 7);
  });

  test('設定が空・読めないときは、既定の3にする', () => {
    // 「空欄なら0」にすると、まもなくの色が**一度も出なくなる**
    // （単価が空欄で0円になった件と同じ倒し方をしない）
    for (const bad of [null, '', 'あ', 0, -5]) {
      const b = makeBox({ warnDays: bad });
      assert.strictEqual(load(b).warnDays, 3, JSON.stringify(bad) + ' で既定に落ちません');
    }
  });

  test('画面の「まもなく」判定が、その日数を使う', () => {
    const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    const s = html.indexOf('function schIsSoon(');
    const e = html.indexOf('\n}\n', s) + 3;
    const body = html.slice(s, e);
    assert.ok(body.indexOf('SCH.warnDays') >= 0,
      '画面が設定の日数を見ていません（3が直書きされています）: ' + body);
  });
});

describe('① ダッシュボードへの合流（§4-8）', () => {

  const ADMIN = () => fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

  test('要対応に、遅れとまもなくが出る', () => {
    const h = ADMIN();
    assert.ok(h.indexOf("'遅れている作業'") >= 0 || h.indexOf('遅れている作業') >= 0,
      '遅れが要対応に出ていません');
    assert.ok(h.indexOf('まもなく期日') >= 0, 'まもなくが要対応に出ていません');
  });

  test('リンクの言葉が、飛び先と合っている', () => {
    // 「一覧」は出店者一覧のこと。制作スケジュールへ飛ぶのに「一覧で見る」と
    // 書いていて、押す前に誤解される形だった（2026-09-04・目で見て気づいた）
    const h = ADMIN();
    assert.ok(h.indexOf("tabLabel(to.slice(4)) + 'で見る →'") >= 0,
      '飛び先の名前をリンクに使っていません');
  });

  test('ダッシュボードでは、期間の帯を押しても編集できない', () => {
    // §4-8「ダッシュボードからは追加も編集もできない」。
    // 入口を2つにすると、片方の直し忘れが必ず起きる
    const h = ADMIN();
    assert.ok(h.indexOf("schPaintTerms($('#dashTerms'), now, false)") >= 0,
      'ダッシュボードの帯が押せる形になっています');
  });

  test('帯を描く処理は、2つの画面で同じものを使っている', () => {
    const h = ADMIN();
    assert.strictEqual((h.match(/function schPaintTerms/g) || []).length, 1,
      '帯を描く処理が2つあります（片方だけ直す事故が起きます）');
    assert.ok(h.indexOf("schPaintTerms($('#schTerms')") >= 0);
    assert.ok(h.indexOf("schPaintTerms($('#dashTerms')") >= 0);
  });
});

describe('① ステータスは選んで変える／領域は前回を覚える（けいた確定・2026-09-04）', () => {

  const ADMIN = () => fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

  test('ステータスは、押すと選択肢が出る（順送りではない）', () => {
    // 「完了にしたいだけなのに4回押す」を無くす（けいた確定）
    const h = ADMIN();
    assert.ok(h.indexOf('function schStatusMenu') >= 0,
      'ステータスの選択肢を出す処理がありません');
    assert.ok(h.indexOf('function schCycleStatus') < 0,
      '順送りの処理が残っています（2つあると、どちらが動くか読めません）');
  });

  test('選択肢は、サーバーが返したものから組む', () => {
    const h = ADMIN();
    const s = h.indexOf('function schStatusMenu');
    const body = h.slice(s, h.indexOf('\n}\n', s));
    assert.ok(body.indexOf('SCH.statuses') >= 0,
      '選択肢を画面が自前で持っています: ' + body.slice(0, 200));
  });

  test('領域は、前回選んだものを覚える（実際に呼んで確かめる）', () => {
    /*
     * 最初は「localStorage.setItem という文字列があるか」で見ていた。
     * ところが `void(0 && localStorage.setItem(...))` と囲むだけで
     * **文字列は残ったまま働かなくなる**（壊し検査がすり抜けた）。
     * 形ではなく、呼んで結果を見る。
     */
    const h = ADMIN();
    const s = h.indexOf('function schCollect(');
    assert.ok(s >= 0, 'schCollect がありません');
    const e = h.indexOf(CUT_END, s) + CUT_END.length;
    const store = {};
    const box = vm.createContext({
      Array, Object, String, Number,
      localStorage: { setItem: (k, v) => { store[k] = v; }, getItem: k => store[k] || null },
      $: (sel) => ({ value: sel === '#schArea' ? '制作' : '' }),
      $$: () => [],
      SCH_AREA_KEY: 'bondance.sched.lastArea.v1',
    });
    vm.runInContext(h.slice(s, e) + ' schCollect();', box);
    assert.strictEqual(store['bondance.sched.lastArea.v1'], '制作',
      '選んだ領域を記憶していません（記録された値: ' + JSON.stringify(store) + '）');
  });

  test('覚えた領域が無いときは、「選んでください」を出す', () => {
    // 記憶が無いのに勝手な既定を入れると、選び忘れがそのまま保存される
    const h = ADMIN();
    assert.ok(h.indexOf("'選んでください'") >= 0, '選ばせる文言がありません');
  });

  test('覚えるのは領域だけ（ステータスや日付は覚えない）', () => {
    // 前回の日付を覚えると、**気づかないうちに古い日付のまま保存**される
    const h = ADMIN();
    assert.ok(h.indexOf('SCH_DATE_KEY') < 0, '日付まで覚えようとしています');
    assert.ok(h.indexOf('SCH_STATUS_KEY') < 0, 'ステータスまで覚えようとしています');
  });
});
