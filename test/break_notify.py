"""選考結果の送信と、台帳の列の差し込みを、わざと壊して検査を確かめる。

使い方：  python test/break_notify.py

■ なぜ念入りにやるか
  2026-09-03、**採択通知が本番では一度も送れない状態**だったのが見つかった。
    ・サーバーは受付IDの集合で照合
    ・画面は件数しか送っていない
    ・**模擬が件数を見ていたので、模擬では通っていた**
  気づくのは締切直後。いちばん困るところ。

  「模擬が本番より緩い」は繰り返し起きている。
  だから壊し方にも「模擬を緩める」を必ず入れる。

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
TARGETS = ['test/notify-kinds.test.js', 'test/ledger-columns.test.js',
           # 守りが立っている前提（既定値）を見る検査。
           # **壊す場所と、落ちる検査を対にする**（失敗パターン7）
           'test/preconditions.test.js']


def build():
    """画面のコードを見る検査があるので、作り直してから流す"""
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
    # ── 守りが立っている「地面」を崩す（2026-09-10、検証役の指摘）──────
    # 引き継ぎ書 §6：「リンクの無い通知は送らない」検査が効かなかった事故は、
    # **自分で入れた既定値のURLで条件が常に偽**になったのが原因。
    # その前提を見る検査が、2026-09-10 まで1件も無かった
    ('確定情報フォームURLの既定値に、URLを入れる', [
        ('gas/Config.gs', "  ['確定情報フォームURL',   '',",
                          "  ['確定情報フォームURL',   'https://example.com/confirm.html',"),
    ], '守りが二度と働きません'),

    ('管理者パスワードの既定値を、埋める', [
        ('gas/Config.gs', "  ['管理者パスワード',     '',",
                          "  ['管理者パスワード',     'himitsu',"),
    ], '既定値が入っています'),


    ('画面が件数だけを送る形に戻す', [
        ('src/build-admin.js', '    ids: rows.map(function(x){ return x.id; }),',
         '    expect: rows.length,'),
    ], '受付IDの集合を送っていません'),

    ('模擬を件数の照合に戻す（本番より緩くする）', [
        ('src/mock.js', "      const nowIds = pend.map(r => r['受付ID']).sort();",
         '      const nowIds = [];\n'
         '      if (Number(payload.expect) === pend.length) '
         'return { ok: true, sent: [], failed: [] };'),
    ], '模擬がまだ件数で照合しています'),

    ('不採択でも採択の列に書く', [
        ('gas/Notify.gs', '    var notifiedCol = L.headers.indexOf(K.sentCol);',
         '    var notifiedCol = L.headers.indexOf(COL.notifiedAt);'),
        ('src/mock.js', '        r[K2.sentCol] = now;', "        r['採択通知送信日時'] = now;"),
    ], '不採択の送信日時が入っていません'),

    ('不採択でもトークンを発行する', [
        ('gas/Notify.gs', '          mail = buildRejectMail_(r);',
         '          ensureAcceptToken_(L.sheet, L.headers, rowNo, r.token);\n'
         '          mail = buildRejectMail_(r);'),
    ], '不採択でトークンを発行しています'),

    ('不採択の本文に理由を書く', [
        ('gas/Notify.gs',
         "    '慎重に検討させていただきましたが、ご用意できる区画数に限りがあり、',",
         "    '慎重に検討させていただきましたが、審査基準に達しなかったため、',"),
    ], '理由に踏み込んでいます'),

    ('不採択の本文にリンクを載せる', [
        ('gas/Notify.gs', "    'ご不明な点がございましたら、本メールへのご返信でお問い合わせください。',",
         "    '出店確定情報フォーム：' + acceptLink_('x', row.id, 'y'),"),
    ], '不採択の本文にリンクが混ざっています'),

    ('列の差し込みで、並べ替えも許す', [
        ('gas/Setup.gs',
         '  if (i !== cur.length) return false;      // 並べ替え・改名・削除が混ざっている',
         '  // 何でも通す'),
    ], '並べ替えを通しています'),

    ('列を右から差し込む', [
        ('gas/Setup.gs',
         '  for (var c = 0; c < headers.length; c++) {\n'
         '    if (live[c] === headers[c]) continue;',
         '  for (var c = headers.length - 1; c >= 0; c--) {\n'
         '    if (live[c] === headers[c]) continue;'),
    ], '見出しの並びがずれています'),

    ('見出しの行が空でも差し込む', [
        ('gas/Setup.gs', '  if (!cur.length) return false;', '  // 通す'),
    ], '見出しが空なのに差し込みました'),

    ('差し込みの結果を見ずに続ける', [
        ('gas/Setup.gs', '      if (!insertMissingLedgerColumns_(sh, current, headers)) {',
         '      if (false) {'),
    ], '差し込みの結果を見ていません'),

    # ── 画面が種類を取り違えさせない（2026-09-03 の検証で見つかった穴）
    ('模擬の見本を、採択で固定に戻す', [
        ('src/mock.js', '        sample: s0 ? mockMailSample(K.kind, s0) : null,',
         "        sample: s0 ? mockMailSample('accept', s0) : null,"),
    ], '不採択なのに採択の件名です'),

    ('模擬の履歴を、採択で固定に戻す', [
        ('src/mock.js', "          item: K2.label, before: '未送信',",
         "          item: '採択通知', before: '未送信',"),
    ], '不採択を送ったのに履歴が'),

    ('不採択でもURLの警告を出す', [
        ('src/build-admin.js', '  if (!isReject && (!r.urls || !r.urls.confirm)){',
         '  if ((!r.urls || !r.urls.confirm)){'),
    ], '不採択でもURLの警告を出しています'),

    ('対象0件の案内を「採択」で固定に戻す', [
        ('src/build-admin.js',
         "      + '出店者一覧でステータスを「' + (isReject ? '不採択' : '採択')",
         "      + '出店者一覧でステータスを「' + ('採択')"),
    ], '不採択の画面で「採択にすると出ます」と案内しています'),

    ('種類を切り替えても、前の結果を残す', [
        ('src/build-admin.js', "      $('#mailResult').hidden = true;",
         '      // 残す'),
    ], '前の結果を消していません'),

    ('送信結果から、送った種類を落とす', [
        ('src/build-admin.js', "      '<p class=\"ok\"><b>' + esc(r.kindLabel || '通知') + ' を '",
         "      '<p class=\"ok\"><b>' + ("),
    ], '結果に種類が書かれていません'),

    # ── 反対の通知を、あとから機械で送らない
    ('本番が、もう片方の送信日時を見ない', [
        ('gas/Notify.gs',
         "    if (asText_(cell_(H, r, other.sentCol)).trim() !== '') {",
         '    if (false) {'),
    ], '本番が、もう片方の送信日時を見ていません'),

    ('模擬が、採択済みにも不採択を送る（本番より緩くする）', [
        ('src/mock.js', '      const pend = all0.filter(r => !r[other.sentCol]);',
         '      const pend = all0;'),
    ], '採択のご連絡を送った相手に、不採択を送ろうとしています'),

    ('模擬が、下見だけ厳しく送信は素通りさせる', [
        ('src/mock.js', '        .filter(r => !r[other2.sentCol])', '        '),
    ], '採択のご連絡を送った相手に、不採択を送りました'),

    ('外した行を、画面が見ないようにする', [
        ('src/build-admin.js', '  if (flip.length){', '  if (false){'),
    ], '外した行を見ていません'),

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
