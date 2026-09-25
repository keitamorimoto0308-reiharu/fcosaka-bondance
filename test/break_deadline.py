"""締切の判定を、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_deadline.py

■ なぜ要るか（2026-09-25）
  gas/Api.gs の submit_ は「締切後の応募は弾く」と書いてあり、
  gas/Config.gs の isClosed は「締切後に受け続ける失敗は回復できない」と
  コメントしている。**それなのに、この判定を確かめる検査が1件も無かった。**
  `if (isClosed())` を丸ごと消しても、テスト1512件は全部緑のままだった。

  締切（2026-09-30 18:00）を過ぎて受け続けると、出店できない会社に
  受付完了メールが届く。**取り消せない。**

■ 改行コードを吸収する
  gas/*.gs は作業ツリーでは LF だが、環境によって CRLF が混ざりうる。
  目印を複数行にまたいで書くと、LF で書いた文字列と一致せず
  「目印なし」で素通りする。**素通りは、検出できたのと見分けがつかない。**
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/deadline-run.test.js'

A = 'gas/Api.gs'
C = 'gas/Config.gs'


def run():
    r = subprocess.run(['node', '--test', TARGET], cwd=R, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', shell=True)
    return r.returncode == 0, (r.stdout or '') + (r.stderr or '')


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


CASES = [
    ('締切の判定を素通りさせる', [
        (A, '  if (isClosed()) {', '  if (false) {'),
    ], '締切後の応募が通ってしまいます'),

    # 「弾いたつもりで、記録だけ残る」形。いちばん気づきにくい
    ('弾かずに、記録だけ進める', [
        (A, "    return { ok: false, error: 'closed', message: '応募の受付は終了しました。' };",
            "    logError_('closed', new Error('締切後'));"),
    ], '締切後なのに台帳へ記録しています'),

    ('締切の比較を、常に「まだ受付中」にする', [
        (C, '    return new Date() > getDeadline();', '    return false;'),
    ], '締切後の応募が通ってしまいます'),

    # 18:00 ちょうどを締切済みにすると、「18:00 まで」の案内と食い違う
    ('境界を1つずらす（ちょうどを締切済みにする）', [
        (C, '    return new Date() > getDeadline();', '    return new Date() >= getDeadline();'),
    ], '締切ちょうどの応募が弾かれています'),

    ('設定が壊れたとき、受付を続ける側に倒す', [
        (C, "    console.error('[isClosed] 締切設定が不正なため受付を停止します: ' + e);\n"
            '    return true;',
            "    console.error('[isClosed] 締切設定が不正なため受付を停止します: ' + e);\n"
            '    return false;'),
    ], '締切が空なのに応募を受け付けています'),

    # 締切は「日本時間の18:00」。GASの実行環境はUTCのことがあるので、
    # getDeadline は -9 して UTC の絶対時刻に直している。
    # ここが外れると締切が9時間ずれ、**18:01 に来た応募を受け付ける**
    ('締切を日本時間として読むのをやめる（9時間ずれる）', [
        (C, '    Number(m[4]) - 9, Number(m[5]), 0', '    Number(m[4]), Number(m[5]), 0'),
    ], '締切後の応募が通ってしまいます'),

    # 【記録】「空の締切を素通りさせる」は壊し方として成立しない。
    # 空チェックと書式チェックを両方外しても、次の行で m が null のまま
    # Number(m[1]) を読んで例外になり、isClosed の catch が
    # 「締切済み」に倒す＝**守りが三重**で、受付は止まったままになる。
    # （ケース5で catch 側を倒すと、ちゃんと穴になることは確認済み）
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
