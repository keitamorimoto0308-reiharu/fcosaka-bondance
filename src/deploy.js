/**
 * 公開用ブランチ（gh-pages）へのデプロイ。
 *
 * GitHub Pages は gh-pages ブランチだけを見る。main にいくらコミットしても
 * 公開状態は変わらない。公開は必ずこのスクリプトを明示的に実行したときだけ起きる。
 *
 *   node src/deploy.js holding   … 準備中ページのみ公開（本番公開前の既定）
 *   node src/deploy.js preview   … 準備中ページ ＋ デザイン3案（送信は無効）
 *   node src/deploy.js live      … 本番の応募フォームを公開（CP3以降・要けいた承認）
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODE = process.argv[2] || 'holding';
const WT = path.join(ROOT, '.deploy');

if (!['holding', 'preview', 'live'].includes(MODE)) {
  console.error('モードは holding / preview / live のいずれかです'); process.exit(1);
}

const sh = (cmd, opt = {}) => execSync(cmd, { cwd: ROOT, stdio: 'pipe', ...opt }).toString().trim();

// 公開用ブランチを worktree として取り出す（作業ツリーを汚さない）
try { sh(`git worktree remove --force "${WT}"`); } catch (e) {}
let exists = true;
try { sh('git rev-parse --verify gh-pages'); } catch (e) { exists = false; }
if (!exists) {
  sh(`git worktree add --detach "${WT}"`);
  sh('git checkout --orphan gh-pages', { cwd: WT });
  sh('git rm -rf . || true', { cwd: WT, shell: true });
} else {
  sh(`git worktree add "${WT}" gh-pages`);
}

// 中身を入れ替える（公開物は毎回この関数が決める。取りこぼしを防ぐため一度空にする）
for (const f of fs.readdirSync(WT)) {
  if (f === '.git') continue;
  fs.rmSync(path.join(WT, f), { recursive: true, force: true });
}

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(WT, to)), { recursive: true });
  fs.cpSync(path.join(ROOT, from), path.join(WT, to), { recursive: true });
};

copy('CNAME', 'CNAME');
copy('assets', 'assets');

if (MODE === 'live') {
  copy('index.html', 'index.html');
} else {
  copy('holding.html', 'index.html');
}
if (MODE === 'preview') {
  // 確認用。送信先を空にしてビルドしたものを preview.html として置く。
  // ルートは「準備中」のままなので、URLを知る人だけが中身を見られる。
  copy('index.html', 'preview.html');
}

const published = fs.readdirSync(WT).filter(f => f !== '.git');
sh('git add -A', { cwd: WT });
try {
  sh(`git commit -q -m "deploy: ${MODE}"`, { cwd: WT });
} catch (e) {
  console.log('  変更なし（公開内容は同じです）');
}
sh('git push -q origin gh-pages', { cwd: WT });
sh(`git worktree remove --force "${WT}"`);

console.log(`公開しました（モード: ${MODE}）`);
console.log('  公開物:', published.join(', '));
