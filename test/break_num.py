"""数の読み取り（gas/Num.gs）を、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_num.py

■ なぜ1本にまとめたか
  単価（レンタル）・枚数（確定情報）・合計（ダッシュボード）で
  同じことを3回書いていた。**揃っていないことに誰も気づいていなかった。**

  2026-09-04、点検役が3つを並べて同じ入力を流したところ、合計だけが前方一致で
  「3-5」→3、「12abc」→12、「-5」→-5、「０．５」→0 を返し、
  しかも全部「入力済み」に数えていた。
  ＝**「未提出」にも出ず、ダッシュボードの合計だけが静かにずれる。**

  読み取りを gas/Num.gs の1か所にまとめたので、
  壊し検査も1本にまとめる。ここが壊れれば3つとも落ちる。

■ 「模擬を緩める」を必ず入れる
  模擬は読み取りを本番のソースから借りている。写しを作った瞬間に揃わなくなる。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ['test/num.test.js', 'test/rental.test.js',
           'test/count-entry.test.js', 'test/aggregate.test.js']


def run():
    r = subprocess.run(['node', '--test'] + TARGETS, cwd=R, capture_output=True,
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
    # ── 共通の読み取りそのもの
    ('全角を半角に直さない', [
        ('gas/Num.gs',
         "    .replace(/[０-９]/g, function (c) "
         "{ return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })",
         '    '),
    ], '「１２００」は 1200'),

    ('全角のピリオドを直さない', [
        ('gas/Num.gs', "    .replace(/[．]/g, '.')", '    '),
    ], '全角の小数点を直していません'),

    ('末尾を固定せず、前方一致で読む', [
        ('gas/Num.gs', "  if (!/^[0-9]+(\\.[0-9]+)?$/.test(t)) return null;",
         "  var m = t.match(/^-?[0-9]+(\\.[0-9]+)?/); if (!m) return null; t = m[0];"),
    ], '単価・合計として'),

    ('枚数で小数を受ける', [
        ('gas/Num.gs', "  if (!/^[0-9]+$/.test(t)) return null;",
         "  if (!/^[0-9]+(\\.[0-9]+)?$/.test(t)) return null;"),
    ], '枚数で小数を受けています'),

    ('内部の空白も全部落とす（1 0 が 10 になる）', [
        ('gas/Num.gs',
         "  if (/^[0-9]{1,3}([,，　 ][0-9]{3})+$/.test(t)) return t.replace(/[,，　 ]/g, '');",
         "  return t.replace(/[,，　 ]/g, '');"),
    ], '「1 0」は読めない'),

    ('読めないものを 0 にする', [
        ('gas/Num.gs', '  if (!/^[0-9]+$/.test(t)) return null;',
         '  if (!/^[0-9]+$/.test(t)) return 0;'),
    ], '枚数として 0 を返しました'),

    ('断る理由を返さない', [
        ('gas/Num.gs', "  if (t.charAt(0) === '-') return 'マイナスは指定できません';",
         "  if (t.charAt(0) === '-') return 'だめです';"),
    ], 'マイナス'),

    # ── 3つが同じ入口を通っていること
    ('単価が、共通の読み取りを通らなくなる', [
        ('gas/Rental.gs', '  var n = numAmount_(raw);',
         "  var n = Number(String(raw).replace(/[^0-9.]/g, ''));"),
    ], '数字以外を捨てる読み方が残っています'),

    ('枚数が、共通の読み取りを通らなくなる', [
        ('gas/Confirm.gs', '  return numCount_(text);',
         '  return Number(text);'),
    ], '共通の読み取りを通っていません'),

    ('合計が、共通の読み取りを通らなくなる', [
        ('gas/Admin.gs', '  return numAmount_(text);', '  return Number(text);'),
    ], '共通の読み取りを通っていません'),

    ('読み取りの中で、書き直しを始める', [
        ('gas/Confirm.gs', '  return numCount_(text);',
         "  return numCount_(String(text).replace(/[^0-9]/g, ''));"),
    ], 'の中で読み取りを書き直しています'),

    # ── 模擬が本番より緩くならないこと
    ('模擬が、読み取りの写しを持つ', [
        ('src/mock.js', 'const confirmCount = t => NUM.numCount_(t);',
         'const confirmCount = t => { const n = Number(t); '
         'return isFinite(n) ? n : null; };'),
    ], '模擬が numCount_ を使っていません'),

    ('模擬が、本番のソースを読まずに自前で持つ', [
        ('src/mock.js', "  const src = fs.readFileSync(path.join(ROOT, 'gas', 'Num.gs'), 'utf8');",
         "  const src = 'function numCount_(t){return Number(t);}'"
         " + 'function numAmount_(t){return Number(t);}'"
         " + 'function numWhy_(t){return String(t);}';"),
    # 2026-09-08、ほかの箱にも rd('Num.gs') を足したところ、
    # 「どこかに 'Num.gs' の字があるか」を見る検査が別の理由で通るようになった。
    # **NUM の箱の中**を切り出して見る形に変えたので、文言もそちらに合わせる
    ], 'NUM の箱が gas/Num.gs を読んでいません'),
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
