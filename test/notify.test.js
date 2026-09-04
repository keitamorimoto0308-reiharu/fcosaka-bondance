/**
 * 採択通知の一括送信（gas/Notify.gs）と、採択後リンクのトークン。
 *
 * ■ この機能で一番怖いのは何か
 *   「送りすぎ」ではなく「**送ったつもりで届いていない**」。
 *   採択されたのに連絡が来ない事業者は、こちらの画面上は「送信済み」に見える。
 *   締切まで誰も気づかない。だから検査の重心もそこに置く。
 *
 * ■ 動かせないものは、コードの形で固定する
 *   GmailApp・SpreadsheetApp は Node では動かない。
 *   純粋な関数（トークン・リンク・本文・対象抽出）は隔離して実行し、
 *   実行できない部分（送信と記録の順序など）はソースの並びで確かめる。
 *   「順序が逆でも動いてしまう」たぐいの誤りなので、形で縛るのが有効。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const NOTIFY = read('gas/Notify.gs');
const CONFIRM = read('gas/Confirm.gs');
const ADMIN = read('gas/Admin.gs');
const API = read('gas/Api.gs');

/** 名前で関数を1つ切り出す。関数の終わりは行頭の `}` */
function cutFunction(code, name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' が見つかりません');
  const end = code.indexOf('\n}\n', start) + 3;
  assert.ok(end > start, name + ' の終わりが見つかりません（切り出しが壊れています）');
  return code.slice(start, end);
}

// ───────────────────────────── 送信の順序と歯止め

describe('採択通知：取り消せない操作の歯止め', () => {

  test('送ってから記録している（逆にすると、届いていないのに送信済みになる）', () => {
    const fn = cutFunction(NOTIFY, 'adminNotifySend_');
    const send = fn.indexOf('GmailApp.sendEmail');
    const mark = fn.indexOf('notifiedCol + 1');
    assert.ok(send >= 0, '送信が見つかりません');
    assert.ok(mark >= 0, '送信日時の記録が見つかりません');
    assert.ok(send < mark,
      '記録が送信より先にあります。送信に失敗した行が「送信済み」として残り、'
      + '事業者には何も届かないのに誰も気づけません');
  });

  test('1件ごとに書き切っている（途中で止まっても、送った分は残る）', () => {
    const fn = cutFunction(NOTIFY, 'adminNotifySend_');
    const loopStart = fn.indexOf('batch.forEach');
    assert.ok(loopStart >= 0, '1件ずつ回す処理が見つかりません');
    assert.ok(fn.indexOf('SpreadsheetApp.flush()', loopStart) > loopStart,
      '1件ごとに書き切っていません（途中で止まると、送ったのに記録が残りません）');
  });

  test('確認なしでは送らない', () => {
    const fn = cutFunction(NOTIFY, 'adminNotifySend_');
    assert.ok(/payload\.confirm !== true/.test(fn),
      '送信の確認（confirm）を見ていません');
    assert.ok(fn.indexOf('not_confirmed') < fn.indexOf('GmailApp.sendEmail'),
      '確認より先に送信しています');
  });

  test('画面で見せた「相手そのもの」と食い違ったら送らない', () => {
    // 件数だけを見ると、**1社抜けて1社増えたとき素通りする**。
    // 管理者が2人いる、1人が別タブで一覧を触っている、で普通に起きる。
    // 検証役が実際に再現させた（画面で見ていない会社に届いた）。
    const fn = cutFunction(NOTIFY, 'adminNotifySend_');
    assert.ok(/sawIds\.join\(','\) !== nowIds\.join\(','\)/.test(fn),
      '受付IDの集合で突き合わせていません（件数だけでは防げません）');
    assert.ok(!/expect !== all\.length/.test(fn),
      '件数だけの突き合わせが残っています');
    assert.ok(fn.indexOf("error: 'changed'") < fn.indexOf('GmailApp.sendEmail'),
      '対象の確認より先に送信しています');
  });

  test('送信の残量が足りなければ、1通も送らない', () => {
    // 途中で尽きると「半分だけ届いた」状態になり、誰に届いたか分からなくなる
    const fn = cutFunction(NOTIFY, 'adminNotifySend_');
    assert.ok(/getRemainingDailyQuota/.test(fn), '送信可能数を見ていません');
    assert.ok(fn.indexOf("error: 'quota'") < fn.indexOf('GmailApp.sendEmail'),
      '残量の確認より先に送信しています');
  });

  test('リンクの無い採択通知は送らない', () => {
    const fn = cutFunction(NOTIFY, 'adminNotifySend_');
    assert.ok(fn.indexOf("error: 'no_url'") < fn.indexOf('GmailApp.sendEmail'),
      '確定情報フォームURLが空でも送信してしまいます');
  });

  test('1回の送信に上限がある（実行時間で途中停止しないように）', () => {
    assert.ok(/var NOTIFY_BATCH_MAX = \d+;/.test(NOTIFY), '上限が定義されていません');
    const fn = cutFunction(NOTIFY, 'adminNotifySend_');
    assert.ok(/slice\(0, NOTIFY_BATCH_MAX\)/.test(fn), '上限を使っていません');
  });

  test('対象は「そのステータスかつ未送信」だけ', () => {
    // 2026-09-03 に不採択にも対応したので、'採択' は直書きせず
    // NOTIFY_KINDS（種類の定義）から引く形になった
    const fn = cutFunction(NOTIFY, 'pendingNotifyRows_');
    assert.ok(fn.includes('K.status'), 'ステータスを見ていません');
    assert.ok(fn.includes('K.sentCol'), '送信済みかどうかを見ていません');

    // 種類の定義に、採択と不採択の両方があるか
    // 宣言の書き出しは変わりうる（素の {} をやめて Object.create(null) にした）。
    // 名前から次の function までを切る
    const kinds = NOTIFY.slice(NOTIFY.indexOf('var NOTIFY_KINDS ='),
                               NOTIFY.indexOf('function notifyKind_'));
    ['採択通知送信日時', '不採択通知送信日時'].forEach(c => {
      assert.ok(kinds.includes(c), '種類の定義に「' + c + '」がありません');
    });
  });

  test('書き戻す行を、受付IDで引き直している', () => {
    // liveRows_ は空行を落とすので添字がずれる。
    // ずれたまま書くと**別の会社を送信済みにする**
    const fn = cutFunction(NOTIFY, 'adminNotifySend_');
    assert.ok(/rowNoByReceiptId_\(L, r\.id\)/.test(fn),
      '行番号を受付IDで引き直していません（別の行を送信済みにする恐れがあります）');
  });

  test('プレビューは台帳を書き換えない', () => {
    const fn = cutFunction(NOTIFY, 'adminNotifyPreview_');
    assert.ok(!/setValue|appendRow|ensureAcceptToken_/.test(fn),
      'プレビューが台帳に書き込んでいます（送っていないのに状態が変わります）');
    assert.ok(!/GmailApp|MailApp\.sendEmail/.test(fn),
      'プレビューがメールを送っています');
  });

  test('採択通知は管理者だけが送れる', () => {
    const m = ADMIN.match(/var adminOnly = \[([\s\S]*?)\];/);
    assert.ok(m, 'adminOnly が見つかりません');
    ['adminNotifyPreview', 'adminNotifySend'].forEach(a => {
      assert.ok(m[1].includes("'" + a + "'"), a + ' が管理者限定になっていません');
    });
  });
});

// ───────────────────────────── トークン

describe('採択後リンクのトークン', () => {

  test('パスワードから作っていない（鍵を変えてもリンクが生き続ける）', () => {
    // SelfEdit.gs は authSecret_() から署名を作る。同じ作りにすると、
    // 管理者がパスワードを変えた瞬間に、送信済みメールのリンクが全部死ぬ。
    // §6-5 の運用は「イベント終了後にパスワードを変更する」なので現実に起きる。
    const fns = ['ensureAcceptToken_', 'findAcceptedRow_', 'acceptLink_']
      .map(n => cutFunction(NOTIFY, n)).join('\n');
    assert.ok(!/authSecret_|selfHmac_|passwordFingerprint/.test(fns),
      'トークンがパスワードに依存しています。パスワードを変えると'
      + '既に送ったリンクが全部死にます');
  });

  test('照合は定数時間の比較を使っている', () => {
    const fn = cutFunction(NOTIFY, 'findAcceptedRow_');
    assert.ok(/safeEquals_\(/.test(fn), 'トークンの比較が safeEquals_ ではありません');
  });

  test('形の合わないトークンは、台帳を読む前に落とす', () => {
    const fn = cutFunction(NOTIFY, 'findAcceptedRow_');
    const guard = fn.indexOf('0-9a-f]{32}');
    const readAt = fn.indexOf('readLedger_()');
    assert.ok(guard >= 0, 'トークンの形を見ていません');
    assert.ok(guard < readAt, '形の検査より先に台帳を読んでいます');
  });

  test('どの失敗でも同じ文言を返す（IDの総当たりの手がかりを与えない）', () => {
    const fn = cutFunction(CONFIRM, 'confirmDenied_');
    assert.ok(!/受付ID|トークン|見つかりません/.test(fn.replace(/^.*message:/s, '')) ||
              /このリンクは有効ではありません/.test(fn),
      'どこが違うのかを教えてしまう文言です');
  });

  test('リンクの値はURLエンコードしている', () => {
    const fn = cutFunction(NOTIFY, 'acceptLink_');
    assert.ok((fn.match(/encodeURIComponent/g) || []).length >= 2,
      '受付IDとトークンの両方をエンコードしていません');
  });

  test('URLが未設定ならリンクを作らない（?id=… だけの壊れたリンクを出さない）', () => {
    const box = vm.createContext({ encodeURIComponent });
    vm.runInContext(cutFunction(NOTIFY, 'acceptLink_'), box);
    const link = vm.runInContext('acceptLink_', box);
    assert.strictEqual(link('', 'SB-0001', 'abc'), '');
    assert.strictEqual(link('https://x.test/c.html', 'SB-0001', 'abc'),
      'https://x.test/c.html?id=SB-0001&t=abc');
    // 既にクエリを持つURLでも壊れない
    assert.strictEqual(link('https://x.test/c.html?v=2', 'SB-0001', 'abc'),
      'https://x.test/c.html?v=2&id=SB-0001&t=abc');
  });
});

// ───────────────────────────── 確定情報フォーム

describe('出店確定情報フォーム：採択者だけが入れる', () => {

  test('採択以外は、トークンが合っていても開かない', () => {
    ['confirmLoad_', 'confirmSave_'].forEach(n => {
      const fn = cutFunction(CONFIRM, n);
      assert.ok(/hit\.status !== '採択'/.test(fn),
        n + ' がステータスを見ていません（採択を取り消した相手のリンクが生き続けます）');
    });
  });

  test('保存の直前に、鍵とステータスを確かめ直している', () => {
    // 開いたあとに採択が取り消された、という行き違いを防ぐ
    const fn = cutFunction(CONFIRM, 'confirmSave_');
    assert.ok(fn.indexOf('findAcceptedRow_') < fn.indexOf('validateFieldList_'),
      '保存時に鍵を確かめ直していません');
  });

  test('条件判定に使う応募段階の値を、ブラウザから受け取っていない', () => {
    // 火気と保険は「飲食のみ」。boothTypes を送らせると、
    // 飲食なのに「飲食ではない」と偽って必須を回避できる
    const fn = cutFunction(CONFIRM, 'confirmSave_');
    assert.ok(/next\.boothTypes = base\.boothTypes;/.test(fn),
      'boothTypes を台帳の値で上書きしていません（必須を回避できます）');
    const assignAt = fn.indexOf('next.boothTypes = base.boothTypes');
    const validateAt = fn.indexOf('validateFieldList_');
    assert.ok(assignAt < validateAt, '上書きより先に検証しています');
  });

  test('受け取るのは確定情報の項目だけ（応募内容を書き換えられない）', () => {
    const fn = cutFunction(CONFIRM, 'confirmSave_');
    assert.ok(/confirmFields\(\)\.forEach/.test(fn),
      '確定情報の項目だけを取り出していません');
    assert.ok(!/applyFields\(\)/.test(fn),
      '応募段階の項目まで受け取っています（応募内容を書き換えられます）');
  });

  test('検証は応募フォームと同じ関数を通る', () => {
    const fn = cutFunction(CONFIRM, 'confirmSave_');
    assert.ok(/validateFieldList_\(confirmFields\(\), next\)/.test(fn),
      '検証が共通の関数を通っていません（片方だけ緩い状態ができます）');
  });

  test('公開APIの入口が、管理APIと分かれている', () => {
    assert.ok(/indexOf\('confirm'\) === 0/.test(API),
      'confirm* の振り分けがありません');
    // 'admin' で始まらないので管理APIの分岐には入らない、を確かめる
    assert.ok(API.indexOf("indexOf('admin') === 0") < API.indexOf("indexOf('confirm') === 0"),
      '管理APIより先に confirm を拾っています');
  });

  test('返す値は確定情報の項目に限っている', () => {
    const fn = cutFunction(CONFIRM, 'confirmPublicValues_');
    assert.ok(/confirmFields\(\)\.forEach/.test(fn),
      '返す値を絞っていません（こちらで足した項目まで返る恐れがあります）');
  });
});

// ───────────────────────────── 台帳とシート

describe('出店確定情報シート', () => {

  test('応募一覧とは別シートになっている', () => {
    const cfg = read('gas/Config.gs');
    assert.ok(/CONFIRM:\s*'出店確定情報'/.test(cfg), 'シート名が定義されていません');
  });

  test('setup() が作る', () => {
    const setup = read('gas/Setup.gs');
    assert.ok(/setupConfirmSheet_\(ss\);/.test(cutFunction(setup, 'setup')),
      'setup() が出店確定情報シートを作っていません');
  });

  test('列は後ろに足すだけ（既にある回答とずれない）', () => {
    const setup = read('gas/Setup.gs');
    const fn = cutFunction(setup, 'setupConfirmSheet_');
    assert.ok(/current\.indexOf\(h\) < 0/.test(fn),
      '足りない列だけを足す作りになっていません');
    assert.ok(!/sh\.clear\(\)/.test(fn),
      'シートを消しています（登録済みの回答が消えます）');
  });

  test('保険は飲食にだけ聞く（けいた確定 F-3）', () => {
    const S = require('../src/schema.js');
    const f = S.FIELDS.find(x => x.key === 'insurance');
    assert.ok(f, '保険の項目がありません');
    assert.strictEqual(f.stage, 'confirm', '保険が応募段階の項目になっています');
    assert.deepStrictEqual(f.showIf, { field: 'boothTypes', op: 'includes', value: '飲食' },
      '保険が飲食以外にも出ます');
  });

  test('確定情報の列に、保険が入っている', () => {
    const S = require('../src/schema.js');
    assert.ok(S.confirmHeaders().includes('保険加入状況'),
      '出店確定情報シートに保険の列がありません');
  });
});

// ───────────────────────────── メール本文

describe('採択通知の本文（既定の文面）', () => {
  // 2026-09-03 から、文面は gas/MailTemplate.gs が持つ。
  // 管理ページから直せるようになったが、**既定はここで守る**。
  // （直したときに守るのは、保存時の検査＝test/mail-template.test.js）
  const TPL = read('gas/MailTemplate.gs');

  test('紙面から外した行が、すべて入っている', () => {
    // 募集要項から外した内容の行き先がここ。抜けると誰にも伝わらなくなる。
    // **一覧を手で書かない**。content.js の afterAcceptRows をそのまま読む。
    // 手で書くと、紙面へ戻した行（2026-09-02 の「包材について」）が
    // 検査だけ古いまま残る
    const C = require('../src/content.js');
    const fn = cutFunction(TPL, 'mailtplDefaultAccept_');
    const rows = Object.values(C.PDF.afterAcceptRows || {}).flat();
    assert.ok(rows.length >= 3, '紙面から外した行を拾えていません：' + rows.length);
    rows.forEach(k => {
      assert.ok(fn.includes(k), '採択通知に「' + k + '」がありません');
    });
  });

  test('確定情報フォームのリンクと提出期限が入っている', () => {
    const fn = cutFunction(TPL, 'mailtplDefaultAccept_');
    assert.ok(/\{\{確定情報フォームURL\}\}/.test(fn), '確定情報フォームのリンクがありません');
    assert.ok(/\{\{提出期限\}\}/.test(fn), '提出期限がありません');
  });

  test('期限は設定シートから読み、空なら運用ルールの文言に落ちる', () => {
    const fn = cutFunction(NOTIFY, 'confirmDeadlineText_');
    assert.ok(/configText\('確定情報の回収期限'/.test(fn), '設定シートを見ていません');
    assert.ok(/5営業日/.test(fn), '既定の文言（可否連絡から5営業日）がありません');
  });

  test('専用リンクであることを本文で伝えている', () => {
    const fn = cutFunction(read('gas/MailTemplate.gs'), 'mailtplDefaultAccept_');
    assert.ok(/共有しない/.test(fn),
      'リンクを他社に共有しないよう伝えていません');
  });
});
