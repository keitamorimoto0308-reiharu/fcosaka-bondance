/**
 * メール文面の編集（採択・不採択）を確かめる。
 *
 * ■ なぜ要るか
 *   けいた指示（2026-09-03）：
 *   「文面はどこかで編集できる？…その送信機能の範疇でそこで作って送信できるように」
 *
 *   文面を直すたびに私がコードを書き換えて再デプロイする形は、
 *   けいたに待ち時間を押し付けている。締切直後にひと言足したい場面は必ず来る。
 *
 * ■ いちばん大事な検査は「作り替えても、届く文が変わっていないこと」
 *   直書きしていた文面を、差し込み付きの文面に作り替えた。
 *   **1文字でも変わっていたら、それは事故**（50社に届く）。
 *   旧・直書き（buildAcceptMailLegacy_ / buildRejectMailLegacy_）を残してあり、
 *   既定の文面を差し込んだ結果と、そのまま突き合わせる。
 *
 * ■ 自由に書ける画面を出す以上、守るものは保存の時点で守る
 *   1. 不採択に採択専用のリンクを入れさせない
 *      （入れると送信時にトークンを発行する道に入り、
 *        不採択の方が出店確定情報フォームを開けてしまう）
 *   2. 採択からリンクを落とさせない（次に何をすればよいか伝わらない）
 *   3. 知らない差し込みのまま送らせない（{{名前}} とそのまま届く）
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');

/**
 * .gs から関数と定数だけを切り出して、外に触れない箱で動かす。
 * GASのAPI（SpreadsheetApp など）を使う関数は取らない。
 */
function loadFrom(file, names, box) {
  const src = read(file);
  const cut = [];
  names.forEach(n => {
    const re = new RegExp('(?:^|\\n)(var ' + n + ' = [\\s\\S]*?;\\n|function ' + n
                          + '\\([\\s\\S]*?\\n\\}\\n)');
    const m = src.match(re);
    assert.ok(m, file + ' の ' + n + ' を読み取れません');
    cut.push(m[1]);
  });
  vm.runInContext(cut.join('\n'), box);
}

/** 差し込みの中身を、決まった文字列に固定した箱 */
function makeBox() {
  const box = vm.createContext({
    Object, String, Number, Array, JSON, RegExp, console, Math,
    EVENT_NAME: '夕照祭2026 FC大阪 秋のサステナ盆踊り',
    eventFactsBlock_: () => '＜開催情報＞',
    signature_: () => '\n＜署名＞',
    confirmDeadlineText_: () => '2026年10月10日まで',
    configText: (k, d) => d || '',
    asText_: v => (v == null ? '' : String(v)),
    logError_: () => {},
  });
  loadFrom('gas/MailTemplate.gs', [
    'MAILTPL_HEAD', 'MAILTPL_SUBJECT_MAX', 'MAILTPL_BODY_MAX',
    'MAILTPL_VARS_', 'mailtplSampleVars_', 'mailtplAllowedVars_',
    'mailtplAcceptOnlyVars_',
    'mailtplDefault_', 'mailtplDefaultAccept_', 'mailtplDefaultReject_',
    'mailtplRender_', 'mailtplVars_', 'mailtplFlatten_',
    'mailtplValidate_', 'mailtplWarnings_',
    'mailtplShort_',
  ], box);
  loadFrom('gas/Notify.gs', ['buildAcceptMailLegacy_', 'buildRejectMailLegacy_'], box);
  return box;
}

const ROW = {
  id: 'SB-0007', person: '田中 一郎', company: '大阪フードサービス',
  shopName: '唐揚げキッチン', email: 'a@example.com',
};
const LINKS = {
  confirm: 'https://example.com/confirm.html?id=SB-0007&t=xxx',
  upload: 'https://example.com/upload.html?id=SB-0007&t=xxx',
};

describe('作り替えても、事業者に届く文が変わっていないこと', () => {
  // ここが崩れたら、50社に違う文が届く。**1文字も変わってはいけない**
  const box = makeBox();

  function rendered(kind, links) {
    const tpl = box.mailtplDefault_(kind);
    const vars = box.mailtplVars_(kind, ROW, links);
    return {
      subject: box.mailtplRender_(tpl.subject, vars).split('\n').join(' ').trim(),
      body: box.mailtplRender_(tpl.body, vars),
    };
  }

  test('採択の文面が、旧・直書きと同じ', () => {
    const now = rendered('accept', LINKS);
    const old = box.buildAcceptMailLegacy_(ROW, LINKS);
    assert.strictEqual(now.subject, old.subject, '件名が変わりました');
    assert.strictEqual(now.body, old.body, '本文が変わりました');
  });

  test('素材アップロードURLが空でも、旧・直書きと同じ', () => {
    // 空のときは案内ごと消える。置き換えて空文字にすると「　▼」だけ残る
    const links = { confirm: LINKS.confirm, upload: '' };
    const now = rendered('accept', links);
    const old = box.buildAcceptMailLegacy_(ROW, links);
    assert.strictEqual(now.body, old.body, '本文が変わりました');
    assert.ok(!/素材アップロード/.test(now.body), '案内が残っています');
  });

  test('出店名が空なら、その行ごと消える', () => {
    const noShop = Object.assign({}, ROW, { shopName: '' });
    const tpl = box.mailtplDefault_('accept');
    const body = box.mailtplRender_(tpl.body, box.mailtplVars_('accept', noShop, LINKS));
    assert.ok(!/出店名：/.test(body), '「出店名：」だけの行が残っています');
    assert.ok(/受付ID：SB-0007/.test(body), '受付IDまで消えています');
  });

  test('不採択の文面が、旧・直書きに「けいた確定の2行」を足したものになっている', () => {
    // けいた確定（2026-09-03）：
    //   ・理由はお答えできかねる（理由を書かない方針なのに問い合わせを促していた）
    //   ・繰り上げの予定は無い（キャンセル待ちだと思って待つ方が出る）
    const now = rendered('reject', null);
    const old = box.buildRejectMailLegacy_(ROW);
    assert.strictEqual(now.subject, old.subject, '件名が変わりました');
    assert.ok(/選考の理由につきましては、お答えいたしかねます/.test(now.body),
      '「理由はお答えできかねる」が入っていません');
    assert.ok(/繰り上げのご連絡を予定しておりません/.test(now.body),
      '「繰り上げの予定は無い」が入っていません');

    // 足した3行を除けば、旧・直書きと同じであること
    const stripped = now.body.split('\n').filter(l =>
      !/選考の理由につきましては/.test(l)
      && !/あらかじめご了承くださいます/.test(l)
      && !/繰り上げのご連絡を予定して/.test(l)).join('\n');
    assert.strictEqual(stripped.split('\n\n\n').join('\n\n'),
      old.body.split('\n\n\n').join('\n\n'),
      '足した2文以外のところが変わりました');
  });

  /*
   * ■ 記号だけが残る行の検査は、**2つ書く**
   *
   *   「　▼ {{素材アップロードURL}}」は、空になると「　▼ 」と**末尾が空白**になる。
   *   2026-09-08 に足した「差し込みが落ちた行で、末尾が空白なら落とす」規則が
   *   先に捕まえてしまうので、この入力だけだと
   *   **記号の規則を消しても検査が通ってしまう**（実際に break_mailtpl.py が
   *   20/21 になって気づいた。振る舞いは正しいまま、守りだけが無検査になる形）。
   *
   *   箇条書きの「・{{…}}」は、空になると「・」で終わり、末尾が空白にならない。
   *   **記号の規則だけが効く入力**なので、こちらを足して独立に見張る。
   */
  test('記号だけが残る行も、消える', () => {
    // 使う人が「　▼ {{素材アップロードURL}}」と1行に書くことはある。
    // URLが空だと「　▼」だけが宙に浮いた行として届く
    const box2 = makeBox();
    const NL = String.fromCharCode(10);
    const out = box2.mailtplRender_(
      'まえ' + NL + '　▼ {{素材アップロードURL}}' + NL + 'あと',
      box2.mailtplVars_('accept', ROW, { confirm: 'x', upload: '' }));
    assert.strictEqual(out, 'まえ' + NL + 'あと',
      '記号だけの行が残りました：' + JSON.stringify(out));

    // 箇条書き。**末尾が空白にならない**ので、記号の規則だけが効く
    const out2 = box2.mailtplRender_(
      'まえ' + NL + '・{{素材アップロードURL}}' + NL + 'あと',
      box2.mailtplVars_('accept', ROW, { confirm: 'x', upload: '' }));
    assert.strictEqual(out2, 'まえ' + NL + 'あと',
      '記号だけの行が残りました（箇条書き）：' + JSON.stringify(out2));
  });

  test('不採択の既定に、リンクもトークンも入っていない', () => {
    const now = rendered('reject', null);
    ['http', 'confirm.html', 'upload.html', '{{確定情報', '{{素材'].forEach(w => {
      assert.ok(now.body.indexOf(w) < 0, '不採択の文面に混ざっています：' + w);
    });
  });
});

describe('保存の検査（自由に書ける画面が、守りを崩さないこと）', () => {
  const box = makeBox();
  const V = (kind, subject, body) => box.mailtplValidate_(kind, subject, body);
  const NL = String.fromCharCode(10);
  const okAccept = '{{お名前}} 様\n{{確定情報フォームURL}}\n{{署名}}';

  test('既定の文面は、そのまま保存できる', () => {
    // 箱の中で作った配列は、外の Array とは別物になる。
    // deepStrictEqual だと中身が同じでも落ちるので、件数で見る
    ['accept', 'reject'].forEach(k => {
      const d = box.mailtplDefault_(k);
      const e = V(k, d.subject, d.body);
      assert.strictEqual(e.length, 0,
        k + ' の既定が保存できません：' + Array.prototype.join.call(e, ' ／ '));
    });
  });

  test('不採択に採択専用のリンクは入れられない', () => {
    ['確定情報フォームURL', '素材アップロードURL', '素材アップロードのご案内', '提出期限']
      .forEach(v => {
        const e = V('reject', '件名', '{{お名前}} 様 {{' + v + '}}');
        assert.ok(e.length, v + ' が通りました');
        assert.ok(/不採択のご連絡には入れられません/.test(e.join(' ')),
          v + ' の断り方が違います：' + e.join(' '));
      });
  });

  test('採択からリンクを落とせない', () => {
    const e = V('accept', '件名', '{{お名前}} 様\n{{署名}}');
    assert.ok(/確定情報フォームURL/.test(e.join(' ')),
      'リンクの無い採択が通りました：' + JSON.stringify(e));
  });

  test('知らない差し込みは断る', () => {
    const e = V('accept', '件名', '{{名前}} 様\n' + okAccept);
    assert.ok(/使える差し込みにありません/.test(e.join(' ')),
      '綴り違いが通りました：' + JSON.stringify(e));
  });

  test('件名にも同じ検査がかかる', () => {
    const e = V('accept', '{{会社名}} さまへ', okAccept);
    assert.ok(/件名の \{\{会社名\}\}/.test(e.join(' ')),
      '件名の差し込みを見ていません：' + JSON.stringify(e));
  });

  test('空では保存できない', () => {
    assert.ok(V('accept', '', okAccept).some(x => /件名が空/.test(x)));
    assert.ok(V('accept', '件名', '').some(x => /本文が空/.test(x)));
    assert.ok(V('accept', '件名', '   ').some(x => /本文が空/.test(x)));
  });

  test('件名に改行は入れられない', () => {
    const e = V('accept', '件名\n2行目', okAccept);
    assert.ok(/件名に改行/.test(e.join(' ')), JSON.stringify(e));
  });

  test('長すぎるものは断る', () => {
    const long = 'あ'.repeat(box.MAILTPL_SUBJECT_MAX + 1);
    assert.ok(V('accept', long, okAccept).some(x => /件名が長すぎ/.test(x)));
    const longBody = 'あ'.repeat(box.MAILTPL_BODY_MAX + 1) + okAccept;
    assert.ok(V('accept', '件名', longBody).some(x => /本文が長すぎ/.test(x)));
  });

  test('括弧が二重になっていたら断る', () => {
    // 2026-09-04 の検証で、2体が独立に見つけた。
    // {{{{お名前}}}} は内側だけ置き換わり、**{{小林 大輔}} 様**と届く。
    // しかも {{ と }} の数は釣り合うので、数え上げの検査は通ってしまっていた
    const e = V('accept', '【ご案内】{{{{受付ID}}}}', '{{{{お名前}}}} 様' + NL + okAccept);
    assert.ok(e.length, '二重の括弧が通りました');
    assert.ok(/書き方が正しくありません/.test(e.join(' ')), e.join(' '));
  });

  test('差し込みの名前が長すぎても断る', () => {
    // 名前が60文字を超えると、綴り検査の正規表現にも置き換えにも当たらず素通りしていた
    const e = V('accept', '件名', '{{' + 'あ'.repeat(61) + '}}' + NL + okAccept);
    assert.ok(e.length, '長い名前の差し込みが通りました');
    assert.ok(/書き方が正しくありません/.test(e.join(' ')), e.join(' '));
  });

  test('入れ子になっていても断る', () => {
    const e = V('accept', '件名', '{{a{{お名前}}b}}' + NL + okAccept);
    assert.ok(e.length, '入れ子が通りました');
    assert.ok(/書き方が正しくありません/.test(e.join(' ')), e.join(' '));
  });

  test('検査は「実際に組み立てて残骸を探す」形になっている', () => {
    // 正規表現で差し込みを探す検査だけだと、**置き換えの側と食い違う**。
    // 置き換えと同じ関数を通してから探せば、食い違いようがない
    const T2 = read('gas/MailTemplate.gs');
    const fn = T2.slice(T2.indexOf('function mailtplValidate_'));
    const body2 = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/mailtplRender_\(/.test(body2),
      '検査が、置き換えを通していません（また食い違います）');
    assert.ok(/mailtplSampleVars_\(/.test(body2), '見本の値を使っていません');
  });

  test('不採択に、確定情報フォームのリンクは入れられない', () => {
    // ■ 2026-09-04、規則を狭めた
    //   はじめは「不採択に生のURLを一切入れさせない」にしていた。
    //   ところが点検で、**既定の不採択文面が実際にはURLを含んでいる**と分かった
    //   （{{署名}} に https://bondance.kreha-c.com/ が入っている）。
    //   つまり「リンクは入れられません」という主張は最初から成立していなかった。
    //
    //   守りたいのは「リンクが無いこと」ではなく、
    //   **その会社だけの鍵つきリンクを不採択の方に渡さないこと**。
    //   イベントサイトへの案内は載せてよい（次回募集の案内が書けないと運用がつらい）。
    const cases = [
      ['素のリンク', 'https://bondance.kreha-c.com/confirm.html?id=SB-0001&t=x'],
      ['スキーム無し', 'bondance.kreha-c.com/confirm.html?id=SB-0001'],
      ['全角', 'ｈｔｔｐｓ://bondance.kreha-c.com/ｃｏｎｆｉｒｍ.ｈｔｍｌ'],
      ['2行に分けて書く', 'https://bondance.kreha-c.com/con' + NL + 'firm.html'],
      ['大文字', 'HTTPS://BONDANCE.KREHA-C.COM/CONFIRM.HTML'],
      ['素材アップロード', 'https://bondance.kreha-c.com/upload.html?id=SB-0001'],
    ];
    cases.forEach(([label, body]) => {
      const e = V('reject', '【選考結果のご連絡】{{イベント名}}',
        '{{お名前}} 様' + NL + body + NL + '{{署名}}');
      assert.ok(e.length, label + ' が通りました：' + body);
      assert.ok(/リンクが入っています/.test(e.join(' ')),
        label + ' の断り方が違います：' + e.join(' '));
    });
  });

  test('不採択でも、イベントサイトへの案内は書ける', () => {
    // 締め付けすぎも困る。「次回の募集はこちら」と書けないと運用がつらい
    [['イベントサイト', '次回の募集は https://bondance.kreha-c.com/ をご覧ください。'],
     ['よくある質問', 'よくあるご質問は https://example.com/faq をご覧ください。']
    ].forEach(([label, body]) => {
      const e = V('reject', '【選考結果のご連絡】{{イベント名}}',
        '{{お名前}} 様' + NL + body + NL + '{{署名}}');
      assert.strictEqual(e.length, 0,
        label + ' まで断っています：' + Array.prototype.join.call(e, ' '));
    });
  });


  test('採択には、リンクを書いてよい', () => {
    // 不採択だけの決まり。採択で断ると運用できない
    const e = V('accept', '件名',
      '{{お名前}} 様' + NL
      + '詳しくは https://bondance.kreha-c.com/ をご覧ください。' + NL
      + okAccept);
    assert.strictEqual(e.length, 0,
      '採択のリンクまで断っています：' + Array.prototype.join.call(e, ' '));
  });

  test('閉じ忘れに気づかせる', () => {
    const e = V('accept', '件名', '{{お名前} 様\n' + okAccept);
    assert.ok(/閉じ忘れ/.test(e.join(' ')), JSON.stringify(e));
  });

  test('断るときは、理由を1つずつ返す', () => {
    // まとめて1行にすると読まれない
    // 「N個以上」で見ると、新しい断り理由が増えるだけで満たされてしまう。
    // **何を断ったかを名指しで確かめる**（2026-09-04 の点検で指摘）
    const e = V('reject', '', '{{確定情報フォームURL}} {{名前}}');
    const all = Array.prototype.join.call(e, ' ／ ');
    [['件名が空', /件名が空/],
     ['不採択にリンク', /不採択のご連絡には入れられません/],
     ['知らない差し込み', /使える差し込みにありません/]].forEach(([label, re]) => {
      assert.ok(re.test(all), label + ' を断っていません：' + all);
    });
    assert.ok(e.length >= 3, '理由をまとめてしまっています：' + all);
  });
});

describe('文面の編集：実際に動かす', () => {
  function fresh() {
    const p = require.resolve('../src/mock.js');
    delete require.cache[p];
    return require(p);
  }
  function login(M, pw, person) {
    const r = M.handle({ action: 'adminLogin', password: pw, person: person });
    assert.ok(r.ok, '入室できません');
    return r.token;
  }
  let M, tok;
  beforeEach(() => { M = fresh(); tok = login(M, 'admin', '山田 太郎'); });

  const get = kind => M.handle({ action: 'adminMailTemplate', token: tok, kind });
  const save = (kind, subject, body) =>
    M.handle({ action: 'adminMailTemplateSave', token: tok, kind, subject, body });
  const sample = kind =>
    M.handle({ action: 'adminNotifyPreview', token: tok, kind }).sample;

  test('一般権限では、見ることも直すこともできない', () => {
    const staff = login(M, 'staff', '佐藤 花子');
    ['adminMailTemplate', 'adminMailTemplateSave', 'adminMailTemplateReset'].forEach(a => {
      const r = M.handle({ action: a, token: staff, kind: 'accept',
                           subject: 'x', body: 'y' });
      assert.strictEqual(r.ok, false, a + ' が通りました');
      assert.strictEqual(r.error, 'forbidden');
    });
  });

  test('はじめは「編集していない」と分かる', () => {
    const r = get('accept');
    assert.strictEqual(r.isDefault, true, '編集済みに見えています');
    assert.strictEqual(r.custom, false);
    assert.ok(r.vars.length >= 8, '差し込みの一覧が足りません：' + r.vars.length);
  });

  test('種類ごとに、使える差し込みが違う', () => {
    const a = get('accept').vars.map(v => v.name);
    const r = get('reject').vars.map(v => v.name);
    assert.ok(a.indexOf('確定情報フォームURL') >= 0, '採択にリンクがありません');
    assert.ok(r.indexOf('確定情報フォームURL') < 0, '不採択にリンクを見せています');
    assert.ok(r.indexOf('お名前') >= 0, '不採択にお名前がありません');
  });

  test('保存すると、本文の見本がその場で変わる', () => {
    const before = sample('reject').body;
    const r = save('reject', '【選考結果のご連絡】{{イベント名}}',
      '{{お名前}} 様\nこのたびは誠にありがとうございました。\n{{署名}}');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const after = sample('reject').body;
    assert.notStrictEqual(after, before, '見本が古いままです');
    assert.ok(/このたびは誠にありがとうございました。/.test(after),
      '直した文が見本に出ていません');
    assert.ok(/^小林 大輔 様/.test(after) || /様/.test(after.split('\n')[0]),
      'お名前が差し込まれていません：' + after.split('\n')[0]);
    assert.ok(!/\{\{/.test(after), '差し込みがそのまま残っています');
  });

  test('断られたときは、1文字も保存しない', () => {
    const before = get('reject');
    const r = save('reject', '件名', '{{お名前}} 様 {{確定情報フォームURL}}');
    assert.strictEqual(r.ok, false, '断るべきものを保存しました');
    assert.ok(r.errors && r.errors.length, '理由を返していません');
    assert.ok(/まだ何も保存していません/.test(r.message), r.message);
    const after = get('reject');
    assert.strictEqual(after.subject, before.subject, '件名が書き換わりました');
    assert.strictEqual(after.body, before.body, '本文が書き換わりました');
  });

  test('はじめの文面に戻せる', () => {
    save('reject', '件名だけ', '{{お名前}} 様\n{{署名}}');
    assert.strictEqual(get('reject').isDefault, false, '編集が入っていません');
    const r = M.handle({ action: 'adminMailTemplateReset', token: tok, kind: 'reject' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(get('reject').isDefault, true, '戻っていません');
  });

  test('誰がいつ変えたかが、変更履歴に残る', () => {
    // 50社に届く文が変わる。あとから「誰がこの文にしたのか」を追えないと困る
    const n = M.DB.history.length;
    save('accept', '【出店決定のご案内】{{イベント名}}',
      '{{お名前}} 様\n{{確定情報フォームURL}}\n{{署名}}');
    assert.ok(M.DB.history.length > n, '履歴に残っていません');
    const h = M.DB.history[0];
    assert.ok(/メール文面/.test(h.item), '何を変えたのか分かりません：' + h.item);
    assert.strictEqual(h.who, '山田 太郎', '誰が変えたのか残っていません');
  });

  test('本文まるごとは履歴に入れない（読めなくなる）', () => {
    save('accept', '【出店決定のご案内】{{イベント名}}',
      'あ'.repeat(1000) + '\n{{確定情報フォームURL}}\n{{署名}}');
    const h = M.DB.history.filter(x => /本文/.test(x.item))[0];
    assert.ok(h, '本文の履歴がありません');
    assert.ok(h.after.length < 300, '本文をまるごと入れています：' + h.after.length + '文字');
  });

  test('種類が違えば断る', () => {
    ['', 'accept2', 'constructor', '__proto__'].forEach(k => {
      const r = M.handle({ action: 'adminMailTemplate', token: tok, kind: k });
      if (k === '') return;   // 空は既定（accept）でよい
      assert.strictEqual(r.ok, false, '「' + k + '」が通りました');
    });
  });
});

describe('本番と模擬が、同じ道を通っているか', () => {
  const N = read('gas/Notify.gs');
  const T = read('gas/MailTemplate.gs');
  const K = read('src/mock.js');

  test('本番の送信が、文面を通っている', () => {
    ['buildAcceptMail_', 'buildRejectMail_'].forEach(name => {
      const i = N.indexOf('function ' + name + '(');
      assert.ok(i > 0, name + ' がありません');
      const fn = N.slice(i, N.indexOf('\n}\n', i));
      assert.ok(/mailtplBuild_\(/.test(fn),
        name + ' が文面を通っていません（直書きに戻っています）');
    });
  });

  test('模擬は、検査を本番のソースから借りている', () => {
    // **写しを作ると、必ずどちらかが古くなる。**
    // ここは「不採択にリンクを入れさせない」という守りが入っているので、
    // 模擬が緩いと、本番の穴を模擬が見逃す
    assert.ok(/gas', 'MailTemplate\.gs'/.test(K) || /MailTemplate\.gs/.test(K),
      '模擬が本番のソースを読んでいません');
    assert.ok(/MAILTPL\.mailtplValidate_/.test(K),
      '模擬が独自の検査を持っています');
    assert.ok(/MAILTPL\.mailtplRender_/.test(K),
      '模擬が独自の置き換えを持っています');
  });

  test('管理者だけの操作になっている', () => {
    const A = read('gas/Admin.gs');
    const only = A.slice(A.indexOf('var adminOnly'), A.indexOf('switch (action)'));
    ['adminMailTemplate', 'adminMailTemplateSave', 'adminMailTemplateReset']
      .forEach(a => {
        assert.ok(only.includes(a), a + ' が管理者限定の一覧にありません');
      });
  });

  test('シートが空でも壊れない（既定に落ちる）', () => {
    const fn = T.slice(T.indexOf('function mailtplRead_'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.ok(/catch \(e\)/.test(body), '読めなかったときの逃げ道がありません');
    // 既定へ落ちる道は3つある。**「2つ以上」で見ていると1つ壊れても気づけない**
    //（この検査自身の甘さを、わざと壊す検査が捕まえた・2026-09-03）
    //   ① その種類の行がまだ無い
    //   ② 行はあるが、件名か本文が空
    //   ③ シートを読む途中で落ちた
    // 既定へ落ちる道は4つある。**「N本以上」で見ていると1つ壊れても気づけない**
    //（この検査自身の甘さを、わざと壊す検査が捕まえた・2026-09-03）
    //   ① 見出しが壊れている（2026-09-04 に追加）
    //   ② その種類の行がまだ無い
    //   ③ 行はあるが、件名か本文が空
    //   ④ シートを読む途中で落ちた
    const paths = (body.match(/subject: def\.subject/g) || []).length;
    assert.strictEqual(paths, 4,
      'シートが空・壊れているときに既定へ落ちていません（落ちる道が ' + paths + ' 本）');
    assert.ok(/mailtplHeadersOk_\(/.test(body), '見出しを確かめていません');
  });

  test('差し込みの一覧が、1か所にまとまっている', () => {
    // 画面の一覧・保存時の検査・置き換えが、同じ表を読んでいること
    assert.ok(/function MAILTPL_VARS_/.test(T), '差し込みの表がありません');
    ['mailtplAllowedVars_', 'adminMailTemplate_'].forEach(n => {
      const i = T.indexOf('function ' + n);
      const fn = T.slice(i, T.indexOf('\n}\n', i));
      assert.ok(/MAILTPL_VARS_\(\)/.test(fn), n + ' が表を読んでいません');
    });
  });
});

describe('シートの見出しが壊れたときに、黙って別の文面で送らない', () => {
  // 2026-09-04 の点検：`headBroken` を計算していたのに誰も読んでいなかった。
  // 「メール文面」シートの列を入れ替えると、
  //   ・画面は「はじめの文面のまま」と**嘘をつく**
  //   ・実際には保存した文面ではなく既定の文面が50社に届く
  // という形になっていた。
  const T3 = read('gas/MailTemplate.gs');
  const N3 = read('gas/Notify.gs');
  const A3 = read('src/build-admin.js');

  test('壊れていることを、画面に返している', () => {
    const fn = T3.slice(T3.indexOf('function adminMailTemplate_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/headBroken:/.test(body), '壊れていることを返していません');
    assert.ok(/headBrokenMessage:/.test(body), '直し方を返していません');
  });

  test('画面が、それを受け取って出している', () => {
    assert.ok(/r\.headBroken/.test(A3), '画面が受け取っていません');
    const i = A3.indexOf('if (r.headBroken){');
    assert.ok(i > 0, '壊れているときの分岐がありません');
    const block = A3.slice(i, i + 500);
    assert.ok(/headBrokenMessage/.test(block), '直し方を出していません');
    // **「はじめの文面のまま」を出してはいけない**（嘘になる）
    const j = block.indexOf('はじめの文面のまま');
    assert.ok(j < 0 || j > block.indexOf('} else {'),
      '壊れているのに「はじめの文面のまま」と出しています');
  });

  test('送信も断っている', () => {
    const fn = N3.slice(N3.indexOf('function adminNotifySend_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}' +
                                        String.fromCharCode(10)));
    assert.ok(/tplNow\.headBroken/.test(body), '送信で見ていません');
    const check = body.indexOf('tplNow.headBroken');
    const send = body.indexOf('sendMail_');
    assert.ok(check < send || send < 0, '送ってから見ています');
  });

  test('見出しの検査そのものがある', () => {
    const fn = T3.slice(T3.indexOf('function mailtplHeadersOk_'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));
    assert.ok(/MAILTPL_HEAD\[i\]/.test(body), '見出しを1つずつ見ていません');
    // 書き込みも断っているか
    const save = T3.slice(T3.indexOf('function adminMailTemplateSave_'));
    assert.ok(/mailtplHeadersOk_\(sh\)/.test(save.slice(0, 1500)),
      '壊れたシートに書き込もうとしています');
  });
});
