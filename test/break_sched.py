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
TARGETS = ['test/linkify.test.js', 'test/sched.test.js',
           'test/sched-import.test.js', 'test/sched-import-mock.test.js',
           'test/sched-page.test.js', 'test/stamp.test.js']


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
I = 'gas/SchedImport.gs'      # Excelの取り込み
P = 'gas/Stamp.gs'            # 「最後に誰がいつ」（②と共有）

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

    # 2026-09-07、「中身が変わらなければ書かない」を入れたときに
    # この辺りを書き換えたので、目印も付け替えた
    ('更新を変更履歴に残さない', [
        (S, "    appendHistory(auth.person, '（スケジュール）', '更新', beforeText, afterText, '');",
            "    if (false) appendHistory(auth.person, '（スケジュール）', '更新', '', '', '');"),
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
    # 正規化を「外す」だけでは落ちないことがある。gas/Admin.gs は改行が**混在**
    # していて、CRLF のまま探しても LF だけの行にたまたま当たり、
    # **別の場所まで含んだ大きな塊**が切り出されてしまう（それでも動く）。
    # だから確実に壊れる形（全部 CRLF にする）で確かめる。
    # ——「外しても落ちなかった」ので、この検査自体を作り直した（2026-09-04）
    # 2026-09-07：`norm` は src/mock.js の先頭に**1つだけ**になった
    # （以前は箱ごとに4つ写されていて、`swap` が最初の1件しか置き換えないため、
    #   5つ目を足した瞬間に狙いと違う箱を壊していた）。
    # おかげでこの1件が**模擬のすべての箱**を守るようになったが、
    # 落ちる文言は「先に読み込まれた箱」のものになる。
    # 箱を足す順が変わっても効くよう、切り出しの失敗そのものを見る。
    ('模擬の切り出しで、改行の正規化を逆にする', [
        (M, "const norm = t => t.split('\\r\\n').join('\\n');",
            "const norm = t => t.split('\\n').join('\\r\\n');"),
    ], '見つかりません'),

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

    # ── ダッシュボードへの合流／警告日数（§4-4・§4-8）────────
    ('警告日数を、読めないとき 0 に倒す（まもなくの色が一度も出なくなる）', [
        (S, 'return SCHED_WARN_DEFAULT_;', 'return 0;'),
    ], 'で既定に落ちません'),

    ('画面に警告日数を直書きする（設定が効かなくなる）', [
        (B, '  return schDayDiff(SCH.today, r.date) <= (SCH.warnDays || 3);',
            '  return schDayDiff(SCH.today, r.date) <= 3;'),
    ], '画面が設定の日数を見ていません'),

    ('サーバーが警告日数を返さない', [
        (S, '    warnDays: schedWarnDays_(),', ''),
    ], 'warnDays を返していません'),

    ('ダッシュボードの帯を、押して編集できるようにする', [
        (B, "schPaintTerms($('#dashTerms'), now, false)",
            "schPaintTerms($('#dashTerms'), now, true)"),
    ], 'ダッシュボードの帯が押せる形になっています'),

    ('リンクの言葉を、飛び先と関係なく「一覧で見る」にする', [
        (B, "            : to.indexOf('tab:') === 0 ? tabLabel(to.slice(4)) + 'で見る →'\n",
            ''),
    ], '飛び先の名前をリンクに使っていません'),

    ('ステータスを、押すたびの順送りに戻す', [
        (B, 'if (r1) schStatusMenu(st, r1); return; }',
            'if (r1) schSetStatus(r1, SCH.statuses[(SCH.statuses.indexOf(r1.status)+1)%SCH.statuses.length]); return; }'),
        (B, 'function schStatusMenu(btn, row){', 'function schCycleStatus(btn, row){'),
    ], '選択肢を出す処理がありません'),

    ('ステータスの選択肢を、画面に直書きする', [
        (B, "m.innerHTML = SCH.statuses.map(function(s){",
            "m.innerHTML = ['未着手','進行中','確認中','完了','停滞中','見送り'].map(function(s){"),
    ], '選択肢を画面が自前で持っています'),

    # **構文エラーにしない**壊し方にすること。括弧が合わない形にすると、
    # 「生成物の構文検査」が先に落ちて、狙った検査が働いたのか分からなくなる
    # （最初 void(0 && …) で囲んで、理由が違うまま通った）
    ('前回の領域を覚えない（文字列は残したまま働かなくする）', [
        (B, "  try { localStorage.setItem(SCH_AREA_KEY, $('#schArea').value || ''); } catch(e){}",
            "  try { if (false) localStorage.setItem(SCH_AREA_KEY, ''); } catch(e){}"),
    ], '選んだ領域を記憶していません'),

    ('模擬の「今日」を、時差のある基準に戻す', [
        (M, "        today: nowText().slice(0, 10),   // 日本時間。本番は Asia/Tokyo",
            "        today: new Date(Date.now() - 86400000).toISOString().slice(0, 10),"),
    ], '模擬の today が日本時間ではありません'),

    # ── Excelの取り込み（design_sched_import.md §6-2）────────────
    # 一時ファイルの消し忘れは**静かな事故**。Driveが散らかるだけでなく、
    # 台帳の中身がそのまま残る（資料フォルダは全共有）
    ('取り込みの一時ファイルの削除を消す（finally を外す）', [
        (I, "      try { DriveApp.getFileById(id).setTrashed(true); }",
            "      try { if (false) DriveApp.getFileById(id).setTrashed(true); }"),
    ], '一時ファイルが残っています'),

    # 消せなかったことを黙って流すと、Driveに中身が残ったままになる
    ('取り込みの片づけの失敗を、黙って流すようにする', [
        (I, "        if (out) out.leftover = true;", "        if (false) out.leftover = true;"),
    ], '消し漏れを伝えていません'),

    # Excelで行をコピーするとIDも複製される。**これは必ず起きる**
    ('同じIDが2行あっても通すようにする', [
        (I, "      if (seen[id]) {\n"
            "        problems.push({ field: 'ID', why: '同じIDの行が2つあります。'\n"
            "          + '新しく足すなら、ID列を空にしてください。' });\n"
            "      }",
            "      if (false) {\n"
            "        problems.push({ field: 'ID', why: '同じIDの行が2つあります。' });\n"
            "      }"),
    ], '同じIDが2行あるのに通っています'),

    # 黙って復活させると、消したはずの行が戻ってくる
    ('台帳に無いIDを、黙って追加するようにする', [
        (I, "      if (!ledger[id]) {\n"
            "        // **黙って復活させない**\n"
            "        problems.push({ field: 'ID', why: 'この行は台帳から削除されています。'\n"
            "          + '新しく足すなら、ID列を空にしてください。' });\n"
            "      }",
            "      if (false) {\n"
            "        problems.push({ field: 'ID', why: 'この行は台帳から削除されています。' });\n"
            "      }"),
        # 素朴な実装は「台帳に無ければ新規」と書く。例外にはしない
        (I, "    } else {\n"
            "      used[id] = true;\n"
            "      action = (schedImportItemKey_(v.value)",
            "    } else if (!ledger[id]) {\n"
            "      action = 'add';\n"
            "    } else {\n"
            "      used[id] = true;\n"
            "      action = (schedImportItemKey_(v.value)"),
    ], '台帳に無いIDを、黙って追加しようとしています'),

    # まるごと差し替えではないので、一部だけ入ると Excel と台帳がずれる
    ('1行だけ不正でも、残りを書くようにする', [
        (I, "    if (bad.length) {", "    if (false) {"),
        # 「通った行だけ書く」という、いかにも親切そうな形にする
        (I, "      if (x.action === 'same') return;          // 触らない（更新者も塗り替えない）",
            "      if (x.action === 'same' || x.action === 'bad') return;"),
    ], '通らない行があるのに保存されました'),

    # ①は全員が触れる。Excelに無い行を消すと、他の人が足した行が黙って消える
    ('Excelに無い行を消すようにする', [
        # 「Excelがそのまま台帳になる」という、よくある思い込みの形
        (I, "    var added = 0, updated = 0;",
            "    var added = 0, updated = 0;\n"
            "    plan.missing.forEach(function (m) {\n"
            "      var gone = schedImportFindRow_(sh, m.id);\n"
            "      if (gone) sh.deleteRow(gone);\n"
            "    });"),
    ], 'が消えました（Excelに無い行は消さない決まりです）'),

    # 「実行時の再検証を外す」は、**壊しようがない**ので置かない。
    # 画面は判定（action）を送らず、生の行だけを送るので、
    # サーバーは必ず自分で組み立て直す。上の「1行だけ不正でも書く」が同じ穴を見ている。

    # 「変わらない」を判定しないと、全部が「更新」になって更新者が塗り替わる
    ('比べる欄に、更新者と更新日時を混ぜる', [
        (I, "var SCHED_IMPORT_COMPARE_ = ['種類', '日付', '終了日', '領域', '担当会社', '担当者',\n"
            "                            'タスク名', '詳細', 'ステータス', '備考'];",
            "var SCHED_IMPORT_COMPARE_ = ['種類', '日付', '終了日', '領域', '担当会社', '担当者',\n"
            "                            'タスク名', '詳細', 'ステータス', '備考',\n"
            "                            '更新者', '更新日時'];"),
    ], '更新者・更新日時・並び順の違いを「更新」に数えています'),

    # 画面の accept だけに頼ると、CSVを投げ込まれて文字化けする
    ('拡張子の検査を外す（画面の accept だけに頼る）', [
        (I, "  if (!/\\.xlsx$/i.test(String(fileName || ''))) {",
            "  if (false) {"),
    ], 'が通っています'),

    # 大きさを Drive に触ってから見ると、無駄なファイルが作られる
    ('大きさの検査を、Driveに触ったあとに動かす', [
        (I, "  if (b64.length * 0.75 > SCHED_IMPORT_MAX_BYTES) {", "  if (false) {"),
    ], '大きすぎるファイルが通っています'),

    # ── 「最後に誰がいつ」（§5）─────────────────────────
    # 開いて閉じただけで記録されると、けいたが求めた「編集してなければ記録せず」が破れる
    ('中身が同じでも、更新者・更新日時を書き換えるようにする', [
        ('gas/Sched.gs',
            "    if (beforeText === afterText) return { ok: true, added: false, unchanged: true };",
            "    if (false) return { ok: true, added: false, unchanged: true };"),
    ], '中身が同じなのに更新者が書き換わりました'),

    # キャッシュ越しに読むと、書いた直後に古い値が返る
    ('記録の読み取りを、設定のキャッシュ越しにする', [
        (P, "function configRaw_(key) {\n"
            "  var sh = sheet_(SHEET.CONFIG);\n"
            "  var row = findConfigRow_(sh, key);\n"
            "  if (!row) return '';\n"
            "  return sh.getRange(row, 2).getValue();",
            "function configRaw_(key) {\n"
            "  return configText(key, '');\n"
            "  var sh = sheet_(SHEET.CONFIG);\n"
            "  var row = findConfigRow_(sh, key);\n"
            "  if (!row) return '';\n"
            "  return sh.getRange(row, 2).getValue();"),
    ], 'キャッシュ越しに読んでいます'),

    # 名前に | が入ると、素朴に split すると時刻を読み違える
    ('記録の区切りを、最初の | で見るようにする', [
        (P, "  var i = raw.lastIndexOf('|');", "  var i = raw.indexOf('|');"),
    ], 'AssertionError'),

    # 赤があっても押せると、通らない行をそのまま送ってしまう
    ('赤があっても「取り込む」を押せるようにする', [
        (A, "  $('#schImpGo').disabled = !!c.bad || !!IMP.busy;",
            "  $('#schImpGo').disabled = false;"),
    ], '赤があっても「取り込む」を押せます'),

    # ── ここから、検証役3体（2026-09-07）が見つけた穴の歯止め ──

    # 送信中の印をボタンに直接立てると、描き直しで消えて二重に入る
    ('送信中かどうかを、描き直しのときに見ないようにする', [
        (A, "  $('#schImpGo').disabled = !!c.bad || !!IMP.busy;",
            "  $('#schImpGo').disabled = !!c.bad;"),
    ], '描き直しのときに、送信中かどうかを見ていません'),

    # 閉じたあとに届いた返事で、下見が復活して二度押しできてしまう
    ('遅れて返ってきた見直しを、そのまま受け取るようにする', [
        (A, "    if (seq !== IMP.seq || !IMP.items.length) return;", "    if (false) return;"),
    ], '古い返事を捨てていません'),

    # 記録の帯は、サーバーが返さなければ画面に出ない
    ('記録の帯を、サーバーが返さないようにする', [
        (S, "    stamps: {", "    stampsUnused_: {"),
    ], 'stamps を返していません'),

    # 台帳のID重複を見逃すと、関係のない行が丸ごと消える
    ('台帳に同じIDが2つあっても、そのまま更新するようにする', [
        (I, "      if (dupInLedger[id]) {", "      if (false) {"),
    ], '同じIDが2つあるのに、そのまま更新しようとしています'),

    # ※「台帳のIDを後勝ちで覚えるように戻す」は、壊し方として入れなかった。
    #   dupInLedger で赤にして止めているので、どちらで覚えても書き込みに届かない。
    #   落ちない壊し方を並べると「守れている」に見えるだけで、何も確かめていない。

    # 上限を取り込みのときだけ見ると、直し終えてから断られる
    ('行数の上限を、読むときに見ないようにする', [
        (I, "    if (rows.length > SCHED_IMPORT_ROWS_MAX) {\n"
            "      return { message: '一度に取り込めるのは'",
            "    if (false) {\n"
            "      return { message: '一度に取り込めるのは'"),
    ], '205行が下見に出てしまいました'),

    # 断る道で out を作らないと、消し漏れが黙って捨てられる
    ('断るときは、消し漏れを伝えないようにする', [
        (I, "      out = { ok: false, leftover: false, message: got.message };\n"
            "      return out;",
            "      return { ok: false, message: got.message };"),
    ], '断ったときは、消し漏れが黙って捨てられています'),

    # ID列が無いと、台帳にある行が全部「追加」になって二重になる
    ('ID列が無くても読めるようにする', [
        (I, "  if (headers.indexOf('ID') < 0) {", "  if (false) {"),
    ], 'ID列が無いのに読めています'),

    # 「正しくありません」だけでは、Excelを直す人は何に直せばいいか分からない
    ('選べない値の断り文から、選択肢を消す', [
        (S, "  return label + '「' + asText_(given) + '」は使えません。'\n"
            "       + list.join('・') + ' のどれかにしてください。';",
            "  return label + 'が正しくありません。';"),
    ], 'どの値が駄目なのかが書かれていません'),

    # 直す場所と赤いところが違うと、人は直しようがない
    ('開始日の言い換えを、知らないようにする', [
        (I, "  if (m.indexOf('開始日') >= 0) return '日付';", "  if (false) return '日付';"),
    ], '開始日が空なのに、日付のセルが赤くなりません'),

    # 取り込みで巻き戻された中身を、あとから追えなくなる
    ('取り込みの更新で、前の中身を残さないようにする', [
        (I, "      undo.push({ before: JSON.stringify(schedRowObject_(was)),",
            "      if (false) undo.push({ before: JSON.stringify(schedRowObject_(was)),"),
    ], '書き換えた行の全文が残っていません'),

    # 理由が出ないと、「押すと直せます」と言われて開いたパネルが無言になる
    ('下見を開いても、理由を出さないようにする', [
        (A, "    schImpWhy(x);", "    if (false) schImpWhy(x);"),
    ], '行を開いたときに理由を出していません'),

    # 上書きの前に止めないと、他人の直しが黙って消える
    ('書き換える前の確認をやめる', [
        (A, "  if (c.update && !confirm(", "  if (false && !confirm("),
    ], '書き換える前に止めていません'),

    # 入室切れの合図を、そのまま赤いトーストに出してしまう
    ('取り込みの通信の失敗を、生のまま出すようにする', [
        (A, "        toastDone(); netFail(e, 'Excelを読めませんでした');",
            "        toastDone(); toast(String(e && e.message || e), true);"),
    ], 'が、通信の失敗を生のまま出しています'),

    # 判定を画面に写すと、サーバーと規則がズレる
    # 2026-09-08、取り込みに replace を足したときに目印がずれた。
    # **引数まで含めた目印は、引数が増えると必ず壊れる。**
    # action の名前だけを目印にする
    ('直したあとの見直しを、画面でやるようにする', [
        (A, "  api('adminSchedImportRead', { rows: rows,",
            "  api('adminSched', { rows: rows,"),
    ], '直したあとの見直しを、画面でやっています'),

    # 下見を直しただけで台帳が書き換わってはいけない
    ('取り込みの編集でも、台帳に保存するようにする', [
        (A, "  if (IMP.editing !== null && IMP.editing !== undefined){",
            "  if (false){"),
    ], '取り込みの編集と、台帳の保存を見分けていません'),

    # シートに直接貼った行はID列が空。画面はIDで行を見分けるので、
    # 空のままだとどの行を押しても同じタスクが開く（2026-09-07に実際に起きた）
    ('IDの無い行に、IDを付けないようにする', [
        (S, '  schedFillIds_(S, idx);', '  if (false) schedFillIds_(S, idx);'),
    ], '1行目にIDが付いていません'),

    # 空行にIDだけが並ぶのを防ぐ
    ('タスク名の無い行にも、IDを付けるようにする', [
        (S, "    if (!asText_(r[idx['タスク名']]).trim()) continue;   // 空行には付けない",
            "    if (false) continue;"),
    ], '空行にIDを付けました'),

    # IDを付けるのは人の編集ではない。記録に残すと嘘になる
    ('IDを付けたことを、最終編集として記録するようにする', [
        (S, '    var id = schedNewId_();',
            '    var id = schedNewId_();\n    schedStampEdit_({ person: (arguments[2] || {}).person || \'\' });'),
    ], '最終編集が記録されています'),

    # ── 一括削除（2026-09-07 けいた指示・急ぎ）────────────
    # 数を突き合わせないと、席を立っているあいだに増えた行まで消える
    ('一括削除で、件数を突き合わせないようにする', [
        (S, '    if (n !== live.length) {', '    if (false) {'),
    ], '件数が違うのに消えました'),

    ('一括削除を、一般権限でもできるようにする', [
        (S, "  if (!auth || auth.role !== '管理者') {", '  if (false) {'),
    ], '一般権限で消せました'),

    # 消した中身が残らないと、戻す手立てが1つも無くなる
    ('一括削除を、変更履歴に残さないようにする', [
        (S, "    appendHistory(auth.person, '（スケジュール）', '一括削除',",
            "    if (false) appendHistory(auth.person, '（スケジュール）', '一括削除',"),
    ], '変更履歴に残っていません'),

    # ②で「シートが縮んで台帳が消える」を踏んでいる。行そのものは消さない
    ('一括削除で、行ごと消すようにする', [
        (S, '      S.sheet.getRange(2, 1, last - 1, SCHED_HEADERS_.length).clearContent();',
            '      for (var d = last; d >= 2; d--) S.sheet.deleteRow(d);'),
    ], 'シートが縮みました（行ごと消しています）'),

    # 画面：惰性で押せると、押し間違いがそのまま全消しになる
    ('一括削除で、件数を打ち込ませないようにする', [
        (A, "  var typed = prompt('制作スケジュールの ' + n + ' 件を、すべて消します。'",
            "  var typed = String(n); if (false) prompt('制作スケジュールの ' + n + ' 件を、すべて消します。'"),
    ], '件数を打ち込ませていません'),

    # 一般権限に出すと、押せないボタンを押させることになる
    ('一括削除のボタンを、誰にでも出す', [
        (A, "    $('#schPurge').hidden = (S.role !== '管理者') || !SCH.rows.length;",
            "    $('#schPurge').hidden = false;"),
    ], '管理者・行の有無で出し分けていません'),

    # 待ちの案内が消えると、効かなかったと思ってもう一度押す人が出る
    ('待ちの案内を、消えるようにする', [
        (A, "    toast('Excelを読んでいます。10秒ほどかかることがあります…', false, true);",
            "    toast('Excelを読んでいます。10秒ほどかかることがあります…');"),
    ], '待っているあいだの案内が消えます'),

    # 書き出したExcelに読み方が無いと、直せない列を直してしまう
    ('書き出しに「はじめにお読みください」を付けないようにする', [
        (S, "    name: 'はじめにお読みください',", "    name: '_none_',"),
    ], '2枚目が読み方になっていません'),

    # 選択肢を写しで書くと、増やしたときに片方が古くなる
    ('読み方の選択肢を、定数ではなく写しで書く', [
        (S, "  if (h === '領域')      return SCHED_AREAS_.join('・')",
            "  if (h === '領域')      return ['全体', '会議'].join('・')"),
    ], '選択肢が書かれていません'),

    # 下見を出したまま往復すると、判定が古いまま残る
    ('タブに戻っても、下見を見直さないようにする', [
        (A, "  if (name === 'sched' && typeof IMP !== 'undefined' && IMP.items.length) {",
            "  if (false) {"),
    ], 'タブに戻ったときに、下見を見直していません'),
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
