"""一斉メールを、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_broadcast.py

■ なぜこれが要るか
  引き継ぎ書の今日いちばんの学び：「テストが緑」と「守りが効いている」は別のこと。
  一斉メールは**取り消せない操作**なので、守りが1つ黙って外れると
  50社に届いてから気づくことになる。

■ 目印は「そこにあるか」ではなく「効いているか」を見る形にする
  引き継ぎ書 §5：位置だけを見る検査は if (false) で囲まれても素通りする。
  ここでは実際に無効化して、**振る舞いを見る検査（node --test）が落ちること**を
  確かめている。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ['test/broadcast.test.js', 'test/broadcast-run.test.js']


def run():
    out = ''
    ok = True
    for t in TARGETS:
        r = subprocess.run(['node', '--test', t], cwd=R, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', shell=True)
        ok = ok and r.returncode == 0
        out += (r.stdout or '') + (r.stderr or '')
    return ok, out


def swap(path, old, new):
    """LF に直して置き換え、元の改行コードで書き戻す。失敗したら None"""
    raw = path.read_bytes().decode('utf-8')
    crlf = '\r\n' in raw
    body = raw.replace('\r\n', '\n')
    if old not in body:
        return None
    body = body.replace(old, new, 1)
    path.write_bytes((body.replace('\n', '\r\n') if crlf else body).encode('utf-8'))
    return raw


def case(label, edits, expect):
    saved = []
    for f, old, new in edits:
        p = R / f
        before = swap(p, old, new)
        if before is None:
            print('  [??] 目印なし …', label)
            for pp, bb in reversed(saved):
                pp.write_bytes(bb.encode('utf-8'))
            return False
        saved.append((p, before))

    ok, out = run()
    for p, before in reversed(saved):        # **逆順**（1つ目の改変が残らないように）
        p.write_bytes(before.encode('utf-8'))

    if ok:
        print('  [NG] 落ちず …', label)
        return False
    if expect not in out:
        print('  [??] 理由違い …', label)
        return False
    print('  [OK] 落ちた …', label)
    return True


BC = 'gas/Broadcast.gs'
ADMIN = 'gas/Admin.gs'
MOCK = 'src/mock.js'

CASES = [
    # ── 二重送信。採択通知と違い、台帳に歯止めが無い ─────────────
    ('札を使い捨てにしない（二重クリックで2通届く）', [
        (BC, '  cache.remove(key);', '  // cache.remove(key);'),
    ], '同じ札で二度送れています'),

    ('札の中身を見ず、あることだけで通す（本文のすり替えが通る）', [
        (BC, '  return safeEquals_(want, broadcastFingerprint_(subject, body, ids));',
             '  return true;'),
    ], 'プレビューで見ていない件名が送れています'),

    ('札に期限を持たせない（何時間前のプレビューでも送れる）', [
        (BC, 'var BROADCAST_TICKET_SEC = 1800;',
             'var BROADCAST_TICKET_SEC = 86400;'),
    ], '古いプレビューのまま送れています'),

    ('同じ受付IDを2回選んだとき、まとめない', [
        (BC, '    if (!id || seen[id]) return;   // 同じ相手に2通送らない',
             '    if (!id) return;'),
    ], '同じ相手に2通送ろうとしています'),

    # ── 送ってはいけない相手 ────────────────────────
    ('辞退・キャンセル・重複を、送信の対象から外さない', [
        (BC, "var BROADCAST_BLOCKED_STATUS = ['辞退', 'キャンセル', '重複（無効）'];",
             'var BROADCAST_BLOCKED_STATUS = [];'),
    ], 'に送ろうとしています'),

    # 送信を止めているのは札のほう（辞退で送り先の集合が変わり、指紋が合わなくなる）。
    # この検知の役目は**人に分かる言葉で伝えること**。消すと
    # 「プレビューで確認したものと違います」としか出ず、何が起きたか分からない
    ('台帳の変更を、人に分かる言葉で伝えない', [
        (BC, '    if (lost.length) {', '    if (false) {'),
    ], '「対象が変わりました」として伝えていません'),

    ('宛先の形を見ない（壊れたアドレスで送信全体が落ちる）', [
        (BC, '    if (!BROADCAST_EMAIL_RE.test(rec.email)) { out.invalid.push(rec); return; }',
             '    if (false) { out.invalid.push(rec); return; }'),
    ], '壊れた宛先を送信対象に入れています'),

    # ── 半分だけ届く ───────────────────────────
    ('送信可能数を確かめずに送りはじめる', [
        (BC, '    if (quota < sendIds.length) {', '    if (false) {'),
    ], '途中まで送って半分だけ届いています'),

    ('一度に送れる上限をなくす（GASの6分制限で途中で切れる）', [
        (BC, '    if (picked.rows.length > BROADCAST_BATCH_MAX) {', '    if (false) {'),
    ], '上限を超えたのに送りはじめています'),

    # ── 記録 ──────────────────────────────
    ('履歴を、送り終えてから書く（途中で切れると記録が残らない）', [
        (BC, '''    var logRow = broadcastLog_(sh, sendId, now, auth && auth.person,
                               subject, body, sendIds);''',
             '    var logRow = 0;'),
        (BC, '    broadcastLogResult_(sh, logRow,',
             '''    logRow = broadcastLog_(sh, sendId, now, auth && auth.person,
                               subject, body, sendIds);
    broadcastLogResult_(sh, logRow,'''),
    ], '送信より先に履歴を書いていません'),

    ('変更履歴を、1通ごとに残す（履歴が埋まる）', [
        (BC, """      appendHistory(auth && auth.person, '', '一斉メール', '',
        subject + '（' + sent.length + '件）', sendId);""",
             """      sent.forEach(function (id) {
        appendHistory(auth && auth.person, id, '一斉メール', '', subject, sendId);
      });"""),
    ], '変更履歴が送信ごとに1行になっていません'),

    ('24時間以内の同じ件名を報せない（二重送信に誰も気づけない）', [
        (BC, '    recent: broadcastRecent_(subject, sendIds),',
             "    recent: { ids: [], sentAt: '', sendId: '' },"),
    ], '24時間以内の同じ件名を報せていません'),

    # ── 文面 ─────────────────────────────
    ('知らない差し込みを断らない（{{担当者}} がそのまま届く）', [
        (BC, '  if (unknown.length) {', '  if (false) {'),
    ], '知らない差し込みの名前を出していません'),

    ('括弧の閉じ忘れ・余りを断らない', [
        (BC, "    if (rest.indexOf('{') >= 0 || rest.indexOf('}') >= 0) loose = true;",
             '    ;'),
    ], '閉じ忘れが素通りしています'),

    ('差し込みが空になった行を報せない（区画番号の無い案内が黙って届く）', [
        (BC, '    if (dropped.indexOf(name) < 0) dropped.push(name);', '    continue;'),
    ], '空になった差し込みの名前を返していません'),

    ('確認の合図を見ずに送る', [
        (BC, '  if (payload.confirm !== true) {', '  if (false) {'),
    ], '確認が無いのに送っています'),

    # ── setup() の前に開かれたとき ─────────────────────
    # 反映の順番は GAS → けいたが setup() → ページ公開。その途中で開く人がいる
    ('履歴シートが無くても送れるようにする（記録の残らない送信）', [
        (BC, '''  var sh = broadcastSheetOrNull_();
  if (!sh) {''', '''  var sh = broadcastSheetOrNull_();
  if (false) {'''),
    # 札が偽物なので送信そのものは札で止まる（守りは二重）。
    # この歯止めの役目は**直し方を伝えること**——消すと
    # 「プレビューで確認したものと違います」としか出ず、setup() に辿り着けない
    ], '直し方（setup() の実行）を伝えていません'),

    ('履歴シートが無いことを画面に伝えない', [
        (BC, '  var historyReady = !!broadcastSheetOrNull_();',
             '  var historyReady = true;'),
    ], '履歴シートの不在を伝えていません'),

    # gas/Api.gs は例外を文言なしの server_error に潰すので、
    # ここで受けないと「理由の出ないエラー」だけが画面に出る
    ('履歴シートの不在で、プレビューごと落ちるようにする', [
        (BC, '''  try {
    return sheet_(SHEET.BROADCAST);
  } catch (e) {
    return null;
  }''', '  return sheet_(SHEET.BROADCAST);'),
    ], 'シートが見つかりません'),

    # ── 検証役3体の指摘で足した歯止め（2026-09-08）────────────
    ('送信履歴を、数式よけを通さずに書く', [
        (BC, '    safeCellText_(subject == null ? \'\' : subject),',
             '    String(subject == null ? \'\' : subject),'),
    ], '数式として動く件名が、そのまま書かれています'),

    # 40社上限があるので50社の催促は必ず2回に分かれる。
    # 1行で打ち切ると、前半40社に無警告で2通目が届く
    ('直前の照合を、最初に当たった1行で打ち切る', [
        (BC, '''    if (!any) continue;''',
             '''    if (!any) continue;
    return { ids: hits, sentAt: asText_(r[iAt]), sendId: '', headBroken: false };'''),
    ], '前のバッチの相手を報せていません'),

    ('履歴の見出しが壊れていても、黙って「重なりなし」と答える', [
        (BC, "    return { ids: [], sentAt: '', sendId: '', headBroken: true };",
             '    return empty;'),
    ], '見出しが壊れているのに'),

    ('数式よけのクォートを外さずに件名を照合する', [
        (BC, '    if (broadcastPlainText_(r[iSub]) !== subj) continue;',
             "    if (String(r[iSub] == null ? '' : r[iSub]).trim() !== subj) continue;"),
    ], 'クォート付きの件名を照合できていません'),

    ('件名と本文をつないで検査する（境目をまたぐ差し込みが通る）', [
        (BC, '  [subject, body].forEach(function (text) {',
             '  [subject + String.fromCharCode(10) + body].forEach(function (text) {'),
    ], '境目をまたいだ差し込みが素通りしています'),

    # 投げると gas/Api.gs が文言なしの server_error に潰し、
    # 画面は「送信できませんでした」とだけ言う。**メールは全部届いている**
    ('送ったあとの記録の失敗を、そのまま外へ投げる', [
        (BC, "      logError_('adminBroadcastSend_:記録', e);",
             "      logError_('adminBroadcastSend_:記録', e); throw e;"),
    ], 'シート「変更履歴」が見つかりません'),

    ('送信可能数の確認を、札を消費したあとに戻す', [
        (BC, '''    var quota = MailApp.getRemainingDailyQuota();
    if (quota < sendIds.length) {''',
             '''    var quota = MailApp.getRemainingDailyQuota();
    if (false) {'''),
        (BC, '''    if (!broadcastUseTicket_(payload.ticket, subject, body, sendIds)) {''',
             '''    if (!broadcastUseTicket_(payload.ticket, subject, body, sendIds)) {
      return { ok: false, error: 'stale', message: 'やり直してください。' };
    }
    if (quota < sendIds.length) {
      return { ok: false, error: 'quota', message: '残り' + quota + '通です。' };
    }
    if (false) {'''),
    ], '残量が足りなかっただけで札を失っています'),

    # 「値の入った差し込みを道連れにしない」（gas/MailTemplate.gs）の壊し検査は、
    # その振る舞いを見る検査がある break_mailtpl.py に置いてある。
    # 壊す場所と、落ちる検査は、同じ壊し検査の中で対にすること

    # ── 権限。ここが外れると、一般権限が50社にメールを送れる ────────
    # ⚠ 目印に行末の `];` を含めない。
    #   含めると、adminOnly の一覧に別の action を足しただけで目印が消え、
    #   **この守りが黙って未検査になる**（同じことが break_mailtpl.py で起きた）。
    ('一斉メールを adminOnly から外す', [
        (ADMIN, "'adminBroadcastPreview', 'adminBroadcastSend'",
                "'ダミー4', 'ダミー5'"),
        (MOCK, """      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      const fn = a === 'adminBroadcastSend'""",
               "      const fn = a === 'adminBroadcastSend'"),
    ], 'が一般権限で通っています'),

    # ── 模擬が写しを持つと、本番との食い違いに気づけなくなる ────────
    ('模擬が、本番の Broadcast.gs を読まない', [
        (MOCK, "  vm.runInContext(rd('Broadcast.gs'), box);", '  // 読まない'),
    ], 'adminBroadcastPreview_'),
]


def main():
    # 模擬サーバーが動いていたら止まる（共有ソースを壊す作業だから）
    guard()
    res = [case(*c) for c in CASES]
    print('\n' + '=' * 52)
    print(f'  {sum(res)} / {len(res)} 件を検出')
    ok, _ = run()
    print('  復元後:', '通過' if ok else '[NG] 落ちたまま')
    return 0 if (all(res) and ok) else 1


if __name__ == '__main__':
    sys.exit(main())
