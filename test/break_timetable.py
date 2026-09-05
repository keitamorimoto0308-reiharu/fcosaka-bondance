"""② タイムスケジュールの歯止めを、わざと壊して確かめる。

使い方：  python test/break_timetable.py   （npm run break が自動で拾う）

■ 仕様書
  docs/internal/design_timetable.md §7-4 に、足すべき壊し方が14通り書いてある。
  **10（Excelの一時ファイルを消し忘れる）だけ、まだ書けない。**
  書き出し（PDF／Excel）は①と共通で作るので、仕様書§9 の手順11で足す。

■ 「通るテスト」は安全網にならない
  下の壊し方は、どれも「見た目は正しいコード」になる。
  目で読んで気づけないから、実際に壊して落ちることを確かめる。

■ 壊し方を書くときの2つの注意（①で両方踏んだ）
  1. **構文エラーにしない。**
     生成物の構文検査が先に落ちて、狙った検査が働いたのか分からなくなる。
  2. **落ちたときの理由が、1件ずつ区別できるようにする。**
     同じ文面を2つの検査に使うと、片方を外しても壊し検査が素通りする。
     だから expect には、その検査だけが出す文字列を書く。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGETS = [
    'test/timetable-run.test.js',
    'test/timetable-rules.test.js',
    'test/timetable-page.test.js',
    'test/timetable-mock.test.js',
    'test/admin-help.test.js',
    'test/admin.test.js',
]


def run():
    # 画面の検査は admin.html を読むものがある。src/build-admin.js を壊したら、
    # **作り直さないと効かない**（生成物を見る検査の落とし穴）
    b = subprocess.run(['node', 'src/build-admin.js'], cwd=R, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', shell=True)
    if b.returncode != 0:
        # 組み立てが落ちること自体が「壊れた」証拠。理由をそのまま返す
        return False, (b.stdout or '') + (b.stderr or '')
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
        print('  [??] 理由違い …', label, '／ 期待:', expect)
        return False
    print('  [OK] 落ちた …', label)
    return True


T = 'gas/Timetable.gs'
U = 'src/timetable-rules.js'
A = 'src/build-admin.js'

CASES = [
    # ── §7-4 の 1 ─────────────────────────────────────
    # 署名を見ずに版番号だけ見ると、**画面が「12です」と言うだけで通る**。
    # 版番号は小さい整数なので、読んでいなくても当てられる
    ('券の署名の照合を外す（版番号だけ見る）', [
        (T, "  if (!safeEquals_(ttHmac_(parts[0]), parts[1])) {",
            "  if (false) {"),
    ], '署名が違う券が通りました'),

    # ── §7-4 の 2 ─────────────────────────────────────
    # 鍵が同じだと、一括削除の券でこのAPIに入れる（逆も）
    ('券の鍵を |purge と同じにする', [
        (T, "Utilities.computeHmacSha256Signature(text, authSecret_() + '|timetable')",
            "Utilities.computeHmacSha256Signature(text, authSecret_() + '|purge')"),
    ], '|purge の鍵で作った券が通りました'),

    # ── §7-4 の 3 ─────────────────────────────────────
    ('版が進んでいても保存するようにする', [
        (T, "  if (Number(payload.v) !== Number(version)) {\n"
            "    return { ok: false, error: 'conflict' };\n  }",
            "  if (false) {\n    return { ok: false, error: 'conflict' };\n  }"),
    ], '版が進んでいるのに保存されました'),

    # ── §7-4 の 4 ─────────────────────────────────────
    # 1行ずつ検証して、通ったものだけ書く形にすると、
    # **一部だけ保存されて残りが消える**（まるごと差し替えなので）
    ('1行だけ不正でも、残りを書くようにする', [
        (T, "    var v = validateTimetableRows_(payload && payload.rows);\n"
            "    if (v.message) return { ok: false, error: 'bad_value', message: v.message };\n"
            "    var rows = v.value;",
            "    var v = validateTimetableRows_(payload && payload.rows);\n"
            "    var rows = v.value || [];"),
    ], '通らない行があるのに保存されました'),

    # ── §7-4 の 5 ─────────────────────────────────────
    # 「隙間なく続いている一連のもの」を「同じレーンの後ろ全部」にすると、
    # **1時間空いた先の予定まで動く**。組み直した人には理由が分からない
    ('ずらしが隙間を無視して、後ろを全部動かすようにする', [
        (U, "      if (ttMinutes(r.start) !== at) continue;",
            "      if (ttMinutes(r.start) < at) continue;"),
    ], '隙間があるのにずらしが止まりませんでした'),

    # ── §7-4 の 6 ─────────────────────────────────────
    ('ずらしがロックを押し出すようにする', [
        (U, "    if (next.locked) return { moved: moved, stopped: 'locked' };",
            "    if (false) return { moved: moved, stopped: 'locked' };"),
    ], 'ロックされた予定が押し出されました'),

    # ── §7-4 の 7 ─────────────────────────────────────
    # オープニングを10分伸ばしたら、ゲートオープン（全体）まで動く形
    ('ずらしがレーンをまたぐようにする', [
        (U, "      if (r.id === skipId || r.lane !== lane) continue;",
            "      if (r.id === skipId) continue;"),
    ], 'ずらしがレーンをまたぎました'),

    # ── §7-4 の 8 ─────────────────────────────────────
    # 素の {} は constructor を持っている。レーンに constructor と書くだけで通る
    ('レーンの許可リストを、素のオブジェクトの照合に戻す', [
        (T, "    if (TT_LANES_.indexOf(lane.value) < 0) {",
            "    var __lanes = {}; TT_LANES_.forEach(function (x) { __lanes[x] = 1; });\n"
            "    if (!__lanes[lane.value]) {"),
    ], 'constructor がレーン名として通りました'),

    # ── §7-4 の 9 ─────────────────────────────────────
    # 「数字以外を捨てて Number()」は、この案件が何度も刺されてきた形
    #（Number('') が 0 ／全角数字が 0 ／-500 が 500）
    ('時刻の検証を「数字以外を捨てて Number()」に戻す', [
        (T, "  var m = String(s == null ? '' : s).match(/^([01]?\\d|2[0-3]):([0-5]\\d)$/);\n"
            "  if (!m) return null;\n"
            "  return Number(m[1]) * 60 + Number(m[2]);",
            "  var d = String(s == null ? '' : s).replace(/[^0-9]/g, '');\n"
            "  if (!d) return null;\n"
            "  return Number(d.slice(0, 2)) * 60 + Number(d.slice(2, 4) || '0');"),
    ], '時刻でないもの'),

    # ── §7-4 の 11 ────────────────────────────────────
    # トーストは数秒で消える。離席中に流れると「保存されたつもり」になる
    ('断られたときに、帯ではなくトーストで出すようにする', [
        (A, "  b.hidden = false;\n  TT.pending = r;",
            "  toast('保存できませんでした', true);\n  TT.pending = r;"),
    ], 'ぶつかりをトーストで出しています'),

    # ── §7-4 の 12 ────────────────────────────────────
    ("HOWTO['tt'] を消す", [
        (A, "  tt: ['タイムスケジュールの見かた', [",
            "  ttDisabled: ['タイムスケジュールの見かた', ["),
    ], "HOWTO['tt'] がありません"),

    # ── §7-4 の 13 ────────────────────────────────────
    # 60秒ごとに全員がシートへ書くと、そのぶん保存が詰まる。
    # **見えるだけのもののために、保存を遅くしない**
    ('札をシートに書くようにする', [
        (T, "    try {\n"
            "      CacheService.getScriptCache().put(TT_EDITORS_KEY_, JSON.stringify(all), TT_LEASE_SEC_ * 2);\n"
            "    } catch (e) { logError_('adminTimetableHeartbeat_', e); }",
            "    try {\n"
            "      ttSetConfig_(TT_EDITORS_KEY_, JSON.stringify(all));\n"
            "      CacheService.getScriptCache().put(TT_EDITORS_KEY_, JSON.stringify(all), TT_LEASE_SEC_ * 2);\n"
            "    } catch (e) { logError_('adminTimetableHeartbeat_', e); }"),
    ], 'シートに書き込んでいます'),

    # ── §7-4 の 14 ────────────────────────────────────
    # 直書きすると、レーンを足したときに**そこだけ古いまま**になる
    ('画面にレーン名を直書きする', [
        (A, "  var cols = '56px repeat(' + Math.max(TT.lanes.length, 1) + ', minmax(132px, 1fr))';",
            "  var __lanes = ['全体', 'イベント', '備考'];\n"
            "  var cols = '56px repeat(' + Math.max(__lanes.length, 1) + ', minmax(132px, 1fr))';"),
    ], 'が画面に直書きされています'),

    # ── 仕様書には無いが、実装中に決めたこと ────────────────
    # 検証を先にすると、**券を持たない人が「何を送ると通るか」を試せる**
    ('券の照合より先に、行の検証をするようにする', [
        (T, "    var version = ttVersion_();\n"
            "    var ng = ttTicketError_(payload && payload.ticket, version);\n"
            "    if (ng && ng.error === 'conflict') return ttConflict_(version);\n"
            "    if (ng) return ng;\n\n"
            "    var v = validateTimetableRows_(payload && payload.rows);\n"
            "    if (v.message) return { ok: false, error: 'bad_value', message: v.message };\n"
            "    var rows = v.value;",
            "    var v = validateTimetableRows_(payload && payload.rows);\n"
            "    if (v.message) return { ok: false, error: 'bad_value', message: v.message };\n"
            "    var rows = v.value;\n\n"
            "    var version = ttVersion_();\n"
            "    var ng = ttTicketError_(payload && payload.ticket, version);\n"
            "    if (ng && ng.error === 'conflict') return ttConflict_(version);\n"
            "    if (ng) return ng;"),
    ], '券が無いのに、行の中身を先に見ています'),

    # 保存したのに版を進めないと、**次の保存が黙って通る**。
    # ぶつかりの検出そのものが働かなくなる
    ('保存しても、版を進めないようにする', [
        (T, "    var next = version + 1;\n    ttSetConfig_(TT_VERSION_KEY_, next);",
            "    var next = version + 1;\n    if (false) ttSetConfig_(TT_VERSION_KEY_, next);"),
    ], '版が1つ進みませんでした'),

    # 0分の予定（時刻だけの目印）を帯として扱うと、
    # その時刻に始まる予定と必ず重なって、**警告が意味を失う**
    ('0分の目印も、帯として重なりを見るようにする', [
        (U, "    if (e === null || e <= s) continue;        // 0分の目印は帯にしない",
            "    if (e === null) continue;"),
    ], '重なりの印が付いてはいけないものに付きました'),

    # 「隣り合っている」（終わりと始まりが同じ分）を重なりにすると、
    # 隙間なく組んだ時間割が**全部警告になる**
    ('隣り合っているだけのものを、重なりとして扱う', [
        (U, "      if (item && cluster.length && item.s < clusterEnd) {",
            "      if (item && cluster.length && item.s <= clusterEnd) {"),
    ], '隣り合っているだけで重なり扱いになりました'),

    # 詳細度で負ける形に戻す。**HTMLもJSも正しいのにCSSだけで機能が死ぬ**
    ('hidden 属性が負ける形に戻す（!important を外す）', [
        (A, "[hidden]{display:none!important}", "[hidden]{display:none}"),
    ], '[hidden]{display:none!important} がありません'),

    # 未定義の var() は、その宣言を**まるごと**無効にする（線が消える）
    ('CSSの変数名を、定義されていないものに戻す', [
        (A, ".sch-chip{background:#fff;border:1px solid var(--border)",
            ".sch-chip{background:#fff;border:1px solid var(--line)"),
    ], '定義されていないCSS変数があります'),

    # 模擬が本番より緩いと、「模擬で通るのに本番で落ちる」が起きる
    ('模擬が、本番の検証を通さずに保存するようにする', [
        ('src/mock.js', "    case 'adminTimetableSave':      return ttCall('adminTimetableSave_', auth, payload);",
            "    case 'adminTimetableSave':      return { ok: true, version: 99, ticket: 'x', rows: payload.rows };"),
    ], 'レーン'),
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
