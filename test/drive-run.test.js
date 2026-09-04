/**
 * Drive まわりを **実際に動かして** 確かめる。
 *
 * ■ なぜ形を見る検査では足りなかったか
 *   `test/upload-docs.test.js` は「その文字列がソースに在るか」を見ている。
 *   これでは次の3つが素通りした（検証役が実際に破った）：
 *
 *     ・`UPLOAD_ALLOWED[mime]` は、種別に `constructor` と入れるだけで真になる
 *     ・`safeFileName_` は名前の拡張子を見ないので、image/png と偽って
 *       `invoice.pdf.html` を置ける
 *     ・`isInsideDocsRoot_` は親をたどるだけなので、`出店者提出物` フォルダ
 *       そのものを指されると「中にある」と答え、全社の提出物が消える
 *
 *   どれも「文字列は在るのに守れていない」形なので、動かすしかない。
 *   ここでは偽の DriveApp を差して、関数をそのまま呼ぶ。
 *
 * ■ 本番のDriveには一切触らない
 *   vm の中に閉じた偽物だけを使う。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

let seq = 0;
/** Driveへの問い合わせ回数。輪になったときに膨らまないかを見る */
const calls = { getParents: 0 };
function iter(list) {
  let i = 0;
  return { hasNext: () => i < list.length, next: () => list[i++] };
}

function makeNode(name, mime, parents) {
  const node = {
    id: 'id-' + (++seq) + '-' + name,
    name, mime,
    parents: parents ? parents.slice() : [],
    files: [], folders: [],
    trashed: false, size: 100,
    getId() { return this.id; },
    getName() { return this.name; },
    getMimeType() { return this.mime; },
    getSize() { return this.size; },
    getLastUpdated() { return new Date('2026-09-01T00:00:00Z'); },
    getUrl() { return 'https://drive.example/' + this.id; },
    getParents() { seq += 0; calls.getParents++; return iter(this.parents); },
    setTrashed(v) { this.trashed = v; },
    getFiles() { return iter(this.files); },
    getFolders() { return iter(this.folders); },
    getFoldersByName(n) { return iter(this.folders.filter(f => f.name === n)); },
    createFolder(n) { const f = makeNode(n, FOLDER_MIME, [this]); this.folders.push(f); return f; },
    createFile(blob) {
      const f = makeNode(blob.name, blob.mime, [this]);
      f.size = blob.size;
      this.files.push(f);
      return f;
    },
  };
  return node;
}

/** 偽のDrive一式と、その中で Drive.gs / Docs.gs を動かす箱を作る */
function makeBox() {
  const root = makeNode('サステナ盆踊り_資料', FOLDER_MIME, []);
  // 提出物は資料フォルダの**外**。資料フォルダはリンク共有しているので、
  // 中に入れるとIDを知る誰でも読める
  const subm = makeNode('サステナ盆踊り_出店者提出物（社外秘）', FOLDER_MIME, []);
  const outsideRoot = makeNode('けいたの私物', FOLDER_MIME, []);
  const outsideFile = makeNode('確定申告.pdf', 'application/pdf', [outsideRoot]);

  const byId = {};
  const reg = n => { byId[n.id] = n; return n; };
  reg(root); reg(subm); reg(outsideRoot); reg(outsideFile);

  const history = [];
  const box = vm.createContext({
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, Date,
    console: { error() {}, log() {} },
    DriveApp: {
      getFolderById(id) {
        const n = byId[id];
        if (!n || n.mime !== FOLDER_MIME) throw new Error('no folder ' + id);
        return n;
      },
      getFileById(id) {
        // 実GASがフォルダIDでFileを返すかは版により変わりうる。
        // **返す側（危険な側）で試す**。返さない版でも守りは成立する
        const n = byId[id];
        if (!n) throw new Error('no file ' + id);
        return n;
      },
    },
    Utilities: {
      formatDate: () => '2026-09-01 00:00',
      base64Decode: s => ({ length: Math.floor(String(s).length * 3 / 4) }),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name, size: bytes.length }),
    },
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    LOCK_WAIT_MS: 1000,
    configText: k => (k === '資料フォルダID' ? root.id
                    : k === '提出物フォルダID' ? subm.id : ''),
    sheet_: () => { throw new Error('設定シートなし'); },
    findConfigRow_: () => 0,
    readLedger_: () => { throw new Error('台帳なし'); },
    appendHistory: (...a) => history.push(a),
    logError_() {},
    COL: { id: '受付ID', company: '企業名' },
  });

  vm.runInContext(read('gas/Drive.gs'), box);
  vm.runInContext(read('gas/Docs.gs'), box);

  const call = (fn, ...args) => vm.runInContext(fn, box)(...args);
  return { box, call, root, subm, outsideRoot, outsideFile, byId, reg, history,
           node: (n) => reg(n) };
}

// ─────────────────────────────── ファイル名

test('safeFileName_ が DEL（127）を落とす', () => {
  const { call } = makeBox();
  const out = call('safeFileName_', 'a' + String.fromCharCode(127) + 'b.png', '');
  assert.strictEqual(out, 'ab.png');
});

test('safeFileName_ が書字方向を上書きする文字（U+202E）を落とす', () => {
  const { call } = makeBox();
  // photo<RLO>gnp.exe は、画面上では photoexe.png に見える。
  // 通知メールにも管理ページの削除確認にも、そのまま出てしまう
  const out = call('safeFileName_', 'photo' + String.fromCharCode(0x202E) + 'gnp.exe', '');
  assert.ok(out.indexOf(String.fromCharCode(0x202E)) < 0, '上書き文字が残っている: ' + out);
});

test('safeFileName_ が見えない文字（U+200B・U+FEFF）を落とす', () => {
  const { call } = makeBox();
  const invisible = String.fromCharCode(0x200B) + String.fromCharCode(0xFEFF);
  assert.strictEqual(call('safeFileName_', invisible, ''), '提出物');
});

test('拡張子を渡すと、名前側の拡張子は捨てて付け直す', () => {
  const { call } = makeBox();
  // image/png と申告して .html を置く手が塞がっているか
  assert.strictEqual(call('safeFileName_', 'invoice.pdf.html', 'png'), 'invoice.pdf.png');
  assert.strictEqual(call('safeFileName_', 'ロゴ', 'png'), 'ロゴ.png');
});

test('すでに正しい拡張子なら、綴り（大文字）はそのまま', () => {
  const { call } = makeBox();
  // IMG_4821.HEIC を .heic に直すと、出した本人には
  // 「名前が変わってしまった」と映る
  assert.strictEqual(call('safeFileName_', 'IMG_4821.HEIC', 'heic'), 'IMG_4821.HEIC');
  assert.strictEqual(call('safeFileName_', '写真.JPG', 'jpg'), '写真.JPG');
});

test('長すぎる名前でも、付け直した拡張子が残る', () => {
  const { call } = makeBox();
  const out = call('safeFileName_', 'あ'.repeat(400) + '.html', 'png');
  assert.ok(out.length <= 120, '長さ ' + out.length);
  assert.ok(/\.png$/.test(out), out.slice(-10));
});

// ─────────────────────────────── 受け取る種類

test('allowedExt_ は prototype のものを「有り」と答えない', () => {
  const { call } = makeBox();
  // ここが真になると、種別に constructor と書くだけで .exe が置ける
  ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'].forEach(m => {
    assert.strictEqual(call('allowedExt_', m), '', m + ' が通っている');
  });
});

test('allowedExt_ は、載っている種類には拡張子を返す', () => {
  const { call } = makeBox();
  assert.strictEqual(call('allowedExt_', 'image/png'), 'png');
  assert.strictEqual(call('allowedExt_', 'application/pdf'), 'pdf');
  assert.strictEqual(call('allowedExt_', 'application/x-msdownload'), '');
});

// ─────────────────────────────── 資料フォルダの内外

test('資料フォルダの中のファイルは「中」と答える', () => {
  const { call, root, node } = makeBox();
  const sub = root.createFolder('図面');
  node(sub);
  const f = node(makeNode('会場図.pdf', 'application/pdf', [sub]));
  assert.strictEqual(call('isInsideDocsRoot_', f), true);
});

test('資料フォルダの外のファイルは「外」と答える', () => {
  const { call, outsideFile } = makeBox();
  assert.strictEqual(call('isInsideDocsRoot_', outsideFile), false);
});

// フォルダは自分の親になれないので、これは Drive の性質としてこうなる。
// 見張りを足しても壊しようがない（＝足すと嘘の行が増える）ので、
// ここでは「そうなっている」ことだけを固定しておく
test('資料フォルダ自身は「中」と答えない', () => {
  const { call, root } = makeBox();
  root.parents.push(makeNode('マイドライブ', FOLDER_MIME, []));
  assert.strictEqual(call('isInsideDocsRoot_', root), false);
});

test('親が輪になっていても止まり、Driveへの問い合わせが膨らまない', () => {
  const { call, root, node } = makeBox();
  // 親が2つあるものを輪に組む。親が1つずつだと枝が増えず、
  // 「たどった先を覚えているか」を確かめられない
  const a = node(makeNode('A', FOLDER_MIME, []));
  const b = node(makeNode('B', FOLDER_MIME, [a]));
  const c = node(makeNode('C', FOLDER_MIME, [a]));
  a.parents.push(b, c);                    // A ⇄ B、A ⇄ C
  const f = node(makeNode('わな.pdf', 'application/pdf', [a]));

  calls.getParents = 0;
  const t0 = Date.now();
  assert.strictEqual(call('isInsideDocsRoot_', f), false);
  assert.ok(Date.now() - t0 < 2000, '止まらなかった');

  // 深さの上限だけでは「止まる」しか言えない。たどった先を覚えていないと、
  // 枝が段ごとに倍々になって約2000回問い合わせる。回数まで見る
  assert.ok(calls.getParents < 20,
    'たどった先を覚えていない（' + calls.getParents + '回）');
  assert.ok(root);
});

test('深く埋もれたものは「外」と答える（閉じる側に倒す）', () => {
  const { call, root, node } = makeBox();
  // 10段より深いところは、たどりきらずに「外」と答える。
  // 消せなくなる不便より、外のものを消す事故を避ける
  let cur = root;
  for (let i = 0; i < 12; i++) { cur = cur.createFolder('層' + i); node(cur); }
  const f = node(makeNode('深いもの.pdf', 'application/pdf', [cur]));
  assert.strictEqual(call('isInsideDocsRoot_', f), false);
});

test('提出物フォルダは、共有している資料フォルダの中に無い', () => {
  // ここが資料フォルダの中に戻ると、リンクを知る誰でも
  // 応募企業のロゴ原本や写真を読める。Drive は共有フォルダの中だけを
  // 制限付きにできないので、**外に置く**しか手が無い
  const { call, root, subm } = makeBox();
  const folder = call('submissionsFolder_');
  assert.strictEqual(folder.getId(), subm.id);
  const inRoot = [];
  const it = root.getFolders();
  while (it.hasNext()) inRoot.push(it.next().getId());
  assert.ok(inRoot.indexOf(subm.id) < 0, '提出物が資料フォルダの中にあります');
});

/** そのフォルダが、資料フォルダの子孫か（親をたどる） */
function underRoot(node, rootId) {
  const seen = new Set();
  let q = node.parents.slice();
  while (q.length) {
    const n = q.shift();
    if (n.id === rootId) return true;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    q = q.concat(n.parents);
  }
  return false;
}

test('事業者の提出先が、共有している資料フォルダの中に作られない', () => {
  // submissionsFolder_ が正しくても、vendorFolder_ が
  // 資料フォルダの下に作ってしまえば同じこと。**置かれる場所**を見る
  const { call, root, node } = makeBox();
  node(call('vendorFolder_', 'SB-0001'));
  const vf = call('vendorFolder_', 'SB-0001');
  assert.ok(!underRoot(vf, root.getId()),
    '提出先が資料フォルダの中にあります: ' + vf.getName());
});

test('提出物フォルダの中のものも、管理者は消せる', () => {
  const { call, subm, node } = makeBox();
  const sb = subm.createFolder('SB-0001'); node(sb);
  const f = node(makeNode('店舗ロゴ.png', 'image/png', [sb]));
  const r = call('adminDocsDelete_', { person: '検査' }, { fileId: f.id });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(f.trashed, true);
});

// ─────────────────────────────── 削除

test('資料フォルダの中のファイルは、管理者なら消せる', () => {
  const { call, root, node } = makeBox();
  const sub = root.createFolder('図面'); node(sub);
  const f = node(makeNode('会場図.pdf', 'application/pdf', [sub]));

  const r = call('adminDocsDelete_', { person: '検査' }, { fileId: f.id });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(f.trashed, true);
});

test('資料フォルダの外のファイルは消せない', () => {
  const { call, outsideFile } = makeBox();
  const r = call('adminDocsDelete_', { person: '検査' }, { fileId: outsideFile.id });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'forbidden');
  assert.strictEqual(outsideFile.trashed, false, 'けいたの私物が消えた');
});

test('フォルダは消せない（区分フォルダ・受付IDフォルダとも）', () => {
  const { call, root, subm, node } = makeBox();
  const teishutsu = subm;
  const sb = teishutsu.createFolder('SB-0001'); node(sb);
  const zumen = root.createFolder('図面'); node(zumen);

  // ここが通ると、全社の提出物が一撃でゴミ箱に入る
  [teishutsu, sb, zumen].forEach(f => {
    const r = call('adminDocsDelete_', { person: '検査' }, { fileId: f.id });
    assert.strictEqual(r.ok, false, f.name + ' が消せてしまう');
    assert.strictEqual(r.error, 'forbidden');
    assert.strictEqual(f.trashed, false, f.name + ' がゴミ箱に入った');
  });
});

test('存在しないIDは、その旨を返して落ちない', () => {
  const { call } = makeBox();
  const r = call('adminDocsDelete_', { person: '検査' }, { fileId: 'nope' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'not_found');
});

// ─────────────────────────────── 管理ページからの追加

test('管理ページからでも、開くと動くものは置けない', () => {
  const { call } = makeBox();
  ['a.exe', 'a.bat', 'a.hta', 'a.js', 'a.html'].forEach(name => {
    const r = call('adminDocsUpload_', { person: '検査' },
      { folder: '図面', name, mime: 'application/octet-stream', data: 'AAAA' });
    assert.strictEqual(r.ok, false, name + ' が置けてしまう');
    assert.strictEqual(r.error, 'type');
  });
});

test('管理ページから出店者提出物には置けない', () => {
  const { call } = makeBox();
  const r = call('adminDocsUpload_', { person: '検査' },
    { folder: '出店者提出物', name: 'x.pdf', mime: 'application/pdf', data: 'AAAA' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'bad_folder');
});

test('管理ページからPDFは置ける', () => {
  const { call, history } = makeBox();
  const r = call('adminDocsUpload_', { person: '検査' },
    { folder: '図面', name: '会場図.pdf', mime: 'application/pdf', data: 'AAAA' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.file.name, '会場図.pdf');
  assert.strictEqual(history.length, 1, '変更履歴に残っていない');
});

test('置き先が一覧に無い名前なら断る', () => {
  const { call } = makeBox();
  ['', '../', 'constructor', '図面 '].forEach(folder => {
    const r = call('adminDocsUpload_', { person: '検査' },
      { folder, name: 'x.pdf', mime: 'application/pdf', data: 'AAAA' });
    assert.strictEqual(r.ok, false, JSON.stringify(folder) + ' が通る');
    assert.strictEqual(r.error, 'bad_folder');
  });
});
