/**
 * 管理ページの受け入れテスト
 *
 * 管理ページは GitHub Pages（誰でも開けるURL）に置き、GASのウェブアプリも
 * 匿名アクセスを許可している。つまり画面を隠しても意味がなく、
 * **守りはすべてサーバー側にある**。
 *
 * GASのコードはNode上では実行できない（SpreadsheetApp などが無い）ので、
 * ここではソースを読んで「性質」を確かめる。
 * 一番大事なのは「データを返す入口が、認証を通さずに存在しないこと」で、
 * これは文字列として検査すれば確実に言える。
 *
 * 実行: npm test
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const ADMIN_GS = read('gas/Admin.gs');
const AUTH_GS = read('gas/Auth.gs');
const API_GS = read('gas/Api.gs');
const MOCK = read('src/mock.js');
const S = require('../src/schema.js');

/** gas/Admin.gs の COL（キー→実際の列名）を読み取る */
function colMapOf(src) {
  const seg = src.slice(src.indexOf('var COL = {'));
  const body = seg.slice(0, seg.indexOf('};'));
  const out = {};
  for (const m of body.matchAll(/(\w+):\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

/** COL.xxx の並びを、実際の列名に直して返す */
function resolvedList(src, marker) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, '見つかりません: ' + marker);
  const open = src.indexOf('[', i), close = src.indexOf(']', open);
  const cols = colMapOf(src);
  return src.slice(open + 1, close)
    .split(',').map(x => x.trim()).filter(Boolean)
    .filter(x => x.indexOf('COL.') === 0)
    .map(x => cols[x.slice(4)]);
}

/** ソースから配列リテラルを取り出す（'…' で並んだもの） */
function arrayLiteral(src, marker) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, '見つかりません: ' + marker);
  const open = src.indexOf('[', i), close = src.indexOf(']', open);
  return src.slice(open + 1, close).split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

describe('管理ページ：認証を通さずにデータが出ないか', () => {

  test('認証の前に通してよいのは、パスワード照合と入室だけ', () => {
    // adminDispatch_ の中で requireAuth_ より前に return しているものを数える
    const body = ADMIN_GS.slice(ADMIN_GS.indexOf('function adminDispatch_'));
    const beforeAuth = body.slice(0, body.indexOf('requireAuth_'));
    const early = [...beforeAuth.matchAll(/action === '(\w+)'/g)].map(m => m[1]);
    assert.deepStrictEqual(early.sort(), ['adminLogin', 'adminNames'],
      '認証の前に応答する入口が増えています: ' + early.join(', ')
      + '（データを返すものをここに足してはいけません）');
  });

  test('認証に失敗したら、その場で打ち切っている', () => {
    // 打ち切りは switch より前になければならない。
    // 後ろに置くと、認証に失敗しても各 case へ落ちてしまう。
    const d = ADMIN_GS.slice(ADMIN_GS.indexOf('function adminDispatch_'));
    const abort = d.indexOf("error: 'unauthorized'");
    const sw = d.indexOf('switch (action)');
    assert.ok(abort >= 0, '認証失敗時に unauthorized を返していません');
    assert.ok(sw > abort, '認証の打ち切りが switch より後ろにあります（素通りします）');
    assert.ok(/if \(!v\.auth\)/.test(d) || /if \(!auth\)/.test(d),
      '認証結果を確かめずに先へ進んでいます');
  });

  test('管理APIの入口が1つに絞られている', () => {
    // doPost の switch に admin* を直接足すと、認証を通さない経路ができる
    const post = API_GS.slice(API_GS.indexOf('function doPost'));
    assert.ok(post.includes('adminDispatch_'), 'doPost から adminDispatch_ を呼んでいません');
    const cases = [...post.matchAll(/case '(\w+)':/g)].map(m => m[1]);
    const admins = cases.filter(c => c.indexOf('admin') === 0);
    assert.deepStrictEqual(admins, [],
      'doPost の switch に管理APIが直接生えています: ' + admins.join(', '));
  });

  test('公開のGETから管理APIに入れない', () => {
    const get = API_GS.slice(API_GS.indexOf('function doGet'), API_GS.indexOf('function doPost'));
    // コメントに admin と書いただけで落ちないよう、分岐だけを見る
    const branches = [...get.matchAll(/case '(\w+)'|action === '(\w+)'/g)]
      .map(m => m[1] || m[2]);
    const admins = branches.filter(b => b.indexOf('admin') === 0);
    assert.deepStrictEqual(admins, [], 'doGet に管理系の分岐があります（GETは公開経路です）');
  });

  test('トークンの検証が、期限・署名・パスワード変更の3つを見ている', () => {
    // 中身は verifyTokenDetail_ にある（verifyToken_ はその薄い包み）
    const v = AUTH_GS.slice(AUTH_GS.indexOf('function verifyTokenDetail_'));
    assert.ok(v.includes('safeEquals_(hmac_(parts[0]), parts[1])'), '署名を検証していません');
    assert.ok(/payload\.e < new Date\(\)\.getTime\(\)/.test(v), '期限を見ていません');
    assert.ok(v.includes('passwordFingerprint_()'),
      'パスワード変更で失効しません（§6-1「パスワード変更時は全端末で失効」）');
  });

  test('管理者になれるのは、シートの役割と入室時のパスワードが両方とも管理者のときだけ', () => {
    // シートの役割だけを見ていた時期があり、そのときは
    // 一般パスワードしか知らない人が、管理者の氏名を選ぶだけで管理者になれた。
    // 氏名は秘密ではない（応募フォームが担当社員の一覧を公開している）。
    const v = AUTH_GS.slice(AUTH_GS.indexOf('function verifyTokenDetail_'));
    assert.ok(/sheetAdmin\s*&&\s*tokenAdmin/.test(v),
      'シートの役割と、どのパスワードで入ったかの両方を見ていません（権限昇格）');
    assert.ok(v.includes("still[0].role === '管理者'"),
      'シートの役割を見ていません（管理者から一般に落としても効かなくなります）');
    assert.ok(v.includes("payload.r === '管理者'"),
      '入室時のパスワードを見ていません');
  });

  test('総当たりに対して、遅くするだけでなく回数で止めている', () => {
    // GASは同時実行を受け付けるので、待たせるだけでは毎時数万回の試行を止められない
    assert.ok(AUTH_GS.includes('function loginLocked_'), '締め出しの仕組みがありません');
    assert.ok(/n >= LOGIN_FAIL_LOCK/.test(AUTH_GS), '回数で止めていません');
    assert.ok(/n % LOGIN_FAIL_ALERT === 0/.test(AUTH_GS),
      '通知が1回きりです（攻撃が続いても2通目が飛びません）');
  });

  test('短いパスワードのままでは管理ページを開かない', () => {
    // 運用ルールに頼ると、短いパスワードのまま公開されうる
    assert.ok(AUTH_GS.includes('function passwordTooWeak_'), 'パスワード強度を見ていません');
    assert.ok(/MIN_PASSWORD_LEN = \d+/.test(AUTH_GS));
    assert.ok(AUTH_GS.includes("error: 'weak_password'"));
  });

  test('公開ページの鍵になる列を、ブラウザへ送らない', () => {
    // 素材トークンは素材アップロードページ（§6-3）のアクセス鍵。
    // 画面側で隠すだけでは、通信欄や拡張機能から素通しになる
    assert.ok(/NEVER_SEND\s*=\s*\[[^\]]*素材トークン/.test(ADMIN_GS),
      '素材トークンをサーバー側で除外していません');
  });

  test('管理APIの例外が、応募の失敗として処理されない', () => {
    // doPost の catch は「応募が記録できなかった」ときの処理で、
    // 退避シートに空行を書き、運用者に誤ったメールを送ってしまう
    const seg = API_GS.slice(API_GS.indexOf("indexOf('admin') === 0"));
    assert.ok(seg.slice(0, 500).includes('try {'),
      '管理APIの呼び出しが独自の try/catch で囲まれていません');
    assert.ok(!seg.slice(0, 500).includes('quarantine_'));
  });

  test('パスワードが未設定のまま素通りしない', () => {
    assert.ok(AUTH_GS.includes("error: 'not_configured'"),
      'パスワード未設定のときに拒否していません（公開URLが素通しになります）');
  });

  test('入室に失敗しても、氏名とパスワードのどちらが違うか教えない', () => {
    const l = AUTH_GS.slice(AUTH_GS.indexOf('function adminLogin_'));
    assert.ok(l.includes('お名前またはパスワードが違います'),
      '失敗の理由を分けて返すと、氏名の総当たりに使われます');
  });
});

describe('管理ページ：書き換えてよい範囲', () => {

  const editableGas = resolvedList(ADMIN_GS, 'function EDITABLE_');
  const editableMock = arrayLiteral(MOCK, 'const EDITABLE =');

  test('応募者が書いた内容を、管理側から直接書き換えられない', () => {
    // 応募フォームの項目名（シート列名）が編集可能リストに混ざっていないこと。
    // ロック解除の仕組み（§6-2）を経ずに上書きできてはいけない。
    const applyCols = S.applyFields().map(f => f.sheet).filter(Boolean);
    const leaked = editableGas.filter(c => applyCols.indexOf(c) >= 0);
    assert.deepStrictEqual(leaked, [],
      '応募者の記入欄が直接編集できるようになっています: ' + leaked.join(', '));
  });

  test('編集できない項目が来たら、値を書かずに拒否する', () => {
    const u = ADMIN_GS.slice(ADMIN_GS.indexOf('function adminUpdate_'));
    const guard = u.indexOf("error: 'forbidden_field'");
    const write = u.indexOf('.setValue(');
    assert.ok(guard >= 0 && guard < write,
      '不正な項目の検査が、書き込みより後にあります');
  });

  test('ステータスは決められた値しか入らない', () => {
    const u = ADMIN_GS.slice(ADMIN_GS.indexOf('function adminUpdate_'));
    assert.ok(u.includes('STATUS_LIST_().indexOf(patch[COL.status]) < 0'),
      'ステータスに任意の文字列を書き込めてしまいます');
  });

  test('変更は必ず変更履歴に残る', () => {
    const u = ADMIN_GS.slice(ADMIN_GS.indexOf('function adminUpdate_'));
    assert.ok(u.includes('appendHistory('), '変更履歴に記録していません');
    assert.ok(u.includes('auth.person'), '誰が変更したかを記録していません');
  });

  test('模擬サーバーとGASで、編集できる項目がそろっている', () => {
    // 食い違うと「模擬では動いたのに本番で落ちる」になる
    assert.deepStrictEqual(editableMock.slice().sort(), editableGas.slice().sort());
  });

  test('ステータスの一覧が schema.js とそろっている', () => {
    const gas = arrayLiteral(ADMIN_GS, 'function STATUS_LIST_');
    assert.deepStrictEqual(gas, S.STATUS);
    const mock = arrayLiteral(MOCK, 'const STATUSES =');
    assert.deepStrictEqual(mock, S.STATUS);
  });
});

describe('管理ページ：画面側', () => {

  const built = () => {
    const f = path.join(ROOT, 'admin.html');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };

  test('画面が生成されている', () => {
    assert.ok(built(), 'admin.html がありません。npm run build を実行してください');
  });

  test('検索エンジンに拾わせない指定がある', () => {
    assert.match(built(), /<meta name="robots" content="noindex, nofollow">/);
  });

  test('画面にパスワードを埋め込んでいない', () => {
    const h = built();
    // 公開ページなので、当然だが機械的に見張る
    assert.ok(!/パスワード\s*[:=]\s*['"][^'"]+['"]/.test(h), 'パスワードらしき定数があります');

    // 以前は「管理者パスワードという文字列を出さない」と見ていたが、
    // 設定タブでは**項目名として**出す必要がある（値ではない）。
    // 守りたいのは値なので、そちらを直接見る。
    // いま入っている値をサーバーが返さないことは test/settings.test.js で確かめている。
    const pwInputs = h.match(/<input[^>]*type="password"[^>]*>/g) || [];
    assert.ok(pwInputs.length > 0, 'パスワード欄が見つかりません');
    for (const tag of pwInputs) {
      assert.ok(!/\svalue=/.test(tag),
        'パスワード欄に初期値が入っています（いまの値が画面に出ます）: ' + tag);
    }
    // 画面側が、返ってきた値をパスワード欄へ書き戻していないか
    assert.ok(!/pw-[^']*'\)\.value\s*=/.test(h),
      'パスワード欄に値を書き戻しています');
  });

  test('パスワードをブラウザに保存していない', () => {
    const h = built();
    const save = h.slice(h.indexOf('localStorage.setItem'), h.indexOf('localStorage.setItem') + 220);
    assert.ok(!save.includes('pw'), 'localStorage にパスワードを保存しています');
    assert.ok(/S\.pw = ''/.test(h), '入室後にパスワードを画面から消していません');
  });

  test('画面が呼ぶAPIは、すべてGAS側に存在する', () => {
    const h = built();
    const called = [...h.matchAll(/api\('(\w+)'/g)].map(m => m[1]);
    const known = [...ADMIN_GS.matchAll(/case '(\w+)':/g)].map(m => m[1])
      .concat(['adminNames', 'adminLogin']);
    const missing = called.filter(a => known.indexOf(a) < 0);
    assert.deepStrictEqual(missing, [], 'GAS側に無いAPIを呼んでいます: ' + missing.join(', '));
  });

  test('模擬サーバーも、同じAPIを全部持っている', () => {
    const known = [...ADMIN_GS.matchAll(/case '(\w+)':/g)].map(m => m[1]);
    const missing = known.filter(a => MOCK.indexOf("'" + a + "'") < 0);
    assert.deepStrictEqual(missing, [],
      '模擬サーバーに無いAPIがあります: ' + missing.join(', ')
      + '（模擬で確かめられない機能ができてしまいます）');
  });

  test('ステータスを変えるときは確認をはさむ', () => {
    // 一覧をスマホで触っていて、うっかり変えてしまうのを防ぐ（monitor_review S6）
    const h = built();
    const save = h.slice(h.indexOf('function saveDetail'));
    assert.ok(save.slice(0, 900).includes('confirm('),
      'ステータス変更に確認がありません');
  });

  test('区画の割当は、環状（最後の番号と1番がつながる）', () => {
    const h = built();
    assert.ok(ADMIN_GS.includes('((start - 1 + k) % total) + 1'),
      'GAS側の割当が環状になっていません');
    assert.ok(MOCK.includes('% total) + 1'), '模擬サーバー側も環状にしてください');
  });

  test('すでに埋まっている区画には割り当てられない', () => {
    assert.ok(ADMIN_GS.includes("error: 'occupied'"), 'GAS側で重複割当を拒否していません');
    assert.ok(MOCK.includes("error: 'occupied'"), '模擬サーバー側でも拒否してください');
  });
});

describe('管理ページ：入力の検証', () => {

  test('区画数と開始番号を検証している', () => {
    // 検証せずに大きな units を受けると、ループがスクリプトロックを握ったまま
    // 実行上限まで走る。そのロックは応募の記録と同じものなので、
    // その間ずっと応募が台帳に書けない（仕様書§0の最重要要件に直撃）。
    const a = ADMIN_GS.slice(ADMIN_GS.indexOf('function adminAssign_'));
    assert.ok(/units < 1 \|\| units > MAX_UNITS/.test(a), '区画数の上限・下限を見ていません');
    assert.ok(/start < 1 \|\| start > total/.test(a), '区画番号の範囲を見ていません');
    assert.ok(/isFinite\(units\)/.test(a), 'NaN を弾いていません');

    const guard = a.indexOf('MAX_UNITS');
    const loop = a.indexOf('for (var k = 0');
    assert.ok(guard >= 0 && guard < loop, '検証がループより後にあります');
  });

  test('模擬サーバーも同じ検証をしている', () => {
    const m = MOCK.slice(MOCK.indexOf("case 'adminAssign'"));
    assert.ok(/units > MAX_UNITS/.test(m.slice(0, 900)), '模擬側に区画数の検証がありません');
    assert.ok(/STATUSES\.includes\(payload\.patch/.test(MOCK),
      '模擬側にステータスの検証がありません（本番では弾かれる値が模擬では通ります）');
  });

  test('数式として解釈される文字列を、そのままシートに書かない', () => {
    // =IMPORTXML(...) のような値は、Excel書き出しを通じて他のPCへ広がる
    assert.ok(ADMIN_GS.includes('function safeCellText_'), '数式の無害化がありません');
    const u = ADMIN_GS.slice(ADMIN_GS.indexOf('function adminUpdate_'));
    assert.ok(/setValue\(safeCellText_\(after\)\)/.test(u), '無害化を通さずに書き込んでいます');
  });

  test('存在しない受付IDへの操作を、成功として返さない', () => {
    const u = ADMIN_GS.slice(ADMIN_GS.indexOf('function adminUnassign_'));
    assert.ok(u.includes("error: 'not_found'"),
      '架空の受付IDで変更履歴に行が残ってしまいます');
  });
});

describe('管理ページ：画面の守り', () => {

  const built = () => fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

  test('設定シートの色を、検査せずにCSSへ入れていない', () => {
    // 画面内で唯一、値を属性の中へ差し込む場所だった
    const h = built();
    assert.ok(h.includes('function color('), '色の検査関数がありません');
    assert.ok(!/style="fill:'\+fill\+'/.test(h), '色を素のまま差し込んでいます');
    assert.ok(/\^#\[0-9A-Fa-f\]\{3,8\}\$/.test(h), '色の形を検査していません');
  });

  test('外部への通信と読み込みを止める指定がある', () => {
    const h = built();
    assert.match(h, /http-equiv="Content-Security-Policy"/);
    assert.match(h, /default-src 'none'/);
    assert.match(h, /form-action 'none'/);
  });

  test('開発用の自動入室が、公開される画面に混ざっていない', () => {
    assert.ok(!built().includes('autologin'),
      '模擬サーバー専用の自動入室が admin.html に入っています');
    // deploy.js は毎回空にしてから明示コピーする許可リスト方式。
    // src/ 配下は構造上 gh-pages に乗らない
    const dep = read('src/deploy.js');
    assert.ok(dep.includes("copy('assets', 'assets')"));
    assert.ok(!dep.includes("copy('src'"), 'src/ を公開対象にしてはいけません');
  });
});

describe('管理ページ：参照している列が、本当に台帳にあるか', () => {

  const headers = S.ledgerHeaders();

  /** gas/Admin.gs の COL に並んだ列名を取り出す */
  function colMap() {
    const seg = ADMIN_GS.slice(ADMIN_GS.indexOf('var COL = {'));
    const body = seg.slice(0, seg.indexOf('};'));
    const out = {};
    for (const m of body.matchAll(/(\w+):\s*'([^']+)'/g)) out[m[1]] = m[2];
    return out;
  }

  test('COL に並べた列名が、すべて応募一覧に存在する', () => {
    // cell_() は無い列に '' を返す。つまり列名を間違えても例外にならず、
    // ダッシュボードが黙って0を並べる。実際に一度そうなった
    // （'企業・団体名' や '火気' など、存在しない名前を参照していた）。
    const cols = colMap();
    assert.ok(Object.keys(cols).length > 20, 'COL を読み取れませんでした');
    const missing = Object.entries(cols).filter(([, v]) => headers.indexOf(v) < 0);
    assert.deepStrictEqual(missing, [],
      '台帳に無い列を参照しています: '
      + missing.map(([k, v]) => k + '=' + v).join(', '));
  });

  test('採択後にしか集まらない項目を、応募段階の集計に混ぜていない', () => {
    // 火気・搬入車両・スタッフ人数などは「出店確定情報」シート側。
    // 応募一覧を数えて 0件 と出すと、集めていないのに「0件でした」と読める
    const confirmOnly = S.confirmFields().map(f => f.sheet).filter(Boolean);
    const cols = Object.values(colMap());
    const leaked = cols.filter(c => confirmOnly.indexOf(c) >= 0);
    assert.deepStrictEqual(leaked, [],
      '採択後の項目を応募一覧から引こうとしています: ' + leaked.join(', '));
  });

  test('最初から出す列は、すべて台帳にある', () => {
    // 2026-09-02 に一覧は**全列を返す**ようにした（使う人が選ぶ）。
    // 決め打ちで残っているのは「最初に出す並び」だけなので、そこを見る
    const seg = ADMIN_GS.slice(ADMIN_GS.indexOf('function LIST_DEFAULT_COLUMNS_'));
    const body = seg.slice(0, seg.indexOf(String.fromCharCode(10) + '}'));
    const cols = colMap();
    const used = [...body.matchAll(/COL\.(\w+)/g)].map(m => m[1]);
    assert.ok(used.length > 5, 'LIST_DEFAULT_COLUMNS_ を読み取れませんでした');
    const bad = used.filter(k => !cols[k]);
    assert.deepStrictEqual(bad, [], 'COL に無いキーを使っています: ' + bad.join(', '));
  });

  test('一覧は、台帳の項目を全部返す（隠すのは返してはいけない列だけ）', () => {
    // けいた指摘「出店者一覧でみれる項目が少なすぎない？」。
    // 絞る側がどれを要ると思うかは、その日の仕事で変わる。選ぶのは使う人
    const seg = ADMIN_GS.slice(ADMIN_GS.indexOf('function LIST_ALL_COLUMNS_'));
    const body = seg.slice(0, seg.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/headers\.filter/.test(body), '台帳の見出しから作っていません');
    assert.ok(/NEVER_SEND\.indexOf\(h\) < 0/.test(body),
      '返してはいけない列を除いていません');
  });

  test('模擬サーバーの行が、台帳と同じ列を持っている', () => {
    // 模擬が勝手な列名を使っていたせいで、本番の列名の間違いに気づけなかった
    assert.ok(MOCK.includes('SCHEMA.ledgerHeaders()'),
      '模擬データが schema.js の列名を使っていません（本番との食い違いに気づけません）');
    assert.ok(MOCK.includes("LEDGER_HEADERS.forEach"),
      '台帳の全列を持たせる処理がありません');
  });

  test('サステナ報告に要る包材の内訳を集計している', () => {
    // 仕様書§6-2に「食器・包材の持込予定の内訳（サステナ報告用）」と明記されている。
    // 列名は直書きしない。schema.js の sheet が正で、
    // 2026-09-02 に「食器・包材」→「包材の用意」へ変わったとき、
    // ここだけ古いまま落ちた
    const S = require('../src/schema.js');
    const sheet = S.FIELDS.find(f => f.key === 'packaging').sheet;
    // 正規表現を組み立てず、空白をつぶした文字列で照合する。
    // 組み立てるとバックスラッシュが編集の経路で1層落ち、
    // \s が s になって**必ず失敗する検査**になる（実際にここで起きた）
    const flat = ADMIN_GS.replace(/\s+/g, ' ');
    assert.ok(flat.includes("packaging: '" + sheet + "'"),
      'COL の packaging が schema.js の「' + sheet + '」と一致しません');
    assert.ok(ADMIN_GS.includes('byPack'), '包材の内訳を集計していません');
  });
});

describe('入室画面：ブラウザのパスワード保存が働くこと', () => {
  const HTML = () => {
    const f = path.join(ROOT, 'admin.html');
    assert.ok(fs.existsSync(f), 'admin.html がありません。先に npm run build を実行してください');
    return fs.readFileSync(f, 'utf8');
  };

  test('入室が form になっている', () => {
    // form が無いと、ブラウザからは「ログイン」に見えず保存を提案してこない
    const h = HTML();
    assert.ok(h.includes('<form id="gForm"'), '入室が form になっていません');
    assert.ok(/id="gPw"[^>]*autocomplete="current-password"/.test(h),
      'パスワード欄に autocomplete がありません');
    assert.ok(/id="gPerson"[^>]*autocomplete="username"/.test(h),
      '氏名の選択に autocomplete がありません');
  });

  test('送信してはいけないボタンに type="button" が付いている', () => {
    // form の中のボタンは既定で submit になる。
    // 「表示」「パスワードを入れ直す」を押すたびに送信されてしまう。
    const h = HTML();
    for (const id of ['gShow', 'gBack']) {
      const m = new RegExp('<button[^>]*id="' + id + '"[^>]*>').exec(h)
             || new RegExp('<button[^>]*id="' + id + '"[^>]*>').exec(h);
      const tag = (h.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>')) || [''])[0]
               || (h.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>')) || [''])[0];
      const around = h.slice(Math.max(0, h.indexOf('id="' + id + '"') - 120),
                             h.indexOf('id="' + id + '"') + 40);
      assert.ok(/type="button"/.test(around),
        id + ' に type="button" がありません（押すたびに送信されます）');
    }
  });

  test('入室できたら、ブラウザに保存を頼んでいる', () => {
    // 画面が切り替わらない作りなので、こちらから頼まないと保存されない
    const h = HTML();
    assert.ok(h.includes('navigator.credentials.store'),
      'パスワードの保存を頼んでいません');
    assert.ok(h.includes('rememberPassword('),
      '入室後に保存を呼んでいません');
  });

  test('保存を頼むのは、パスワードを消す前', () => {
    // S.pw = '' のあとに呼ぶと、空のパスワードを保存させてしまう
    const h = HTML();
    const remember = h.indexOf('rememberPassword(person');
    const clear = h.indexOf("S.pw = ''");
    assert.ok(remember >= 0 && clear >= 0, '入室後の処理が見つかりません');
    assert.ok(remember < clear,
      'パスワードを消したあとに保存を頼んでいます（空の値が保存されます）');
  });
});
