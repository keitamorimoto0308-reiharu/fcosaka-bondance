"""素材アップロード・資料置き場の歯止めを、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_drive.py

■ なぜ要るか
  「テストが通った」は「守れている」ではない。実際、形だけを見る検査は
  次の3つを素通りさせた（検証役が実際に破った）：
    ・種別に constructor と書くだけで .exe が置ける
    ・image/png と偽って invoice.pdf.html が置ける
    ・出店者提出物フォルダごと消せる
  ここで1つずつ壊し、**検査が落ちること**を確かめる。

■ 同じファイルを2か所壊したら、復元は逆順で
  順に書き戻すと、2つ目の復元が1つ目の改変を含んだ内容を書き戻し、
  **穴が開いたまま残る**。実際にそれで gas/Drive.gs に穴が残り、
  次のテスト実行で見つかった。逆順にすれば必ず最初の内容に戻る。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGET = 'test/drive-run.test.js'


def run():
    r = subprocess.run(['node', '--test', TARGET], cwd=R, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', shell=True)
    return r.returncode == 0, (r.stdout or '') + (r.stderr or '')


def case(label, edits, expect):
    """edits: [(ファイル, 目印, 差し替え後), ...]"""
    saved = []
    ok_marks = True
    for f, old, new in edits:
        p = R / f
        o = p.read_bytes()
        if old.encode() not in o:
            print('  [??] 目印なし …', label)
            ok_marks = False
            break
        saved.append((p, o))
        p.write_bytes(o.replace(old.encode(), new.encode(), 1))

    if not ok_marks:
        for p, o in reversed(saved):
            p.write_bytes(o)
        return False

    ok, out = run()
    # **逆順で戻す。**順に戻すと、同じファイルへの1つ目の改変が残る
    for p, o in reversed(saved):
        p.write_bytes(o)

    if ok:
        print('  [NG] 落ちず …', label)
        return False
    if expect not in out:
        print('  [??] 理由違い …', label)
        return False
    print('  [OK] 落ちた …', label)
    return True


CASES = [
    ('種類の照合を、二重とも元の形に戻す', [
        ('gas/Drive.gs', 'var o = Object.create(null);', 'var o = {};'),
        ('gas/Drive.gs',
         "var v = UPLOAD_ALLOWED[String(mime || '')];\n"
         "  return (typeof v === 'string') ? v : '';",
         "return UPLOAD_ALLOWED[String(mime || '')] || '';"),
    ], 'prototype のものを'),

    ('拡張子の付け直しをやめる', [
        ('gas/Drive.gs', "    s = s.replace(/\\.[A-Za-z0-9]{1,12}$/, '');",
         "    if (s.indexOf('.') >= 0) return s;"),
    ], '拡張子は捨てて付け直す'),

    ('DELを通す', [
        ('gas/Drive.gs', 'if (c < 32 || c === 127) return false;',
         'if (c < 32) return false;'),
    ], 'DEL'),

    ('書字方向の上書きを通す', [
        ('gas/Drive.gs', 'if (c >= 0x202A && c <= 0x202E) return false;',
         'if (false) return false;'),
    ], '書字方向'),

    ('見えない文字を通す', [
        ('gas/Drive.gs', 'if (c >= 0x200B && c <= 0x200F) return false;',
         'if (false) return false;'),
    ], '見えない文字'),

    ('フォルダを消せるようにする', [
        ('gas/Docs.gs',
         "    if (file.getMimeType() === 'application/vnd.google-apps.folder') {",
         '    if (false) {'),
    ], 'フォルダは消せない'),

    ('資料フォルダの外か確認しない', [
        ('gas/Docs.gs', '    if (!isInsideDocsRoot_(file)) {', '    if (false) {'),
    ], '資料フォルダの外のファイルは消せない'),

    ('たどった先を覚えない', [
        ('gas/Docs.gs', '      if (seen[fid]) continue;', '      if (false) continue;'),
    ], '親が輪'),

    ('深さの上限を外す', [
        ('gas/Docs.gs', 'depth < 10 && queue.length', 'depth < 100000 && queue.length'),
    ], '深く埋もれたもの'),

    ('管理ページで実行できるものを通す', [
        ('gas/Docs.gs', '  if (DOCS_DENY_EXT.indexOf(fileExt_(fileName)) >= 0) {',
         '  if (false) {'),
    ], '開くと動くもの'),

    ('提出物を、共有している資料フォルダの中に戻す', [
        ('gas/Drive.gs',
         '  var folder = childFolder_(submissionsFolder_(), receiptId);',
         "  var folder = childFolder_(childFolder_(rootFolder_(), '出店者提出物'), receiptId);"),
        ('gas/Docs.gs', '  try { subm = submissionsFolder_(); }',
         "  try { subm = childFolder_(rootFolder_(), '出店者提出物'); }"),
    ], '共有している資料フォルダの中に無い'),

    ('置き先の照合を外す', [
        ('gas/Docs.gs',
         '  if (DRIVE_SUBFOLDERS.indexOf(folderName) < 0) {',
         '  if (false) {'),
    ], '置き先が一覧に無い名前'),
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
