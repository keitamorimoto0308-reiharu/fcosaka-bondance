/**
 * スキーマの受け入れテスト
 * 仕様書 §10 Phase 1 の項目 2「条件付き表示が正しく動く」に対応する。
 *
 * 実行: npm test
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../src/schema.js');
const ROOT = path.resolve(__dirname, '..');

const field = key => {
  const f = S.FIELDS.find(f => f.key === key);
  assert.ok(f, '項目が存在しません: ' + key);
  return f;
};

/** 応募内容の最小セット（必須をすべて満たした状態）を作る */
const baseValues = (over = {}) => Object.assign({
  companyName: '株式会社テスト',
  contactName: 'テスト太郎',
  contactEmail: 'test@example.com',
  contactPhone: '06-1234-5678',
  fcosakaStaff: 'その他',
  boothTypes: ['展示'],
  boothDescription: '展示の内容',
  fireUse: ['使用しない'],
  boothSize: 'S1',
  power: '不要',
  vehicleCount: 1,
  parkingRequest: '希望する',
  staffCount: 2,
  // 数を集める項目（2026-09-03 追加）。必須なので、通る例には必ず入れる
  passCount: 2, parkingPassCount: 1, ticketCount: 0,
  rainPolicy: '雨天でも出店する',
  agreeTerms: true,
  agreePrivacy: true,
}, over);

describe('飲食を選んだときの条件付き項目', () => {
  test('飲食を選ぶと営業許可と食器・包材が表示され、必須になる', () => {
    const v = baseValues({ boothTypes: ['飲食'] });
    for (const key of ['foodLicense', 'tableware']) {
      assert.equal(S.isVisible(field(key), v), true, key + ' が表示されていません');
      assert.equal(S.isRequired(field(key), v), true, key + ' が必須になっていません');
    }
  });

  test('飲食を含む複数選択でも表示・必須になる', () => {
    const v = baseValues({ boothTypes: ['展示', '飲食'] });
    assert.equal(S.isVisible(field('foodLicense'), v), true);
    assert.equal(S.isRequired(field('tableware'), v), true);
  });

  test('飲食を選ばなければ非表示で、必須にもならない', () => {
    const v = baseValues({ boothTypes: ['ワークショップ'] });
    for (const key of ['foodLicense', 'tableware']) {
      assert.equal(S.isVisible(field(key), v), false, key + ' が表示されています');
      assert.equal(S.isRequired(field(key), v), false, key + ' が必須になっています');
    }
  });
});

describe('電源の条件分岐', () => {
  test('発電機持込のとき、容量・機器・消費電力が必須になる', () => {
    const v = baseValues({ power: '必要（発電機を持ち込む）' });
    for (const key of ['generatorCapacity', 'powerDevices', 'powerWatt']) {
      assert.equal(S.isRequired(field(key), v), true, key + ' が必須になっていません');
    }
  });

  test('レンタル希望のとき、機器と消費電力は必須だが発電機容量は聞かない', () => {
    const v = baseValues({ power: 'レンタルを希望する（要確認）' });
    assert.equal(S.isRequired(field('powerDevices'), v), true);
    assert.equal(S.isRequired(field('powerWatt'), v), true);
    assert.equal(S.isVisible(field('generatorCapacity'), v), false,
      '発電機を持ち込まないのに容量を聞いています');
  });

  test('電源が不要なら、電源まわりは一切表示されない', () => {
    const v = baseValues({ power: '不要' });
    for (const key of ['generatorCapacity', 'powerDevices', 'powerWatt']) {
      assert.equal(S.isVisible(field(key), v), false, key + ' が表示されています');
    }
  });

  test('電源が未選択の段階では、条件付き項目を表示しない', () => {
    // op:'ne' が「未入力」を真と判定すると、開いた瞬間に全部出てしまう
    const v = baseValues({ power: '' });
    assert.equal(S.isVisible(field('powerDevices'), v), false);
  });

  test('「わからない」チェックの定義が消費電力に付いている', () => {
    const f = field('powerWatt');
    assert.ok(f.unknownCheckbox, '「わからない」チェックが定義されていません');
    assert.equal(f.unknownCheckbox.key, 'powerWattUnknown');
  });
});

describe('その他の自由記述', () => {
  test('出店形態で「その他」を選ぶと自由記述が必須になる', () => {
    const v = baseValues({ boothTypes: ['その他'] });
    assert.equal(S.isRequired(field('boothTypeOther'), v), true);
  });

  test('火気で「その他」を選ぶと自由記述が必須になる', () => {
    const v = baseValues({ fireUse: ['その他'] });
    assert.equal(S.isRequired(field('fireUseOther'), v), true);
  });

  test('「その他」以外なら自由記述は表示されない', () => {
    const v = baseValues({ fireUse: ['ガス'] });
    assert.equal(S.isVisible(field('fireUseOther'), v), false);
  });
});

describe('区画サイズ（レンタルテントの2サイズに対応）', () => {
  test('2種類あり、いずれも奥行2間。区画数は1と2', () => {
    const opts = field('boothSize').options;
    assert.equal(opts.length, 2);
    assert.deepEqual(opts.map(o => o.units), [1, 2]);
    for (const o of opts) {
      assert.match(o.label, /奥行2間/, '奥行が2間になっていません: ' + o.label);
    }
  });

  test('区画の値は台帳・マップと共有する短いキーである', () => {
    assert.deepEqual(field('boothSize').options.map(o => o.value), ['S1', 'S2']);
  });

  test('区画のサイズがレンタルテントのサイズと一致している', () => {
    // 片方だけ直して食い違うのを防ぐ。区画1＝テント小、区画2＝テント大。
    const booth = field('boothSize').options.map(o => o.label.match(/約[\d.]+m×[\d.]+m/)[0]);
    const tent  = field('tentSize').options.map(o => o.label.match(/約[\d.]+m×[\d.]+m/)[0]);
    assert.deepEqual(booth, tent, '区画とテントの寸法が食い違っています');
  });
});

describe('台帳の列', () => {
  test('列名が重複していない（重複すると保存先がずれる）', () => {
    const h = S.ledgerHeaders();
    assert.equal(new Set(h).size, h.length);
  });

  test('受付IDと受付日時が先頭2列にある', () => {
    const h = S.ledgerHeaders();
    assert.deepEqual(h.slice(0, 2), ['受付ID', '受付日時']);
  });

  test('ハニーポットは台帳に列を作らない', () => {
    const h = S.ledgerHeaders();
    assert.equal(h.includes('website2'), false);
    assert.equal(field('website2').sheet, null);
  });

  test('「わからない」チェックも台帳に列を持つ', () => {
    assert.ok(S.ledgerHeaders().includes('消費電力不明'));
  });

  test('管理側の列がすべて含まれている', () => {
    const h = S.ledgerHeaders();
    for (const c of S.ADMIN_COLUMNS) {
      assert.ok(h.includes(c), '管理列が欠けています: ' + c);
    }
  });
});

describe('ステータス定義', () => {
  test('重複応募を無効化するステータスがある', () => {
    assert.ok(S.STATUS.includes('重複（無効）'));
  });

  test('当日ステータスが4段階そろっている', () => {
    assert.deepEqual(S.DAY_STATUS, ['未着', '搬入済', '設営完了', '撤収完了']);
  });
});

describe('フォームを止めない設計', () => {
  test('担当社員リストの取得に失敗しても選べる選択肢がある', () => {
    const f = field('fcosakaStaff');
    assert.ok(f.fallbackOptions.length > 0);
    assert.equal(f.fallbackOptions.includes(f.unknownOption), true);
  });
});

describe('生成物がスキーマと同期しているか（回帰テスト）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');

  test('index.html に埋め込まれた FIELDS が schema.js の応募段階と一致する', () => {
    // ビルドを片方しか流していない、生成を忘れた、を検出する。
    // index.html に入るのは応募段階（stage:'apply'）の項目だけ。
    // 採択後に聞く項目まで入っていたら、応募フォームに漏れている。
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const m = html.match(/var FIELDS = (\[.*?\]);\n/s);
    assert.ok(m, 'index.html に FIELDS が見つかりません');
    const applyFields = S.applyFields();
    assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(applyFields)));
  });

  test('gas/Schema.gs の FIELDS が schema.js と完全に一致する', () => {
    const gas = fs.readFileSync(path.join(root, 'gas', 'Schema.gs'), 'utf8');
    const m = gas.match(/var FIELDS = (\[[\s\S]*?\n\]);/);
    assert.ok(m, 'Schema.gs に FIELDS が見つかりません');
    assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(S.FIELDS)));
  });

  test('台帳にメール到達状況と生データの列がある', () => {
    const h = S.ledgerHeaders();
    ['受付メール送信', '通知メール送信', '生データ(JSON)'].forEach(c =>
      assert.ok(h.includes(c), '列が欠けています: ' + c));
  });
});

describe('二段階収集（列は今作り、聞くタイミングを分ける）', () => {
  test('採択後に聞く項目は「出店確定情報」シート側に列を持つ', () => {
    // 応募一覧とは別シートなので、ここへの項目追加は運用開始後でもできる。
    const h = S.confirmHeaders();
    for (const f of S.confirmFields()) {
      assert.ok(h.includes(f.sheet), '列が欠けています: ' + f.sheet);
    }
  });

  test('採択後の項目が応募一覧の列に混ざっていない', () => {
    const led = S.ledgerHeaders();
    for (const f of S.confirmFields()) {
      assert.equal(led.includes(f.sheet), false, '応募一覧に混ざっています: ' + f.sheet);
    }
  });

  test('応募フォームの項目が増えすぎていない', () => {
    // 全員が全問答えるわけではない（多くは条件表示）が、定義の総数が
    // 膨らむと画面も必ず長くなる。上限を決めて歯止めにする。
    const n = S.applyFields().filter(f => f.type !== 'honeypot').length;
    assert.ok(n <= 30, '応募フォームの項目が増えすぎています: ' + n + '項目');
  });

  test('採択後に聞く項目は応募フォームに出さない', () => {
    const fs = require('node:fs'), path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    for (const f of S.FIELDS.filter(f => f.stage === 'confirm')) {
      assert.equal(html.includes('data-field="' + f.key + '"'), false,
        '応募フォームに出てしまっています: ' + f.key);
    }
  });

  test('火気は複数選択で、併用（炭＋ガス）を表現できる', () => {
    const f = S.FIELDS.find(x => x.key === 'fireUse');
    assert.equal(f.type, 'checkboxes');
    const v = { fireUse: ['ガス', '炭'] };
    const ext = S.FIELDS.find(x => x.key === 'fireExtinguisher');
    assert.equal(S.isRequired(ext, v), true, '消火器が必須になっていません');
  });

  test('火気を使わないなら消火器は聞かない', () => {
    const v = { fireUse: ['使用しない'] };
    const ext = S.FIELDS.find(x => x.key === 'fireExtinguisher');
    assert.equal(S.isVisible(ext, v), false);
  });

  test('テントは、レンタルならサイズを・持ち込みなら寸法と重りを聞く', () => {
    const f = k => S.FIELDS.find(x => x.key === k);
    const rent = { tentChoice: 'レンタルする' };
    const own  = { tentChoice: '持ち込む' };

    assert.equal(S.isVisible(f('tentSize'), rent), true, 'レンタル時にサイズを聞いていません');
    assert.equal(S.isVisible(f('tentOwnWidth'), rent), false, 'レンタルなのに寸法を聞いています');
    assert.equal(S.isVisible(f('tentWeight'), rent), false, 'レンタルなのに重りを聞いています');

    assert.equal(S.isVisible(f('tentSize'), own), false, '持ち込みなのにサイズを聞いています');
    assert.equal(S.isVisible(f('tentOwnWidth'), own), true);
    assert.equal(S.isVisible(f('tentOwnDepth'), own), true);
    assert.equal(S.isVisible(f('tentWeight'), own), true, '持ち込み時に重りを聞いていません');
  });

  test('レンタルテントは2サイズあり、それぞれ別の単価キーを持つ', () => {
    const opts = S.FIELDS.find(x => x.key === 'tentSize').options;
    assert.equal(opts.length, 2);
    assert.deepEqual(opts.map(o => o.priceKey), ['tentT1', 'tentT2']);
    // メートル表記が間口×奥行の順になっていること
    assert.match(opts[0].label, /約2\.7m×3\.6m/);
    assert.match(opts[1].label, /約5\.4m×3\.6m/);
  });
});

describe('生成した gas/Schema.gs が、それ単体で動くか', () => {
  const B = require('../src/build.js');

  test('生成物の中だけで ledgerHeaders() が動く', () => {
    // Node の中で呼べても、生成物に依存関数が入っていなければGASでは落ちる。
    // 実際 columnsFor_ と applyFields が漏れていて、setup() が動かず
    // 台帳の列を直せない状態になっていた（応募が記録できない一歩手前）。
    const errors = B.verifyGenerated(B.buildSchemaGs());
    assert.deepStrictEqual(errors, []);
  });

  test('依存する関数が漏れたら、検査が気づく', () => {
    // 検査そのものが効いていることを確かめる（効かない検査は無いのと同じ）
    const broken = B.buildSchemaGs().replace(/function columnsFor_[\s\S]*?\n}\n/, '');
    const errors = B.verifyGenerated(broken);
    assert.ok(errors.length > 0, '関数を消しても検査が通ってしまいます');
    assert.ok(errors.some(e => e.includes('columnsFor_')));
  });

  test('ディスク上の gas/Schema.gs も単体で動く', () => {
    const fs = require('fs'), path = require('path');
    const file = path.join(__dirname, '..', 'gas', 'Schema.gs');
    assert.deepStrictEqual(B.verifyGenerated(fs.readFileSync(file, 'utf8')), []);
  });
});

describe('応募を受け付けられる状態か（台帳の列と受付検査の整合）', () => {
  const fs = require('fs');
  const path = require('path');

  /** gas/Ledger.gs の assertHeaders_ と同じ判定を、こちらで再現する */
  function missingFor(headers) {
    const missing = [];
    S.applyFields().forEach(f => {
      if (f.sheet && headers.indexOf(f.sheet) === -1) missing.push(f.sheet);
      if (f.unknownCheckbox && headers.indexOf(f.unknownCheckbox.sheet) === -1) {
        missing.push(f.unknownCheckbox.sheet);
      }
    });
    S.ADMIN_COLUMNS.forEach(c => { if (headers.indexOf(c) === -1) missing.push(c); });
    return missing;
  }

  test('setup() が作る列で、応募の受付検査が通る', () => {
    // ここが食い違うと、**どの応募も必ず失敗する**（応募者に送信エラーが出る）。
    // 実際、受付検査が採択後の17項目まで応募一覧に要求していて、
    // 本番のフォームから応募できない状態になっていた。
    assert.deepStrictEqual(missingFor(S.ledgerHeaders()), [],
      '台帳を setup() で作り直しても、受付検査が通りません');
  });

  test('受付検査は、採択後にしか集めない項目を要求しない', () => {
    // 採択後の項目は別シート「出店確定情報」の列。応募一覧には存在しない
    const confirmOnly = S.confirmFields().map(f => f.sheet).filter(Boolean);
    const demanded = missingFor(S.ledgerHeaders().filter(h => !confirmOnly.includes(h)));
    assert.deepStrictEqual(demanded, []);
  });

  test('gas/Ledger.gs の受付検査が、応募段階の項目だけを見ている', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Ledger.gs'), 'utf8');
    const fn = src.slice(src.indexOf('function assertHeaders_'));
    const head = fn.slice(0, fn.indexOf('}'));
    assert.ok(head.includes('applyFields()'),
      '受付検査が FIELDS 全部を見ています（採択後の項目まで要求してしまいます）');
  });
});

describe('レンタル品目：危ない側に倒れないか', () => {
  // 改行コードを揃えて読む。CRLF のままだと目印が見つからず、
  // 関数の切り出しに失敗してファイル全体を見てしまう
  const read = f => fs.readFileSync(path.join(ROOT, 'gas', f), 'utf8')
    .split(String.fromCharCode(13) + String.fromCharCode(10))
    .join(String.fromCharCode(10));
  const CFG = read('Config.gs');
  const API = read('Api.gs');
  const LED = read('Ledger.gs');

  test('単価が空欄の品目を、0円として公開しない', () => {
    // Number('') は 0 になる。空欄を 0 と読むと、
    // 応募者の画面にも台帳にも「0円」と出て整合するので、誰も気づけない。
    const fn = CFG.slice(CFG.indexOf('function readRentalSheet_'));
    assert.ok(/rawPrice === ''\s*\)\s*\?\s*null/.test(fn) || /=== ''\) \? null :/.test(fn),
      '単価の空欄を null（未定）として扱っていません');
    const qty = CFG.slice(CFG.indexOf('function getRentalQtyItems'));
    assert.ok(/it\.price === 'number' && it\.price > 0/.test(qty),
      '単価0円の品目を応募フォームに出しています');
  });

  test('種別と有効を、許可リストで判定している', () => {
    // 「!== '無効'」だと、空欄も打ち間違いも有効として通る
    const fn = CFG.slice(CFG.indexOf('function readRentalSheet_'));
    assert.ok(/active:\s*cell\(r, '有効'\) === '有効'/.test(fn),
      '「有効」の判定が許可リストになっていません');
    assert.ok(!/kind:.*\|\| '数量'/.test(fn),
      '種別が空欄のとき「数量」として扱っています（フォームに出てしまいます）');
  });

  test('列見出しが変わっていたら、黙って続けずに止める', () => {
    const fn = CFG.slice(CFG.indexOf('function readRentalSheet_'));
    assert.ok(fn.includes('の列がありません'),
      '必須の列見出しを検査していません（全品目が0円になりえます）');
  });

  test('レンタルの数量を、既知の品目だけに作り直している', () => {
    // 弾くだけだと、知らない品目名が生データに残り、管理ページの集計に並ぶ
    const v = API.slice(API.indexOf('function validate_'));
    assert.ok(v.includes('values.rentalItems = clean'),
      '検証後に値を作り直していません（応募者が書いた任意の名前が残ります）');
    assert.ok(v.includes('Object.create(null)'),
      'constructor や toString が実在品目として通ります');
  });

  test('変更履歴も、数式として解釈されない形で書いている', () => {
    // 無害化と長さの上限は historyCell_ にまとめてある。
    // 長すぎる値をそのまま渡すと appendRow ごと落ち、
    // 「台帳は変わったのに記録が無い」という一番まずい状態になる。
    const cell = LED.slice(LED.indexOf('function historyCell_'));
    const cellBody = cell.slice(0, cell.indexOf('\n}\n'));
    assert.ok(/safeCell_\(/.test(cellBody), 'historyCell_ が無害化していません');
    assert.ok(/HISTORY_CELL_MAX/.test(cellBody), 'historyCell_ に長さの上限がありません');

    const fn = LED.slice(LED.indexOf('function appendHistory'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.ok((body.match(/historyCell_\(/g) || []).length >= 6,
      '変更履歴に生の値を書いています（担当メモに数式を入れられます）');
  });

  test('1行ぶんのレンタル計算を、列ごとに繰り返さない', () => {
    // 明細と合計で2回呼ぶと、そのあいだにシートが変わって食い違いうる
    const fn = LED.slice(LED.indexOf('function buildRow_'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.strictEqual((body.match(/rentalSummary_\(/g) || []).length, 1,
      'rentalSummary_ を1行のなかで複数回呼んでいます');
  });
});

describe('台帳の入力規則が、古い列構成のまま残らないか', () => {
  const read = f => fs.readFileSync(path.join(ROOT, 'gas', f), 'utf8')
    .split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));

  test('入力規則を貼り直す前に、いったん全部消している', () => {
    // sh.clear() は中身と書式を消すが、**入力規則は残る**。
    // 列の並びが変わったあとも古い列に規則が居座り、
    // 「主形態の列にステータスの選択肢しか入らない」状態になった。
    // 新規の応募は appendRow なので素通りし、セル単位の書き込みだけが弾かれる。
    // 応募者による修正が server_error で落ちて、本番で発覚した。
    const setup = read('Setup.gs');
    const fn = setup.slice(setup.indexOf('function setupLedgerSheet_'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    const clear = body.indexOf('clearDataValidations');
    const apply = body.indexOf('setDropdown_');
    assert.ok(clear >= 0, '古い入力規則を消していません');
    assert.ok(apply >= 0, '入力規則を貼っていません');
    assert.ok(clear < apply, '消すのが貼るより後になっています（消してから貼ること）');
  });

  test('公開の応答に、内部のエラー内容を混ぜていない', () => {
    // 原因を突き止めるために一度だけ返させたが、恒久的に返してはいけない
    const api = read('Api.gs');
    assert.ok(!/debug:\s*String/.test(api),
      '診断用の返却が残っています（公開エンドポイントに内部情報が出ます）');
  });
});
