"""prototype 経由の抜け道の検査を、わざと壊して確かめる。

使い方：  python test/break_prototype.py

■ なぜ念入りにやるか
  「一覧にあるものだけ通す」は、このシステムの守りの中心にある形。
  素の {} で書くと、`constructor` と入れるだけでその関門が開く。
  **見た目は正しいコード**なので、目で読んでも気づけない。

  実際にこのプロジェクトで4か所に書かれていた
  （アップロードの種別／応募内容の修正／枚数の打ち込み／通知の種類）。
  直したあとも、新しく書く人が素の {} を使えばまた開くので、
  「書き方そのもの」を見る検査と、「実際に投げて抜けられない」検査の
  両方が働くことを確かめる。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/prototype-maps.test.js'


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


CASES = [
    ('通知の種類を素の {} に戻す（本番）', [
        ('gas/Notify.gs', 'var NOTIFY_KINDS = Object.assign(Object.create(null), {',
         'var NOTIFY_KINDS = ({'),
    ], 'が素の {} です'),

    ('通知の種類を素の {} に戻す（模擬）', [
        ('src/mock.js', 'const MAIL_KINDS = Object.assign(Object.create(null), {',
         'const MAIL_KINDS = ({'),
    ], '「constructor」が種類として通りました'),

    ('枚数の許可リストを素の {} に戻す（模擬）', [
        ('src/mock.js', '      const allowed = Object.create(null);\n'
                        "      S.aggregateFields().forEach(f => { if (f.stage === 'confirm') "
                        "allowed[f.key] = f; });",
         '      const allowed = {};\n'
         "      S.aggregateFields().forEach(f => { if (f.stage === 'confirm') "
         "allowed[f.key] = f; });"),
    ], '「constructor」が許可リストを抜けました'),

    ('枚数の許可リストを素の {} に戻す（本番）', [
        ('gas/Confirm.gs', '  var allowed = Object.create(null);', '  var allowed = {};'),
    ], '許可リストを素の {} で作っています'),

    ('集計の母数を素の {} に戻す', [
        ('gas/Admin.gs',
         'var AGGREGATE_CONFIRM_STATUS_ = Object.assign(Object.create(null), '
         "{ '採択': true });",
         "var AGGREGATE_CONFIRM_STATUS_ = { '採択': true };"),
    ], 'が素の {} です'),

    ('アップロードの種別を素の {} に戻す', [
        ('gas/Drive.gs', '  var o = Object.create(null);', '  var o = {};'),
    ], 'が素の {} です'),
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
