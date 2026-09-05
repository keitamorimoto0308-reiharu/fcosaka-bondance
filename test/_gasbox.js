/**
 * GAS の代役は src/gasbox.js に1つだけ置く。
 *
 * 模擬サーバー（src/mock.js）も同じものを使う。
 * ここに写しを置くと、片方だけ厳しくしたときに、もう片方は緩いまま通り続ける。
 */
module.exports = require('../src/gasbox');
