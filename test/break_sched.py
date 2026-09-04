"""① 制作スケジュール表の歯止めを、わざと壊して確かめる。

使い方：  python test/break_sched.py     （npm run break が自動で拾う）

■ 仕様書
  docs/internal/design_schedule_plan.md §5-4 に、足すべき壊し方が12通り書いてある。
  いまここに在るのは **§5-1（詳細欄のURLのリンク化）の分だけ**。
  残り（許可リスト・絞り込み・完了日・削除の履歴・端末の日付・HOWTO・直書き）は、
  gas/Sched.gs を作るときに、歯止めと一緒に足す。

■ なぜリンク化だけ先に在るか
  この仕組みは「守りはすべてサーバー側」で通してきたが、
  **リンク化だけは画面側の処理**なので、ここに穴が開く。
  詳細欄は全員が書けて、管理ページは応募企業の個人情報を読める画面。
  だから①②の実装より先に、単体で固めた（src/linkify.js）。
  ② タイムスケジュール（design_timetable.md §7-1）も**同じ関数を共有する**ので、
  ここが働かなくなると2画面ぶん穴が開く。

■ 「通るテスト」は安全網にならない
  下の壊し方はどれも「見た目は正しいコード」になる。
  目で読んで気づけないから、実際に壊して落ちることを確かめる。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/linkify.test.js'


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


F = 'src/linkify.js'

# 画面側の esc と同じもの。case5 で「関数の外」に置くために使う
OUTER_ESC = (
    "var __outerEsc = function (s) { return String(s == null ? '' : s)"
    ".replace(/&/g, '&amp;'); };\n"
)

CASES = [
    # ── 仕様書 §5-4 の 1 ──────────────────────────────
    ('javascript: もリンクにできるようにする', [
        (F, r'var re = /https?:\/\/(?:',
            r'var re = /(?:https?:\/\/|javascript:)(?:'),
    ], 'リンクになってしまいました'),

    # ── 仕様書 §5-4 の 2 ──────────────────────────────
    ('エスケープをやめる（<img onerror> が通る）', [
        (F, "var s = esc(text == null ? '' : String(text));",
            "var s = String(text == null ? '' : text);"),
    ], 'エスケープされていません'),

    # ── 仕様書 §5-4 の 3 ──────────────────────────────
    # 「先にリンク化 → あとでエスケープ」にすると、作った <a> まで壊れる。
    # 出来上がりは &lt;a href=… なので、リンクが1つも無い画面になる。
    ('エスケープとリンク化の順番を逆にする', [
        (F, "var s = esc(text == null ? '' : String(text));",
            "var s = String(text == null ? '' : text);"),
        (F, 'return s.replace(re, function (url) {',
            'return esc(s.replace(re, function (url) {'),
        (F, '  });\n}', '  }));\n}'),
    ], 'エスケープとリンク化の順番が逆だと'),

    # ── 仕様書には無いが、実装中に実際に踏んだ穴 ──────────
    # 「空白以外は全部URL」と書くと、**日本語は空白で区切らない**ので
    # URLの後ろの本文まで飲み込む。英語で試すと通ってしまう。
    ('URLの構成文字を「空白以外は全部」に戻す', [
        (F, r'[A-Za-z0-9\-._~:/?#[\]@!$()*+,;=%]', r'[^\s&<>"\']'),
    ], 'URLの後ろの日本語まで飲み込みました'),

    ('rel="noopener noreferrer" を外す', [
        (F, r'''noreferrer">' + url''', r'''">' + url'''),
    ], 'window.opener でこの管理ページを操作できます'),

    # ── 埋め込みの前提が壊れていないか ────────────────────
    # .toString() で画面に書き出す方式なので、関数の外側を参照した時点で
    # **画面でだけ落ちる**（テストからは普通に呼べるので気づけない）。
    ('esc を引数ではなく関数の外から呼ぶ（画面で落ちる形にする）', [
        (F, 'function linkifyDetail(text, esc) {',
            OUTER_ESC + 'function linkifyDetail(text, esc) {\n  esc = __outerEsc;'),
    ], '__outerEsc is not defined'),
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
