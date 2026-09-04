"""① 制作スケジュール表の歯止めを、わざと壊して確かめる。

使い方：  python test/break_sched.py     （npm run break が自動で拾う）

■ 仕様書
  docs/internal/design_schedule_plan.md §5-4 に、足すべき壊し方が12通り書いてある。
  **サーバー側の分は入れ終えた。**
  まだ無いのは**画面を作ってから足す分**：
    5・6・6b … 「終わったもの ◯件を表示」の判定（未着手を含めない／期日前の完了を含めない／
                0件ならボタンを出さない）
    7 …… 曜日を列として持つように戻す（いまは表示形式 m/d(ddd)）
    10 … 遅れの判定を端末の日付にする（サーバーの today を使っているか）
    11 … HOWTO['sched'] を消す
    12 … 画面に領域名・ステータス名を直書きする

■ リンク化（1〜3）が先に在る理由
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
TARGETS = ['test/linkify.test.js', 'test/sched.test.js']


def run():
    # 画面の検査は admin.html を読む。src/build-admin.js を壊したら、
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
        print('  [??] 理由違い …', label)
        return False
    print('  [OK] 落ちた …', label)
    return True


F = 'src/linkify.js'
S = 'gas/Sched.gs'
M = 'src/mock.js'
# 画面のコードは src/build-admin.js の中にある（admin.html は生成物）。
# 壊したら作り直さないと効かないので、run() が毎回ビルドする
A = 'src/build-admin.js'
B = 'src/build-admin.js'

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

    # ── 仕様書 §5-4 の 4：許可リストを素の {} に戻す ───────
    ('種類の照合を、配列から素の {} に戻す', [
        (S, 'if (SCHED_KINDS_.indexOf(kind) < 0) {',
            "if (!({ 'タスク': 1, '期間': 1, 'マイルストーン': 1 })[kind]) {"),
    ], 'kind に constructor が通りました'),

    ('担当者の入れ物を、親を持つ素の {} に戻す', [
        (S, 'var byName = Object.create(null);', 'var byName = {};'),
    ], '担当者に constructor が通りました'),

    ('担当者の実在チェックを外す', [
        (S, 'if (!(name in people.byName)) {', 'if (false) {'),
    ], '知らない担当者が通りました'),

    ('担当者の所属を、担当会社に足さなくする', [
        (S, 'chosen.forEach(function (p) {', '[].forEach(function (p) {'),
    ], '担当者の所属が担当会社に足されていません'),

    # ── 仕様書 §5-4 の 8：完了日の自動記入 ──────────────
    ('完了にしても完了日を入れない', [
        (S, 'if (schedSettled_(item.status)) {', 'if (false) {'),
    ], '完了にしたのに完了日が入りません'),

    ('手で入れた完了日を、毎回今日で上書きする', [
        (S, "var prev = before ? schedDate_(before[10]) : '';", "var prev = '';"),
    ], '手で入れた値を上書きしました'),

    # ── 仕様書 §5-4 の 9：削除が全文を残す ────────────────
    ('削除の履歴に、タスク名だけしか残さない', [
        (S, "JSON.stringify(full), '', '');", "full['タスク名'], '', '');"),
    ], '詳細が履歴に残っていません'),

    # ── 期間の前後関係 ────────────────────────────────
    ('期間の「終了日が開始日より前」の検査を外す', [
        (S, 'if (end.value < date.value) {', 'if (false) {'),
    ], '終了日が開始日より前の期間が通りました'),

    # ── 移行（§5-3-10）────────────────────────────────
    ('移行で、元のシートを消す（名前を変えるだけにしない）', [
        (S, '      src.setName(name);', '      if (false) src.setName(name);'),
    ], '元シートの名前を変えていません'),

    ('移行で、関係者にいない名前も担当者に入れる', [
        (S, 'if (owner && (owner in people.byName)) {', 'if (owner) {'),
    ], '知らない名前が担当者に入りました'),

    ('移行の件数をログに出さない', [
        (S, "console.log('確認事項から制作スケジュールへ '", "if (moved) console.log('確認事項から制作スケジュールへ '"),
    ], 'ログが1行も出ていません'),

    # ── 検証役2体の指摘（2026-09-04）で足した歯止め ────────────
    # 行を「何行目か」だけで指すと、他人が1行消した瞬間に
    # 別のタスクを上書き・削除してしまう（ok:true が返る）
    ('行のIDを照合せず、行番号だけで指す', [
        (S, '  if (id && here === id) return { row: row, values: values };',
            '  return { row: row, values: values };'),
    ], '消えた行への保存が通りました'),

    ('IDが合わないとき、探し直さずに黙って書く', [
        (S, "  if (!id) {\n    return { error: 'stale',",
            "  if (true) {\n    return { row: row, values: values };\n  }\n  if (!id) {\n    return { error: 'stale',"),
    ], 'IDなしの更新が通りました'),

    ('更新を変更履歴に残さない', [
        (S, '    if (beforeText !== afterText) {', '    if (false) {'),
    ], '更新が履歴に残っていません'),

    ('担当会社の件数の上限を外す', [
        (S, '  if (given.length > SCHED_LIST_MAX) {', '  if (false) {'),
    ], '3000社が通りました'),

    ('担当者の件数の上限を外す', [
        (S, '  if (list.length > SCHED_LIST_MAX) {', '  if (false) {'),
    ], '3000人が通りました'),

    ('日付を asText_ で読む（Date が「2026-09-20 00:00」に化ける）', [
        (S, "      date:      schedDate_(r[idx['日付']]),",
            "      date:      asText_(r[idx['日付']]).trim(),"),
    ], 'date が化けました'),

    ('移行済みの印を見ない（setup() の2回目で確認事項が復活する）', [
        (S, '  return !!ss.getSheetByName(SCHED_TODO_DONE_);', '  return false;'),
    ], '移行済みの印を見つけられません'),

    ('改名先の衝突を避けない（3回目の setup() が例外で止まる）', [
        (S, '      for (var n = 2; ss.getSheetByName(name); n++) name = SCHED_TODO_DONE_ + n;',
            '      name = SCHED_TODO_DONE_;'),
    ], 'は既にあります'),

    # 模擬が本番より緩い／そもそも動かない形
    ('模擬の切り出しで、改行の正規化をやめる', [
        (M, "  const src = norm(fs.readFileSync(path.join(ROOT, 'gas', 'Sched.gs'), 'utf8'));\n"
            "  const adminSrc = norm(fs.readFileSync(path.join(ROOT, 'gas', 'Admin.gs'), 'utf8'));",
            "  const src = fs.readFileSync(path.join(ROOT, 'gas', 'Sched.gs'), 'utf8');\n"
            "  const adminSrc = fs.readFileSync(path.join(ROOT, 'gas', 'Admin.gs'), 'utf8');"),
    ], 'を切り出せませんでした'),

    ('模擬が、行のIDを照合しない', [
        (M, '  if (id && here === id) return { i };', '  return { i };'),
    ], '2回目が通りました'),

    # UTC に戻す壊し方だと、JST 09:00〜24:00 のあいだは同じ日付になり落ちない
    # （最初そう書いて、実際に落ちなかった）。必ず違う日にして、いつ流しても効くようにする
    # ── 型を見る（2026-09-04 の検証で指摘）────────────────
    ('文字の欄を asText_ で読む（{} が「[object Object]」になる）', [
        (S, "  if (t !== 'string') return { message: label + 'を読み取れませんでした。' };",
            "  if (t !== 'string') return { value: String(v) };"),
    ], 'object の値が通りました'),

    ('row を Number(...)||0 に戻す（読めない row が新規追加になる）', [
        (S, "  if (typeof raw !== 'number' && typeof raw !== 'string') {",
            "  if (false) {"),
        (S, "  if (!isFinite(n) || n !== Math.floor(n) || n < 0 || String(raw).trim() === '') {",
            "  if (false) {"),
    ], 'が通りました'),

    ('日付の前後を固定しない（文字列の一部から拾う）', [
        (S, r"  var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);",
            r"  var m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);"),
    ], 'が通りました'),

    ('実在しない日付の検査を外す（2026-02-31 が通る）', [
        (S, '  if (mo < 1 || mo > 12 || da < 1 || da > days[mo - 1]) {',
            '  if (mo < 1 || mo > 12 || da < 1 || da > 31) {'),
    ], '2026-02-31 が通りました'),

    ('マイルストーンの日付を必須にしない', [
        (S, "  if (kind === 'マイルストーン' && !date.value) {", '  if (false) {'),
    ], '日付のないマイルストーンが通りました'),

    # 以前の書き方（item = item || {} で先へ進む）に戻すと、
    # payload が壊れているのに「領域が…」と返る
    ('送られた内容の形を確かめない（理由が「領域」になる）', [
        (S, "  if (item === null || item === undefined || typeof item !== 'object'\n"
            "      || Array.isArray(item)) {\n"
            "    return { message: '送信された内容を読み取れませんでした。'\n"
            "                    + '画面を読み込み直してから、もう一度お願いします。' };\n"
            "  }",
            '  item = item || {};'),
    ], '関係のない「領域」が理由に出ました'),

    # ── 画面（仕様書 §5-4 の 5・6・6b・7・10・11・12）────────
    # 画面を壊したあとは admin.html を作り直さないと効かない
    ('「終わったもの」の判定に、未着手を含める', [
        (A, "  var settled = (r.status === '完了' || r.status === '見送り');",
            "  var settled = true;"),
    ], 'が「終わったもの」に入りました'),

    ('「終わったもの」の判定に、期日前の完了も含める', [
        (A, "  return settled && !!r.date && r.date < SCH.today;",
            "  return settled;"),
    ], '期日前の完了が隠れました'),

    ('隠れているものが0件でも、ボタンを出す', [
        (A, '  db.hidden = doneCount === 0;', '  db.hidden = false;'),
    ], '0件のときにボタンを隠していません'),

    ('ボタンから件数を落とす', [
        (A, "'終わったもの ' + doneCount + '件を表示'", "'終わったものを表示'"),
    ], 'ボタンに隠れている件数が出ていません'),

    ('遅れの判定を、端末の日付にする', [
        (A, '  return r.date < SCH.today;',
            "  return r.date < new Date().toISOString().slice(0, 10);"),
    ], 'サーバーの today を無視して'),

    ('「あと3日」の注意を、進行中にも出す', [
        (A, "  if (r.status !== '未着手' && r.status !== '停滞中') return false;",
            '  if (false) return false;'),
    ], '進行中にまで注意が出ています'),

    ('HOWTO を消す', [
        (B, "  sched: ['制作スケジュール表の見かた', [", "  schedX: ['制作スケジュール表の見かた', ["),
    ], 'HOWTO がありません'),

    ('画面に、ステータスの一覧を直書きする', [
        (B, "  fill('#schStat', SCH.statuses, row ? row.status : '未着手');",
            "  fill('#schStat', ['未着手','進行中','確認中','完了','停滞中','見送り'], row ? row.status : '');"),
    ], 'ステータスの一覧が画面に直書きされています'),

    ('hidden を効かせる規則を消す（種類がタスクでも終了日の欄が出る）', [
        (B, '.editrow[hidden],.grp[hidden],.sch-bar[hidden],.sch-terms[hidden]{display:none}',
            '/* 消した */'),
    ], 'hidden を付けても消えません'),

    ('詳細のリンク化を、素の esc で済ませる', [
        (B, "linkifyDetail(r.detail, esc)", "esc(r.detail)"),
    ], '詳細の描画が linkifyDetail を通っていません'),

    ('模擬の「今日」を、時差のある基準に戻す', [
        (M, "        today: nowText().slice(0, 10),   // 日本時間。本番は Asia/Tokyo",
            "        today: new Date(Date.now() - 86400000).toISOString().slice(0, 10),"),
    ], '模擬の today が日本時間ではありません'),
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
