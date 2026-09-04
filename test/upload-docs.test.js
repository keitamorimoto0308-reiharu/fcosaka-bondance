/**
 * 素材アップロード（§6-3）と資料置き場（§6-2）。
 *
 * ■ この2つで一番怖いこと
 *   ・**送信を押しても無反応**（大きすぎるものを送ってGASの上限に当たる）
 *   ・こちらのDriveから、意図しないファイルを消される
 *   ・一般権限の人が図面を消す
 *   ・事業者本人の提出物の場所に、こちらが混ぜて「誰が出したか」が分からなくなる
 *
 * ■ 形の検査と、実際に動かす検査を分ける
 *   Drive は Node で動かないので、GAS側は形（順序・呼び先）で縛る。
 *   模擬サーバーは実際に呼んで応答を見る（形だけの検査は3回すり抜けられた）。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const C = require('../src/content.js');

function cutFunction(code, name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' が見つかりません');
  const end = code.indexOf('\n}\n', start) + 3;
  assert.ok(end > start, name + ' の終わりが見つかりません');
  return code.slice(start, end);
}

/**
 * コメントを外した本体だけを返す。
 * 順序を見る検査は、**コメントに残った文字列**を拾ってしまう。
 * 実際、`var approx = 0; // data.length * 3 / 4` という壊し方が素通りした。
 */
function codeOnly(src) {
  return src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}

/** `var X = [ ... ];` の中身を、実際の要素の配列として返す */
function arrayLiteral(code, name) {
  const m = code.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' が見つかりません');
  return (codeOnly(m[1]).match(/'([^']*)'/g) || []).map(x => x.slice(1, -1));
}

const DRIVE = read('gas/Drive.gs');
const UPLOAD = read('gas/Upload.gs');
const DOCS = read('gas/Docs.gs');
const ADMIN = read('gas/Admin.gs');
const API = read('gas/Api.gs');

// ───────────────────────────── 大きさと種類の歯止め

describe('素材アップロード：送る前に断る', () => {

  test('画面が、送る前に大きさと種類を見ている', () => {
    // ここを通さずに送ると、GASのPOST上限に当たって
    // **押しても無反応**という一番たちの悪い形で失敗する
    const src = read('src/build-upload.js');
    const fn = cutFunction(src, 'handleFiles');
    const send = fn.indexOf('uploadFile');
    // 種類の割り出しは pickMime() に寄せた。ブラウザは .ai / .heic の
    // 種別を空文字で返すので、f.type だけを見ると
    // **ダイアログで選ばせておいて断る**形になっていた
    assert.ok(/var mime = pickMime\(f\);/.test(fn), '種類を見ていません');
    assert.ok(/f\.size > STATE\.max/.test(fn), '大きさを見ていません');
    assert.ok(fn.indexOf('pickMime(f)') < send, '検査より先に送っています');
    assert.ok(fn.indexOf('f.size > STATE.max') < send, '検査より先に送っています');
  });

  test('サーバー側でも同じ上限で止める（画面はあてにしない）', () => {
    const fn = cutFunction(UPLOAD, 'uploadFile_');
    assert.ok(/UPLOAD_ALLOWED\[mime\]/.test(fn), '種類を見ていません');
    assert.ok(/UPLOAD_MAX_BYTES/.test(fn), '大きさを見ていません');
    // 復号する前に長さで弾く。復号してから測ると、上限超えを一度展開してしまう
    const body = codeOnly(fn);
    assert.ok(body.includes('data.length * 3 / 4'),
      '復号前の見積もりがありません（上限超えを一度メモリに載せます）');
    assert.ok(body.indexOf('data.length * 3 / 4') < body.indexOf('base64Decode'),
      '復号してから大きさを見ています（上限超えを一度メモリに載せます）');
  });

  test('1件ずつ送っている（1つ大きいと全部落ちる作りにしない）', () => {
    const src = read('src/build-upload.js');
    const fn = cutFunction(src, 'handleFiles');
    assert.ok(/function next\(\)/.test(fn), '順番に送る作りになっていません');
    assert.ok(!/Promise\.all/.test(fn), 'まとめて送っています');
  });

  test('数の上限がある（鍵を持つ相手にDriveを埋められない）', () => {
    assert.ok(/var UPLOAD_MAX_FILES = \d+;/.test(DRIVE), '数の上限がありません');
    assert.ok(/UPLOAD_MAX_FILES/.test(cutFunction(UPLOAD, 'uploadFile_')), '上限を使っていません');
  });

  test('実行できる種類を受け取らない', () => {
    const m = DRIVE.match(/var UPLOAD_ALLOWED = \(function[\s\S]*?\n\}\)\(\);/);
    assert.ok(m, 'UPLOAD_ALLOWED が見つかりません');
    ['x-msdownload', 'x-sh', 'javascript', 'x-msdos'].forEach(bad => {
      assert.ok(!m[0].includes(bad), '実行できる種類が入っています：' + bad);
    });
    // 素のオブジェクトに戻すと、種別に constructor と書くだけで素通りする。
    // 実際に呼んで確かめるのは test/drive-run.test.js
    assert.ok(/Object\.create\(null\)/.test(m[0]),
      '素のオブジェクトです（prototype 経由で素通りします）');
  });

  test('採択者以外は提出できない', () => {
    ['uploadInfo_', 'uploadFile_'].forEach(n => {
      const fn = cutFunction(UPLOAD, n);
      assert.ok(/findAcceptedRow_/.test(fn), n + ' が鍵を確かめていません');
      assert.ok(/hit\.status !== '採択'/.test(fn), n + ' がステータスを見ていません');
    });
  });

  test('通知は1社あたり1時間に1回にまとめる', () => {
    // 1ファイルごとに送ると、50社×数枚で通知が埋まる
    const fn = cutFunction(UPLOAD, 'uploadNotify_');
    assert.ok(/CacheService/.test(fn), '通知のまとめがありません');
  });

  test('ファイル名の制御文字を、正規表現の範囲指定で落としていない', () => {
    // 範囲指定を生の文字で書くと、本物の制御文字がソースに混ざる（実際に起きた）
    const fn = cutFunction(DRIVE, 'nameCharOk_');
    assert.ok(/charCodeAt\(0\)/.test(fn), '文字コードで落としていません');
    assert.ok(/c < 32/.test(fn) && /c === 127/.test(fn),
      '制御文字とDELを落としていません');
  });
});

// ───────────────────────────── 資料置き場

describe('資料置き場：消せる範囲を限る', () => {

  test('資料フォルダの外にあるファイルは消せない', () => {
    // ファイルIDを受け取って消すので、断らないと
    // **けいたのDrive内の任意のファイル**を消させてしまう
    const fn = cutFunction(DOCS, 'adminDocsDelete_');
    assert.ok(/isInsideDocsRoot_\(file\)/.test(fn), '置き場の中かを確かめていません');
    assert.ok(fn.indexOf('isInsideDocsRoot_') < fn.indexOf('setTrashed'),
      '確かめる前に消しています');
  });

  test('完全には消さない（ゴミ箱に入れる）', () => {
    const fn = cutFunction(DOCS, 'adminDocsDelete_');
    assert.ok(/setTrashed\(true\)/.test(fn), 'ゴミ箱に入れる形になっていません');
    assert.ok(!/removeFile|\.delete\(\)/.test(fn), '完全に消しています');
  });

  test('削除は管理者だけ（一覧と追加は一般もできる）', () => {
    // 区切り文字込みの文字列で探すと、`'adminDocs'];` のような形を見落とす。
    // 要素そのものの配列にしてから比べる（実際にその壊し方が素通りした）。
    const only = arrayLiteral(ADMIN, 'adminOnly');
    assert.ok(only.includes('adminDocsDelete'), '削除が管理者限定になっていません');
    assert.ok(!only.includes('adminDocs'),
      '一覧まで管理者限定になっています（営業が資料を見られません）');
    assert.ok(!only.includes('adminDocsUpload'),
      '追加まで管理者限定になっています（§6-1では一般も可）');
  });

  test('出店者提出物には、こちらから置けない', () => {
    // あそこは事業者本人の提出物の場所。混ぜると「誰が出したか」が分からなくなる。
    // いまは提出物フォルダが**資料フォルダの外**にあるので、
    // 置き先の一覧（DRIVE_SUBFOLDERS）に入っていないことで弾かれる。
    // 実際に呼んで確かめるのは test/drive-run.test.js
    assert.ok(!arrayLiteral(DRIVE, 'DRIVE_SUBFOLDERS').includes('出店者提出物'),
      '出店者提出物が置き先の一覧に入っています');
    const fn = cutFunction(DOCS, 'adminDocsUpload_');
    assert.ok(/DRIVE_SUBFOLDERS\.indexOf\(folderName\) < 0/.test(fn),
      '置き先を一覧で確かめていません');
  });

  test('フォルダの直下に置かれたものも拾う', () => {
    // 人は区分フォルダに入れず、いちばん上に置く。
    // 実際、けいたが最初に置いた企画書が直下にあった
    const fn = cutFunction(DOCS, 'adminDocs_');
    assert.ok(/root\.getFiles\(\)/.test(fn), '直下のファイルを拾っていません');
    assert.ok(/（未分類）/.test(fn), '直下のものを見せる区分がありません');
  });

  test('画面にフォルダIDを返していない', () => {
    // IDが分かると、共有設定によっては直接開けてしまう
    const fn = cutFunction(DRIVE, 'fileToObject_');
    assert.ok(/url: f\.getUrl\(\)/.test(fn), '開くリンクを返していません');
    assert.ok(!/getParents|folderId/.test(fn), 'フォルダの情報を返しています');
  });
});

// ───────────────────────────── 実際に呼んで確かめる

describe('模擬サーバーで実際に呼ぶ', () => {
  const MOCK = require('../src/mock.js');
  const login = (pw, person) => MOCK.handle({ action: 'adminLogin', password: pw, person });

  test('一般権限では削除できない（画面ではなくサーバーが弾く）', () => {
    const staff = login('staff', '佐藤 花子');
    const id = MOCK.DB.docs['（未分類）'][0].id;
    const r = MOCK.handle({ action: 'adminDocsDelete', token: staff.token, fileId: id });
    assert.strictEqual(r.ok, false, '一般権限で削除できます');
    assert.strictEqual(r.error, 'forbidden');
  });

  test('一般権限でも、一覧と追加はできる', () => {
    const staff = login('staff', '佐藤 花子');
    assert.strictEqual(MOCK.handle({ action: 'adminDocs', token: staff.token }).ok, true,
      '一般権限で資料を見られません');
    const up = MOCK.handle({ action: 'adminDocsUpload', token: staff.token,
      folder: '議事録', name: 'メモ.pdf', mime: 'application/pdf', data: 'AAAA' });
    assert.strictEqual(up.ok, true, '一般権限で資料を追加できません');
  });

  test('出店者提出物には置けない', () => {
    const admin = login('admin', '山田 太郎');
    const r = MOCK.handle({ action: 'adminDocsUpload', token: admin.token,
      folder: '出店者提出物', name: 'x.pdf', mime: 'application/pdf', data: 'AAAA' });
    assert.strictEqual(r.ok, false, '出店者提出物に置けてしまいます');
    assert.strictEqual(r.error, 'bad_folder');
  });

  test('採択者以外は素材を提出できない', () => {
    const other = MOCK.DB.rows.find(r => r['ステータス'] !== '採択');
    const r = MOCK.handle({ action: 'uploadInfo', id: other['受付ID'],
      t: MOCK.mockToken(other['受付ID']) });
    assert.strictEqual(r.ok, false, '採択されていないのに提出できます');
    assert.strictEqual(r.error, 'not_accepted');
  });

  test('鍵が違えば提出できない', () => {
    const acc = MOCK.DB.rows.find(r => r['ステータス'] === '採択');
    const r = MOCK.handle({ action: 'uploadFile', id: acc['受付ID'],
      t: MOCK.mockToken('SB-9999'), name: 'a.png', mime: 'image/png', data: 'AAAA' });
    assert.strictEqual(r.ok, false, '鍵が違うのに提出できます');
    assert.strictEqual(r.error, 'denied');
  });

  test('受け取れない種類は断る', () => {
    const acc = MOCK.DB.rows.find(r => r['ステータス'] === '採択');
    const r = MOCK.handle({ action: 'uploadFile', id: acc['受付ID'],
      t: MOCK.mockToken(acc['受付ID']),
      name: 'a.exe', mime: 'application/x-msdownload', data: 'AAAA' });
    assert.strictEqual(r.ok, false, '実行できる種類を受け取っています');
    assert.strictEqual(r.error, 'type');
  });

  test('大きすぎるものは断る', () => {
    const acc = MOCK.DB.rows.find(r => r['ステータス'] === '採択');
    // base64 で上限を超える長さを作る
    const big = 'A'.repeat(15 * 1024 * 1024);
    const r = MOCK.handle({ action: 'uploadFile', id: acc['受付ID'],
      t: MOCK.mockToken(acc['受付ID']), name: 'a.png', mime: 'image/png', data: big });
    assert.strictEqual(r.ok, false, '上限を超えるものを受け取っています');
    assert.strictEqual(r.error, 'too_large');
  });
});

// ───────────────────────────── ページ

describe('素材アップロードのページ', () => {

  test('ビルドされ、公開物に入る', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'upload.html')), 'upload.html がありません');
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.scripts.build.includes('build-upload'), 'build に入っていません');
    assert.ok(/copy\('upload\.html', 'upload\.html'\)/.test(read('src/deploy.js')),
      'deploy.js が公開していません。採択通知のリンクが404になります');
  });

  test('検索に出さず、トークンを外部へ漏らさない', () => {
    const html = read('upload.html');
    assert.ok(/name="robots" content="noindex/.test(html), '検索避けがありません');
    assert.ok(/name="referrer" content="no-referrer"/.test(html), 'referrer を止めていません');
  });

  test('画面のコードが構文として通る', () => {
    const html = read('upload.html');
    const m = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(m, '画面のコードが見つかりません');
    assert.doesNotThrow(() => new Function(m[1]),
      'upload.html の <script> が構文エラーです。画面は1行も動きません');
  });

  test('事業者が自分で消せる操作を置いていない', () => {
    // 間違えて消すと戻せない。出し直せば新しい版が並ぶ
    const html = read('upload.html');
    assert.ok(!/uploadDelete|データを削除/.test(html), '削除の操作があります');
  });

  test('デザインは応募フォームと同じコードを使っている', () => {
    assert.ok(/FORM\.css\(\)/.test(read('src/build-upload.js')), 'CSSを共有していません');
  });

  test('管理ページに資料置き場タブがある', () => {
    const html = read('admin.html');
    assert.ok(html.includes('data-tab="docs"'), '資料置き場タブがありません');
    // 一覧は一般も見られる。admin-only を付けてはいけない
    const m = html.match(/<button data-tab="docs"[^>]*>/);
    assert.ok(m && !m[0].includes('admin-only'),
      '資料置き場タブが管理者限定になっています（§6-1では一般も閲覧可）');
  });
});
