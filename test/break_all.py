"""わざと壊す検査を、全部まとめて流す。

使い方：  npm run break     （= python test/break_all.py）

■ なぜ要るか
  歯止めを1つ足すたびに `break_*.py` が増えている。
  どれを流すかを人が覚えていると、**足したのに一度も流していない**検査が出る。
  検査が働かない検査は、無いのと同じ。

■ 何をしているか
  それぞれの検査は「コードをわざと壊す → 検査が落ちることを確かめる → 戻す」。
  ここはその親で、結果を1枚にまとめるだけ。

■ 途中で止まったら
  各スクリプトは自分で元に戻すが、**強制終了すると壊れたまま残る**。
  そのときは `git status` で差分を見て戻すこと。
"""
import hashlib
import os
import pathlib
import re
import socket
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent
SCRIPTS = sorted(p.name for p in R.glob('break_*.py') if p.name != 'break_all.py')


WATCH = ['src', 'gas', 'test']


def snapshot():
    """更新時刻を控える。

    壊し検査は「書き換えて→戻す」ので中身は元どおりになるが、
    **更新時刻は今になる**。
    このプロジェクトには「src/content.js より成果物が古ければ落ちる」検査があり、
    壊し検査を流しただけで「ビルドが古い」と誤って落ちる。
    中身が元どおりなら、時刻も元に戻すのが正しい。
    """
    out = {}
    for d in WATCH:
        for f in (R.parent / d).rglob('*'):
            if f.is_file():
                st = f.stat()
                # 中身の指紋も控える。戻してよいかを、これで見分ける
                out[f] = (st.st_atime, st.st_mtime, st.st_size, file_digest(f))
    return out


def restore_times(snap):
    """更新時刻を戻す。**中身が元どおりのものだけ**。

    以前は「時刻が変わったファイル」を全部戻していたので、
    検査の最中に人が別のファイルを編集していると、その編集の時刻まで巻き戻り、
    「成果物がソースより古ければ落ちる」検査を**すり抜けさせて**いた
    （2026-09-04 の点検で指摘）。
    中身が変わっているファイルは、人が触ったものなので触らない。
    """
    n = 0
    for f, (atime, mtime, size, digest) in snap.items():
        try:
            if not f.is_file():
                continue
            st = f.stat()
            if st.st_mtime == mtime:
                continue                      # そもそも変わっていない
            if st.st_size != size or file_digest(f) != digest:
                continue                      # 中身が変わっている＝人が触った
            os.utime(f, (atime, mtime))
            n += 1
        except OSError:
            pass
    return n


def file_digest(f):
    return hashlib.sha256(f.read_bytes()).hexdigest()



def main():
    # 模擬サーバーが動いていたら止まる。歯止めは test/_guard.py に1つだけ置く
    #（break_all にしか無いと、個別に流したときに素通りする・2026-09-04 の点検で指摘）
    guard()

    print(f'わざと壊す検査 {len(SCRIPTS)}本を流します。\n')
    snap = snapshot()
    rows = []
    for name in SCRIPTS:
        print(f'── {name}')
        r = subprocess.run([sys.executable, str(R / name)], cwd=R.parent,
                           capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
        out = (r.stdout or '') + (r.stderr or '')
        for line in out.splitlines():
            if line.strip().startswith(('[OK]', '[NG]', '[??]')):
                print('  ' + line.strip())
        m = re.search(r'(\d+) / (\d+) 件を検出', out)
        got, want = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
        restored = '復元後: 通過' in out
        rows.append((name, got, want, restored, r.returncode == 0))
        print()

    touched = restore_times(snap)
    if touched:
        print(f'（書き換えて戻したファイル {touched} 件の更新時刻も元に戻しました）')

    print('=' * 56)
    okAll = True
    for name, got, want, restored, code in rows:
        mark = 'OK ' if (code and restored and got == want and want) else 'NG '
        if mark == 'NG ': okAll = False
        note = '' if restored else '  ← **復元できていません。git status を見てください**'
        print(f'  [{mark}] {name:<22} {got:>3} / {want:<3} 件を検出{note}')
    total_got = sum(x[1] for x in rows)
    total_want = sum(x[2] for x in rows)
    print('=' * 56)
    print(f'  合計 {total_got} / {total_want} 件を検出')
    return 0 if okAll else 1


if __name__ == '__main__':
    sys.exit(main())
