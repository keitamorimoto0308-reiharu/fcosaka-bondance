/**
 * レンタル品目を、管理ページから編集する。
 *
 * ■ この機能の主役は、編集ではなく**紙面とのずれの検出**
 *   募集要項PDFは src/content.js から刷り、応募フォームは
 *   「レンタル品目」シートを読む。シートだけ直すと、
 *   **紙とフォームで金額が違う**状態になる。
 *   PDFはGASからは刷れない（Chromeで組版している）ので、この制約は消せない。
 *   だから「制約を外す」のではなく、**制約を見えるようにした**。
 *
 *   ずれを出さなければ、営業が古い金額の紙を配り続ける。
 *   それに気づくのは、出店者から「金額が違う」と言われたとき。
 *
 * ■ お金の話なので、歯止めを厚くする
 *   ・管理者のみ
 *   ・単価の空欄は「0円」ではなく「未定」（0で受注すると誰も気づけない）
 *   ・桁の打ち間違いを止める上限
 *   ・品目名の重複を止める（フォームの欄が二重に出る）
 *   ・消さずに「無効」にする（申込済みの明細の行き先が消える）
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

function fresh() {
  const p = require.resolve('../src/mock.js');
  delete require.cache[p];
  return require(p);
}
function login(M, pw, person) {
  const r = M.handle({ action: 'adminLogin', password: pw, person: person });
  assert.ok(r.ok, JSON.stringify(r));
  return r.token;
}

describe('レンタル品目：紙面とのずれ', () => {
  let M, tok;
  beforeEach(() => { M = fresh(); tok = login(M, 'admin', '山田 太郎'); });

  test('直していないうちは、ずれが無い', () => {
    const r = M.handle({ action: 'adminRental', token: tok });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.paperDiff, [],
      'はじめから食い違っています：' + JSON.stringify(r.paperDiff));
  });

  test('単価を変えると、紙面とのずれが出る', () => {
    const before = M.handle({ action: 'adminRental', token: tok });
    const desk = before.items.filter(x => x.name.indexOf('長机') === 0)[0];
    assert.ok(desk, '長机がありません');

    M.handle({ action: 'adminRentalSave', token: tok, row: desk.row,
      item: { kind: desk.kind, name: desk.name, price: '1200',
              unit: desk.unit, max: desk.max, active: true } });

    const after = M.handle({ action: 'adminRental', token: tok });
    const d = after.paperDiff.filter(x => x.kind === 'price')[0];
    assert.ok(d, 'ずれが出ていません：' + JSON.stringify(after.paperDiff));
    // **どちらがいくらか**を書く。書かないと、どちらを直せばよいか分からない
    assert.ok(d.message.includes('1,000') && d.message.includes('1,200'),
      '紙面といまの値の両方が書かれていません：' + d.message);
  });

  test('品目を足すと、「紙面に載っていない」と出る', () => {
    M.handle({ action: 'adminRentalSave', token: tok, row: 0,
      item: { kind: '数量', name: '延長コード（10m）', price: '800',
              unit: '本', max: 5, active: true } });
    const r = M.handle({ action: 'adminRental', token: tok });
    const d = r.paperDiff.filter(x => x.kind === 'added')[0];
    assert.ok(d, '追加が検出されていません');
    assert.ok(d.message.includes('延長コード'), d.message);
  });

  test('品目を外すと、「紙面に載っているのに出ていない」と出る', () => {
    const r0 = M.handle({ action: 'adminRental', token: tok });
    const chair = r0.items.filter(x => x.name === 'パイプ椅子')[0];
    M.handle({ action: 'adminRentalDisable', token: tok, row: chair.row });
    const r = M.handle({ action: 'adminRental', token: tok });
    const d = r.paperDiff.filter(x => x.kind === 'removed')[0];
    assert.ok(d, '無効化が検出されていません');
    assert.ok(d.message.includes('パイプ椅子'), d.message);
  });
});

describe('レンタル品目：お金の歯止め', () => {
  let M, tok;
  beforeEach(() => { M = fresh(); tok = login(M, 'admin', '山田 太郎'); });

  test('一般権限では、見ることも直すこともできない', () => {
    const staff = login(M, 'staff', '佐藤 花子');
    ['adminRental', 'adminRentalSave', 'adminRentalDisable'].forEach(a => {
      const r = M.handle({ action: a, token: staff, row: 2, item: {} });
      assert.strictEqual(r.ok, false, a + ' が通りました');
      assert.strictEqual(r.error, 'forbidden');
    });
  });

  test('単価の空欄は「0円」ではなく「未定」', () => {
    // 0で受注すると、応募者の画面にも台帳にも 0 と出て整合するので、
    // **誰も気づけない**
    const r0 = M.handle({ action: 'adminRental', token: tok });
    const chair = r0.items.filter(x => x.name === 'パイプ椅子')[0];
    M.handle({ action: 'adminRentalSave', token: tok, row: chair.row,
      item: { kind: chair.kind, name: chair.name, price: '',
              unit: chair.unit, max: chair.max, active: true } });
    const r = M.handle({ action: 'adminRental', token: tok });
    const after = r.items.filter(x => x.name === 'パイプ椅子')[0];
    assert.strictEqual(after.price, '', '0 になっています：' + JSON.stringify(after.price));
    assert.notStrictEqual(after.price, 0, '空欄が0として入りました');
  });

  test('桁を打ち間違えた単価は入らない', () => {
    const r = M.handle({ action: 'adminRentalSave', token: tok, row: 0,
      item: { kind: '数量', name: '発電機', price: '9999999',
              unit: '台', max: 1, active: true } });
    assert.strictEqual(r.ok, false);
    assert.ok(/高すぎ|桁/.test(r.message), r.message);
  });

  test('同じ品目名は登録できない', () => {
    // 同じ名前が2つあると、フォームの欄が二重に出る
    const r = M.handle({ action: 'adminRentalSave', token: tok, row: 0,
      item: { kind: '数量', name: 'パイプ椅子', price: '600',
              unit: '脚', max: 40, active: true } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'duplicate');
  });

  test('種別が一覧に無ければ断る', () => {
    const r = M.handle({ action: 'adminRentalSave', token: tok, row: 0,
      item: { kind: 'なんでも', name: 'テスト', price: '100', unit: '個', active: true } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'bad_value');
  });

  // ── 数の読み取り。**「保存しました」と言いながら別の数を入れる**のが
  //    いちばん危ない形。お金の欄なので、読めないものは断る

  test('全角の数字は、半角に直して受ける', () => {
    // スマホの日本語入力では全角が普通に混ざる。
    // ここで断ると、直し方が分からないまま止まる
    const r0 = M.handle({ action: 'adminRental', token: tok });
    const desk = r0.items.filter(x => x.name.indexOf('長机') === 0)[0];
    const r = M.handle({ action: 'adminRentalSave', token: tok, row: desk.row,
      item: { kind: desk.kind, name: desk.name, price: '１２００',
              unit: desk.unit, max: desk.max, active: true } });
    assert.strictEqual(r.ok, true, '全角を断りました：' + JSON.stringify(r));
    const after = M.handle({ action: 'adminRental', token: tok })
      .items.filter(x => x.name.indexOf('長机') === 0)[0];
    assert.strictEqual(after.price, 1200,
      '全角が別の数になりました：' + JSON.stringify(after.price));
  });

  test('全角で打っても、黙って0円（＝無料）にはしない', () => {
    // 以前は「数字以外を捨てて Number()」だったので、
    // 全角は全部捨てられて '' になり、Number('') が 0 になっていた。
    // 単価0は「未定」ではなく**無料**として応募フォームに出る
    const r0 = M.handle({ action: 'adminRental', token: tok });
    const desk = r0.items.filter(x => x.name.indexOf('長机') === 0)[0];
    M.handle({ action: 'adminRentalSave', token: tok, row: desk.row,
      item: { kind: desk.kind, name: desk.name, price: '１２００',
              unit: desk.unit, max: desk.max, active: true } });
    const after = M.handle({ action: 'adminRental', token: tok })
      .items.filter(x => x.name.indexOf('長机') === 0)[0];
    assert.notStrictEqual(after.price, 0, '全角の単価が0円になりました');
    assert.notStrictEqual(after.price, '', '全角の単価が「未定」になりました');
  });

  test('マイナスの単価は、符号を落とさずに断る', () => {
    // 「数字以外を捨てる」と -500 が 500 になる。**符号だけが静かに消える**
    const r = M.handle({ action: 'adminRentalSave', token: tok, row: 0,
      item: { kind: '数量', name: 'マイナス試験', price: '-500',
              unit: '個', max: 1, active: true } });
    assert.strictEqual(r.ok, false, 'マイナスが通りました');
    assert.strictEqual(r.error, 'bad_value');
    assert.ok(/マイナス/.test(r.message), '理由が伝わりません：' + r.message);
    const list = M.handle({ action: 'adminRental', token: tok });
    assert.ok(!list.items.some(x => x.name === 'マイナス試験'), '入ってしまいました');
  });

  test('数として読めないものは、断って書き直してもらう', () => {
    [['abc', '文字'], ['1e9', '指数表記'], ['1.2.3', '点が2つ']].forEach(([v, why]) => {
      const r = M.handle({ action: 'adminRentalSave', token: tok, row: 0,
        item: { kind: '数量', name: '試験' + v, price: v,
                unit: '個', max: 1, active: true } });
      assert.strictEqual(r.ok, false, why + '（' + v + '）が通りました');
      assert.strictEqual(r.error, 'bad_value', why + '：' + JSON.stringify(r));
    });
  });

  test('最大数も、単価と同じ厳しさで読む', () => {
    // 上限が黙って0になると、応募フォームの数量欄が出なくなる
    const r = M.handle({ action: 'adminRentalSave', token: tok, row: 0,
      item: { kind: '数量', name: '上限試験', price: '100',
              unit: '個', max: '１０', active: true } });
    assert.strictEqual(r.ok, true, '全角の最大数を断りました：' + JSON.stringify(r));
    const after = M.handle({ action: 'adminRental', token: tok })
      .items.filter(x => x.name === '上限試験')[0];
    assert.strictEqual(after.max, 10, '最大数が別の数になりました：' + after.max);
  });

  test('カンマ・円・空白は、意味を変えないので受ける', () => {
    const r = M.handle({ action: 'adminRentalSave', token: tok, row: 0,
      item: { kind: '数量', name: 'カンマ試験', price: '1,200円',
              unit: '個', max: 1, active: true } });
    assert.strictEqual(r.ok, true, '「1,200円」を断りました：' + JSON.stringify(r));
    const after = M.handle({ action: 'adminRental', token: tok })
      .items.filter(x => x.name === 'カンマ試験')[0];
    assert.strictEqual(after.price, 1200);
  });

  test('単価と有無の変更は、履歴に残る', () => {
    // お金の話なので、いつ誰がいくらに変えたかが残らないと後で説明できない
    const r0 = M.handle({ action: 'adminRental', token: tok });
    const desk = r0.items.filter(x => x.name.indexOf('長机') === 0)[0];
    M.handle({ action: 'adminRentalSave', token: tok, row: desk.row,
      item: { kind: desk.kind, name: desk.name, price: '1200',
              unit: desk.unit, max: desk.max, active: true } });
    const h = M.DB.history[0];
    assert.ok(/レンタル品目：単価/.test(h.item), '履歴に残っていません：' + JSON.stringify(h));
    assert.strictEqual(h.before, '1000');
    assert.strictEqual(h.after, '1200');
    assert.strictEqual(h.who, '山田 太郎');
  });
});

describe('レンタル品目：本番側の作り', () => {
  const R = read('gas/Rental.gs');
  const ADMIN = read('gas/Admin.gs');
  const SCHEMA = read('gas/Schema.gs');

  test('管理者だけが使える', () => {
    const only = ADMIN.slice(ADMIN.indexOf('var adminOnly'), ADMIN.indexOf('switch (action)'));
    ['adminRental', 'adminRentalSave', 'adminRentalDisable'].forEach(a => {
      assert.ok(only.includes(a), a + ' が管理者限定の一覧にありません');
    });
  });

  test('紙面の料金表が、ビルドで焼き込まれている', () => {
    // GASからは content.js を読めない。ビルド時に焼き込むしかない
    assert.ok(/var PUBLISHED_RENTALS = \[/.test(SCHEMA),
      'PUBLISHED_RENTALS が Schema.gs にありません');
    const C = require('../src/content.js');
    C.RENTALS.forEach(r => {
      assert.ok(SCHEMA.includes(r.label), '紙面の品目が焼き込まれていません：' + r.label);
    });
  });

  test('品目は消さず、「無効」にする', () => {
    // 消すと、申込済みの「レンタル明細」の行き先が分からなくなる
    const fn = R.slice(R.indexOf('function adminRentalDisable_'));
    const body = fn.slice(0, fn.indexOf('\n}' + '\n'));
    assert.ok(!/deleteRow/.test(body), '行を消しています');
    assert.ok(/setValue\('無効'\)/.test(body), '無効にしていません');
  });

  test('本番も、数を「拾って捨てる」読み方をしていない', () => {
    // 数字以外を落として Number() に渡すと、
    // 「-500」→500、「１２００」→0、「1e9」→19 と**黙って別の数**になる。
    // 単価は請求書になる数字なので、この読み方をどこにも残さない。
    // 2026-09-04 から、読み取りは gas/Num.gs の1か所にまとめてある
    //（単価・枚数・合計の3つが、実測したら揃っていなかったため）
    assert.ok(!R.includes('replace(/[^0-9'),
      '数字以外を捨てる読み方が残っています');
    assert.ok(/function rentalNumber_/.test(R), '読み取りが1か所にまとまっていません');
    const fn = R.slice(R.indexOf('function rentalNumber_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/numAmount_\(/.test(body), '共通の読み取りを通っていません');
    assert.ok(/numWhy_\(/.test(body), '断る理由を伝えていません');

    const N = read('gas/Num.gs');
    assert.ok(/０-９/.test(N), '共通の読み取りが全角を半角に直していません');
    assert.ok(/マイナスは指定できません/.test(N), 'マイナスを見ていません');
    // **末尾まで数であること**。前方一致だと「3-5」が 3 になる
    assert.ok(N.indexOf(')?$/') > 0, '末尾を固定していません');
  });

  test('単価も最大数も、同じ読み取りを通している', () => {
    const fn = R.slice(R.indexOf('function adminRentalSave_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    const n = (body.match(/rentalNumber_\(/g) || []).length;
    assert.ok(n >= 2, '単価か最大数のどちらかが素通りしています（' + n + 'か所）');
  });

  test('模擬も、本番と同じ厳しさで読んでいる', () => {
    // **模擬が緩いと、本番のバグを模擬が見逃す**（このプロジェクトで何度も起きている）
    // 2026-09-04 から、模擬は読み取りを**本番のソースから借りている**
    const mock = read('src/mock.js');
    assert.ok(mock.includes("'Num.gs'"), '模擬が本番の読み取りを読んでいません');
    assert.ok(/NUM\.numAmount_/.test(mock), '模擬が独自の読み取りを持っています');
    const i = mock.indexOf("case 'adminRentalSave'");
    const block = mock.slice(i, i + 2500);
    assert.ok(!/replace\(\/\[\^0-9/.test(block),
      '模擬に「数字以外を捨てる」読み方が残っています');
    assert.ok((block.match(/rentalNumber\(/g) || []).length >= 2,
      '模擬で、単価か最大数が素通りしています');
  });

  test('画面に無い欄（並び順・間口・奥行）を、保存で消さない', () => {
    // 管理ページの入力欄は7つだけ。並び順・間口(m)・奥行(m) は欄が無いので
    // payload に入ってこない。それを空で上書きしていたため、
    // 単価を1つ直しただけで**並びが行番号に戻り、テントの寸法が消えていた**
    const fn = R.slice(R.indexOf('function adminRentalSave_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    // 寸法は dim() を通すようにしたので、set() の行だけを見ると分からない。
    // **画面が送ってこないときに keepCell へ落ちる**ことが確かめられればよい
    // 並び順は、値を組み立ててから書く形にした（2026-09-04）。
    // set() の行だけを見ても分からないので、組み立てのところを見る
    const oi = body.indexOf('var orderVal;');
    assert.ok(oi >= 0, '並び順を組み立てている場所が見つかりません');
    const orderBlock = body.slice(oi, body.indexOf("set('並び順'", oi));
    assert.ok(/given\(it\.order\)/.test(orderBlock),
      '画面が送ってきたかどうかを見ていません：' + orderBlock.trim());
    assert.ok(/keepCell\('並び順'\)/.test(orderBlock),
      '並び順を、画面が送ってこないときも上書きしています：' + orderBlock.trim());
    assert.ok(/rentalNumber_\(it\.order\)/.test(orderBlock),
      '並び順を、共通の読み取りに通していません');
    // **読み取った値をそのまま使っているか。**
    // 検査だけ足して Number(it.order) を残していたので、
    // 「0」「１０」がどれも行番号に化けていた（2026-09-04 の点検で指摘）
    assert.ok(/gotOrder\.value/.test(orderBlock),
      '読み取った値を使っていません（行番号に化けます）：' + orderBlock.trim());
    assert.ok(!/Number\(it\.order\)/.test(orderBlock),
      'Number() を直に呼んでいます：' + orderBlock.trim());

    const dim = body.slice(body.indexOf('var dim = function'));
    const dimBody = dim.slice(0, dim.indexOf('};') + 2);
    assert.ok(/if \(!given\(v\)\) return keepCell\(col\);/.test(dimBody),
      '寸法を、画面が送ってこないときも上書きしています：' + dimBody.trim());
    assert.ok(/rentalNumber_\(/.test(dimBody),
      '寸法を、共通の読み取りに通していません（"2.7m" が空になります）');

    assert.ok(/function \(col\) \{/.test(R.slice(R.indexOf('var keepCell'))),
      'いまの値を読む手立てがありません');
  });

  test('模擬でも、画面に無い欄が保存で消えない', () => {
    const M = fresh();
    const tok = login(M, 'admin', '山田 太郎');
    const r0 = M.handle({ action: 'adminRental', token: tok });
    const tent = r0.items.filter(x => x.kind.indexOf('テント') === 0)[0];
    assert.ok(tent && tent.w > 0, '見本のテントに寸法がありません');
    const beforeOrder = tent.order, beforeW = tent.w, beforeD = tent.d;

    // 画面と同じ7項目だけを送る
    const res = M.handle({ action: 'adminRentalSave', token: tok, row: tent.row,
      item: { kind: tent.kind, name: tent.name, price: '16000',
              unit: tent.unit, max: tent.max, note: tent.note, active: true } });
    assert.strictEqual(res.ok, true, JSON.stringify(res));

    const after = M.handle({ action: 'adminRental', token: tok })
      .items.filter(x => x.name === tent.name)[0];
    assert.strictEqual(after.w, beforeW, 'テントの間口が消えました');
    assert.strictEqual(after.d, beforeD, 'テントの奥行が消えました');
    assert.strictEqual(after.order, beforeOrder, '並び順が変わりました');
    assert.strictEqual(after.price, 16000, '単価が入っていません');
  });

  test('見出しが1つでも欠けていたら書き込まない', () => {
    // 見出しを探せないまま列番号で書くと、**別の列を壊す**
    const fn = R.slice(R.indexOf('function rentalHeaders_'));
    assert.ok(/missing\.length/.test(fn), '欠けを見ていません');
  });

  test('書き換える関数はどれも、読み直させる', () => {
    // getRentalItems は1回の実行の間だけ結果を持つ。
    // 消さないと、保存直後の画面に古い値が出る。
    // **1か所だけ見ると、もう片方を壊しても素通りする**（実際に素通りした）
    ['adminRentalSave_', 'adminRentalDisable_'].forEach(name => {
      const i = R.indexOf('function ' + name);
      assert.ok(i >= 0, name + ' がありません');
      const NL = String.fromCharCode(10);
      const fn = R.slice(i, R.indexOf(NL + '}' + NL, i));
      assert.ok(/_rentalCache = null/.test(fn),
        name + ' がキャッシュを消していません');
    });
  });
});
