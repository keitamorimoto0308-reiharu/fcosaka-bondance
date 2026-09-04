/**
 * 公開中のページが、手元のビルドとずれていないか。
 *
 * ■ なぜ要るか（実際に起きた）
 *   本番のGASだけ反映して、**管理ページの再公開を忘れた**。
 *   その結果、設定タブに新しい項目が出ず、メール送信タブも出なかった。
 *   けいたに「設定タブから入れられます」と案内したが、そこに無かった。
 *
 *   たちが悪いのは、**画面に何のエラーも出ない**こと。項目が無いだけ。
 *   気づかなければ「入れたはずのURLが空で採択通知が送れない」と後で悩む。
 *
 *   サーバー側（GAS）とページ側（GitHub Pages）は**別々に反映**する。
 *   片方だけ進めたことに、人間は気づけない。機械に見張らせる。
 *
 * ■ ネットにつながらないときは飛ばす
 *   公開先を見に行くので、オフラインでは判定できない。
 *   その場合は「確かめられなかった」と分かる形で飛ばす（合格にしない）。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://bondance.kreha-c.com/';

/** 公開中のページと手元で、必ず一致しているべき目印 */
const MARKERS = [
  { page: 'admin.html', published: 'admin.html', keys: [
    'data-tab="mail"',      // メール送信タブ
    'loadNotify',           // その動き
  ] },
  // 応募フォームは preview.html として公開されている
  { page: 'index.html', published: 'preview.html', keys: [
    'logo-stack',           // 新ロゴ（picture の中）
    'btn-outline-brand',    // 白地の枠線ボタン
  ] },
];

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(url + ' → ' + res.status);
  return res.text();
}

describe('公開中のページが、手元のビルドとずれていないか', () => {
  for (const m of MARKERS) {
    test(`${m.published} が手元の ${m.page} と同じ機能を持っている`,
      { timeout: 60000 }, async (t) => {
      const local = fs.readFileSync(path.join(ROOT, m.page), 'utf8');

      let live;
      try {
        live = await fetchText(BASE + m.published);
      } catch (e) {
        // ネットに出られない環境では判定できない。合格にはしない
        t.skip('公開先を確認できませんでした（' + e.message + '）');
        return;
      }

      const missing = m.keys.filter(k => local.includes(k) && !live.includes(k));
      assert.deepStrictEqual(missing, [],
        m.published + ' が古いままです。手元にあって公開中に無いもの：'
        + missing.join(', ')
        + '\n→ node src/deploy.js preview で公開し直してください'
        + '（GASの反映とページの公開は別の操作です）');
    });
  }
});
