/**
 * 本番へ反映する（4段階を1コマンドで）。
 *
 *   npm run release "変更の要約"
 *
 * ── なぜ作ったか（2026-09-10）──
 * これまでは4つのコマンドを人が順に打ち、**②で出た版番号を③に手で写していた**。
 * けいた（非技術者の発注者）から「この `-V 【番号】` が分からない」と指摘があった。
 * **人に番号を写させる手順は、いつか必ず写し間違える。**
 *
 * 実際、この案件は同じ形で3回事故を起こしている：
 *   - `deploy.js` のモードを付け忘れ、4ページが404になった（2026-09-02）
 *   - `create-deployment` と `update-deployment` を取り違え、公開URLが変わらなかった
 *   - 版番号を引き継ぎ書に書き写し、そのまま古くなった（2回）
 *
 * ── やること ──
 *   1. npm run push            テストを通してから GAS へ（鍵を取って走る）
 *   2. clasp create-version    版を作り、**出力から番号を自動で拾う**
 *   3. clasp update-deployment 公開中のURLをその版に切り替える
 *   4. deploy.js preview       公開ページを出し直す（モードは必ず付ける）
 *   5. 反映後、外から健康を確かめる
 *
 * ── 送信先の取り出し ──
 * デプロイIDは `src/endpoint.live.json` の URL から取る。
 * **どこにも書き写さない。** 2か所に同じ値があると、必ず片方が古くなる。
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODE = 'preview';          // CP3で本番公開したら 'live'

function say(s) { process.stdout.write(s + '\n'); }
function head(n, s) { say(''); say('── ' + n + '/5 ' + s + ' ' + '─'.repeat(Math.max(2, 48 - s.length))); }

/** 送信先のURLから、公開中のデプロイIDを取り出す */
function deploymentId() {
  const p = path.join(ROOT, 'src', 'endpoint.live.json');
  if (!fs.existsSync(p)) {
    throw new Error('src/endpoint.live.json がありません。送信先が分かりません。');
  }
  const url = String(JSON.parse(fs.readFileSync(p, 'utf8')).gasUrl || '');
  const m = url.split('/macros/s/')[1];
  const id = m ? m.split('/')[0] : '';
  if (!id) {
    throw new Error('送信先のURLからデプロイIDを取り出せません：' + url);
  }
  return id;
}

/** そのまま画面に流す（テストの経過を人が見られるように） */
function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
}

/** 出力を受け取る（版番号を拾うため） */
function capture(cmd) {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) {
    process.stdout.write(out);
    throw new Error('失敗しました：' + cmd);
  }
  return out;
}

function main() {
  const summary = process.argv.slice(2).join(' ').trim();
  if (!summary) {
    say('変更の要約を書いてください。例：');
    say('  npm run release "検証役の指摘を反映"');
    process.exit(1);
  }

  const id = deploymentId();
  say('本番へ反映します。');
  say('  変更の要約 : ' + summary);
  say('  送信先     : ' + id.slice(0, 16) + '…（src/endpoint.live.json から取得）');
  say('  公開モード : ' + MODE);

  head(1, 'テストを通してから GAS へ');
  run('npm run push');

  head(2, '版を作る');
  const out = capture('npx clasp create-version "' + summary.replace(/"/g, "'") + '"');
  process.stdout.write(out);
  /*
   * 出力から番号を拾う。**人に写させない。**
   * 拾えなかったら、ここで止まる（古い版のまま切り替えるより、止まるほうが安全）。
   */
  const m = /Created version (\d+)/.exec(out);
  if (!m) {
    say('');
    say('⛔ 版番号を読み取れませんでした。ここで止めます。');
    say('   上の出力を見て、手で切り替えてください：');
    say('   npx clasp update-deployment -V <番号> ' + id);
    process.exit(1);
  }
  const version = m[1];
  say('  → 版 ' + version + ' を作りました');

  head(3, '公開中のURLを、その版に切り替える');
  run('npx clasp update-deployment -V ' + version + ' ' + id);

  head(4, '公開ページを出し直す');
  // **モードを必ず付ける。** 省くと既定の holding で走り、
  // admin/preview/confirm/upload の4ページが公開物から消える（2026-09-02 に実際にやった）
  run('node src/deploy.js ' + MODE);

  head(5, '本当に届いたかを確かめる');
  const url = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src', 'endpoint.live.json'), 'utf8')).gasUrl;
  return fetch(url + '?action=formConfig', { redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      say('  応募の受付      : ' + (j.ok ? 'OK' : '⛔ 落ちています'));
      say('  応募一覧の列    : ' + (j.ledgerReady ? 'OK' : '⛔ setup() が要ります'));
      say('  確定情報の列    : ' + (j.confirmReady ? 'OK' : '⛔ setup() が要ります'));
      say('');
      if (!j.ok || !j.ledgerReady || !j.confirmReady) {
        say('⛔ 本番が正常ではありません。Apps Script から setup() を1回実行してください。');
        process.exit(1);
      }
      say('版 ' + version + ' に反映しました。');
      say('');
      say('⚠ シートの列や書式を変えたときは、Apps Script から setup() を');
      say('  1回実行してください（この道具では判定できません）。');
    });
}

Promise.resolve().then(main).catch(function (e) {
  say('');
  say('⛔ ' + (e && e.message ? e.message : e));
  say('');
  say('  途中で止まったので、公開中のURLは**まだ切り替わっていない**可能性があります。');
  say('  いまの版は  npx clasp deployments  で確かめられます。');
  process.exit(1);
});
