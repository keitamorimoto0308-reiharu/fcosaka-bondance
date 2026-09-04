"""枚数の打ち込みと、変更履歴の受け渡しを、わざと壊して検査を確かめる。

使い方：  python test/break_count.py

■ なぜ念入りにやるか
  ここは**電話で聞いた枚数**を入れる画面で、当日の手配に直結する。
  2026-09-03 の検証で見つかった壊れ方が、どれも**画面が何も言わない**形だった：

    ・読めない値を黙って読み飛ばし、「変更はありません」とだけ出す
      → 聞いた枚数が消える。閉じて開き直すまで気づけない
    ・変更履歴の「操作者」が空欄
      → 本番は operator、模擬は who で返していた。
        **名前が違うだけで、画面は何のエラーも出さずに空を表示する**

■ 期待する文言は、**実際に出たもの**を書く
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/count-entry.test.js'


def build():
    subprocess.run(['node', 'src/build-admin.js'], cwd=R, capture_output=True, shell=True)


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

    build()
    ok, out = run()
    for p, before in reversed(saved):
        p.write_bytes(before.encode('utf-8'))
    build()

    if ok:
        print('  [NG] 落ちず …', label)
        return False
    if expect not in out:
        print('  [??] 理由違い …', label)
        return False
    print('  [OK] 落ちた …', label)
    return True


CASES = [
    # ── 読めない値の扱い（模擬）
    ('模擬が、読めない値を黙って読み飛ばす', [
        ('src/mock.js', '          const n = confirmCount(s);',
         '          const n = Number(s); if (!isFinite(n)) return;'),
    ], '読めない値が通りました'),

    ('模擬が、断った項目を無視して書き進む', [
        ('src/mock.js',
         "      if (bad.length) {\n"
         "        return { ok: false, error: 'bad_value', rejected: bad,",
         "      if (false) {\n"
         "        return { ok: false, error: 'bad_value', rejected: bad,"),
    ], '読めない値が通りました'),

    ('模擬が、読みながら書く（一部だけ入る）', [
        ('src/mock.js', '        plan.push({ f, k, out });',
         "        plan.push({ f, k, out });\n"
         "        DB.confirm[id].values[k] = out === '' ? '' : out;"),
    ], '読めない値が混ざっていたのに、他の項目が書き換わりました'),

    ('打ち込みを足し算にする', [
        ('src/mock.js', "        DB.confirm[id].values[k] = out === '' ? '' : out;",
         "        DB.confirm[id].values[k] = out === '' ? '' "
         ": Number(before || 0) + Number(out);"),
    ], '足し算になっています'),

    ('履歴に操作者を残さない', [
        ('src/mock.js', "        DB.history.unshift({ at: nowText(), who: auth.person, "
                        "id, item: f.sheet,",
         "        DB.history.unshift({ at: nowText(), who: '', id, item: f.sheet,"),
    ], '操作者が残っていません'),

    # ── 名前の食い違い（これが「操作者が空欄」の正体）
    ('模擬が、履歴を who という名前で返す', [
        ('src/mock.js', '                 at: h.at, operator: h.who, id: h.id, item: h.item,',
         '                 at: h.at, who: h.who, id: h.id, item: h.item,'),
    ], 'を返していません（画面では空欄になります）'),

    ('画面が、サーバーに無い名前を読む', [
        ('src/build-admin.js', "      + '<td>' + esc(h.operator) + '</td>'",
         "      + '<td>' + esc(h.person) + '</td>'"),
    ], 'を返していません（画面では空欄になります）'),

    ('絞り込みが操作者を見なくなる', [
        ('src/build-admin.js', '    return [h.id, h.item, h.operator, h.reason]',
         '    return [h.id, h.item, h.reason]'),
    ], '絞り込みが操作者を見ていません'),

    ('模擬が、履歴の操作者を2つの名前で書き分ける', [
        ('src/mock.js', "        DB.history.unshift({ at: nowText(), who: auth.person, "
                        "id: payload.id,",
         "        DB.history.unshift({ at: nowText(), operator2: auth.person, "
         "id: payload.id,"),
    ], '操作者が空欄の行があります'),

    ('模擬が、知らない受付IDでも行を作る', [
        ('src/mock.js', "      if (!DB.rows.some(r => String(r['受付ID']).trim() === id)) {",
         '      if (false) {'),
    ], '知らない受付IDが通りました'),

    ('模擬が、検査より前に行を作る', [
        ('src/mock.js',
         '      // ① まず全部読む。**1つでも読めなければ、何も書かない**（本番と同じ順序）。',
         "      if (!DB.confirm[id]) DB.confirm[id] = { at: nowText(), values: {} };"),
    ], '断ったのに行が増えました'),

    ('本番が、検査より前に行を作る', [
        ('gas/Confirm.gs', '      sh.appendRow([receiptId]);',
         '      /* 作らない */'),
    ], '行を作る場所が見つかりません'),

    ('本番が、知らない受付IDを断らない', [
        ('gas/Confirm.gs', "    if (!known) {", '    if (false) {'),
    ], '知らない受付IDを断っていません'),

    # ── 本番側
    ('本番が、確かめる前に書く', [
        ('gas/Confirm.gs', '    if (bad.length) {', '    if (false) {'),
    ], '本番が、断った項目をまとめていません'),

    ('本番が、読めない値を黙って読み飛ばす形に戻る', [
        ('gas/Confirm.gs', '        var got = confirmCount_(s);',
         '        var got = Number(s);\n'
         '        if (!isFinite(n)) return;'),
    ], '本番が読み取りをまとめていません'),

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
