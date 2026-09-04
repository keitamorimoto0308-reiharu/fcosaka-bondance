"""ダッシュボードの集計を、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_aggregate.py

■ なぜ念入りにやるか
  ここは **FC大阪が最初に見る数字**で、しかも当日の手配（パス・駐車証・
  チケットの枚数）に直結する。数が違っても画面は何も言わない。

  2026-09-03 の検証で2つ見つかった：
    ・「未提出 7社」が、**採択していない事業者まで数えていた**
      （出せない人を催促の対象に入れていた。実際は3社）
    ・全角の「１０」が **0** として足され、しかも「入力済み」に数えられていた
      （数字以外を捨てて Number() に渡すと、Number('') が 0 になる）

■ 「模擬を緩める」を必ず入れる
  このプロジェクトでは「模擬が本番より緩いせいで本番のバグを見逃す」が
  繰り返し起きている。

■ 期待する文言は、**実際に出たもの**を書く
  推測で書くと「理由違い」で素通りし、検出できたのと見分けがつかない。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/aggregate.test.js'


def build():
    """画面のコードを見る検査があるので、作り直してから流す"""
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
    # ── 母数（誰を数えるか）
    ('本番が、採択していない事業者まで母数に入れる', [
        ('gas/Admin.gs',
         "        if (!AGGREGATE_CONFIRM_STATUS_[asText_(r[stIdx]).trim()]) return;",
         '        // 全部数える'),
    ], '本番が母数を絞っていません'),

    ('本番が、辞退・キャンセルも母数に入れる', [
        ('gas/Admin.gs',
         "var AGGREGATE_CONFIRM_STATUS_ = Object.assign(Object.create(null), "
         "{ '採択': true });",
         "var AGGREGATE_CONFIRM_STATUS_ = Object.assign(Object.create(null), "
         "{ '採択': true, '辞退': true, 'キャンセル': true, '不採択': true, "
         "'審査中': true, '未確認': true });"),
    ], 'が入っています'),

    ('模擬が、全行を母数にする（本番より緩くする）', [
        ('src/mock.js',
         "        if (f.stage === 'confirm' && String(r['ステータス'] || '').trim() "
         "!== '採択') return;",
         '        // 全部数える'),
    ], 'の母数が採択者数と違います'),

    # ── 数の読み取り
    ('本番が、数字以外を捨てて読む形に戻る', [
        ('gas/Admin.gs', '      var n = aggregateNumber_(s);',
         "      var n = Number(s.replace(/[^0-9.-]/g, ''));"),
    ], '本番が読み取りをまとめていません'),

    ('読めない値を、入力済みに数える', [
        ('src/mock.js', '        if (n === null) { missing++; note(r); return; }',
         '        if (n === null) { sum += 0; filled++; return; }'),
    ], '読めない値を「入力済み」に数えています'),

    ('未提出の社名を返さない', [
        ('src/mock.js',
         '               missingNames: missingNames.slice(0, 5).map(x => x.name),',
         '               missingNames: [],'),
    ], '社名の数が未提出の数と合いません'),

    ('社名を全部返す（50社ぶん並ぶ）', [
        ('src/mock.js',
         '               missingNames: missingNames.slice(0, 5).map(x => x.name),',
         '               missingNames: missingNames.map(x => x.name),'),
    ], '頭だけにしていません'),

    ('本番が、社名を返さない', [
        ('gas/Admin.gs', '      missingNames: missingNames.slice(0, AGGREGATE_NAMES_MAX)',
         '      missingNamesX: []; var _x = ('),
    ], '本番が未提出の社名を返していません'),

    ('画面が、社名を出さない', [
        ('src/build-admin.js', '        var who = (t.missingNames || []).length',
         '        var who = 0 && (t.missingNames || []).length'),
    ], '社名を出していません'),

    # ── 画面の言い方
    ('画面から「まだ増える」の注意書きを外す', [
        ('src/build-admin.js',
         "        ? '<p class=\"pnote warn\">まだ全社そろっていません。'\n"
         "          + '下の数は<b>いま出ている分だけの合計</b>で、未提出の分が届くと増えます。</p>'",
         "        ? ''"),
    ], '途中の数だと書いていません'),

    ('画面から母数を外す', [
        ('src/build-admin.js',
         "          ? total + '社中 ' + t.filled + '社ぶん（確定情報が未提出 '"
         " + t.missing + '社）'",
         "          ? t.filled + '社ぶん（未提出 ' + t.missing + '社）'"),
    ], '母数を書いていません'),
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
