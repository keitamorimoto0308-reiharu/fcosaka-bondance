"""文言の歯止めを、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_content.py

■ なぜ要るか
  時刻は5か所に書かれている（画面の帯／募集要項2か所／メール本文／紙面）。
  2026-09-02 の修正で、**メール本文だけ古い時刻のまま**になりかけた。
  メールは出店者にしか届かないので、こちらの画面をいくら見ても気づけない。

■ 復元は逆順で
  同じファイルを2か所壊したとき、順に書き戻すと1つ目の改変が残る
  （test/break_drive.py と同じ理由。実際に穴が残った）。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ['test/times.test.js', 'test/schema.test.js', 'test/pdf.test.js']


def rebuild():
    """紙面を作り直す。

    pdf.test.js は「content.js より PDF が古くないか」を見ているので、
    ファイルを書き戻しただけで**更新時刻が新しくなり、落ちたままになる**。
    作り直さないと、この道具の最後の1行が常に赤く出て意味を失う。
    """
    subprocess.run(['node', 'src/build-pdf.js'], cwd=R, capture_output=True, shell=True)


def run():
    r = subprocess.run(['node', '--test'] + TARGETS, cwd=R, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', shell=True)
    return r.returncode == 0, (r.stdout or '') + (r.stderr or '')


def case(label, edits, expect):
    saved = []
    for f, old, new in edits:
        p = R / f
        o = p.read_bytes()
        if old.encode() not in o:
            print('  [??] 目印なし …', label)
            for pp, oo in reversed(saved):
                pp.write_bytes(oo)
            return False
        saved.append((p, o))
        p.write_bytes(o.replace(old.encode(), new.encode(), 1))

    rebuild()                          # 生成物を見る検査は、作り直さないと素通りする
    ok, out = run()
    for p, o in reversed(saved):      # **逆順**
        p.write_bytes(o)
    rebuild()

    if ok:
        print('  [NG] 落ちず …', label)
        return False
    if expect not in out:
        print('  [??] 理由違い …', label)
        return False
    print('  [OK] 落ちた …', label)
    return True


CASES = [
    ('メール本文だけ古い搬入時刻に戻す', [
        ('gas/Mail.gs', "'搬　入　：9:30〜10:30',", "'搬　入　：8:30〜10:30',"),
    ], 'メールの搬入が違います'),

    ('メール本文だけ古い搬出時刻に戻す', [
        ('gas/Mail.gs', "'搬　出　：18:00〜19:00',", "'撤　収　：17:30〜19:30',"),
    ], 'メールの搬出が違います'),

    ('画面の帯だけ古い時刻に戻す', [
        ('src/content.js', "note: '搬入 9:30〜10:30 ／ 搬出 18:00〜19:00' },",
         "note: '搬入 8:30〜10:30 ／ 撤収 17:30〜19:30' },"),
    ], '帯の搬入が違います'),

    ('募集要項の本文だけ直して、要約を取り残す', [
        ('src/content.js', "lead: '搬入は9:30〜10:30、搬出は18:00〜19:00。",
         "lead: '搬入は8:30〜10:30、撤収は17:30〜19:30。"),
    ], '要約が本文と食い違っています'),

    ('盆踊りの時刻だけ古いまま', [
        ('src/content.js', "{ big: '16:15', small: '〜17:30', label: '盆踊り',",
         "{ big: '16:30', small: '〜',     label: '盆踊り',"),
    ], '時刻が、すべての置き場所で揃っているか'),

    ('タイムラインだけ古いまま', [
        ('src/content.js', "+ '／ 16:15〜17:30 盆踊り'],", "+ '／ 16:30〜 盆踊り'],"),
    ], 'タイムラインの盆踊りが違います'),

    ('包材にプラスチックの選択肢を戻す', [
        ('src/schema.js', "      'ご相談したい',", "      'プラスチック',"),
    ], '包材'),

    ('使用予定の包材を、書かなくてよくする', [
        ('src/schema.js',
         "    required: { field: 'packaging', op: 'eq', value: '自分で用意する（サステナブル素材）' },",
         '    required: false,'),
    ], '包材'),
]


def main():
    # 模擬サーバーが動いていたら止まる（共有ソースを壊す作業だから）
    guard()
    rebuild()
    res = [case(*c) for c in CASES]
    print('\n' + '=' * 52)
    print(f'  {sum(res)} / {len(res)} 件を検出')
    ok, _ = run()
    print('  復元後:', '通過' if ok else '[NG] 落ちたまま')
    return 0 if (all(res) and ok) else 1


if __name__ == '__main__':
    sys.exit(main())
