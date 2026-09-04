"""わざと壊す検査を流す前の、共通の歯止め。

■ なぜ要るか
  壊し検査は **src/mock.js と gas/*.gs を一時的に書き換える**。
  その最中に誰かが模擬サーバーを触っていると、
  壊した状態の画面を見て「バグを見つけた」と報告することになる。

  2026-09-04、実際に起きた。検証役の報告2件
  （「置き換えのはずが合計が足し算になった」「保存した文面が消えた」）が、
  どちらも同時に流した壊し検査のせいだった。検証役の時間を無駄にしている。

■ なぜ break_all.py だけでは足りないか
  歯止めを `break_all.py` にしか置いていなかったので、
  `python test/break_num.py` のように**個別に流すと素通り**していた
  （2026-09-04 の点検で指摘）。各スクリプトの先頭で呼ぶ。

■ ポートは src/mock.js から読む
  決め打ちにすると、ポートを変えたときに歯止めが黙って外れる。
"""
import json
import pathlib
import re
import socket
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent


def mock_port():
    """模擬サーバーのポート。src/mock.js が正（決め打ちにしない）"""
    try:
        src = (ROOT / 'src' / 'mock.js').read_text(encoding='utf-8')
        m = re.search(r'const PORT = (\d+)', src)
        if m:
            return int(m.group(1))
    except OSError:
        pass
    return 4174


def mock_running(port=None):
    port = port or mock_port()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(('127.0.0.1', port)) == 0


def require_no_mock():
    """模擬サーバーが動いていたら、理由を出して止める。

    呼び出し側は、返り値が None でなければ、そのまま sys.exit すること。
    """
    port = mock_port()
    if not mock_running(port):
        return None
    print(f'[中止] 模擬サーバーがポート {port} で動いています。')
    print('')
    print('  わざと壊す検査は、src/mock.js と gas/*.gs を**一時的に書き換えます**。')
    print('  いま画面を見ている人がいると、壊れた状態を見せてしまいます。')
    print('  （2026-09-04、これで検証役の報告2件が誤報になりました）')
    print('')
    print('  先に模擬サーバーを止めてください：')
    print(f'    $p=(Get-NetTCPConnection -LocalPort {port} -State Listen '
          '-ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique; '
          'if($p){Stop-Process -Id $p -Force}')
    return 2


def require_no_deploy():
    """本番へ反映している最中でないか。

    ■ なぜ要るか（2026-09-04、けいたの指摘）
      同じ作業フォルダを、2つのセッションが触っている。
      壊し検査は gas/*.gs と src/mock.js を一時的に書き換えるので、
      その最中に `clasp push` が走ると、**壊れたコードが本番に行く**。

      `npm run push` はテストを先に流すが、
      壊し検査は「テストがわざと落ちる状態」を作るので、
      タイミング次第ですり抜ける。ファイル1つで知らせ合う。
    """
    lock = ROOT / '.locks' / 'deploy.lock'
    if not lock.exists():
        return None
    try:
        info = json.loads(lock.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    age_min = (time.time() * 1000 - float(info.get('at', 0))) / 60000
    if age_min > 30:
        return None                      # 古い鍵は無視（持ち主が落ちたまま）
    print('[中止] いま「本番へ反映」を '
          + str(info.get('who', '誰か')) + ' が '
          + str(round(age_min)) + '分前から実行中です。')
    print('')
    print('  わざと壊す検査は、ソースを一時的に書き換えます。')
    print('  反映の最中に走らせると、**壊れたコードが本番に行きます**。')
    print('')
    print('  反映が終わるのを待ってください（node tools/lock.js check で確認できます）。')
    return 2


def guard():
    """先頭で1行呼ぶだけで済む形"""
    for check in (require_no_mock, require_no_deploy):
        code = check()
        if code is not None:
            sys.exit(code)
