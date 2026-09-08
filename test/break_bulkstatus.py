"""まとめてステータスを変える機能を、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_bulkstatus.py

■ なぜ break_broadcast.py に入れないか
  あちらが見るのは test/broadcast*.test.js だけ。
  この機能の振る舞いを見る検査は test/admin-edit.test.js にあるので、
  Admin.gs を壊しても**あちらでは検出できない**。
  **壊す場所と、落ちる検査は、同じ壊し検査の中で対にする。**
  （2026-09-08、実際にここを取り違えて何も検出できなかった）

■ 一斉メールとは守りの重さが違う
  メール送信は取り消せないので、札・プレビュー必須・40件上限を置いた。
  ステータス変更は変更履歴に前の値ごと残り、戻せる。
  だから守るのは「規則を写さないこと」と「途中まで変わって止まらないこと」。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ['test/admin-edit.test.js']


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


ADMIN = 'gas/Admin.gs'

CASES = [
    # 1件ずつのときは理由が要るのに、まとめてのときだけ要らない、では筋が通らない。
    # むしろ、まとめて変えるほうが影響が大きい
    ('まとめて変えるときだけ、理由を要らなくする', [
        (ADMIN, '  if (STATUS_NEEDS_REASON_.indexOf(status) >= 0 && reason.trim().length < 5) {',
                '  if (false) {'),
    ], '理由が要るステータスなのに、先に断っていません'),

    ('知らないステータスを通す', [
        (ADMIN, '  if (STATUS_LIST_().indexOf(status) < 0) {', '  if (false) {'),
    ], '知らないステータスを、先に断っていません'),

    # 同じIDを2回選ぶと、同じ相手に2回書いて変更履歴が二重に増える
    ('同じ受付IDを2回選んだとき、まとめない', [
        (ADMIN, '    if (!id || seen[id]) return;\n    seen[id] = true;\n    list.push(id);',
                '    if (!id) return;\n    list.push(id);'),
    ], '同じ相手を2回変えています'),

    # 相手が0件なのに通すと、「0件を変えました」と出て何が起きたか分からない
    ('相手が1件も選ばれていなくても通す', [
        (ADMIN, '  if (!list.length) {', '  if (false) {'),
    ], 'まとめてステータスを変える'),

    # **規則を写さない。** 1件ずつの adminUpdate_ をそのまま通すのが要点。
    # ここを自前の書き込みに変えると、変更履歴も理由も落ちる
    ('1件ずつの adminUpdate_ を通さず、自前で書く', [
        (ADMIN, '      r = adminUpdate_(auth, { id: id, patch: patch, reason: reason });',
                "      r = { ok: true };"),
    ], '変更履歴に残っていません'),
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
