/**
 * 一斉メール（gas/Broadcast.gs）を、**実際に走らせて**確かめる。
 *
 * ■ なぜ形の検査にしないか
 *   引き継ぎ書 §9「形を見る検査の限界」。ソース文字列を見る検査は
 *   順序の取り違えには効くが、**入力に対する振る舞い**は捕まえられない。
 *   一斉メールで守りたいのは、まさに振る舞いのほう
 *   （誰に届くか・二度届かないか・差し込みが解決できているか）。
 *
 * ■ 代役は src/gasbox.js のものを使う
 *   写しを持つと、片方だけ厳しくしたときにもう片方が緩いまま通る。
 *   2026-09-04 の検証役が見つけた【高】5件は、どれも代役が本物より
 *   優しかったことが原因だった。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const GASBOX = require('./_gasbox');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const NL = String.fromCharCode(10);

/**
 * gas/Broadcast.gs を、周りの本物ごと箱に読み込む。
 *
 * MailTemplate.gs を**本物のまま**読むのが要点。
 * 差し込みの解決（mailtplRender_）を写しで持つと、
 * 「値が空なら行ごと落とす」規則が二重実装になってズレる。
 */
function makeBox(opts) {
  opts = opts || {};
  const history = [];
  const sentTo = [];
  const sheets = {};

  /*
   * シートの見出しは、**本番の定義（BROADCAST_HEAD）をそのまま使う**。
   * ここに見出しの写しを書くと、列を足したときに検査だけが古いまま通り、
   * 本番では列がずれて値が黙って消える（引き継ぎ書 §5「台帳の列の整合」）。
   */
  const sheetFor = name => {
    if (!sheets[name]) {
      const head = name === 'メール文面'
        ? ['種類', '件名', '本文', '更新日時', '更新者']
        : (box.BROADCAST_HEAD || ['送信ID']);
      sheets[name] = GASBOX.makeSheet(head, (opts.logRows || []).map(r => head.map(h => r[h] || '')));
      sheets[name].name = name;
    }
    return sheets[name];
  };

  /*
   * 「いま」を止められる Date。
   *
   * 24時間の判定を確かめるには、実時刻では書けない
   * （テストを流した時刻によって通ったり落ちたりする検査になる）。
   * 引数ありの呼び出しは本物のまま通す。
   */
  const FixedDate = opts.now ? class extends Date {
    constructor(...a) { if (a.length === 0) super(opts.now.getTime()); else super(...a); }
    static now() { return opts.now.getTime(); }
  } : Date;

  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Error,
    Date: FixedDate,
    console: { error() {}, log() {} },
    Utilities: GASBOX.makeUtilities({ now: opts.now }),
    CacheService: GASBOX.makeCache(opts.clock),
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { getRemainingDailyQuota: () => (opts.quota == null ? 1000 : opts.quota) },
    GmailApp: {
      sendEmail(to) {
        if (opts.failFor && opts.failFor.indexOf(to) >= 0) throw new Error('送信失敗');
        sentTo.push(to);
      },
    },
    // ── プロジェクト側
    LOCK_WAIT_MS: 1000,
    EVENT_NAME: 'テスト祭',
    SHEET: { MAILTPL: 'メール文面', BROADCAST: '一斉メール履歴' },
    sheet_: sheetFor,
    configText: (k, d) => (opts.config && k in opts.config ? opts.config[k] : d),
    appendHistory: (...a) => history.push(a),
    logError_() {},
    mailOptions_: () => ({}),
    signature_: () => '（署名）',
    eventFactsBlock_: () => '（開催概要）',
    confirmDeadlineText_: () => '2026年10月10日まで',
    diagnoseMail: () => ({ aliasRegistered: true, from: 'x@y.z', remainingQuota: 1000 }),
  });

  /*
   * sha256_ と safeEquals_ は gas/Auth.gs の**本物を切り出して**入れる。
   * 代役を書くと、今日いちばんの学び（代役が本物より優しい）を繰り返す。
   * 指紋の検査は、本物のダイジェストでなければ意味を持たない。
   */
  const AUTH = read('gas/Auth.gs');
  vm.runInContext(GASBOX.cutFunction(AUTH, 'sha256_'), box);
  vm.runInContext(GASBOX.cutFunction(AUTH, 'safeEquals_'), box);

  // 台帳の読み方（列の引き方・空行の落とし方）も本物を借りる。
  // ここを写すと「模擬では通るのに本番で落ちる」がまた起きる
  const ADMIN = read('gas/Admin.gs');
  // indexOf_ は列が無ければ例外を投げる。**この厳しさごと**借りるのが要点
  ['indexOf_', 'liveRows_', 'cell_', 'asText_'].forEach(fn => {
    vm.runInContext(GASBOX.cutFunction(ADMIN, fn), box);
  });
  vm.runInContext(ADMIN.slice(ADMIN.indexOf('var COL = {'),
    ADMIN.indexOf('};', ADMIN.indexOf('var COL = {')) + 2), box);

  vm.runInContext(read('gas/MailTemplate.gs').replace(/^\/\*\*[\s\S]*?\*\/\n/, ''), box);
  vm.runInContext(read('gas/Broadcast.gs').replace(/^\/\*\*[\s\S]*?\*\/\n/, ''), box);

  box.__history = history;
  box.__sentTo = sentTo;
  box.__sheets = sheets;
  return box;
}

/**
 * 箱の中の関数を呼んで、**素の値に写して**返す。
 *
 * 引き継ぎ書 §8：`vm.runInContext` の中で作られた配列・オブジェクトは
 * Node のものと別物で、`deepStrictEqual` は中身が同じでも一致しない
 * （`actual: []` と `expected: []` が不一致になる）。実際にここで踏んだ。
 */
function call(box, fn, ...args) {
  return JSON.parse(JSON.stringify(vm.runInContext(fn, box)(...args)));
}

/** 台帳から取った1行ぶんの形（broadcastRows_ が返すもの） */
function row(id, over) {
  return Object.assign({
    id: id,
    company: id + '社',
    shopName: '',
    person: '担当 太郎',
    email: id.toLowerCase() + '@example.com',
    status: '採択',
    block: '',
    inAt: '',
    token: 'a'.repeat(32),
  }, over || {});
}

describe('差し込みの解決（broadcastBuild_）', () => {

  test('本文の差し込みが、その行の値に置き換わる', () => {
    const box = makeBox();
    const built = call(box, 'broadcastBuild_',
      row('SB-0001', { company: '花園商店' }),
      '{{企業名}} さまへ',
      '{{お名前}} 様' + NL + '{{企業名}} の {{受付ID}} です。');

    assert.strictEqual(built.subject, '花園商店 さまへ');
    assert.ok(built.body.indexOf('担当 太郎 様') >= 0, built.body);
    assert.ok(built.body.indexOf('花園商店 の SB-0001 です。') >= 0, built.body);
  });

  test('値が空の差し込みは、その行ごと落ちる（既存の規則をそのまま使う）', () => {
    const box = makeBox();
    const built = call(box, 'broadcastBuild_',
      row('SB-0001', { block: '' }),
      '件名',
      '区画番号：{{区画番号}}' + NL + '本文は残る');

    assert.ok(built.body.indexOf('区画番号') < 0,
      '区画が空なのに「区画番号：」の行が残っています：' + built.body);
    assert.ok(built.body.indexOf('本文は残る') >= 0, built.body);
  });

  /*
   * ■ ここがこの機能の肝
   *   50社ぶんの本文を目で追うことはできないので、
   *   「落ちた行があること」を**機械が数えて画面に出す**必要がある。
   *   落ちたことに気づけないと、区画番号の無い案内が黙って届く。
   */
  test('落ちた差し込みの名前を返す（画面に出すため）', () => {
    const box = makeBox();
    const built = call(box, 'broadcastBuild_',
      row('SB-0001', { block: '', inAt: '9:00' }),
      '件名',
      '区画：{{区画番号}}' + NL + '搬入：{{搬入予定時刻}}');

    assert.deepStrictEqual(built.dropped, ['区画番号'],
      '空になった差し込みの名前を返していません');
  });

  test('区画番号と搬入予定時刻が差し込める', () => {
    const box = makeBox();
    const built = call(box, 'broadcastBuild_',
      row('SB-0001', { block: '12〜14', inAt: '9:30' }),
      '件名',
      '区画：{{区画番号}} 搬入：{{搬入予定時刻}}');

    assert.ok(built.body.indexOf('区画：12〜14 搬入：9:30') >= 0, built.body);
    assert.deepStrictEqual(built.dropped, []);
  });
});

/*
 * 保存された文面（採択・不採択）には種類ごとの規則があるが、
 * その場で書く文面には当てはめる規則が無い。
 * **当てはめられるものだけを当てる**（設計メモ §5）。
 */
describe('文面の検査（broadcastValidate_）', () => {

  const errs = (subject, body) => call(makeBox(), 'broadcastValidate_', subject, body);

  test('通る文面では何も返さない', () => {
    assert.deepStrictEqual(errs('件名', '{{お名前}} 様' + NL + '本文'), []);
  });

  test('件名が空なら断る', () => {
    assert.ok(errs('', '本文').join('').indexOf('件名') >= 0);
  });

  test('本文が空なら断る', () => {
    assert.ok(errs('件名', '   ').join('').indexOf('本文') >= 0);
  });

  /*
   * `{{担当者}}` と書いても置き換わらず、**そのまま50社に届く**。
   * 保存する文面には既に同じ検査があるが（mailtplValidate_）、
   * その場で書く文面はその経路を通らない。
   */
  test('知らない差し込みを断る', () => {
    const e = errs('件名', '{{担当者}} 様').join('');
    assert.ok(e.indexOf('担当者') >= 0, '知らない差し込みの名前を出していません：' + e);
  });

  /*
   * 採択通知にしか無い差し込みを一斉メールに書いても、値が用意されていない。
   * 「知らない差し込み」と同じ扱いで断る。
   */
  test('一斉メールで使えない差し込みを断る', () => {
    assert.ok(errs('件名', '{{素材アップロードのご案内}}').length > 0);
  });

  /*
   * 閉じ忘れ `{{お名前}` は正規表現に当たらないので、
   * 差し込みとして扱われないまま**そのまま届く**。
   * 「知らない差し込み」の検査では捕まらない別の穴。
   */
  test('括弧の閉じ忘れを断る', () => {
    const e = errs('件名', '{{お名前} 様').join('');
    assert.ok(e.length > 0, '閉じ忘れが素通りしています');
  });

  test('件名が長すぎたら断る', () => {
    assert.ok(errs('あ'.repeat(201), '本文').join('').indexOf('件名') >= 0);
  });

  test('本文が長すぎたら断る', () => {
    assert.ok(errs('件名', 'あ'.repeat(20001)).join('').indexOf('本文') >= 0);
  });
});

/*
 * ■ 一斉メールに、採択通知のような「送信日時の列」は無い
 *
 *   採択通知は台帳の列そのものが二重送信を止めている。
 *   一斉メールにはそれが無いので、札で止める。
 *
 * ■ 札に指紋を持たせる（設計メモから1つ強くした）
 *
 *   札をただの乱数にすると二重クリックしか止まらない。
 *   **プレビューで見た件名・本文・宛先の指紋**を札に結びつけると、
 *   「画面で見たものしか送れない」まで保証できる。
 */
describe('一度きりの札（broadcastTicket_ / broadcastUseTicket_）', () => {

  const ISSUE = (box, s, b, ids) => vm.runInContext('broadcastTicket_', box)(s, b, ids);
  const USE = (box, t, s, b, ids) => vm.runInContext('broadcastUseTicket_', box)(t, s, b, ids);

  test('発行した札は1回だけ通る', () => {
    const box = makeBox();
    const t = ISSUE(box, '件名', '本文', ['SB-0001', 'SB-0002']);
    assert.strictEqual(USE(box, t, '件名', '本文', ['SB-0001', 'SB-0002']), true);
  });

  test('同じ札は二度使えない（二重クリック・通信の再送）', () => {
    const box = makeBox();
    const t = ISSUE(box, '件名', '本文', ['SB-0001']);
    assert.strictEqual(USE(box, t, '件名', '本文', ['SB-0001']), true);
    assert.strictEqual(USE(box, t, '件名', '本文', ['SB-0001']), false,
      '同じ札で二度送れています');
  });

  test('知らない札では送れない', () => {
    const box = makeBox();
    ISSUE(box, '件名', '本文', ['SB-0001']);
    assert.strictEqual(USE(box, 'でっちあげ', '件名', '本文', ['SB-0001']), false);
  });

  test('件名を書き換えたら、その札では送れない', () => {
    const box = makeBox();
    const t = ISSUE(box, '当日のご案内', '本文', ['SB-0001']);
    assert.strictEqual(USE(box, t, '別の件名', '本文', ['SB-0001']), false,
      'プレビューで見ていない件名が送れています');
  });

  test('宛先を足したら、その札では送れない', () => {
    const box = makeBox();
    const t = ISSUE(box, '件名', '本文', ['SB-0001']);
    assert.strictEqual(USE(box, t, '件名', '本文', ['SB-0001', 'SB-0002']), false,
      'プレビューで見ていない相手に送れています');
  });

  test('宛先の並び順が違うだけなら通る（画面の並べ替えで弾かれない）', () => {
    const box = makeBox();
    const t = ISSUE(box, '件名', '本文', ['SB-0002', 'SB-0001']);
    assert.strictEqual(USE(box, t, '件名', '本文', ['SB-0001', 'SB-0002']), true);
  });

  /*
   * 期限を無視する代役だと、この検査は「消していないのに通る」。
   * gasbox の makeCache は期限を実際に守るので、本物の挙動で確かめられる。
   */
  test('30分を過ぎた札は使えない', () => {
    let t0 = 1000000;
    const box = makeBox({ clock: () => t0 });
    const t = ISSUE(box, '件名', '本文', ['SB-0001']);
    t0 += 31 * 60 * 1000;
    assert.strictEqual(USE(box, t, '件名', '本文', ['SB-0001']), false,
      '古いプレビューのまま送れています');
  });
});

/*
 * ■ 画面から来た値を一切信じない
 *
 *   画面は「受付IDの配列」だけを送る。企業名も宛先も台帳から引き直す。
 *   画面の値を使うと、細工した通信で任意の宛先に送れる
 *   （管理ページは公開URLにあり、守りはサーバー側だけ・引き継ぎ書 §4）。
 */
describe('受付IDで台帳を引き直す（broadcastRows_）', () => {

  const H = ['受付ID', '企業名', '出店名', '担当者氏名', '担当者メール',
             'ステータス', '割当開始区画', '割当区画数', '搬入予定時刻', '素材トークン'];

  /** 台帳の1行 */
  const L = (id, over) => Object.assign({
    '受付ID': id, '企業名': id + '社', '出店名': '', '担当者氏名': '担当 太郎',
    '担当者メール': id.toLowerCase() + '@example.com', 'ステータス': '採択',
    '割当開始区画': '', '割当区画数': '', '搬入予定時刻': '',
    '素材トークン': 'a'.repeat(32),
  }, over || {});

  function pick(rows, ids) {
    const box = makeBox();
    const ledger = { headers: H, rows: rows.map(r => H.map(h => r[h])) };
    return call(box, 'broadcastRows_', ledger, ids);
  }

  test('選んだ受付IDの行だけを返す', () => {
    const r = pick([L('SB-0001'), L('SB-0002'), L('SB-0003')], ['SB-0001', 'SB-0003']);
    assert.deepStrictEqual(r.rows.map(x => x.id), ['SB-0001', 'SB-0003']);
  });

  test('宛先と企業名は台帳から取る（画面の値を使わない）', () => {
    const r = pick([L('SB-0001', { '企業名': '本当の社名',
                                   '担当者メール': 'real@example.com' })], ['SB-0001']);
    assert.strictEqual(r.rows[0].company, '本当の社名');
    assert.strictEqual(r.rows[0].email, 'real@example.com');
  });

  test('台帳に無い受付IDは、送らずに分けて返す', () => {
    const r = pick([L('SB-0001')], ['SB-0001', 'SB-9999']);
    assert.deepStrictEqual(r.rows.map(x => x.id), ['SB-0001']);
    assert.deepStrictEqual(r.missing, ['SB-9999']);
  });

  test('宛先の形が壊れている行は、送らずに分けて返す', () => {
    const r = pick([L('SB-0001', { '担当者メール': 'こわれている' })], ['SB-0001']);
    assert.deepStrictEqual(r.rows, []);
    assert.deepStrictEqual(r.invalid.map(x => x.id), ['SB-0001']);
  });

  /*
   * 辞退・キャンセル・重複（無効）に一斉メールが届くのは、
   * **どんな絞り込みで選んだとしても事故**。絞り込みに使ったかに関わらず見る。
   */
  ['辞退', 'キャンセル', '重複（無効）'].forEach(st => {
    test('ステータスが「' + st + '」の行には送らない', () => {
      const r = pick([L('SB-0001', { 'ステータス': st })], ['SB-0001']);
      assert.deepStrictEqual(r.rows, [], st + ' に送ろうとしています');
      assert.deepStrictEqual(r.blocked.map(x => x.id), ['SB-0001']);
    });
  });

  test('同じ受付IDを2回選んでも、1通ぶんにまとめる', () => {
    const r = pick([L('SB-0001')], ['SB-0001', 'SB-0001']);
    assert.deepStrictEqual(r.rows.map(x => x.id), ['SB-0001'],
      '同じ相手に2通送ろうとしています');
  });

  test('区画は「開始〜終わり」の形にする', () => {
    const r = pick([L('SB-0001', { '割当開始区画': '12', '割当区画数': '3' })], ['SB-0001']);
    assert.strictEqual(r.rows[0].block, '12〜14');
  });

  test('1区画だけなら、範囲にしない', () => {
    const r = pick([L('SB-0001', { '割当開始区画': '7', '割当区画数': '1' })], ['SB-0001']);
    assert.strictEqual(r.rows[0].block, '7');
  });

  test('未割当なら区画は空（差し込みの行が落ちる）', () => {
    const r = pick([L('SB-0001')], ['SB-0001']);
    assert.strictEqual(r.rows[0].block, '');
  });
});

/*
 * ■ 押し間違いと、意図した再送は、機械には区別できない
 *
 *   催促メールの再送は正当な操作なので、機械が止めると人は迂回路を探す
 *   （シートを直接いじる等）。機械が確実に止められるもの（札）と、
 *   人が決めるべきもの（同じ件名の再送）を分ける。
 */
describe('直前の送信との照合（broadcastRecent_）', () => {

  /** 履歴シートに1行入った状態を作る */
  const withLog = (rows, opts) => makeBox(Object.assign({ logRows: rows }, opts || {}));

  const logRow = (over) => Object.assign({
    '送信ID': 'BC-20261007-1',
    '送信日時': '2026-10-07 10:00',
    '送信者': '小谷',
    '件名': '当日のご案内',
    '本文': '本文',
    '対象件数': '2',
    '宛先の受付ID': 'SB-0001,SB-0002',
    '結果': '成功2件',
  }, over || {});

  test('24時間以内に同じ件名を送った相手を返す', () => {
    const box = withLog([logRow()], { now: new Date(2026, 9, 7, 20, 0) });
    const r = call(box, 'broadcastRecent_', '当日のご案内', ['SB-0002', 'SB-0003']);
    assert.deepStrictEqual(r.ids, ['SB-0002'], '同じ件名の再送を見落としています');
    assert.strictEqual(r.sentAt, '2026-10-07 10:00');
  });

  test('24時間を過ぎていれば、報せない', () => {
    const box = withLog([logRow()], { now: new Date(2026, 9, 8, 11, 0) });
    const r = call(box, 'broadcastRecent_', '当日のご案内', ['SB-0001']);
    assert.deepStrictEqual(r.ids, []);
  });

  test('件名が違えば、報せない', () => {
    const box = withLog([logRow()], { now: new Date(2026, 9, 7, 12, 0) });
    const r = call(box, 'broadcastRecent_', '素材のご提出のお願い', ['SB-0001']);
    assert.deepStrictEqual(r.ids, []);
  });

  test('相手が重なっていなければ、報せない', () => {
    const box = withLog([logRow()], { now: new Date(2026, 9, 7, 12, 0) });
    const r = call(box, 'broadcastRecent_', '当日のご案内', ['SB-0009']);
    assert.deepStrictEqual(r.ids, []);
  });

  test('履歴が空でも落ちない', () => {
    const box = makeBox({ now: new Date(2026, 9, 7, 12, 0) });
    const r = call(box, 'broadcastRecent_', '当日のご案内', ['SB-0001']);
    assert.deepStrictEqual(r.ids, []);
  });
});
