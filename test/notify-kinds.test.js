/**
 * 選考結果の一括送信（採択・不採択）。
 *
 * ■ ここで見つけた事故（2026-09-03）
 *   **採択通知は、本番では一度も送れない状態だった。**
 *     ・サーバーは `ids`（受付IDの集合）で照合する
 *     ・画面は `expect`（件数）しか送っていなかった
 *     ・**模擬サーバーが件数を見ていたので、模擬では通っていた**
 *   気づくのは、締切直後に送ろうとしたとき。いちばん困るところ。
 *
 *   「模擬が本番より緩い」は、このプロジェクトで繰り返し起きている。
 *   だから**画面が何を送るか**と**サーバーが何を見るか**を、
 *   ここで直接突き合わせる。
 *
 * ■ 不採択は、採択と同じ3段階にそろえた
 *   仕様書§6-5は「ステータス変更時に確認して送る」だが、
 *   50社ぶんを1件ずつ変えながら送るのは送り漏れと誤送信の温床。
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
function login(M) {
  const r = M.handle({ action: 'adminLogin', password: 'admin', person: '山田 太郎' });
  assert.ok(r.ok, JSON.stringify(r));
  return r.token;
}

describe('画面とサーバーが、同じものを見ているか', () => {

  test('画面は、受付IDの集合を送っている', () => {
    // ここが件数だけだった。サーバーはIDで照合するので、必ず弾かれていた
    const SRC = read('src/build-admin.js');
    const i = SRC.indexOf('function sendNotify(');
    assert.ok(i >= 0, 'sendNotify がありません');
    const fn = SRC.slice(i, SRC.indexOf('function ', i + 10));
    assert.ok(/ids:\s*rows\.map\(/.test(fn),
      '画面が受付IDの集合を送っていません（サーバーはIDで照合します）');
    assert.ok(/kind:/.test(fn), '画面が通知の種類を送っていません');
  });

  test('サーバーは、受付IDの集合で照合している', () => {
    const N = read('gas/Notify.gs');
    const i = N.indexOf('function adminNotifySend_');
    const fn = N.slice(i, N.indexOf('\n}\n', i));
    assert.ok(/payload\.ids/.test(fn), 'サーバーがIDを見ていません');
    assert.ok(/nowIds/.test(fn) && /sawIds/.test(fn), 'ID集合の突き合わせがありません');
  });

  test('模擬も、受付IDの集合で照合している', () => {
    // 模擬が緩いと、本番で落ちる不具合を模擬では見つけられない
    const MOCK = read('src/mock.js');
    const i = MOCK.indexOf("case 'adminNotifySend'");
    const fn = MOCK.slice(i, MOCK.indexOf("case '", i + 10));
    assert.ok(/payload\.ids/.test(fn), '模擬がIDを見ていません（本番より緩い）');
    assert.ok(!/Number\(payload\.expect\)/.test(fn),
      '模擬がまだ件数で照合しています');
  });

  test('送る種類の定義が、本番と模擬で一致している', () => {
    const N = read('gas/Notify.gs');
    const MOCK = read('src/mock.js');
    ['採択通知送信日時', '不採択通知送信日時'].forEach(col => {
      assert.ok(N.includes(col), '本番に「' + col + '」がありません');
      assert.ok(MOCK.includes(col), '模擬に「' + col + '」がありません');
    });
  });
});

describe('選考結果の送信：実際に動かす', () => {
  let M, tok;
  beforeEach(() => { M = fresh(); tok = login(M); });

  test('件数だけを送ると、弾かれる', () => {
    // 直す前の画面はこれを送っていた。**本番では必ずここで止まっていた**
    const r = M.handle({ action: 'adminNotifySend', token: tok, confirm: true, expect: 3 });
    assert.strictEqual(r.ok, undefined === true ? true : false);
    assert.strictEqual(r.error, 'changed');
  });

  test('受付IDの集合を送ると、通る', () => {
    const p = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'accept' });
    assert.ok(p.rows.length > 0, '採択の対象がいません');
    const r = M.handle({ action: 'adminNotifySend', token: tok, confirm: true,
                         kind: 'accept', ids: p.rows.map(x => x.id) });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.sent.length, p.rows.length);
  });

  test('不採択は、不採択の人だけが対象になる', () => {
    const a = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'accept' });
    const r = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'reject' });
    assert.strictEqual(r.kind, 'reject');
    assert.ok(r.rows.length > 0, '不採択の対象がいません');
    // 採択と不採択が混ざっていないこと
    const overlap = r.rows.filter(x => a.rows.some(y => y.id === x.id));
    assert.strictEqual(overlap.length, 0,
      '採択と不採択に同じ会社が入っています：' + overlap.map(x => x.id).join('、'));
  });

  test('送信日時は、種類ごとに別の列に入る', () => {
    // 1つの列を使い回すと「採択を送ったのか、不採択なのか」が後から分からない
    const p = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'reject' });
    const id = p.rows[0].id;
    M.handle({ action: 'adminNotifySend', token: tok, confirm: true,
               kind: 'reject', ids: p.rows.map(x => x.id) });
    const row = M.DB.rows.filter(r => r['受付ID'] === id)[0];
    assert.ok(row['不採択通知送信日時'], '不採択の送信日時が入っていません');
    assert.ok(!row['採択通知送信日時'], '採択の列に入っています');
  });

  test('一度送った相手は、次から対象に出ない', () => {
    const p = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'reject' });
    M.handle({ action: 'adminNotifySend', token: tok, confirm: true,
               kind: 'reject', ids: p.rows.map(x => x.id) });
    const again = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'reject' });
    assert.strictEqual(again.rows.length, 0, '二重送信の恐れがあります');
  });

  test('知らない種類は断る', () => {
    const r = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'なんでも' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'bad_request');
  });
});

describe('不採択の文面', () => {
  const N = read('gas/Notify.gs');
  const fn = N.slice(N.indexOf('function buildRejectMail_'),
                     N.indexOf('function buildAcceptMail_'));

  test('理由を書いていない', () => {
    // 具体的な理由を書くと、必ず「なぜうちが」という問い合わせになる。
    // 選考基準を公開していない以上、答えられない
    ['審査基準', '評価', '点数', '不足していた'].forEach(w => {
      assert.ok(!fn.includes(w), '理由に踏み込んでいます：' + w);
    });
    assert.ok(/区画数に限りがあり/.test(fn), '断りの理由がぼかされていません');
  });

  test('リンクを載せていない', () => {
    // 確定情報フォームも素材提出も、この方には要らない。
    // 載っていると「まだ何かするのか」と読ませてしまう
    ['confirm', 'upload', 'acceptLink_'].forEach(w => {
      assert.ok(!fn.includes(w), '不採択の本文にリンクが混ざっています：' + w);
    });
  });

  test('受付IDと、次回への案内がある', () => {
    assert.ok(/受付ID/.test(fn), '受付IDがありません（問い合わせ時に探せません）');
    assert.ok(/次回/.test(fn), '次回のご案内がありません');
  });

  test('不採択では、素材トークンを発行しない', () => {
    // 発行すると、本文にリンクが無くても確定情報フォームが開けてしまう
    const send = N.slice(N.indexOf('function adminNotifySend_'));
    const body = send.slice(0, send.indexOf('\n}\n'));
    const i = body.indexOf('if (isReject)');
    const j = body.indexOf('} else {', i);
    assert.ok(i >= 0 && j > i, '種類で分けていません');
    assert.ok(!body.slice(i, j).includes('ensureAcceptToken_'),
      '不採択でトークンを発行しています');
  });
});

describe('画面が、種類を取り違えさせない', () => {
  // 2026-09-03 の検証：「不採択のご連絡」を選んでも、
  // 本文確認に**採択の文面**（出店決定・確定情報フォームのリンク付き）が出ていた。
  // 3段階（相手を確かめる→本文を読む→送る）の2段目が働いていなかった。
  const A = read('src/build-admin.js');

  function preview(kind) {
    const M = fresh();
    const tok = login(M, 'admin', '山田 太郎');
    return M.handle({ action: 'adminNotifyPreview', token: tok, kind });
  }

  test('不採択の見本は、不採択の文面になっている', () => {
    const r = preview('reject');
    assert.ok(r.sample, '見本がありません');
    assert.ok(!/出店決定/.test(r.sample.subject),
      '不採択なのに採択の件名です：' + r.sample.subject);
    assert.ok(/選考結果/.test(r.sample.subject), '件名が本番と違います：' + r.sample.subject);
    assert.ok(!/決定いたしました/.test(r.sample.body), '不採択なのに出店決定の本文です');
    assert.ok(!/confirm\.html/.test(r.sample.body), '不採択の見本にリンクが載っています');
  });

  test('採択の見本は、採択の文面のまま', () => {
    const r = preview('accept');
    assert.ok(/出店決定/.test(r.sample.subject), '採択の件名が変わっています');
    assert.ok(/confirm\.html/.test(r.sample.body), '確定情報フォームの案内がありません');
  });

  test('模擬の見本の骨格が、本番の文面と合っている', () => {
    // **模擬だけ直して本番と食い違う**のがいちばん怖いので、両方を突き合わせる
    const N2 = read('gas/Notify.gs');
    const rej = N2.slice(N2.indexOf('function buildRejectMail_'));
    const subj = (rej.match(/var subject = '(【[^']+】)'/) || [])[1];
    assert.ok(subj, '本番の件名を読み取れません');
    assert.ok(preview('reject').sample.subject.indexOf(subj) === 0,
      '模擬の件名が本番と違います');
  });

  test('変更履歴には、送った種類が残る', () => {
    const M = fresh();
    const tok = login(M, 'admin', '山田 太郎');
    const r = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'reject' });
    M.handle({ action: 'adminNotifySend', token: tok, confirm: true, kind: 'reject',
               ids: r.rows.map(x => x.id) });
    const h = M.DB.history[0];
    assert.ok(/不採択/.test(h.item),
      '不採択を送ったのに履歴が「' + h.item + '」になっています');
  });

  test('不採択では、URLが空でも「送信できません」と言わない', () => {
    // 本番は不採択の本文にリンクを載せないので、URLが無くても送れる。
    // ここで止めると、URLを入れる前に不採択だけ先に送る運用ができない
    // **その警告を出している if 文そのもの**を見る。
    // 前後400文字を眺めると、隣の分岐の isReject を拾って素通りする
    const lines = A.split(String.fromCharCode(10));
    const at = lines.findIndex(l => l.includes('確定情報フォームURL</b>が空です'));
    assert.ok(at > 0, '警告文が見つかりません');
    let cond = '';
    for (let k = at; k >= 0 && k > at - 6; k--) {
      if (lines[k].trim().indexOf('if (') === 0) { cond = lines[k]; break; }
    }
    assert.ok(cond, '警告を出す条件が見つかりません');
    assert.ok(cond.includes('!isReject'),
      '不採択でもURLの警告を出しています：' + cond.trim());
  });

  test('対象0件の案内が、その種類のステータス名になっている', () => {
    const i = A.indexOf('にすると、ここに出ます');
    assert.ok(i > 0, '案内が見つかりません');
    const block = A.slice(Math.max(i - 300, 0), i + 40);
    assert.ok(/isReject/.test(block),
      '不採択の画面で「採択にすると出ます」と案内しています');
  });

  test('種類を切り替えたら、前の送信結果を消す', () => {
    // 「1件を送信しました」が残ったまま別の種類に切り替わると、
    // **どちらを送ったのか取り違える**
    const i = A.indexOf("S.notifyKind = radio.value;");
    assert.ok(i > 0, '切り替えの処理が見つかりません');
    const block = A.slice(i, i + 500);
    assert.ok(/mailResult'\)\.hidden = true/.test(block), '前の結果を消していません');
  });

  test('送信結果に、何を送ったかが書いてある', () => {
    assert.ok(/kindLabel \|\| '通知'\) \+ ' を '/.test(A),
      '結果に種類が書かれていません（採否を取り違えます）');
  });
});

describe('反対の通知を、あとから機械で送らない', () => {
  // 2026-09-03 の点検：採択のご連絡を送ったあとにステータスを不採択へ直すと、
  // その方に「見送らせていただきました」が**一斉送信で自動的に**届いていた。
  // ステータスの打ち間違いを直したときに普通に起きる。
  // 機械で追い打ちをかけず、人が事情を説明する形にする。
  let M, tok, victim;

  beforeEach(() => {
    M = fresh();
    tok = login(M, 'admin', '山田 太郎');
    const p = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'accept' });
    M.handle({ action: 'adminNotifySend', token: tok, confirm: true, kind: 'accept',
               ids: p.rows.map(x => x.id) });
    victim = p.rows[0].id;
    M.DB.rows.filter(r => r['受付ID'] === victim)[0]['ステータス'] = '不採択';
  });

  test('採択を送った相手は、不採択の対象に入らない', () => {
    const q = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'reject' });
    assert.ok(!q.rows.some(x => x.id === victim),
      '採択のご連絡を送った相手に、不採択を送ろうとしています：' + victim);
  });

  test('外したことを、理由つきで画面に返す', () => {
    // 黙って外すと、こんどは「送ったはずの人に届いていない」が起きる
    const q = M.handle({ action: 'adminNotifyPreview', token: tok, kind: 'reject' });
    assert.ok(Array.isArray(q.flipped), '外した行を返していません');
    const f = q.flipped.filter(x => x.id === victim)[0];
    assert.ok(f, '外した行に入っていません：' + JSON.stringify(q.flipped));
    assert.ok(f.sentAt, 'いつ送ったかが分かりません');
    assert.ok(/採択/.test(f.sentLabel), '何を送ったかが分かりません：' + f.sentLabel);
  });

  test('送信のときも、同じ理由で外れている', () => {
    // 下見だけで外して送信側が素通りだと、意味がない。
    // **下見を通さず、台帳から直に受付IDを作って送る**（画面のバグを模した形）。
    // 歯止めがあれば「対象が変わりました」で断られ、無ければ届いてしまう
    const ids = M.DB.rows
      .filter(r => r['ステータス'] === '不採択' && !r['不採択通知送信日時'])
      .map(r => r['受付ID']);
    assert.ok(ids.indexOf(victim) >= 0, '試験の前提が崩れています');
    const r = M.handle({ action: 'adminNotifySend', token: tok, confirm: true,
                         kind: 'reject', ids });
    assert.ok(!(r.sent || []).some(x => x.id === victim),
      '採択のご連絡を送った相手に、不採択を送りました');
  });

  test('画面が、外したことを見える所に出している', () => {
    // **その分岐の中に文があるか**まで見る。
    // ファイル全体を眺めると、分岐を if (false) にしても文字列は残るので素通りする
    const A = read('src/build-admin.js');
    const i = A.indexOf('var flip = r.flipped || [];');
    assert.ok(i > 0, '画面が外した行を受け取っていません');
    const block = A.slice(i, i + 900);
    assert.ok(/if \(flip\.length\)\{/.test(block), '外した行を見ていません');
    assert.ok(/一斉送信の対象から外しています/.test(block),
      '外したことを画面に書いていません');
    assert.ok(/お電話などで事情をお伝えください/.test(block),
      '次に何をすればよいかが書かれていません');
  });

  test('本番も、同じ形で外している', () => {
    const N2 = read('gas/Notify.gs');
    const fn = N2.slice(N2.indexOf('function pendingNotifyRows_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    // 条件そのものを見る。if (false) にされても flipped.push は残る
    assert.ok(body.includes("if (asText_(cell_(H, r, other.sentCol)).trim() !== '') {"),
      '本番が、もう片方の送信日時を見ていません');
    assert.ok(/flipped\.push/.test(body), '本番が、外した行を集めていません');
    // 送信側も同じ関数を通っているか（下見だけ厳しくても意味がない）
    // 関数の頭から1200文字、のような数え方はしない。
    // 手前に処理を足すと、正しいまま落ちる（実際に落ちた・2026-09-04）
    const send = N2.slice(N2.indexOf('function adminNotifySend_'));
    const sendBody = send.slice(0, send.indexOf(String.fromCharCode(10) + '}' +
                                                String.fromCharCode(10)));
    assert.ok(/pendingNotifyRows_\(/.test(sendBody),
      '送信側が別の絞り込みを使っています');
  });
});
