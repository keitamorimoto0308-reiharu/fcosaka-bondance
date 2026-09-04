/**
 * 「数を集める項目」の仕組み。
 *
 * 2026-09-03 けいた指示：
 * 「ゆくゆくはダッシュボードで、関係者パス、駐車証、チケットの必要枚数を
 *   応募フォームから吸い上げ、および、管理画面で打ち込み、
 *   ダッシュボードで総数が分かれば便利。
 *   これみたいに、運営上後々発生するけど、こうなったら便利、というのは
 *   あらかじめ吸い上げれるようにしたい」
 * 「今後もダッシュボードに出したいものは運用しながら増えていくかも」
 *
 * ■ ここで守りたいこと
 *   **項目を1行足すだけで、全部が揃う。**
 *   フォームの欄・台帳の列・ダッシュボードの合計・打ち込み欄。
 *   どれか1つでも「別のところにも書く」作りだと、必ず取り残される。
 *
 * ■ だから「項目名が書かれていないこと」を検査する
 *   ふつうの検査は「在ること」を見る。ここは逆に、
 *   集計のコードと画面に**項目名が直書きされていないこと**を見る。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const S = require('../src/schema.js');

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

describe('数を集める項目：定義', () => {

  test('印のついた項目が拾える', () => {
    const f = S.aggregateFields();
    assert.ok(f.length >= 4, '拾えていません：' + f.length);
    f.forEach(x => {
      assert.strictEqual(x.type, 'number', x.key + ' は数値ではありません');
      assert.ok(x.aggregate.label && x.aggregate.label.length >= 2,
        x.key + ' の表示名がありません');
      assert.ok(x.sheet, x.key + ' に台帳の列名がありません');
    });
  });

  test('けいたが挙げた3つが入っている', () => {
    const labels = S.aggregateFields().map(f => f.aggregate.label);
    ['関係者パス', '駐車証', '観戦チケット'].forEach(k => {
      assert.ok(labels.includes(k), k + ' がありません：' + labels.join('／'));
    });
  });

  test('台帳（出店確定情報）に列ができている', () => {
    const cols = S.confirmHeaders();
    S.aggregateFields().filter(f => f.stage === 'confirm').forEach(f => {
      assert.ok(cols.includes(f.sheet), f.sheet + ' の列がありません');
    });
  });
});

describe('数を集める項目：集計のコードに項目名を書いていない', () => {

  test('サーバーの集計に、項目名が直書きされていない', () => {
    // ここに項目名を書くと、schema.js に足したときに集計だけ古いまま残る
    const ADMIN = read('gas/Admin.gs');
    const fn = ADMIN.slice(ADMIN.indexOf('function aggregateTotals_'),
                           ADMIN.indexOf('function readConfirmAll_'));
    assert.ok(fn.includes('aggregateFields()'), '項目の一覧を読んでいません');
    S.aggregateFields().forEach(f => {
      assert.ok(!fn.includes(f.sheet), '集計に「' + f.sheet + '」が直書きされています');
      assert.ok(!fn.includes(f.key), '集計に「' + f.key + '」が直書きされています');
    });
  });

  test('画面の表示にも、項目名が直書きされていない', () => {
    const SRC = read('src/build-admin.js');
    const fn = SRC.slice(SRC.indexOf('function renderTotals('),
                         SRC.indexOf('function bars('));
    S.aggregateFields().forEach(f => {
      assert.ok(!fn.includes(f.aggregate.label),
        '画面に「' + f.aggregate.label + '」が直書きされています');
    });
  });

  test('打ち込み欄も、サーバーが送る一覧から組み立てている', () => {
    const SRC = read('src/build-admin.js');
    const fn = SRC.slice(SRC.indexOf('function renderCountEntry('),
                         SRC.indexOf('function closeDetail('));
    assert.ok(/fields\.map\(/.test(fn), '一覧から組み立てていません');
    S.aggregateFields().forEach(f => {
      assert.ok(!fn.includes(f.aggregate.label),
        '打ち込み欄に「' + f.aggregate.label + '」が直書きされています');
    });
  });
});

describe('数を集める項目：実際に動かす', () => {
  let M, tok;
  beforeEach(() => { M = fresh(); tok = login(M, 'admin', '山田 太郎'); });

  test('ダッシュボードに合計が出る', () => {
    const s = M.handle({ action: 'adminSummary', token: tok });
    assert.ok(Array.isArray(s.totals), '合計を返していません');
    assert.strictEqual(s.totals.length, S.aggregateFields().length,
      '項目の数と合いません');
    const pass = s.totals.filter(t => t.label === '関係者パス')[0];
    assert.ok(pass, '関係者パスがありません');
    assert.ok(pass.sum > 0, '合計が0です');
  });

  test('未提出の数も一緒に出す', () => {
    // 合計だけ出すと、まだ聞けていないぶんが見えない。
    // 枚数を手配する人がいちばん困るのは「この数字で発注してよいのか」
    const s = M.handle({ action: 'adminSummary', token: tok });
    s.totals.forEach(t => {
      assert.ok(typeof t.filled === 'number' && typeof t.missing === 'number',
        t.label + ' に提出済み／未提出の数がありません');
    });
    assert.ok(s.totals[0].missing > 0, '未提出が数えられていません');
  });

  test('管理ページから打ち込むと、合計に入る', () => {
    const before = M.handle({ action: 'adminSummary', token: tok })
      .totals.filter(t => t.label === '関係者パス')[0];
    const r = M.handle({ action: 'adminConfirmSave', token: tok,
                         id: 'SB-0002', values: { passCount: '3' } });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const after = M.handle({ action: 'adminSummary', token: tok })
      .totals.filter(t => t.label === '関係者パス')[0];
    assert.strictEqual(after.sum, before.sum + 3, '合計に入っていません');
    assert.strictEqual(after.filled, before.filled + 1, '社数が増えていません');
  });

  test('打ち込みは、誰が入れたか分かる形で履歴に残る', () => {
    // フォームからの提出と、こちらの打ち込みは区別できないと困る
    M.handle({ action: 'adminConfirmSave', token: tok,
               id: 'SB-0002', values: { ticketCount: '2' } });
    const h = M.DB.history[0];
    assert.strictEqual(h.who, '山田 太郎');
    assert.strictEqual(h.reason, '管理ページから入力');
    assert.strictEqual(h.after, '2');
  });

  test('文章の欄は、管理ページから書き換えられない', () => {
    // 事業者が書いた文章を主催側が書き換えられると、
    // **誰が書いたのか分からなくなる**
    const r = M.handle({ action: 'adminConfirmSave', token: tok,
                         id: 'SB-0002', values: { notes: '書き換え' } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'forbidden_field');
  });

  test('一般権限では打ち込めない', () => {
    const staff = login(M, 'staff', '佐藤 花子');
    const r = M.handle({ action: 'adminConfirmSave', token: staff,
                         id: 'SB-0002', values: { passCount: '9' } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'forbidden');
  });

  test('決めた範囲の外の数は、断って理由を言う', () => {
    // 以前は黙って読み飛ばして「変更0件」で返していた。
    // 打ち込んだ人には「同じ値だった」と読めるので、**入れたつもりの数が消える**
    const f = S.aggregateFields().filter(x => x.key === 'passCount')[0];
    const r = M.handle({ action: 'adminConfirmSave', token: tok,
                         id: 'SB-0002', values: { passCount: String(f.max + 1) } });
    assert.strictEqual(r.ok, false, '上限を超える数が入りました');
    assert.strictEqual(r.error, 'bad_value');
    assert.ok(r.message.includes(String(f.max)),
      '上限がいくつなのか伝わりません：' + r.message);
  });

  test('受付IDの形が違えば断る', () => {
    const r = M.handle({ action: 'adminConfirmSave', token: tok,
                         id: '../../etc', values: { passCount: '1' } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'bad_request');
  });
});

describe('集計の母数と、数の読み取り', () => {
  // 2026-09-03 の検証：ダッシュボードの「未提出 7社」が、
  // **採択していない事業者まで数えていた**（実際に催促できるのは3社）。
  // 枚数を手配する人が最初に見る数字なので、母数がずれると発注がずれる。
  let M, tok;
  beforeEach(() => { M = fresh(); tok = login(M, 'admin', '山田 太郎'); });

  const totals = () => M.handle({ action: 'adminSummary', token: tok }).totals;

  test('確定情報の母数は、採択した方だけ', () => {
    const accepted = M.DB.rows.filter(r => r['ステータス'] === '採択').length;
    assert.ok(accepted > 0 && accepted < M.DB.rows.length,
      '見本データが試験に向きません（採択 ' + accepted + ' / 全 ' + M.DB.rows.length + '）');
    totals().filter(t => t.stage === 'confirm').forEach(t => {
      assert.strictEqual(t.filled + t.missing, accepted,
        t.label + ' の母数が採択者数と違います（' + (t.filled + t.missing) + '）');
    });
  });

  test('不採択・審査中は、未提出に数えない', () => {
    // 「未提出」は催促する相手の数。出せない人を混ぜてはいけない
    const before = totals().filter(t => t.stage === 'confirm')[0].missing;
    M.DB.rows.push({ '受付ID': 'SB-9001', '企業名': '落ちた会社', 'ステータス': '不採択' });
    M.DB.rows.push({ '受付ID': 'SB-9002', '企業名': '審査中の会社', 'ステータス': '審査中' });
    const after = totals().filter(t => t.stage === 'confirm')[0].missing;
    assert.strictEqual(after, before,
      '出せない事業者を未提出に数えています（' + before + ' → ' + after + '）');
  });

  test('採択が増えれば、未提出も増える', () => {
    const before = totals().filter(t => t.stage === 'confirm')[0].missing;
    M.DB.rows.push({ '受付ID': 'SB-9003', '企業名': '新しく採択', 'ステータス': '採択' });
    const after = totals().filter(t => t.stage === 'confirm')[0].missing;
    assert.strictEqual(after, before + 1, '採択者が未提出に入っていません');
  });

  test('全角の数字を、0として足さない', () => {
    // 「数字以外を捨てて Number()」だと、'１０' が '' になり Number('') は 0。
    // **入っているのに0**として足され、しかも「入力済み」に数えられる
    const id = M.DB.rows.filter(r => r['ステータス'] === '採択')[0]['受付ID'];
    const key = require('../src/schema.js').aggregateFields()
      .filter(f => f.stage === 'confirm')[0].key;
    M.DB.confirm[id] = M.DB.confirm[id] || { values: {} };
    M.DB.confirm[id].values[key] = '１０';
    const t = totals().filter(x => x.key === key)[0];
    assert.strictEqual(t.sum, 10, '全角が ' + t.sum + ' として足されました');
  });

  test('読めない値は、入力済みに数えない', () => {
    const id = M.DB.rows.filter(r => r['ステータス'] === '採択')[0]['受付ID'];
    const key = require('../src/schema.js').aggregateFields()
      .filter(f => f.stage === 'confirm')[0].key;
    M.DB.confirm[id] = { values: {} };
    M.DB.confirm[id].values[key] = 'あとで';
    const t = totals().filter(x => x.key === key)[0];
    assert.strictEqual(t.sum, 0, '読めない値を足しています');
    assert.strictEqual(t.filled, 0, '読めない値を「入力済み」に数えています');
  });

  test('本番も、同じ母数と同じ読み取りにしてある', () => {
    const A = read('gas/Admin.gs');
    const fn = A.slice(A.indexOf('function aggregateTotals_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/AGGREGATE_CONFIRM_STATUS_/.test(body), '本番が母数を絞っていません');
    assert.ok(/aggregateNumber_\(/.test(body), '本番が読み取りをまとめていません');

    // **中身まで見る。** 名前が残っているだけでは、
    // 全ステータスを true にされても素通りする
    const map = A.slice(A.indexOf('var AGGREGATE_CONFIRM_STATUS_'));
    const decl = map.slice(0, map.indexOf(';') + 1);
    ['不採択', '辞退', 'キャンセル', '審査中', '未確認', '重複'].forEach(st => {
      assert.ok(!decl.includes(st), '本番の母数に「' + st + '」が入っています：' + decl.trim());
    });
    assert.ok(decl.includes('採択'), '本番の母数に「採択」がありません');

    // 数の読み取りは gas/Num.gs にまとめた（3つが揃っていなかったため）
    const num = A.slice(A.indexOf('function aggregateNumber_'));
    const nb = num.slice(0, num.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/numAmount_\(/.test(nb), '共通の読み取りを通っていません');
    assert.ok(!/replace\(/.test(nb), 'ここに読み取りを書き直しています（写しになります）');
  });

  test('誰が未提出なのかを返す', () => {
    // 数だけでは催促できない。検証役は一覧で5手順かけて自力で調べていた
    //（2026-09-04 の検証で指摘）
    const t = totals().filter(x => x.stage === 'confirm')[0];
    assert.ok(Array.isArray(t.missingNames), '未提出の社名を返していません');
    assert.strictEqual(t.missingNames.length, Math.min(t.missing, 5),
      '社名の数が未提出の数と合いません：' + JSON.stringify(t.missingNames));
    t.missingNames.forEach(nm => {
      assert.ok(String(nm).trim(), '空の社名が入っています');
      assert.ok(M.DB.rows.some(r => r['企業名'] === nm || r['受付ID'] === nm),
        '台帳に無い名前です：' + nm);
    });
  });

  test('同じ社名が2社あっても、「ほかN社」が実数と合う', () => {
    // 同一企業が2区画に応募することがある（別の行＝別の未提出）。
    // 社名で重複を潰していたので、画面の「ほかN社」が実際の未提出数と合わず、
    // **催促が抜ける**形になっていた（2026-09-04 の点検で指摘）。
    // 受付IDで見るように直したので、同名でも別々に数える
    const accepted = M.DB.rows.filter(r => r['ステータス'] === '採択');
    const name = accepted[0]['企業名'];
    M.DB.rows.push({ '受付ID': 'SB-9101', '企業名': name, 'ステータス': '採択' });
    M.DB.rows.push({ '受付ID': 'SB-9102', '企業名': name, 'ステータス': '採択' });

    const t = totals().filter(x => x.stage === 'confirm')[0];
    const shown = t.missingNames.length;
    assert.strictEqual(shown + t.missingMore, t.missing,
      '出した社名 ' + shown + ' ＋ ほか ' + t.missingMore
      + ' が、未提出 ' + t.missing + ' と合いません');
    // 同名が2つ出ていること（1つに潰されていない）
    const same = t.missingNames.filter(x => x === name).length;
    assert.ok(same >= 2 || shown >= 5,
      '同じ社名を1つに潰しています：' + JSON.stringify(t.missingNames));
  });

  test('未提出が多いときは、頭だけ返して残りの数を添える', () => {
    // 50社ぶん並べても読めない
    M.DB.rows.filter(r => r['ステータス'] !== '採択').forEach(r => {
      r['ステータス'] = '採択';
    });
    const t = totals().filter(x => x.stage === 'confirm')[0];
    assert.ok(t.missing > 5, '前提が崩れています（未提出 ' + t.missing + '社）');
    assert.strictEqual(t.missingNames.length, 5, '頭だけにしていません');
    assert.strictEqual(t.missingNames.length + t.missingMore, t.missing,
      '出した社名と「ほかN社」の合計が、未提出の数と合いません');
  });

  test('画面が、未提出の社名と行き先を出している', () => {
    const A = read('src/build-admin.js');
    const fn = A.slice(A.indexOf('function renderTotals'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/var who = \(t\.missingNames \|\| \[\]\)\.length/.test(body),
      '社名を出していません');
    assert.ok(/data-jump/.test(body), '一覧への行き先がありません');
    assert.ok(/missingMore/.test(body), '残りの数を出していません');

    // 本番も返しているか（模擬だけ直しても意味がない）
    const A2 = read('gas/Admin.gs');
    assert.ok(/missingNames: missingNames\.slice\(0, AGGREGATE_NAMES_MAX\)/.test(A2),
      '本番が未提出の社名を返していません');
  });

  test('画面が、まだ増えることを書いている', () => {
    // 大きい数字だけ見て「これが当日の必要数」と読まれるのを防ぐ
    const A = read('src/build-admin.js');
    const fn = A.slice(A.indexOf('function renderTotals'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/いま出ている分だけの合計/.test(body), '途中の数だと書いていません');
    assert.ok(/社中 /.test(body), '母数を書いていません');
  });
});
