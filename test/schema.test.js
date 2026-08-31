/**
 * スキーマの受け入れテスト
 * 仕様書 §10 Phase 1 の項目 2「条件付き表示が正しく動く」に対応する。
 *
 * 実行: npm test
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const S = require('../src/schema.js');

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
  fcosakaStaff: 'わからない／FC大阪以外からの紹介',
  boothTypes: ['展示'],
  boothDescription: '展示の内容',
  fireUse: ['使用しない'],
  boothSize: 'S1',
  power: '不要',
  vehicleCount: 1,
  parkingRequest: '希望する',
  staffCount: 2,
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

describe('区画サイズ（仕様書v3.1で表記を統一した項目）', () => {
  test('3種類あり、いずれも奥行2間で、区画数が1・2・3である', () => {
    const opts = field('boothSize').options;
    assert.equal(opts.length, 3);
    assert.deepEqual(opts.map(o => o.units), [1, 2, 3]);
    for (const o of opts) {
      assert.match(o.label, /奥行2間/, '奥行が2間になっていません: ' + o.label);
    }
  });

  test('区画の値は台帳・マップと共有する短いキーである', () => {
    assert.deepEqual(field('boothSize').options.map(o => o.value), ['S1', 'S2', 'S3']);
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
