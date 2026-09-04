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

/**
 * 管理ページを公開してよい状態かを、稼働中のGASに聞いて確かめる。
 *
 * 管理ページは誰でも開けるURLに置かれ、守りはパスワードだけになる。
 * 設定シートのパスワードが空のまま、あるいは短いまま公開すると、
 * **見た目には管理ページが立ち上がっているのに鍵がかかっていない**状態になる。
 * この検査は「公開してよいか」をこちらの記憶ではなく本番に確認する。
 */
function assertAdminLocked() {
  const url = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src', 'endpoint.live.json'), 'utf8')).gasUrl;

  // deploy.js は同期で書かれているので、確認だけ子プロセスに投げる
  const probe = [
    'fetch(process.argv[1],{method:"POST",',
    'headers:{"Content-Type":"text/plain;charset=utf-8"},',
    'body:JSON.stringify({action:"adminNames",password:"probe-not-a-password"})})',
    '.then(r=>r.json()).then(j=>console.log(j.error||"")).catch(()=>console.log("unreachable"))',
  ].join('');

  let err;
  try {
    err = execSync(`node -e ${JSON.stringify(probe)} ${JSON.stringify(url)}`,
                   { cwd: ROOT, stdio: 'pipe', timeout: 60000 }).toString().trim();
  } catch (e) {
    err = 'unreachable';
  }

  if (err === 'denied' || err === 'locked') return;   // 鍵はかかっている

  const why = {
    not_configured: '設定シートのパスワードが空です。',
    weak_password:  '設定シートのパスワードが短すぎます（16文字以上必要）。',
    unreachable:    '稼働中のGASに問い合わせできませんでした。',
  }[err] || ('予期しない応答でした（' + err + '）。');

  console.error([
    '',
    '✗ 管理ページを公開できません。' + why,
    '  管理ページは誰でも開けるURLに置かれ、守りはパスワードだけです。',
    '  設定シートの「管理者パスワード」「一般パスワード」を入れてから、もう一度実行してください。',
    '',
  ].join(String.fromCharCode(10)));
  process.exit(1);
}

if (MODE === 'preview' || MODE === 'live') assertAdminLocked();

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
  // 確認用。ルートは「準備中」のままなので、URLを知る人だけが中身を見られる。
  // 注意：preview.html には**稼働中の送信先が入っている**（下の検査がそれを強制する）。
  // つまりここから送信すると本番の台帳に行を作る。確認用だから安全、ではない。
  copy('index.html', 'preview.html');
}
if (MODE === 'preview' || MODE === 'live') {
  // 管理ページ。誰でも開けるURLに置かれるので、守りはGAS側のパスワードだけ。
  // 上の assertAdminLocked() が、鍵のかからない状態での公開を止めている。
  copy('admin.html', 'admin.html');
  // 出店確定情報フォーム。採択通知メールのリンク先。
  // **これを公開し忘れると、採択通知のリンクが404になる。**
  // 送信は取り消せないので、先に置いておく。
  copy('confirm.html', 'confirm.html');
  // 素材アップロード。こちらも採択通知メールのリンク先になる
  copy('upload.html', 'upload.html');
}

/**
 * 送信できないフォームを公開してしまうのを防ぐ。
 *
 * index.html には、ビルド時点の src/endpoint.json の値が焼き込まれる。
 * 空のままビルドしたものを公開すると、**見た目は正常なのに送信だけ効かない**
 * ページが出来上がる。押しても何も起きないので、事故に気づくのは応募者の側になる。
 */
if (MODE === 'live' || MODE === 'preview') {
  const liveUrl = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src', 'endpoint.live.json'), 'utf8')).gasUrl;
  const html = fs.readFileSync(path.join(WT, MODE === 'live' ? 'index.html' : 'preview.html'), 'utf8');
  if (!html.includes(liveUrl)) {
    sh(`git worktree remove --force "${WT}"`);
    console.error([
      '',
      '✗ 公開しようとしたページに、稼働中の送信先が入っていません。',
      '  このまま公開すると、送信ボタンを押しても何も起きないページになります。',
      '  次の手順でビルドし直してください：',
      '    1. src/endpoint.json に endpoint.live.json と同じ URL を入れる',
      '    2. npm run build',
      '    3. もう一度 deploy',
      '',
    ].join('\n'));
    process.exit(1);
  }
  console.log('  送信先   : 稼働中のURLが入っています');
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
