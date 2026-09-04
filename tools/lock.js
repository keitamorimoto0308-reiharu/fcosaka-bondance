/**
 * 「同じフォルダを2人が同時にいじる」ための鍵。
 *
 * ■ なぜ要るか（2026-09-04）
 *   けいたの指摘：「別のセッションでスケジュール機能の開発も同じように進んでるけど
 *   大丈夫？ 作業かぶって壊れない？」
 *
 *   同じ作業フォルダを、2つのセッションが触っている。
 *   別々のコピーが喧嘩するのではなく、**同じ1つのものを同時にいじる**のが危ない。
 *
 *   いちばん怖い順：
 *     1. **わざと壊す検査の最中に、本番へ上げる**
 *        壊し検査は gas/*.gs と src/mock.js を一時的に書き換える。
 *        その瞬間に `clasp push` すると、**壊れたコードが本番に行く**。
 *        `npm run push` は先にテストを流すが、
 *        壊し検査は「テストがわざと落ちる状態」を作るので、
 *        タイミング次第ですり抜ける。
 *     2. 本番へ上げている最中に、もう片方が編集する
 *        push はフォルダにあるものを丸ごと上げるので、書きかけも一緒に上がる
 *     3. 両方がページを公開する（あとに実行したほうで上書き）
 *
 * ■ どう防ぐか
 *   「いま危ない作業をしている」ことを、ファイル1つで知らせ合う。
 *   取れなければ、**誰が・何を・いつから**やっているかを見せて止まる。
 *
 * ■ 使い方
 *   node tools/lock.js take deploy "本番へ反映"    鍵を取る（取れなければ終了コード2）
 *   node tools/lock.js free deploy                鍵を返す
 *   node tools/lock.js check                      いま誰が何をしているか
 *
 *   鍵の種類は2つ：
 *     deploy … 本番へ上げる（push / create-version / update-deployment / deploy.js）
 *     break  … ソースを一時的に壊す（npm run break / break_*.py）
 *   **この2つは同時に持てない。**
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, '.locks');
const KINDS = ['deploy', 'break'];

/** 古い鍵は自動で外す。持ち主が落ちたまま残ると、誰も作業できなくなる */
const STALE_MIN = 30;

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function lockFile(kind) {
  return path.join(DIR, kind + '.lock');
}

function readLock(kind) {
  try {
    const raw = fs.readFileSync(lockFile(kind), 'utf8');
    const info = JSON.parse(raw);
    const ageMin = (Date.now() - Number(info.at || 0)) / 60000;
    return Object.assign({}, info, { ageMin });
  } catch (e) {
    return null;
  }
}

function describe(kind, info) {
  const what = kind === 'deploy' ? '本番へ反映' : 'ソースを壊す検査';
  return '「' + what + '」を ' + (info.who || '誰か') + ' が '
       + Math.round(info.ageMin) + '分前から実行中'
       + (info.note ? '（' + info.note + '）' : '');
}

function take(kind, note) {
  ensureDir();
  // もう片方の鍵も見る。deploy と break は同時に持てない
  const others = KINDS.filter(k => k !== kind).concat([kind]);
  for (const k of others) {
    const info = readLock(k);
    if (!info) continue;
    if (info.ageMin > STALE_MIN) {
      console.log('（' + k + ' の古い鍵を外しました：' + Math.round(info.ageMin) + '分前）');
      try { fs.unlinkSync(lockFile(k)); } catch (e) {}
      continue;
    }
    if (info.pid && info.pid === process.pid) continue;
    console.error('[中止] ' + describe(k, info));
    console.error('');
    console.error('  同じフォルダを2つのセッションが触っています。');
    console.error('  この2つを同時にやると、**壊れたコードが本番に行く**ことがあります。');
    console.error('');
    console.error('  向こうが終わるのを待つか、終わっているのに残っているなら：');
    console.error('    node tools/lock.js free ' + k);
    return 2;
  }
  fs.writeFileSync(lockFile(kind), JSON.stringify({
    who: os.userInfo().username + '@' + os.hostname(),
    pid: process.pid,
    at: Date.now(),
    note: note || '',
  }, null, 2), 'utf8');
  console.log('鍵を取りました：' + kind + (note ? '（' + note + '）' : ''));
  return 0;
}

function free(kind) {
  try {
    fs.unlinkSync(lockFile(kind));
    console.log('鍵を返しました：' + kind);
  } catch (e) {
    console.log('（' + kind + ' の鍵はありませんでした）');
  }
  return 0;
}

function check() {
  ensureDir();
  let any = false;
  KINDS.forEach(k => {
    const info = readLock(k);
    if (!info) return;
    any = true;
    console.log((info.ageMin > STALE_MIN ? '[古い] ' : '[実行中] ') + describe(k, info));
  });
  if (!any) console.log('いま危ない作業をしている人はいません。');
  return 0;
}

const [cmd, kind, note] = process.argv.slice(2);
if (cmd === 'take' && KINDS.includes(kind)) process.exit(take(kind, note));
else if (cmd === 'free' && KINDS.includes(kind)) process.exit(free(kind));
else if (cmd === 'check') process.exit(check());
else {
  console.error('使い方: node tools/lock.js take|free deploy|break [メモ] / check');
  process.exit(1);
}
