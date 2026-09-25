"""問い合わせメールの欄から警報を外す（2026-09-25）を、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_inbox.py

外しすぎ（返信した問い合わせまで消える）と、外し漏れの両方を見る。

目印に行末の `];` は含めない（引き継ぎ書 §3。一覧に1行足しただけで目印が消える）。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/inbox-run.test.js'


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
    ('警報を外す絞り込みをやめる', [
        ('gas/Admin.gs', '    return !th.getMessages().every(function (m) {',
         '    return true || !th.getMessages().every(function (m) {'),
    ], '警報が混ざっています'),

    ('「すべての1通」ではなく「どれか1通」で外す（返信した問い合わせまで消える）', [
        ('gas/Admin.gs', '    return !th.getMessages().every(function (m) {',
         '    return !th.getMessages().some(function (m) {'),
    ], '人の返信が入ったスレッドまで消えています'),

    ('画面に出す件数ぶんしか読まない', [
        ('gas/Admin.gs', 'threads = GmailApp.search(q, 0, INBOX_SCAN);',
         'threads = GmailApp.search(q, 0, INBOX_MAX);'),
    ], '画面に出す件数ぶんしか読んでいません'),

    ('上限で切らない', [
        ('gas/Admin.gs', '  }).slice(0, INBOX_MAX);', '  });'),
    ], '画面に出す上限'),

    ('警報の差出人名を直書きに戻す', [
        ('gas/Mail.gs', '{ name: ALERT_SENDER_NAME_ }', "{ name: 'サステナ盆踊り 応募システム' }"),
    ], '警報の差出人名が直書きです'),
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
