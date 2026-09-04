"""メール文面の編集を、わざと壊して検査が働くことを確かめる。

使い方：  python test/break_mailtpl.py

■ なぜ念入りにやるか
  ここは**自由に書ける画面**を、取り消せない一括送信の手前に置いた場所。
  守っているものが3つあり、どれが外れても画面は何も言わない。

    1. 不採択に採択専用のリンクを入れさせない
       （入れると送信時にトークンを発行する道に入り、
         不採択の方が出店確定情報フォームを開けてしまう）
    2. 採択からリンクを落とさせない（次に何をすればよいか伝わらない）
    3. 知らない差し込みのまま送らせない（{{名前}} とそのまま届く）

  さらに「作り替えても届く文が変わっていないこと」を、
  旧・直書き（buildAcceptMailLegacy_）との突き合わせで見ている。
  **1文字でも変われば50社に違う文が届く**ので、この検査が働くことは必ず確かめる。

■ 「模擬を緩める」を必ず入れる
  模擬は検査を本番のソースから借りている。写しを作った瞬間に古くなる。
"""
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _guard import guard  # noqa: E402
R = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ['test/mail-template.test.js', 'test/notify.test.js', 'test/notify-run.test.js']


def build():
    subprocess.run(['node', 'src/build-admin.js'], cwd=R, capture_output=True, shell=True)


def run():
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
    # ── 届く文が変わっていないこと
    ('既定の採択文面を、1文字だけ変える', [
        ('gas/MailTemplate.gs', "      '当日の運営に必要な情報を、下記のフォームからご登録ください。',",
         "      '当日の運営に必要な情報を、下記のフォームからご入力ください。',"),
    ], '本文が変わりました'),

    ('既定の採択文面から、荒天時の中断を落とす', [
        ('gas/MailTemplate.gs', "      '【荒天時の中断】',", "      '',"),
    ], 'がありません'),

    ('けいた確定の「理由はお答えできかねる」を落とす', [
        ('gas/MailTemplate.gs',
         "      'なお、今回の選考の理由につきましては、お答えいたしかねます。',",
         "      '',"),
    ], '「理由はお答えできかねる」が入っていません'),

    ('けいた確定の「繰り上げの予定は無い」を落とす', [
        ('gas/MailTemplate.gs',
         "      'また、今回は繰り上げのご連絡を予定しておりません。',",
         "      '',"),
    ], '「繰り上げの予定は無い」が入っていません'),

    ('不採択の既定にリンクを入れる', [
        ('gas/MailTemplate.gs', "      '受付ID：{{受付ID}}',\n      '出店名：{{出店名}}',\n"
                                "      '企業・団体名：{{企業名}}',",
         "      '受付ID：{{受付ID}}',\n      'https://bondance.kreha-c.com/confirm.html',"),
    ], '不採択の文面に混ざっています'),

    # ── 保存の検査（守りの本体）
    ('不採択に採択専用のリンクを通す', [
        ('gas/MailTemplate.gs',
         "      if (kind === 'reject' && acceptOnly.indexOf(name) >= 0) {",
         '      if (false) {'),
    ], 'の断り方が違います'),

    ('採択からリンクを落とせるようにする', [
        ('gas/MailTemplate.gs',
         "  if (kind === 'accept' && !seenBody['確定情報フォームURL']) {",
         '  if (false) {'),
    ], 'リンクの無い採択が通りました'),

    ('知らない差し込みを通す', [
        ('gas/MailTemplate.gs', '      if (allowed[name]) {',
         '      if (true) {'),
    ], '綴り違いが通りました'),

    ('採択専用の差し込みを、不採択でも使えることにする', [
        ('gas/MailTemplate.gs', "    { name: '確定情報フォームURL', kinds: ['accept'],",
         "    { name: '確定情報フォームURL', kinds: ['accept', 'reject'],"),
    ], '不採択にリンクを見せています'),

    ('空の文面を保存できるようにする', [
        ('gas/MailTemplate.gs', "  if (!body.trim()) errs.push('本文が空です。');", '  ;'),
    ], '本文が空'),

    ('件名に改行を通す', [
        ('gas/MailTemplate.gs', "  if (subject.indexOf('\\n') >= 0) {", '  if (false) {'),
    ], '件名に改行'),

    ('組み立て後の残骸を見ない', [
        ('gas/MailTemplate.gs', '  if (/[{}]/.test(built)) {', '  if (false) {'),
    ], '二重の括弧が通りました'),

    ('検査が、置き換えを通さずに正規表現だけで見る', [
        ('gas/MailTemplate.gs',
         '  var builtSubject = mailtplRender_(subject, sample);',
         '  var builtSubject = String(subject);'),
    ], 'の既定が保存できません'),

    ('不採択の鍵つきリンクを通す', [
        ('gas/MailTemplate.gs', '      if (flat.indexOf(banned[bi]) >= 0) {',
         '      if (false) {'),
    ], 'が通りました：'),

    # ── 置き換え
    ('空の差し込みで、見出しだけの行を残す', [
        ('gas/MailTemplate.gs', "    if (/[：:]\\s*$/.test(filled)) continue;", '    ;'),
    ], '「出店名：」だけの行が残っています'),

    ('記号だけが残る行を、消さないようにする', [
        ('gas/MailTemplate.gs',
         "    if (/^[\s　▼・\-—]*$/.test(filled)) continue;", '    ;'),
    ], '記号だけの行が残りました'),

    # ── 送信が文面を通っていること
    ('本番の送信を、直書きに戻す', [
        ('gas/Notify.gs', "  return mailtplBuild_('reject', row, null);",
         '  return buildRejectMailLegacy_(row);'),
    ], 'が文面を通っていません'),

    # ── 模擬が本番より緩くならないこと
    ('模擬が、独自の検査を持つ（本番より緩くする）', [
        ('src/mock.js', '      const errs = MAILTPL.mailtplValidate_(kind, subject, body);',
         '      const errs = [];'),
    ], '模擬が独自の検査を持っています'),

    ('模擬が、断られても保存する', [
        ('src/mock.js', '      if (errs.length) {\n'
                        "        return { ok: false, error: 'bad_value', errors: errs,",
         "      if (false) {\n        return { ok: false, error: 'bad_value', errors: errs,"),
    ], '断るべきものを保存しました'),

    ('一般権限にも開放する', [
        ('gas/Admin.gs',
         "                   'adminMailTemplate', 'adminMailTemplateSave', "
         "'adminMailTemplateReset'];",
         '                   ];'),
    ], '管理者限定の一覧にありません'),

    ('シートが読めないときに、既定へ落とさない', [
        ('gas/MailTemplate.gs',
         "      out = { subject: def.subject, body: def.body, custom: false };",
         '      out = { subject: 0, body: 0, custom: false };'),
    ], 'シートが空・壊れているときに既定へ落ちていません'),
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
