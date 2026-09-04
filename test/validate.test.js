/**
 * 応募の検証を「実際に走らせて」確かめるテスト。
 *
 * ■ なぜ要るか
 *   gas/Api.gs の validate_ が FIELDS を全部回していて、
 *   採択後にしか聞かない項目（現場責任者・搬入車両台数・車両種別など）まで
 *   必須として要求していた。フォームにその欄は存在しないので、
 *   **どの応募も必ず検証で弾かれる**状態だった。
 *
 *   しかも返るエラーは画面に無い項目を指すため、画面側は何も表示できず、
 *   利用者からは「送信を押しても何も起きない」という現れ方をしていた。
 *   検証で止まるので台帳にも退避シートにも残らず、痕跡がどこにも出なかった。
 *
 * ■ どうやって走らせるか
 *   gas/Schema.gs（生成物）と gas/Api.gs の validate_ を、
 *   Node の変数が見えない箱に読み込んで実行する。
 *   GASの機能に触らない純粋な関数なので、これで本物と同じ判定を確かめられる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const S = require('../src/schema.js');

/** 改行コードを揃えて読む。CRLF のままだと目印が見つからず切り出しに失敗する */
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/** 名前で関数を1つ切り出す。関数の終わりは行頭の `}` */
function cutFunction(code, name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' が見つかりません');
  const end = code.indexOf('\n}\n', start) + 3;
  assert.ok(end > start, name + ' の終わりが見つかりません');
  return code.slice(start, end);
}

/** gas/Api.gs の validate_ を、依存する Schema.gs と一緒に隔離環境へ読み込む */
function loadValidate(staffLabels) {
  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite,
    // 関係者シートの代役。担当社員の選択肢は実在するものだけを許す作りなので、
    // ここを差し替えて「登録済みの社員がいる場合／いない場合」の両方を試せる
    getStaffOptions: () => (staffLabels || []).map(label => ({ label })),
    // レンタル品目シートの代役。検証は「実在する品目か」「上限内か」を見る
    getRentalQtyItems: () => [
      { name: '長机（1800×450）', price: 1000, unit: '台', max: 20, note: '' },
      { name: 'パイプ椅子',       price: 500,  unit: '脚', max: 40, note: '' },
    ],
  });
  // 数の読み取りは gas/Num.gs にまとめてある（2026-09-04）。
  // これを読まないと numAmount_ / numCount_ が未定義で落ちる
  vm.runInContext(read('gas/Num.gs'), box);
  vm.runInContext(read('gas/Schema.gs'), box);

  const api = read('gas/Api.gs');
  // validate_ は validateFieldList_ を呼ぶので、両方を箱に入れる。
  // 片方だけ入れると「文法としては正しいが、呼ぶと落ちる」状態のまま通ってしまう。
  ['validateFieldList_', 'validate_'].forEach(name => {
    vm.runInContext(cutFunction(api, name), box);
  });

  const fn = vm.runInContext('validate_', box);
  // vm の中で作られた配列は Node の配列と別物なので、素の値に写してから返す
  return values => JSON.parse(JSON.stringify(fn(values)));
}

/** 応募段階の必須をすべて満たした、通るはずの応募 */
function validApplication(over) {
  return Object.assign({
    companyName: '株式会社テスト',
    boothName: 'テスト出店',
    contactName: 'テスト太郎',
    contactEmail: 'test@example.com',
    contactPhone: '06-1234-5678',
    fcosakaStaff: 'その他',
    boothTypes: ['展示'],
    boothDescription: '展示の内容です。',
    boothSize: 'S1',
    power: '不要',
    tentChoice: '持ち込む',
    tentOwnWidth: 2.5,          // 1区画は約2.7m。これを超えると収まらない
    tentOwnDepth: 3,
    tentWeight: '持参する',
    rentalItems: {},          // 数量で頼む備品は台帳の「レンタル品目」シートで決まる
    agreeAll: true,
  }, over || {});
}

describe('応募の検証（サーバー側を実際に動かす）', () => {

  test('応募段階の必須をすべて満たした応募が、検証を通る', () => {
    // ここが通らないと、**どの応募も受け付けられない**。
    // 実際、採択後の項目まで必須として要求していて、全件が弾かれていた。
    const validate = loadValidate();
    const errors = validate(validApplication());
    assert.deepStrictEqual(errors, [],
      '通るはずの応募が弾かれています: '
      + errors.map(e => e.key + '（' + e.message + '）').join(' / '));
  });

  test('採択後にしか聞かない項目を、応募時に要求しない', () => {
    const validate = loadValidate();
    const confirmKeys = S.confirmFields().map(f => f.key);
    const errors = validate(validApplication());
    const wrong = errors.filter(e => confirmKeys.includes(e.key));
    assert.deepStrictEqual(wrong, [],
      'フォームに無い項目を要求しています: ' + wrong.map(e => e.key).join(' / '));
  });

  test('検証が返すエラーは、必ず応募フォームに存在する項目を指す', () => {
    // 画面に無い項目のエラーは、利用者には何も表示されない＝直しようがない
    const validate = loadValidate();
    const applyKeys = S.applyFields().map(f => f.key);
    const errors = validate({});           // 空の応募（必須がすべて欠けた状態）
    assert.ok(errors.length > 0, '空の応募が通ってしまいます');
    const ghosts = errors.filter(e => !applyKeys.includes(e.key));
    assert.deepStrictEqual(ghosts, [],
      '画面に無い項目のエラーを返しています: ' + ghosts.map(e => e.key).join(' / '));
  });

  test('必須が欠けていれば、ちゃんと弾く', () => {
    const validate = loadValidate();
    const errors = validate(validApplication({ companyName: '' }));
    assert.ok(errors.some(e => e.key === 'companyName'), '必須の欠落を見逃しています');
  });

  test('メールアドレスと電話番号の形式を見ている', () => {
    const validate = loadValidate();
    assert.ok(validate(validApplication({ contactEmail: 'こわれた' }))
      .some(e => e.key === 'contactEmail'));
    assert.ok(validate(validApplication({ contactPhone: 'あいうえお' }))
      .some(e => e.key === 'contactPhone'));
  });

  test('gas/Api.gs の検証が、応募段階の項目だけを見ている', () => {
    const api = read('gas/Api.gs');
    assert.ok(cutFunction(api, 'validate_').includes('validateFieldList_(applyFields()'),
      '検証が FIELDS 全部を見ています（採択後の項目まで必須になります）');
    assert.ok(!cutFunction(api, 'validateFieldList_').includes('FIELDS.forEach'),
      '共通の検証が FIELDS を直接回しています（段階の分離が効かなくなります）');
  });
});

describe('担当社員の選択肢（関係者シートに連動する）', () => {

  test('関係者シートが空でも「わからない」で応募できる', () => {
    // 公開直後は関係者シートが空になりうる。そこで応募できなくなると、
    // 「登録を忘れていたせいで1件も応募が取れない」という事故になる
    const validate = loadValidate([]);
    const errors = validate(validApplication({
      fcosakaStaff: 'その他',
    }));
    assert.deepStrictEqual(errors, []);
  });

  test('登録済みの社員を選べる', () => {
    const validate = loadValidate(['山田 太郎 - 事業推進部']);
    assert.deepStrictEqual(validate(validApplication({
      fcosakaStaff: '山田 太郎 - 事業推進部',
    })), []);
  });

  test('登録されていない社員名は受け付けない', () => {
    const validate = loadValidate(['山田 太郎 - 事業推進部']);
    assert.ok(validate(validApplication({ fcosakaStaff: '居ない 人' }))
      .some(e => e.key === 'fcosakaStaff'));
  });
});

describe('レンタルの数量（サーバー側で実際に動かす）', () => {
  // 箱の中で作られたオブジェクトは Node のものと別物なので、素の値に写してから比べる
  const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));


  test('実在する品目を、上限内で頼める', () => {
    const validate = loadValidate();
    const v = validApplication({ rentalItems: { '長机（1800×450）': 3, 'パイプ椅子': 6 } });
    assert.deepStrictEqual(validate(v), []);
  });

  test('上限を超えたら弾く', () => {
    const validate = loadValidate();
    const errs = validate(validApplication({ rentalItems: { 'パイプ椅子': 41 } }));
    assert.ok(errs.some(e => e.key === 'rentalItems'), '上限超えを見逃しています');
  });

  test('負の数・小数・数字でないものを弾く', () => {
    const validate = loadValidate();
    for (const bad of [-1, 1.5, 'たくさん', NaN]) {
      const errs = validate(validApplication({ rentalItems: { '長机（1800×450）': bad } }));
      assert.ok(errs.some(e => e.key === 'rentalItems'),
        '通ってしまった値: ' + String(bad));
    }
  });

  test('知らない品目名は、エラーにせず落とす', () => {
    // こちらが品目を無効にした直後に、下書きから復元した応募者が
    // 送信できなくなるのを避ける。ただし値としては残さない。
    const validate = loadValidate();
    const v = validApplication({ rentalItems: { 'そんな品目はない': 5, 'パイプ椅子': 2 } });
    assert.deepStrictEqual(validate(v), [], '知らない品目でエラーにしています');
    assert.deepStrictEqual(plain(v.rentalItems), { 'パイプ椅子': 2 },
      '知らない品目名が残っています（生データと管理ページの集計に流れます）');
  });

  test('constructor や toString を品目名にしても、実在品目として通らない', () => {
    // 素の {} を使うと、これらがプロトタイプ上の値を返して「実在する」と誤判定され、
    // 上限の検査が効かなくなる
    const validate = loadValidate();
    const v = validApplication({
      rentalItems: { constructor: 999, toString: 999, __proto__: 999, hasOwnProperty: 999 },
    });
    validate(v);
    assert.deepStrictEqual(plain(v.rentalItems), {},
      'プロトタイプ由来の名前が品目として残っています');
  });

  test('0のものは残さない', () => {
    const validate = loadValidate();
    const v = validApplication({ rentalItems: { '長机（1800×450）': 0, 'パイプ椅子': 2 } });
    validate(v);
    assert.deepStrictEqual(plain(v.rentalItems), { 'パイプ椅子': 2 });
  });

  test('レンタルの指定が無くても応募できる', () => {
    const validate = loadValidate();
    const v = validApplication();
    delete v.rentalItems;
    assert.deepStrictEqual(validate(v), []);
    assert.deepStrictEqual(plain(v.rentalItems), {}, '未指定を空にそろえていません');
  });

  test('配列や文字列で送られてきたら読み取れないと返す', () => {
    const validate = loadValidate();
    for (const bad of [[1, 2], 'こわれた', 42]) {
      const v = validApplication({ rentalItems: bad });
      assert.ok(validate(v).some(e => e.key === 'rentalItems'),
        '通ってしまった値: ' + JSON.stringify(bad));
    }
  });
});
