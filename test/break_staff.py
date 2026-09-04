"""担当社員の整理を、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_staff.py

■ 改行コードを吸収する
  gas/*.gs は CRLF。目印を複数行にまたいで書くと、LF で書いた文字列と
  一致せず「目印なし」で素通りする。**素通りは、検出できたのと見分けがつかない**。
  ここでは LF に正規化してから置き換え、書き戻すときに元の改行へ戻す。
  （break_drive.py / break_content.py は1行の目印だけなので素で当たっている）
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/staff-run.test.js'


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
    ('既にいる人にも上書きする（メールが消える）', [
        ('gas/Setup.gs', '    if (have[name]) return;', '    if (false) return;'),
    ], '2回目で行が増えました'),

    ('苗字への置き換えをやめる', [
        ('gas/Setup.gs',
         "var STAFF_RENAME = { '小谷　成太': '小谷', '小谷 成太': '小谷' };",
         'var STAFF_RENAME = {};'),
    ], 'フルネームのまま残っています'),

    ('フォーム表示の絞り込みを外す', [
        ('gas/Setup.gs',
         "    var want = (String(r[iOrg]).trim() === 'FC大阪'\n"
         "                && FCOSAKA_STAFF.indexOf(name) >= 0) ? '有効' : '無効';",
         "    var want = '有効';"),
    ], 'フォームに出る人が想定と違います'),

    ('外した人の行を消す', [
        ('gas/Setup.gs',
         '    if (String(r[iForm]).trim() === want) return;',
         "    if (want === '無効') { r[iName] = ''; return; }\n"
         '    if (String(r[iForm]).trim() === want) return;'),
    ], 'がまだフォームに出ます'),

    ('見出しを探さず、列番号を決め打ちにする', [
        ('gas/Setup.gs', '  if (iName < 0 || iOrg < 0 || iForm < 0) {', '  if (false) {'),
    ], '見出しが違うのに書き込んでいます'),

    # 新しい人の「有効」は二重にかかっている（足すときと、あとの整理と）。
    # 片方だけ壊しても動きが変わらないので、**両方**壊して初めて穴になる
    ('新しい人がフォームに出ない形にする（二重とも壊す）', [
        ('gas/Setup.gs', "    row[iForm] = '有効';", "    row[iForm] = '無効';"),
        ('gas/Setup.gs',
         "    var want = (String(r[iOrg]).trim() === 'FC大阪'\n"
         "                && FCOSAKA_STAFF.indexOf(name) >= 0) ? '有効' : '無効';",
         "    var want = String(r[iForm]).trim();"),
    ], 'がフォームに出ません'),
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
