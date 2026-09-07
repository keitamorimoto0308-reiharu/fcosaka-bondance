"""設定タブの歯止めを、わざと壊して確かめる。

使い方：  python test/break_settings.py   （npm run break が自動で拾う）

■ なぜ独立した1本にしたか
  2026-09-07、けいたが「テストデータの一括削除を許可をONにして保存しても
  『不明な項目です』と出て保存されない」と報告した。
  原因は `checkSetting_` に **text 型の分岐が無かった**こと。
  画面は全項目をまとめて送るので、text の項目が1つ混ざっているだけで
  **設定タブが丸ごと保存できなくなる**。ONにできなかったのは巻き添えだった。

  そしてこのとき、設定タブを見ている壊し検査が**1本も無かった**。
  テストは 1252 件が緑のまま、設定が保存できない状態が本番に出ていた。

■ 「通るテスト」は安全網にならない
  下の壊し方は、どれも「見た目は正しいコード」になる。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/settings.test.js'


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
        print('  [??] 理由違い …', label, '／ 期待:', expect)
        return False
    print('  [OK] 落ちた …', label)
    return True


A = 'gas/Admin.gs'

CASES = [
    # ── けいたが実際に踏んだ形（2026-09-07）──────────────
    # text の分岐が無いと、設定タブが丸ごと保存できなくなる
    ('text 型の分岐を消す', [
        (A, "  if (def.type === 'text') {", '  if (false) {'),
    ], 'checkSetting_ が扱えない型があります'),

    # 設定はシートのセルに書かれる。= で始まると数式になる
    ('設定の値を、数式よけを通さずにシートへ書く', [
        (A, '      sh.getRange(row, 2).setValue(safeCellText_(c.value));',
            '      sh.getRange(row, 2).setValue(c.value);'),
    ], 'シートに数式として書き込まれます'),

    # 長さの上限が無いと、シートのセルに何万字でも入る
    ('設定の文字の、長さの上限を外す', [
        (A, "    if (v.length > 300) return { message: def.label + 'が長すぎます。' };\n"
            '    // 数式よけ',
            "    if (false) return { message: def.label + 'が長すぎます。' };\n"
            '    // 数式よけ'),
    ], '長すぎるものが通りました'),

    # 1件でも通らなければ1件も書かない、を外すと
    # 「一部だけ保存された」状態が生まれる
    ('通らない項目があっても、通ったものは書くようにする', [
        (A, "    if (r.message) return { ok: false, error: 'bad_value', message: r.message };",
            '    if (r.message) continue;'),
    ], '通らない項目が混ざっているのに、書き込んでいます'),

    # 締切が読めないと isClosed() が「締切済み」に倒れ、応募が止まる
    ('締切の書式の検査を外す', [
        (A, "      return { message: '応募の締切は「2026-09-30 18:00」の形でご入力ください。'",
            "      return { value: v };\n      return { message: '応募の締切は「2026-09-30 18:00」の形でご入力ください。'"),
    ], '通ってしまった値'),

    # 区画の総数を割り当て済みより小さくすると、その割当が消える
    ('区画の総数の下限（割り当て済み）を見ないようにする', [
        (A, "    if (checked[j].def.key !== '区画総数') continue;",
            '    continue;'),
    ], '割り当て済みより小さい総数が通りました'),

    # パスワードを変えたら入り直しが要る。伝えないと「入れなくなった」と見える
    ('パスワードを変えたことを、画面に伝えないようにする', [
        (A, '      passwordChanged: pwToSet.length > 0,', '      passwordChanged: false,'),
    ], '入り直しが要ることを伝えていません'),
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
