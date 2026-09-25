"""区画の割り当ては管理者だけ（I6・2026-09-25）を、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_spacerole.py

守りは3か所にある：本番（gas/Admin.gs の adminOnly）／模擬（src/mock.js）／画面。
どれか1つを外しても test/space-role.test.js が落ちることを見る。
**外しすぎ**（マップを見ることまで管理者だけにする）も落ちることを見る。

目印に行末の `];` は含めない（引き継ぎ書 §3。一覧に1行足しただけで目印が消える）。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/space-role.test.js'


def run():
    r = subprocess.run(['node', '--test', TARGET], cwd=R, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', shell=True)
    return r.returncode == 0, (r.stdout or '') + (r.stderr or '')


def swap(path, old, new):
    """LF に直して置き換え、元の改行コードで書き戻す。失敗したら None"""
    raw = path.read_bytes().decode('utf-8')
    crlf = '\r\n' in raw
    body = raw.replace('\r\n', '\n')
    if body.count(old) != 1:
        # 0件は目印なし、2件以上は狙いと違う場所を壊しうる（引き継ぎ書 §「目印が2重」）
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
            print('  [??] 目印なし（または2重） …', label)
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


CASES = [
    ('本番：割り当てと解除を adminOnly から外す', [
        ('gas/Admin.gs', "'adminAssign', 'adminUnassign'", "'adminNoop'"),
    ], 'が adminOnly に入っていません'),

    ('本番：マップを見ることまで管理者だけにする（外しすぎ）', [
        ('gas/Admin.gs', "'adminAssign', 'adminUnassign'",
         "'adminAssign', 'adminUnassign', 'adminSpaces'"),
    ], 'まで管理者だけになっています'),

    ('模擬：割り当ての権限の確認を外す', [
        ('src/mock.js',
         "      // 本番（gas/Admin.gs の adminOnly）と同じく管理者のみ。文言も合わせる\n"
         "      if (auth.role !== '管理者') return",
         "      if (false) return"),
    ], '一般で割り当てできています'),

    ('模擬：解除の権限の確認を外す', [
        ('src/mock.js',
         "    case 'adminUnassign': {\n      if (auth.role !== '管理者') return",
         "    case 'adminUnassign': {\n      if (false) return"),
    ], '一般で解除できています'),

    ('画面：一般がマスを押すと割り当ての道に入る', [
        ('src/build-admin.js',
         "  if (S.role !== '管理者'){\n    if (id){\n      var ow",
         "  if (false){\n    if (id){\n      var ow"),
    ], '一般がマスを押すと'),

    ('画面：操作を admin-only で包まない', [
        ('src/build-admin.js', 'class="admin-only" id="aCtl" hidden>', 'id="aCtl">'),
    ], 'admin-only で包まれていません'),
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
