"""レンタル品目の歯止めを、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_rental.py

■ なぜ念入りにやるか
  単価は**お金の話**。間違えると、そのまま請求書になる。
  しかも紙面（募集要項PDF）とのずれは、
  出店者から「金額が違う」と言われるまで誰も気づかない。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/rental.test.js'


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


CASES = [
    # ── 紙面とのずれ（この機能の主役）
    ('単価のずれを見ない', [
        ('src/mock.js', '    if (Number(pp.price) !== Number(live[name].price)) {',
         '    if (false) {'),
    ], 'ずれが出ていません'),

    ('紙面に無い品目を見逃す', [
        ('src/mock.js',
         "      out.push({ name, kind: 'added',\n"
         "        message: '「' + name + '」は、募集要項PDFの料金表に載っていません。' });\n"
         "      return;",
         '      return;'),
    ], '追加が検出されていません'),

    ('フォームから消えた品目を見逃す', [
        ('src/mock.js', '    if (live[name]) return;', '    if (true) return;'),
    ], '無効化が検出されていません'),

    ('ずれの文面に、紙面の値を書かない', [
        ('src/mock.js',
         "        message: '「' + name + '」の単価が、紙面は ' + Number(pp.price).toLocaleString()\n"
         "               + '円、いまのシートは ' + Number(live[name].price).toLocaleString() + '円です。' });",
         "        message: '「' + name + '」の単価が紙面と違います。' });"),
    ], '紙面といまの値の両方が書かれていません'),

    # ── お金の歯止め
    ('一般権限にも開放する', [
        ('src/mock.js',
         "    case 'adminRental': {\n"
         "      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',\n"
         "        message: 'この操作は管理者のみです。' };",
         "    case 'adminRental': {"),
    ], '一般権限では'),

    ('空欄の単価を0として入れる', [
        ('src/mock.js', "      let price = '';", '      let price = 0;'),
    ], '0 になっています'),

    ('単価の上限を外す', [
        ('src/mock.js', "        if (got.value > 500000) return { ok: false, error: 'bad_value',",
         "        if (false) return { ok: false, error: 'bad_value',"),
    ], '桁を打ち間違えた単価は入らない'),

    ('同じ品目名を許す', [
        ('src/mock.js',
         "      const dup = rentalRows.find(x => x.name === name && x.row !== row);",
         '      const dup = null;'),
    ], '同じ品目名は登録できない'),

    ('種別の照合をやめる', [
        ('src/mock.js', "      if (!RENTAL_KINDS.includes(String(it.kind || ''))) {",
         '      if (false) {'),
    ], '種別が一覧に無ければ断る'),

    ('単価の変更を履歴に残さない', [
        ('src/mock.js', "        ['品目', '単価', '有効'].forEach(k => {",
         '        [].forEach(k => {'),
    ], '履歴に残っていません'),

    # ── 本番側の作り
    ('紙面の料金表を焼き込まない', [
        ('gas/Schema.gs', 'var PUBLISHED_RENTALS = [', 'var PUBLISHED_RENTALS_X = ['),
    ], 'PUBLISHED_RENTALS が Schema.gs にありません'),

    ('品目を行ごと消す', [
        ('gas/Rental.gs', "    sh.getRange(row, headers.idx['有効'] + 1).setValue('無効');",
         '    sh.deleteRow(row);'),
    ], '行を消しています'),

    ('見出しの欠けを見ない', [
        ('gas/Rental.gs', '  if (missing.length) {', '  if (false) {'),
    ], '欠けを見ていません'),

    ('保存しても読み直させない', [
        ('gas/Rental.gs', '    _rentalCache = null;          // 読み直させる',
         '    // 読み直させない'),
    ], 'キャッシュを消していません'),

    ('管理者限定から外す', [
        ('gas/Admin.gs',
         "                   'adminRental', 'adminRentalSave', 'adminRentalDisable',",
         '                   ];'),
    ], '管理者限定の一覧にありません'),

    # ── 数の読み取り（2026-09-03 の検証で見つかった穴）
    ('本番が、数字以外を捨てて読む形に戻る', [
        ('gas/Rental.gs', "    var got = rentalNumber_(priceRaw);",
         "    var got = { ok: true, value: Number(priceRaw.replace(/[^0-9.]/g, '')) };"),
    ], '数字以外を捨てる読み方が残っています'),

    ('本番が、最大数だけ素通りさせる', [
        ('gas/Rental.gs', '    var gotMax = rentalNumber_(maxRaw);',
         "    var gotMax = { ok: true, value: Number(maxRaw.replace(/[^0-9]/g, '')) || 0 };"),
    ], '数字以外を捨てる読み方が残っています'),

    ('模擬が、数字以外を捨てて読む形に戻る（本番より緩くする）', [
        ('src/mock.js', '        const got = rentalNumber(praw);',
         "        const got = { ok: true, value: Number(praw.replace(/[^0-9.]/g, '')) };"),
    ], '模擬に「数字以外を捨てる」読み方が残っています'),

    # ── 画面に無い欄を、保存で消さない（2026-09-03 の点検で指摘）
    ('本番が、並び順を行番号で上書きする', [
        ('gas/Rental.gs', '      orderVal = Math.floor(gotOrder.value);',
         '      orderVal = Number(it.order) || row;'),
    ], '読み取った値を使っていません'),

    ('本番が、テントの間口を空にする', [
        ('gas/Rental.gs', '      if (!given(v)) return keepCell(col);',
         '      if (false) return keepCell(col);'),
    ], '寸法を、画面が送ってこないときも上書きしています'),

    ('模擬が、保存で寸法を消す', [
        ('src/mock.js', '        Object.assign(target, rec);',
         "        Object.assign(target, rec, { w: 0, d: 0 });"),
    ], 'テントの間口が消えました'),

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
