/**
 * QRコードの生成。
 *
 * 中身のURLは content.js の SITE.url を単一の正とする。
 * 配布キットのQR・募集要項PDFのQR・社内資料のQRが別々の文字列を持つと、
 * 「片方だけ直して気づかない」事故になるため。
 *
 * 誤り訂正レベルは M（既定）ではなく H を使う。印刷物は汚れ・折れ・
 * 名刺サイズへの縮小で読み取り率が落ちるため、冗長度を上げておく。
 * ロゴを重ねる余地を残す意味もある。
 */
const QRCode = require('qrcode');

const OPTS = {
  errorCorrectionLevel: 'H',
  margin: 2,          // クワイエットゾーン（規格上は4モジュール以上。印刷では2でも実用上通る余白を別途とる）
  color: { dark: '#231816', light: '#FFFFFF' },
};

/** SVG文字列を返す（印刷用。拡大しても劣化しない） */
async function qrSvg(text, opts) {
  const svg = await QRCode.toString(text, Object.assign({ type: 'svg' }, OPTS, opts));
  // width/height 属性を外し、viewBox だけ残す。CSS側でサイズを決められるようにする。
  return svg.replace(/\s(width|height)="[^"]*"/g, '');
}

/**
 * PNGバッファを返す（画面共有・スライド貼り込み用）。
 *
 * SVG版はPDF側で余白（padding）を足しているのでmargin:2で足りるが、
 * PNGは画像の外に余白が無いまま貼られる。規格どおり4モジュール確保する。
 */
/* Promise<Buffer> を返す */
function qrPng(text, size, opts) {
  return QRCode.toBuffer(text, Object.assign(
    { type: 'png', width: size || 1024 }, OPTS, { margin: 4 }, opts));
}

module.exports = { qrSvg, qrPng, OPTS };
