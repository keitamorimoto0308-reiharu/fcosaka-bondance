"""テストデータの一括削除の歯止めを、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_purge.py

■ なぜ念入りにやるか
  これは**本番の応募を消せる**唯一の機能。押し間違いが取り返しにつかない。
  しかも本番では試せない（試すと本物が消える）。
  歯止めが1つ外れても検査が黙っているなら、その歯止めは無いのと同じ。

■ 改行コードを吸収する（break_staff.py と同じ理由）
  gas/*.gs は CRLF。複数行の目印が LF のままだと一致せず「目印なし」で素通りする。
  **素通りは、検出できたのと見分けがつかない。**
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/purge.test.js'


def run():
    r = subprocess.run(['node', '--test', TARGET], cwd=R, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', shell=True)
    return r.returncode == 0, (r.stdout or '') + (r.stderr or '')


def swap(path, old, new):
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
    for p, before in reversed(saved):
        p.write_bytes(before.encode('utf-8'))

    if ok:
        print('  [NG] 落ちず …', label)
        return False
    if expect not in out:
        print('  [??] 理由違い …', label)
        return False
    print('  [OK] 落ちた …', label)
    return True


SWITCH_OFF = "      DB.settings['テストデータの削除'] = 'OFF';   // 1回ぶんの鍵"

CASES = [
    # ── 模擬側（通しの動きを守る）
    ('スイッチを見ずに下見できるようにする', [
        ('src/mock.js',
         "      if (String(DB.settings['テストデータの削除'] || 'OFF') !== 'ON') {\n"
         "        return { ok: false, error: 'disabled',\n"
         "          message: 'この操作は、「設定」タブの「テストデータの一括削除を許可」が'\n"
         "                 + 'ONのときだけ使えます。ONにしてから、この画面を読み込み直してください。' };\n"
         "      }",
         '      if (false) { return { ok: false }; }'),
    ], 'スイッチがOFFのあいだは'),

    ('一般権限にも開放する', [
        ('src/mock.js',
         "    case 'adminPurgePreview': {\n"
         "      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',\n"
         "        message: 'この操作は管理者のみです。' };",
         "    case 'adminPurgePreview': {"),
    ], '一般権限では'),

    ('下見のときに消してしまう', [
        ('src/mock.js',
         "      const items = DB.rows.filter(r => r['受付ID']).map(r => ({",
         "      DB.rows = DB.rows.slice(1);\n"
         "      const items = DB.rows.filter(r => r['受付ID']).map(r => ({"),
    ], '下見では'),

    ('件数の照合をやめる', [
        ('src/mock.js', '      if (Number(payload.count) !== live.length) {', '      if (false) {'),
    ], '件数が違うと'),

    ('対象が変わっていても実行する', [
        ('src/mock.js',
         "      if (live.slice().sort().join(',') !== sent.slice().sort().join(',')) {",
         '      if (false) {'),
    ], '下見のあとに応募が増えていたら'),

    ('スイッチを戻さない', [
        ('src/mock.js', SWITCH_OFF, '      // 戻さない'),
    ], 'スイッチはOFFに戻る'),

    ('変更履歴を消し残す', [
        ('src/mock.js', '      DB.history = [];', '      // 残す'),
    ], '変更履歴が残っています'),

    ('控えの場所を返さない', [
        ('src/mock.js',
         "      const backupUrl = 'https://docs.google.com/spreadsheets/d/mock-backup/edit';",
         "      const backupUrl = '';"),
    ], '控えの場所を返していません'),

    # ── 本番側（作りの性質を守る）
    ('控えを取らずに消す', [
        ('gas/Purge.gs', '    try { backupUrl = purgeBackup_(); }',
         '    try { if (false) purgeBackup_(); }'),
    ], '控えの場所を受け取っていません'),

    ('控えに失敗しても消す', [
        ('gas/Purge.gs', "      return { ok: false, error: 'no_backup',", '      var _skip = {'),
    ], '控えに失敗しても消しています'),

    ('丸ごとの複製をやめる', [
        ('gas/Purge.gs', '  var copy = DriveApp.getFileById(ss_().getId()).makeCopy(name);',
         '  var copy = { getUrl: function () { return name; } };'),
    ], '複製していません'),

    ('変更履歴を消す対象から外す', [
        ('gas/Purge.gs',
         '  return [SHEET.LEDGER, SHEET.CONFIRM, SHEET.HISTORY, SHEET.QUARANTINE];',
         '  return [SHEET.LEDGER, SHEET.CONFIRM, SHEET.QUARANTINE];'),
    ], '変更履歴を消す対象に入れていません'),

    ('確認事項まで消す', [
        ('gas/Purge.gs',
         '  return [SHEET.LEDGER, SHEET.CONFIRM, SHEET.HISTORY, SHEET.QUARANTINE];',
         '  return [SHEET.LEDGER, SHEET.CONFIRM, SHEET.HISTORY, SHEET.QUARANTINE, SHEET.TODO];'),
    ], 'を消そうとしています'),

    ('区画の行ごと消す', [
        ('gas/Purge.gs', "    sh.getRange(i + 2, col + 1).setValue('');", '    sh.deleteRow(i + 2);'),
    ], '区画の行を消しています'),

    ('提出物を完全に消す', [
        ('gas/Purge.gs', '  while (it.hasNext()) { it.next().setTrashed(true); n++; }',
         '  while (it.hasNext()) { it.next().removeFolder(); n++; }'),
    ], 'ゴミ箱に入れていません'),

    ('1回の上限を外す', [
        ('gas/Purge.gs', '    if (live.length > PURGE_MAX) {', '    if (false) {'),
    ], '上限を見ていません'),

    ('管理者限定から外す', [
        ('gas/Admin.gs', "                   'adminDocsDelete', 'adminPurgePreview', 'adminPurgeRun',",
         "                   'adminDocsDelete',"),
    ], '管理者限定の一覧にありません'),

    # ── 安全装置5：引換券（2026-09-03 の検証で見つかった穴）
    ('本番が、券の結果を見ずに続ける', [
        ('gas/Purge.gs', '    if (ticketNg) return ticketNg;', '    // 見ない'),
    ], '券の結果を見ていません'),

    ('本番が、券の署名を確かめない', [
        ('gas/Purge.gs', "  if (!safeEquals_(purgeHmac_(parts[0]), parts[1])) {", '  if (false) {'),
    ], '署名を確かめていません'),

    ('本番が、券の期限を見ない', [
        ('gas/Purge.gs', '  if (!payload.e || payload.e < new Date().getTime()) {',
         '  if (false) {'),
    ], '期限を見ていません'),

    ('本番が、券の鍵を管理トークンと同じにする', [
        ('gas/Purge.gs', "    Utilities.computeHmacSha256Signature(text, authSecret_() + '|purge'));",
         '    Utilities.computeHmacSha256Signature(text, authSecret_()));'),
    ], '鍵を分けていません'),

    ('模擬が、券を見ない（本番より緩くする）', [
        ('src/mock.js', '      if (ticketNg) return ticketNg;',
         '      // 見ない'),
    ], '券なしで実行できました'),

    ('模擬が、券の署名を確かめない', [
        ('src/mock.js', "  if (purgeHmac(parts[0]) !== parts[1]) {", '  if (false) {'),
    ], '自分で作った券で実行できました'),

    ('模擬が、券の集合を照合しない', [
        ('src/mock.js', "  if (String(payload.h) !== purgeIdsFingerprint(ids)) {",
         '  if (false) {'),
    ], '見せた一覧と違う集合を消しました'),

    ('画面が、一覧の再読み込みで受付IDの控えを差し替える', [
        ('src/build-admin.js', "    if (!on) purgeForget('');",
         '    if (on) PURGE.ids = r.ids || [];'),
    ], '一覧の再読み込みで受付IDの控えを差し替えています'),

    ('画面が、券を送らない', [
        ('src/build-admin.js', 'ticket: PURGE.ticket', 'ticket2: PURGE.ticket'),
    ], '券を送っていません'),

    ('文言を「削除済みシートへ移します」に戻す', [
        ('src/build-admin.js', '          <b>完全に消します</b>。<b>元に戻せません。</b>',
         '          <b>「削除済み」シートへ移します</b>（完全には消しません）。'),
    ], '実態と違う文言が残っています'),

    ('模擬の案内を、設定タブに無い名前に戻す', [
        ('src/mock.js', "          message: 'この操作は、「設定」タブの「テストデータの一括削除を許可」が'",
         "          message: 'この操作は、「設定」タブの「テストデータの削除」が'"),
    ], '設定タブに無い名前を言っています'),
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
