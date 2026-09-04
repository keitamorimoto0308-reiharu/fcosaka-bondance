/**
 * テストデータの一括削除を、**実際に通しで動かして**確かめる。
 *
 * ■ なぜ念入りにやるか
 *   これは**本番の応募を消せる**唯一の機能。押し間違いが取り返しにつかない。
 *   しかも本番では試せない（試すと本物が消える）ので、
 *   模擬で通しを流すのが唯一の確認手段になる。
 *
 * ■ 5つの安全装置を1つずつ確かめる
 *   1. 設定のスイッチがONのときだけ入口が開く
 *   2. 消える対象を先に一覧で返す（下見では何も書き換えない）
 *   3. 件数が一致しないと実行しない
 *   4. **下見のときと対象が変わっていたら実行しない**
 *      画面を開いたまま席を立つ間に、本物の応募が来ているかもしれない
 *   5. 4を画面に任せない。下見のときにサーバーが署名した引換券を要る形にする
 *
 * ■ 文言が実態と合っているかも見る
 *   2026-09-03 の検証：画面には「削除済みシートへ移します（完全には消しません）」
 *   と書いてあったが、実際は変更履歴ごと消していた。
 *   **取り返しのつかない操作で、押す人が読む文が嘘**なのがいちばん危ない。
 *
 * ■ 実行後はスイッチがOFFに戻る
 *   ONのまま忘れると、安全装置1が働かなくなる。
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/** 模擬サーバーを、毎回まっさらに読み直す（前の削除を引きずらない） */
function fresh() {
  const p = require.resolve('../src/mock.js');
  delete require.cache[p];
  return require(p);
}

function login(M, pw, person) {
  const r = M.handle({ action: 'adminLogin', password: pw, person: person });
  assert.ok(r.ok, '入室できません：' + JSON.stringify(r));
  return r.token;
}

describe('テストデータの一括削除：通しで動かす', () => {
  let M, tok;

  beforeEach(() => {
    M = fresh();
    tok = login(M, 'admin', '山田 太郎');
  });

  test('スイッチがOFFのあいだは、下見も実行もできない', () => {
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    assert.strictEqual(p.ok, false);
    assert.strictEqual(p.error, 'disabled');
    assert.ok(/設定/.test(p.message), 'どこをONにすればよいか書かれていません');

    const before = M.DB.rows.length;
    const r = M.handle({ action: 'adminPurgeRun', token: tok, ids: ['SB-0001'], count: 1 });
    assert.strictEqual(r.ok, false, 'OFFなのに実行できました');
    assert.strictEqual(M.DB.rows.length, before, '応募が消えました');
  });

  test('一般権限では、ONにしても使えない', () => {
    M.DB.settings['テストデータの削除'] = 'ON';
    const staff = login(M, 'staff', '佐藤 花子');
    const p = M.handle({ action: 'adminPurgePreview', token: staff });
    assert.strictEqual(p.ok, false);
    assert.strictEqual(p.error, 'forbidden');
  });

  test('下見では、何も書き換えない', () => {
    M.DB.settings['テストデータの削除'] = 'ON';
    const before = M.DB.rows.length;
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    assert.strictEqual(p.ok, true);
    assert.ok(p.items.length > 0, '対象が空です');
    assert.strictEqual(p.items.length, before);
    assert.strictEqual(M.DB.rows.length, before, '下見で消えました');
    // 何が消えるかが読める形か
    assert.ok(p.items[0].id && p.items[0].company !== undefined
              && p.items[0].at !== undefined && p.items[0].status !== undefined,
      '受付ID・企業名・受付日時・ステータスがそろっていません');
  });

  test('件数が違うと実行しない', () => {
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    const before = M.DB.rows.length;
    const r = M.handle({ action: 'adminPurgeRun', token: tok,
                         ids: p.ids, ticket: p.ticket, count: p.ids.length + 1 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'bad_count');
    assert.ok(r.message.includes(String(p.ids.length)), '正しい件数を教えていません');
    assert.strictEqual(M.DB.rows.length, before, '件数が違うのに消えました');
  });

  test('下見のあとに応募が増えていたら、実行しない', () => {
    // **画面を開いたまま席を立つ**のは普通に起きる。
    // その間に届いた本物の応募を、巻き込んで消してはいけない
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });

    M.DB.rows.push({ '受付ID': 'SB-9999', '企業名': '本物の応募', '受付日時': '2026-09-20 10:00',
                     'ステータス': '未確認' });

    const r = M.handle({ action: 'adminPurgeRun', token: tok,
                         ids: p.ids, ticket: p.ticket, count: p.ids.length });
    assert.strictEqual(r.ok, false, '増えているのに実行しました');
    assert.strictEqual(r.error, 'changed');
    assert.ok(M.DB.rows.some(x => x['受付ID'] === 'SB-9999'), '本物の応募が消えました');
  });

  test('通せば、応募・確定情報・変更履歴・区画・提出物がすべて消える', () => {
    // けいた指示「ほんとにすべて消してきれいにして変更履歴とかも残してほしくない」
    M.DB.settings['テストデータの削除'] = 'ON';
    M.DB.vendorFiles['SB-0001'] = [{ id: 'f1', name: 'ロゴ.png' }];
    assert.ok(M.DB.confirm['SB-0001'], '確定情報の見本がありません');
    assert.ok(M.DB.spaces.some(s => s.id), '区画の割当がありません');
    assert.ok(M.DB.history.length, '変更履歴の見本がありません');

    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    const r = M.handle({ action: 'adminPurgeRun', token: tok,
                         ids: p.ids, ticket: p.ticket, count: p.ids.length });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(M.DB.rows.length, 0, '応募が残っています');
    assert.strictEqual(Object.keys(M.DB.confirm).length, 0, '確定情報が残っています');
    assert.strictEqual(Object.keys(M.DB.vendorFiles).length, 0, '提出物が残っています');
    assert.strictEqual(M.DB.history.length, 0, '変更履歴が残っています');
    assert.ok(!M.DB.spaces.some(s => s.id), '区画の割当が残っています');
  });

  test('消す前に、控えの場所を返す', () => {
    // 台帳はきれいにするが、間違えたときの戻り道は要る。
    // **控えが取れなければ消さない**のが本番の作り
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    const r = M.handle({ action: 'adminPurgeRun', token: tok,
                         ids: p.ids, ticket: p.ticket, count: p.ids.length });
    assert.ok(r.backupUrl && /^https:/.test(r.backupUrl),
      '控えの場所を返していません：' + r.backupUrl);
  });

  test('下見で、何行消えるかを先に見せる', () => {
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    assert.ok(p.counts && typeof p.counts === 'object', '行数を返していません');
    assert.ok(Object.keys(p.counts).length >= 3, '消すシートを拾えていません');
    assert.ok(p.counts['変更履歴'] > 0, '変更履歴の行数が出ていません');
  });

  test('実行したら、スイッチはOFFに戻る', () => {
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    M.handle({ action: 'adminPurgeRun', token: tok,
                ids: p.ids, ticket: p.ticket, count: p.ids.length });
    assert.strictEqual(M.DB.settings['テストデータの削除'], 'OFF',
      'ONのまま残っています（安全装置が1つ消えます）');
  });

  test('変更履歴も残さない（けいた指示）', () => {
    // 「ほんとにすべて消してきれいにして変更履歴とかも残してほしくない」。
    // 記録は控え（複製したスプレッドシート）の側にある
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    M.handle({ action: 'adminPurgeRun', token: tok,
                ids: p.ids, ticket: p.ticket, count: p.ids.length });
    assert.strictEqual(M.DB.history.length, 0,
      '変更履歴に行が残っています：' + JSON.stringify(M.DB.history[0]));
  });

  // ── 安全装置5：引換券。
  //    2026-09-03 の検証で、安全装置4が**画面の変数だけ**で守られていたのが見つかった。
  //    画面は一覧の再読み込みで受付IDの控えを黙って差し替えていたので、
  //    人が見た一覧は古いまま、送られる受付IDだけが新しくなっていた。

  test('券が無ければ実行しない', () => {
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    const before = M.DB.rows.length;
    const r = M.handle({ action: 'adminPurgeRun', token: tok,
                         ids: p.ids, count: p.ids.length });
    assert.strictEqual(r.ok, false, '券なしで実行できました');
    assert.strictEqual(r.error, 'no_ticket');
    assert.strictEqual(M.DB.rows.length, before, '券なしで消えました');
  });

  test('券を自分で作っても実行しない', () => {
    // 画面側のコードは誰でも書き換えられる。券の中身も自分で組める。
    // **中身が全部正しくても、署名が無ければ通らない**ことを見る。
    // （中身をわざと壊すと、集合の照合の側で止まってしまい、
    //   署名を確かめているかどうかの試験にならない）
    const crypto = require('crypto');
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    const body = Buffer.from(JSON.stringify({
      h: crypto.createHash('sha256')
               .update('purge|' + p.ids.map(String).sort().join(',')).digest('base64url'),
      n: p.ids.length,
      e: Date.now() + 600000,
    })).toString('base64url');
    const before = M.DB.rows.length;
    const r = M.handle({ action: 'adminPurgeRun', token: tok, ids: p.ids,
                         ticket: body + '.' + 'jibunde-tsukutta-shomei', count: p.ids.length });
    assert.strictEqual(r.ok, false, '自分で作った券で実行できました');
    assert.strictEqual(r.error, 'bad_ticket', '署名を確かめていません：' + r.error);
    assert.strictEqual(M.DB.rows.length, before, '自分で作った券で消えました');
  });

  test('1件増えて1件減っても、券が食い違うので実行しない', () => {
    // **これが件数の照合では捕まえられない形**。
    // 件数も、送られてくる受付IDの集合も、いまの台帳と一致してしまう。
    // 古いのは「人が見た一覧」だけ
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });

    // 席を立っている間に、1件消えて、本物が1件届いた
    const dropped = M.DB.rows.pop();
    M.DB.rows.push({ '受付ID': 'SB-9999', '企業名': '本物の応募',
                     '受付日時': '2026-09-20 10:00', 'ステータス': '未確認' });

    // 画面が一覧を読み直して、受付IDの控えだけ新しくしてしまった状況
    const nowIds = M.DB.rows.map(r => r['受付ID']);
    assert.strictEqual(nowIds.length, p.ids.length, '件数が変わってしまい、試験になりません');
    assert.notDeepStrictEqual(nowIds.slice().sort(), p.ids.slice().sort(),
      '中身が変わっておらず、試験になりません');

    const r = M.handle({ action: 'adminPurgeRun', token: tok,
                         ids: nowIds, ticket: p.ticket, count: nowIds.length });
    assert.strictEqual(r.ok, false, '見せた一覧と違う集合を消しました');
    assert.strictEqual(r.error, 'stale_ticket',
      '券ではなく別の歯止めが止めています：' + r.error);
    assert.ok(M.DB.rows.some(x => x['受付ID'] === 'SB-9999'), '本物の応募が消えました');
    assert.ok(dropped, '前提の準備に失敗しています');
  });

  test('券には有効期限がある', () => {
    M.DB.settings['テストデータの削除'] = 'ON';
    const p = M.handle({ action: 'adminPurgePreview', token: tok });
    assert.ok(p.ticketMin > 0 && p.ticketMin <= 60, '有効時間が変です：' + p.ticketMin);
    // 期限だけを過去にした券は、署名が合わないので bad_ticket になる。
    // 「期限を見ているか」は本番のコードで確かめる（下の describe）
    const parts = String(p.ticket).split('.');
    assert.strictEqual(parts.length, 2, '券の形が違います');
    const body = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    assert.ok(body.e > Date.now(), '期限が入っていません');
    assert.ok(!String(p.ticket).includes('SB-'), '券に受付IDがそのまま入っています');
  });
});

describe('テストデータの一括削除：本番側の作り', () => {
  const PURGE = read('gas/Purge.gs');
  const ADMIN = read('gas/Admin.gs');

  test('管理者だけが使える', () => {
    assert.ok(/'adminPurgePreview', 'adminPurgeRun'/.test(ADMIN)
              || (/adminPurgePreview/.test(ADMIN) && /adminOnly/.test(ADMIN)),
      '管理者限定になっていません');
    const only = ADMIN.slice(ADMIN.indexOf('var adminOnly'), ADMIN.indexOf('switch (action)'));
    ['adminPurgePreview', 'adminPurgeRun'].forEach(a => {
      assert.ok(only.includes(a), a + ' が管理者限定の一覧にありません');
    });
  });

  test('控えを取ってからでないと消さない', () => {
    const fn = PURGE.slice(PURGE.indexOf('function adminPurgeRun_'));
    // 位置だけを見ると、if (false) で囲まれても素通りする。
    // **控えの場所を受け取っている**形まで見る
    const backup = fn.indexOf('backupUrl = purgeBackup_();');
    const clear = fn.indexOf('clearSheetRows_');
    assert.ok(backup >= 0, '控えの場所を受け取っていません（呼び出しが無効化されています）');
    assert.ok(backup < clear, '控えより先に消しています');
    // 控えが取れなかったら、消さずに戻る
    assert.ok(/error: 'no_backup'/.test(fn), '控えに失敗しても消しています');
    const guard = fn.indexOf("error: 'no_backup'");
    assert.ok(guard < clear, '控えの失敗を見る前に消しています');
  });

  test('控えは、スプレッドシートを丸ごと複製している', () => {
    const fn = PURGE.slice(PURGE.indexOf('function purgeBackup_'));
    assert.ok(/makeCopy\(/.test(fn), '複製していません');
    assert.ok(/削除前の控え/.test(fn), '控えと分かる名前になっていません');
  });

  test('変更履歴も空にする（けいた指示）', () => {
    const fn = PURGE.slice(PURGE.indexOf('function PURGE_SHEETS_'));
    assert.ok(/SHEET\.HISTORY/.test(fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'))),
      '変更履歴を消す対象に入れていません');
  });

  test('触ってはいけないシートに手を出していない', () => {
    // 確認事項・関係者・設定・レンタル品目は、テストデータではない
    const fn = PURGE.slice(PURGE.indexOf('function PURGE_SHEETS_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    ['SHEET.TODO', 'SHEET.PEOPLE', 'SHEET.RENTAL'].forEach(s => {
      assert.ok(!body.includes(s), s + ' を消そうとしています');
    });
    // 設定シートは、スイッチを戻すためだけに触る
    assert.ok(!body.includes('SHEET.CONFIG'), '設定シートを空にしようとしています');
  });

  test('区画の行は消さない（割当だけ外す）', () => {
    // 区画は会場の形。応募を消しても、区画そのものは残る
    const fn = PURGE.slice(PURGE.indexOf('function clearSpaceAssignments_'));
    assert.ok(!/deleteRow/.test(fn.slice(0, fn.indexOf('\n}'))), '区画の行を消しています');
    assert.ok(/setValue\(''\)/.test(fn), '割当を外していません');
  });

  test('提出物はゴミ箱へ（完全には消さない）', () => {
    const fn = PURGE.slice(PURGE.indexOf('function trashVendorFolders_'));
    assert.ok(/setTrashed\(true\)/.test(fn), 'ゴミ箱に入れていません');
    assert.ok(!/removeFile|removeFolder/.test(fn), '完全に消しています');
  });

  test('1回に消せる件数に上限がある', () => {
    const max = Number((PURGE.match(/var PURGE_MAX = (\d+);/) || [])[1]);
    assert.ok(max > 0 && max <= 500, '上限が変です：' + max);
    assert.ok(PURGE.includes('live.length > PURGE_MAX'), '上限を見ていません');
  });

  test('券を、消す前に確かめている', () => {
    const fn = PURGE.slice(PURGE.indexOf('function adminPurgeRun_'));
    const check = fn.indexOf('purgeTicketError_(');
    const clear = fn.indexOf('clearSheetRows_');
    assert.ok(check >= 0, '券を確かめていません');
    assert.ok(check < clear, '券を確かめる前に消しています');
    assert.ok(/if \(ticketNg\) return ticketNg;/.test(fn), '券の結果を見ていません');
  });

  test('券は署名と期限と集合の3つを見ている', () => {
    const fn = PURGE.slice(PURGE.indexOf('function purgeTicketError_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/safeEquals_\(purgeHmac_\(/.test(body), '署名を確かめていません');
    assert.ok(/payload\.e < new Date\(\)\.getTime\(\)/.test(body), '期限を見ていません');
    assert.ok(/purgeIdsFingerprint_\(ids\)/.test(body), '対象の集合を照合していません');
  });

  test('券の鍵は、管理トークンの鍵と分けてある', () => {
    // 同じ鍵だと、券で管理APIに入れる形になりうる
    const fn = PURGE.slice(PURGE.indexOf('function purgeHmac_'));
    assert.ok(/authSecret_\(\) \+ '\|purge'/.test(fn.slice(0, 300)),
      '鍵を分けていません');
  });
});

describe('テストデータの一括削除：画面の作り', () => {
  const ADMIN_SRC = read('src/build-admin.js');

  test('受付IDの控えを書き換えるのは、確かめるボタンだけ', () => {
    // 一覧の再読み込みで黙って差し替えると、
    // **人が見た一覧は古いまま、送る対象だけが新しくなる**
    const box = ADMIN_SRC.slice(ADMIN_SRC.indexOf('function loadPurgeBox'),
                                ADMIN_SRC.indexOf('function purgeCheck'));
    assert.ok(!/PURGE\.ids\s*=\s*r\./.test(box),
      '一覧の再読み込みで受付IDの控えを差し替えています');
  });

  test('券を実行時に送っている', () => {
    assert.ok(/ticket: PURGE\.ticket/.test(ADMIN_SRC), '券を送っていません');
    assert.ok(/PURGE\.ticket = r\.ticket/.test(ADMIN_SRC), '券を受け取っていません');
  });

  test('押す人が読む文が、実態と合っている', () => {
    // 消えるのに「移します」「完全には消しません」と書いてあってはいけない
    const purgeUi = ADMIN_SRC.slice(ADMIN_SRC.indexOf('var PURGE = {'));
    ['削除済み」シートへ移します', '完全には消しません', '変更履歴は残します'].forEach(w => {
      assert.ok(!ADMIN_SRC.includes(w), '実態と違う文言が残っています：' + w);
    });
    assert.ok(/完全に消します/.test(purgeUi), '消えることが書かれていません');
    assert.ok(/元に戻せません/.test(ADMIN_SRC), '戻せないことが書かれていません');
    assert.ok(/変更履歴/.test(purgeUi), '変更履歴も消えることが書かれていません');
  });

  test('OFFのときの案内が、設定タブの見出しと同じ名前を言っている', () => {
    // 2026-09-03 の検証：模擬は「テストデータの削除」と案内していたが、
    // 設定タブにある見出しは「テストデータの一括削除を許可」。
    // **画面に無い名前を探させる**ことになり、探して見つからずに止まる。
    // 設定の見出しは gas/Admin.gs が唯一の正なので、そこから読む
    const admin = read('gas/Admin.gs');
    const i = admin.indexOf("key: 'テストデータの削除'");
    const label = (admin.slice(i, i + 200).match(/label: '([^']+)'/) || [])[1];
    assert.ok(label, '設定の見出しを読み取れません');

    // OFFのときの返事は error: 'disabled'。その直後の文だけを見る。
    // 文が複数行に折られていても拾えるように、行ではなく塊で切る
    const mock = read('src/mock.js');
    [['gas/Purge.gs', read('gas/Purge.gs')],
     ['src/mock.js', mock.slice(mock.indexOf("case 'adminPurgePreview'"),
                                mock.indexOf("case 'adminConfirmSave'"))]]
      .forEach(([name, src]) => {
        let found = 0;
        for (let i = src.indexOf("error: 'disabled'"); i >= 0;
             i = src.indexOf("error: 'disabled'", i + 1)) {
          found++;
          const msg = src.slice(i, i + 400);
          assert.ok(msg.includes(label),
            name + ' の案内が、設定タブに無い名前を言っています：'
            + msg.split(String.fromCharCode(10)).slice(0, 3).join(' '));
        }
        assert.ok(found >= 2, name + ' に、OFFのときの案内が足りません（' + found + '件）');
      });
  });

  test('設定タブの説明も、実態と合っている', () => {
    const help = read('gas/Admin.gs');
    const i = help.indexOf("key: 'テストデータの削除'");
    assert.ok(i > 0, '設定の説明が見つかりません');
    const block = help.slice(i, i + 600);
    assert.ok(!/完全には消しません/.test(block), '実態と違う説明が残っています');
    assert.ok(/完全に消します/.test(block), '消えることが書かれていません');
  });
});
