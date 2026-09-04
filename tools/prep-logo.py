"""支給ロゴPNG → ウェブ用アセット。

    python tools/prep-logo.py

■ 縮小もトリミングもしない
  2026-09-02 から、けいたが**最終サイズちょうど・余白なし**で書き出している。
  こちらで縮小すると、そのぶん画質を落とすだけになる。
  ここでやるのは軽量化（256色化）と、ファビコンの生成だけ。

  以前は 2500px の支給データを外接矩形で切って縮小していた。
  その版は git 履歴（tools/ に無かった時代のスクラッチ）にある。
  支給サイズが変わったら、まずここの EXPECT を直すこと。

■ なぜ256色に落とすか
  平らな色で構成された図案なので、目に見える劣化がほぼ無く容量が5分の1になる。
  スマホで開くページなので効く（wide で 298KB → 60KB前後）。

■ 期待サイズを固定してある
  違うサイズが来たら**止める**。黙って通すと、
  「Retinaでぼやける」「紙面で粗い」が、誰も気づかないまま公開される。
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path(r'C:\Users\keita\fcosaka\assets')
DST = Path(__file__).resolve().parent.parent / 'assets' / 'logo'

# (支給ファイル名, 出力名, 期待サイズ)
#   期待サイズの根拠は docs/internal/progress_log.md（2026-09-02）:
#     wide 1200 … PCのヒーロー最大386px×2 ＋ 紙面58mm
#     box   700 … スマホのヒーロー最大300px×2
#     text  240 … ヘッダー44〜56px×2 に余裕
#     icon  384 … OGPの132px と ファビコン180px の元
FILES = [
    ('★widerogo)event1200-418.png.png', 'event-logo-wide.png', (1200, 428)),
    ('★boxrogo)event_700-900.png',      'event-logo-box.png',  (700, 900)),
    ('★textrogotextrogo_event_575-240.png', 'event-logo-text.png', (575, 240)),
    ('★iconrogo_event_384-384.png',     'event-mark.png',      (384, 384)),
]

# 余白の許容。書き出しのアンチエイリアスぶんは避けられない。
# これを超える余白があると、CSSは画像全体を指定幅に収めるので
# **余白のぶんロゴが小さく表示され**、他のページと大きさが揃わなくなる
MAX_PAD = 20


def resize_premultiplied(im, size):
    """アルファ事前乗算つきの縮小。白フチの外に黒が滲むのを防ぐ。

    透明部分のRGBが (0,0,0) なので、素直に縮小すると白フチの外へ黒が出る。
    事前乗算しておけば、透明なピクセルは重み0で計算に入らない。
    ファビコンを作るときだけ使う。
    """
    a = np.asarray(im, dtype=np.float64) / 255.0
    rgb, alpha = a[..., :3], a[..., 3:4]
    pre = np.concatenate([rgb * alpha, alpha], axis=2)
    small = Image.fromarray((pre * 255 + 0.5).astype(np.uint8), 'RGBA') \
                 .resize(size, Image.LANCZOS)
    b = np.asarray(small, dtype=np.float64) / 255.0
    rgb2, alpha2 = b[..., :3], b[..., 3:4]
    safe = np.where(alpha2 > 1e-6, alpha2, 1.0)
    out = np.concatenate([np.clip(rgb2 / safe, 0, 1), alpha2], axis=2)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')


def check(im, name, expect):
    if im.size != expect:
        print(f'  ✗ {name} のサイズが {im.size[0]}x{im.size[1]} です'
              f'（想定 {expect[0]}x{expect[1]}）。')
        print('    このまま通すと、Retinaでぼやける／紙面で粗い状態が')
        print('    誰にも気づかれないまま公開されます。')
        return False

    bbox = im.getchannel('A').getbbox()
    if bbox is None:
        print(f'  ✗ {name} が全面透明です。')
        return False
    w, h = im.size
    pad = max(bbox[0], bbox[1], w - bbox[2], h - bbox[3])
    if pad > MAX_PAD:
        print(f'  ✗ {name} の透明な余白が {pad}px あります（許容 {MAX_PAD}px）。')
        print('    余白のぶんロゴが小さく表示され、他のページと大きさが揃いません。')
        return False
    return True


def main():
    DST.mkdir(parents=True, exist_ok=True)
    print('ウェブ用ロゴを書き出します（縮小・トリミングはしません）')

    mark = None
    ok = True
    for src_name, out_name, expect in FILES:
        path = SRC / src_name
        if not path.exists():
            print(f'  ✗ 支給データがありません: {src_name}')
            ok = False
            continue
        im = Image.open(path).convert('RGBA')
        if not check(im, src_name, expect):
            ok = False
            continue

        out = DST / out_name
        im.quantize(colors=256, method=Image.FASTOCTREE).save(out, 'PNG', optimize=True)
        kb = out.stat().st_size / 1024
        print(f'  {out_name:24s} {im.size[0]:>4d} x {im.size[1]:<4d} {kb:7.1f} KB')
        if out_name == 'event-mark.png':
            mark = im

    if not ok:
        print('\n  書き出しを中止しました。')
        return 1

    # ファビコン。透過のままだと暗いタブで沈むので、白を敷く
    for px, name in ((180, 'favicon-180.png'), (32, 'favicon-32.png')):
        small = resize_premultiplied(mark, (px, px))
        plate = Image.new('RGBA', (px, px), (255, 255, 255, 255))
        plate.alpha_composite(small)
        p = DST / name
        plate.convert('RGB').save(p, 'PNG', optimize=True)
        print(f'  {name:24s} {px:>4d} x {px:<4d} {p.stat().st_size / 1024:7.1f} KB')

    print('\n  次にやること：npm run build（縦横比が変わっていれば紙面の再測定も）')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
