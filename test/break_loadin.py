"""まとめて搬入予定時刻を入れる機能を、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_loadin.py

■ なぜ break_bulkstatus.py に入れないか
  同じ gas/Admin.gs を壊すが、**守っているものが違う**。
  あちらは「規則を写さない」「途中まで変わって止まらない」。
  こちらはそれに加えて **「報せるが、止めない」** を守っている。
  一緒にすると、どちらが壊れたのか読めなくなる。

■ この機能でいちばん守りたいこと
  1. **書式は、1件目に触る前に全部見る**（前半だけ入る状態を作らない）
  2. **窓（9:30〜10:30）の外は止めない**——当日の事情で早く入れる社は現実にある。
     止めると、人はシートを直接いじりに行く（＝変更履歴に残らない）
  3. **空は許す**（時刻を消せる）。戻す道が無いと、同じく迂回路を探させる
  4. 規則を写さず、1件ずつの adminUpdate_ をそのまま通す

■ 目印の作り方（引き継ぎ書 §3 の失敗パターン）
  行末の記号（`];` など）や引数の並びを目印に含めない。
  いつか誰かが足したり並べ替えたりして、**黙って未検査になる**。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
# **壊す場所と、落ちる検査を対にする**（引き継ぎ書 §3 の失敗パターン7）。
#   gas/Admin.gs      → test/admin-edit.test.js
#   src/build-admin.js → test/admin.test.js（画面の性質を見る）
TARGETS = ['test/admin-edit.test.js', 'test/admin.test.js', 'test/loadin.test.js']


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
PAGE = 'src/build-admin.js'
CALC = 'src/loadin.js'

CASES = [
    # ── 検証役3体の指摘（2026-09-09）を、二度と戻さないための壊し方 ──────
    # H-1：枠を押しても選択が残る＝**画面に出ていない相手にメールが飛ぶ**。
    #      この案件が「いちばん危ない形」と名指ししているもの
    ('枠を押しても、選んだ相手を解除しない', [
        (PAGE, '    var had = bcPickIds().length;\n    bcPickClear();\n    renderList();',
               '    var had = 0;\n    renderList();'),
    ], '枠を押したときに、選んだ相手を解除していません'),

    # 高3：既にいる社を数えないと、「押す前に見せた計画」が嘘になる
    ('すでにその枠にいる社を、数えずに配る', [
        (PAGE, '  var assign = loadinPlan(todo, from, LOADIN.step, LOADIN.cap, occupied);',
               '  var assign = loadinPlan(todo, from, LOADIN.step, LOADIN.cap);'),
    # 落ちるのは test/admin.test.js のほう（画面が渡しているかを見る検査）。
    # test/loadin.test.js は loadinPlan を直接呼ぶので、画面を壊しても落ちない。
    # なお loadinOccupied() の呼び出し自体は残るので、
    # 反応するのは「渡しているか」を見る2つ目の assert
    ], '数えた結果を loadinPlan に渡していません'),

    ('入れ直す社まで「すでにいる」に数える', [
        (CALC, "    if (skip[String(x['受付ID'])]) return;", '    if (false) return;'),
    ], '入れ直す社を数に入れています'),

    # 低2：0台と答えた社を1台に数えると、「入りきりません」が誤って点灯する
    ('0台と答えた社も、1台として数える', [
        (CALC, "  if (raw === '' || raw === null || raw === undefined) return 1;   // まだ答えていない",
               "  if (raw === '' || raw === null || raw === undefined || Number(raw) === 0) return 1;"),
    ], '0台と答えた社は、0台として数える'),

    # ── 報せる側と、実際にやる側がずれる ───────────────────
    # この案件は同じ形で一度事故を起こしている（一斉メールのプレビューは
    # 「この行は消えます」と正しく警告したのに、本文では消えていなかった）。
    # **片方だけを見る検査では捕まらない。**
    ('枠を押したときの絞り込みが、来ない相手を外さなくなる', [
        (PAGE, '      if (!loadinComing(x)) return false;\n', ''),
    ], '枠の絞り込みが、来ない相手を外していません'),

    # 判定は loadinComing の1か所だけ。ここを壊すと3つの経路すべてに効く。
    # 2026-09-10 まで同じ判定が3か所に写されていて、目印が複数の場所に当たっていた
    # ※ `return true;` に置き換えない。**判定の写しが0か所になり**、
    #   「1か所だけにある」を見る検査のほうが先に落ちる（理由違いになる）。
    #   **構造は保ったまま、振る舞いだけ壊す**のが正しい壊し方
    # 判定は src/loadin.js に移した（画面に置くと「呼んでいるか」しか見られず、
    # **逆にしてもどのテストも落ちなかった**。2026-09-10 に壊し検査が暴いた）
    ('来ない相手かの判定を、逆にする', [
        (CALC, "  return loadinSkipList().indexOf(String((x || {})['ステータス'] || '')) < 0;",
               "  return loadinSkipList().indexOf(String((x || {})['ステータス'] || '')) >= 0;"),
    ], 'を数に入れています'),

    ('来ないと決まった相手の一覧を、空にする', [
        (CALC, "  return ['不採択', '辞退', 'キャンセル', '重複（無効）'];", '  return [];'),
    ], '外す一覧が、想定どおり4つ'),

    # 画面で数え直すと、src/loadin.js の検査（test/loadin.test.js）が
    # 一切効かなくなる。**写しを2つ持たない**のがこの機能の前提
    ('数え方を、画面で書き写す', [
        (PAGE, '  var B = loadinBuckets(rows, from, to, LOADIN.step, LOADIN.cap);',
               '  var B = { slots: [], undecided: { n: 0, cars: 0 },'
               ' outside: { n: 0, cars: 0 }, cap: 0, cars: 0 };'),
    ], 'loadinBuckets を呼ばず'),

    # ── 書式：1件目に触る前に、全部見る ────────────────────────
    ('書式の検査を、まるごと外す', [
        (ADMIN, '  if (bad.length) {\n    return { ok: false, error: \'bad_value\',\n'
                '      message: \'時刻の書き方が「9:30」の形になっていません：\'',
                '  if (false) {\n    return { ok: false, error: \'bad_value\',\n'
                '      message: \'時刻の書き方が「9:30」の形になっていません：\''),
    ], '書式違いを先に断っていません'),

    # 「1件目だけ見て、あとは通す」は、素朴に書くと本当に起きる形。
    # 2件目に変な値を入れた検査でしか捕まらない
    ('書式を、1件目しか見ないようにする', [
        (ADMIN, '  for (var j = 0; j < list.length; j++) {',
                '  for (var j = 0; j < 1; j++) {'),
    ], '書式違いを先に断っていません'),

    ('ありえない時刻（25:00 など）を通す', [
        (ADMIN, "    if (!/^([0-9]|[01][0-9]|2[0-3]):[0-5][0-9]$/.test(t)) "
                "bad.push(list[j].id + '（' + t + '）');",
                "    if (false) bad.push(list[j].id + '（' + t + '）');"),
    ], '書式違いを先に断っていません'),

    # ── 報せるが、止めない ────────────────────────────────
    # **過剰な守りを入れる**壊し方。減らすのではなく、増やすと壊れる形。
    # 止めると人はシートを直接いじりに行き、変更履歴に残らなくなる
    ('搬入の窓の外を、断るようにする（守りを足して壊す）', [
        (ADMIN, "    if (!/^([0-9]|[01][0-9]|2[0-3]):[0-5][0-9]$/.test(t)) "
                "bad.push(list[j].id + '（' + t + '）');",
                "    if (!/^(9:[3-5][0-9]|10:[0-2][0-9]|10:30)$/.test(t)) "
                "bad.push(list[j].id + '（' + t + '）');"),
    ], '窓の外を断っています'),

    ('空（時刻を消す）を、断るようにする', [
        (ADMIN, "    if (t === '') continue;",
                "    if (t === '') { bad.push(list[j].id); continue; }"),
    ], '空（時刻を消す）を断っています'),

    # ── 二重・空 ─────────────────────────────────────────
    # 同じIDが2回入ると、同じ相手に2回書いて変更履歴が二重に増える。
    # 画面では起きにくいが、通信を細工すれば起きる（守りはサーバー側だけ）
    ('同じ受付IDが2回入っていても、まとめない', [
        (ADMIN, '    if (!id || seen[id]) continue;\n    seen[id] = true;',
                '    if (!id) continue;'),
    ], '変更履歴が二重に増えています'),

    # 目印は adminBulkLoadIn_ にしか無い形にしてある。
    # 「!list.length」は adminBulkStatus_ にも同じ行があり、
    # **別の関数を壊してしまう**（2026-09-09 に実際に踏んだ）
    ('相手が1件も選ばれていなくても通す', [
        (ADMIN, '  if (list.length === 0) {', '  if (false) {'),
    ], '相手が0件なのに通しています'),

    # ── 規則を写さない ──────────────────────────────────
    # 1件ずつの adminUpdate_ をそのまま通すのが要点。
    # 自前の書き込みに変えると、変更履歴も、変えてよい項目の判定も落ちる
    ('1件ずつの adminUpdate_ を通さず、自前で書く', [
        (ADMIN, "      res = adminUpdate_(auth, { id: list[k].id, patch: patch, reason: '' });",
                "      res = { ok: true };"),
    ], '変更履歴に残っていません'),

    # 書き込む先が搬入予定時刻でなくなると、静かに別の列が書き換わる
    ('書き込む先を、搬入予定時刻ではなくする', [
        (ADMIN, '    patch[COL.inAt] = list[k].at;',
                '    patch[COL.memo] = list[k].at;'),
    ], '搬入予定時刻を書いていません'),
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
