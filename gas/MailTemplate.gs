/**
 * 採択・不採択のメール文面を、管理ページから編集できるようにする。
 *
 * ■ なぜ要るか
 *   けいた指示（2026-09-03）：
 *   「文面はどこかで編集できる？一斉送信機能つけてたと思うから、
 *     文面もその送信機能の範疇でそこで作って送信できるようにしてほしい」
 *
 *   文面を直すたびに私がコードを書き換えて再デプロイする形だと、
 *   けいたに手作業を押し付けているのと同じで、しかも**待ち時間が生まれる**。
 *   締切直後にひと言足したい、という場面は必ず来る。
 *
 * ■ ただし「メーラー」にはしない
 *   自由に書けるようにすると、この仕組みが守ってきたものが3つ壊れる。
 *   そこだけは、保存の時点で断る。
 *
 *   1. **不採択にリンクを載せない**
 *      確定情報フォームのリンクは、載せると送信時にトークンを発行する作りになる。
 *      不採択の方が出店確定情報フォームを開けるようになってしまう。
 *      → 不採択の文面に採択専用の差し込みは入れられない。
 *
 *   2. **採択からリンクを落とさない**
 *      「出店決定です」とだけ書いて送ると、事業者は次に何をすればよいか分からず、
 *      50社ぶんの問い合わせが来る。
 *      → 採択の文面には確定情報フォームのリンクを必ず入れてもらう。
 *
 *   3. **書き間違えた差し込みを、そのまま送らない**
 *      {{お名前}} を {{名前}} と書くと、届いたメールに {{名前}} と出る。
 *      → 知らない差し込みがあれば保存の時点で断る。送信時には遅い。
 *
 * ■ 差し込みが空のときは、その行ごと落とす
 *   素材アップロードURLは未設定のことがある。
 *   置き換えて空文字にすると、本文に空行と「　▼」だけが残る。
 *
 * ■ 既定の文面はコードが持つ
 *   シートが空でも壊れない。「既定に戻す」でいつでも帰ってこられる。
 */

/** 文面シートの見出し。順番も含めてここが正 */
var MAILTPL_HEAD = ['種類', '件名', '本文', '更新日時', '更新者'];

var MAILTPL_SUBJECT_MAX = 200;
var MAILTPL_BODY_MAX = 20000;

/**
 * 使える差し込み。
 *
 * kinds に無い種類では使えない。**ここが唯一の正**で、
 * 画面の一覧も、保存時の検査も、置き換えも、すべてこれを読む。
 */
function MAILTPL_VARS_() {
  return [
    { name: 'お名前',   kinds: ['accept', 'reject'], sample: '〇〇 太郎',
      about: 'ご担当者さまのお名前' },
    { name: '企業名',   kinds: ['accept', 'reject'], sample: '〇〇商店',
      about: '企業・団体名' },
    { name: '出店名',   kinds: ['accept', 'reject'], sample: '〇〇キッチン',
      about: '出店名。ご記入が無ければ、その行ごと消えます' },
    { name: '受付ID',   kinds: ['accept', 'reject'], sample: 'SB-0001',
      about: '受付ID' },
    { name: 'イベント名', kinds: ['accept', 'reject'], sample: EVENT_NAME,
      about: 'イベントの名前' },
    { name: '開催情報', kinds: ['accept', 'reject'], sample: '（開催日・会場などの一覧）',
      about: '開催日・会場・搬入出・営業時間の一覧（複数行になります）' },
    { name: '署名',     kinds: ['accept', 'reject'], sample: '（署名）',
      about: '末尾の署名（主催名・問い合わせ先）' },
    { name: '確定情報フォームURL', kinds: ['accept'],
      sample: 'https://bondance.kreha-c.com/confirm.html?id=SB-0001&t=…',
      about: '**その会社だけの**リンク。当日の運営に必要なこと（火気・車両・人数など）を'
           + 'ご記入いただくフォームです。採択のご連絡にだけ入れられます' },
    { name: '素材アップロードURL', kinds: ['accept'],
      sample: 'https://bondance.kreha-c.com/upload.html?id=SB-0001&t=…',
      about: '**その会社だけの**リンク。告知に使うロゴ・お店の写真をご提出いただく画面です。'
           + '設定が空なら、その行ごと消えます' },
    { name: '素材アップロードのご案内', kinds: ['accept'],
      sample: '（素材アップロードのご案内・4行）',
      about: '上のリンクに見出しとひとこと説明を付けた、4行のかたまりです。'
           + 'ふつうはこちらをお使いください。設定が空なら丸ごと消えます' },
    { name: '提出期限', kinds: ['accept'], sample: '2026年10月10日まで',
      about: '出店確定情報の提出期限。設定の「確定情報の提出期限」から作ります。'
           + '空欄のときは「出店可否のご連絡から5営業日以内」と出ます' },
  ];
}

/**
 * 検査のための見本の値。**空文字を入れない。**
 * 空にすると「値が空なら行ごと落とす」規則が働いて、
 * 括弧の残骸まで一緒に消えてしまい、検査にならない。
 */
function mailtplSampleVars_(kind) {
  var out = Object.create(null);
  MAILTPL_VARS_().forEach(function (v) {
    if (v.kinds.indexOf(kind) >= 0) out[v.name] = v.sample || ('（' + v.name + '）');
  });
  return out;
}

/** その種類で使ってよい差し込みの名前 */
function mailtplAllowedVars_(kind) {
  var out = Object.create(null);
  MAILTPL_VARS_().forEach(function (v) {
    if (v.kinds.indexOf(kind) >= 0) out[v.name] = v;
  });
  return out;
}

/** 採択にだけ許す差し込み（不採択に混ざっていないかを見るのに使う） */
function mailtplAcceptOnlyVars_() {
  return MAILTPL_VARS_()
    .filter(function (v) { return v.kinds.indexOf('reject') < 0; })
    .map(function (v) { return v.name; });
}

// ─────────────────────────────── 既定の文面

function mailtplDefault_(kind) {
  return kind === 'reject' ? mailtplDefaultReject_() : mailtplDefaultAccept_();
}

function mailtplDefaultAccept_() {
  return {
    subject: '【出店決定のご案内】{{イベント名}}（受付ID：{{受付ID}}）',
    body: [
      '{{お名前}} 様',
      '',
      'このたびは「{{イベント名}}」への出店にお申し込みいただき、',
      'ありがとうございました。',
      '厳正な選考の結果、{{企業名}} さまの出店が決定いたしました。',
      '',
      '受付ID：{{受付ID}}',
      '出店名：{{出店名}}',
      '',
      '{{開催情報}}',
      '',
      '───────────────────────',
      '■ ご対応をお願いしたいこと',
      '───────────────────────',
      '',
      '当日の運営に必要な情報を、下記のフォームからご登録ください。',
      '搬入の時間帯や誘導の計画に使わせていただきます。',
      '',
      '　▼ 出店確定情報フォーム',
      '　{{確定情報フォームURL}}',
      '',
      '　ご提出期限：{{提出期限}}',
      '',
      '※ このリンクは {{企業名}} さま専用です。',
      '　 他社さまには共有しないようお願いいたします。',
      '',
      '{{素材アップロードのご案内}}',
      '───────────────────────',
      '■ あらためてお伝えする事項',
      '───────────────────────',
      '',
      '【区画の場所】',
      '　場外エリア内のどこになるかは、区画図の確定後にご案内します。',
      '',
      '【お支払い】',
      '　レンタル備品をお申し込みの場合、方法・時期は追ってご連絡いたします。',
      '　請求書の発行に対応します（領収書の発行はいたしかねます）。',
      '',
      '【荒天時の中断】',
      '　営業中に風雨が強まった場合、主催の判断で火気の使用停止や',
      '　営業の中断・終了をお願いすることがあります。',
      '　当日は主催の指示に従っていただきますようお願いいたします。',
      '',
      'ご不明な点がございましたら、本メールへのご返信でお問い合わせください。',
      '当日お会いできることを楽しみにしております。',
      '{{署名}}',
    ].join('\n'),
  };
}

function mailtplDefaultReject_() {
  return {
    subject: '【選考結果のご連絡】{{イベント名}}（受付ID：{{受付ID}}）',
    body: [
      '{{お名前}} 様',
      '',
      'このたびは「{{イベント名}}」への出店にお申し込みいただき、',
      'ありがとうございました。',
      '',
      '慎重に検討させていただきましたが、ご用意できる区画数に限りがあり、',
      '誠に残念ながら、今回は出店を見送らせていただくこととなりました。',
      'ご期待に添えず、申し訳ございません。',
      '',
      '受付ID：{{受付ID}}',
      '出店名：{{出店名}}',
      '企業・団体名：{{企業名}}',
      '',
      // けいた確定（2026-09-03）：この2行を足す。
      //   ・理由を書かない方針なのに問い合わせを促していたので、
      //     「なぜうちが」という返信に答えられないまま放置になっていた
      //   ・キャンセル待ちだと思って待つ方が出る
      'なお、今回の選考の理由につきましては、お答えいたしかねます。',
      'あらかじめご了承くださいますようお願い申し上げます。',
      'また、今回は繰り上げのご連絡を予定しておりません。',
      '',
      'お忙しいなかご準備いただきましたこと、あらためて御礼申し上げます。',
      '本イベントは今後も継続して開催してまいります。',
      '次回の募集の際には、あらためてご案内させていただければ幸いです。',
      '',
      'ご不明な点がございましたら、本メールへのご返信でお問い合わせください。',
      '{{署名}}',
    ].join('\n'),
  };
}

// ─────────────────────────────── シートの読み書き

function mailtplSheet_() {
  return sheet_(SHEET.MAILTPL);
}

/**
 * 見出しが定義どおりか。
 *
 * ■ なぜ要るか
 *   ほかのシートは全部これを持っている（`confirmSave_` は見出しの1列目を見て止まり、
 *   `rentalHeaders_` は1列でも欠けたら書き込まない）。
 *   **このシートだけが素通しだった**（2026-09-04 の点検で指摘）。
 *
 *   読み書きは列位置を決め打ちしている。「件名」と「本文」の列を入れ替えると、
 *   種類の行は見つかるし、両方とも空でないので「編集済み」として採用され、
 *   **件名と本文が入れ替わったまま50社に送られる**。
 *   例外が出ないので、`catch` の既定落ちも働かない。
 *
 *   運営がシートを開いて列の並びや幅を触るのは、普通に起きる。
 */
function mailtplHeadersOk_(sh) {
  if (sh.getLastRow() === 0) return true;      // まだ何も無い＝これから作る
  var width = Math.max(sh.getLastColumn(), MAILTPL_HEAD.length);
  var head = sh.getRange(1, 1, 1, width).getValues()[0]
    .map(function (h) { return asText_(h).trim(); });
  for (var i = 0; i < MAILTPL_HEAD.length; i++) {
    if (head[i] !== MAILTPL_HEAD[i]) return false;
  }
  return true;
}

/** 見出しが壊れているときの返事。**書きは断る** */
function mailtplHeadBroken_() {
  return { ok: false, error: 'bad_sheet',
    message: '「' + SHEET.MAILTPL + '」シートの見出しが定義と違います'
           + '（' + MAILTPL_HEAD.join('／') + ' の順）。'
           + '列の並びを戻すか、Apps Script から setup() を実行してください。'
           + '直るまで、文面は**はじめの文面**を使って送ります。' };
}

/** 種類の行番号。無ければ -1 */
function mailtplFindRow_(sh, kind) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim() === kind) return i + 2;
  }
  return -1;
}

/**
 * その種類の文面。シートに無ければ既定を返す。
 * **読めなかったときも既定に落とす**（文面が読めないから送れない、をなくす）。
 */
var _mailtplCache = null;

function mailtplRead_(kind) {
  // 送信は1通ずつループする。ここでシートを読み直すと
  // 1通あたり4回の往復が増え、40通で約160回になる（実行時間の6分に効く）。
  // 設定（_configCache）・レンタル（_rentalCache）と同じく、実行の間だけ覚える
  _mailtplCache = _mailtplCache || Object.create(null);
  if (_mailtplCache[kind]) return _mailtplCache[kind];

  var def = mailtplDefault_(kind);
  var out = null;
  try {
    var sh = mailtplSheet_();
    // 見出しが壊れていたら、シートの中身は読まない（入れ替わった列を読むより既定が安全）
    if (!mailtplHeadersOk_(sh)) {
      console.error('[mailtplRead_] ' + SHEET.MAILTPL + ' の見出しが定義と違います。'
        + 'はじめの文面を使います。');
      _mailtplCache[kind] = { subject: def.subject, body: def.body,
                              custom: false, headBroken: true };
      return _mailtplCache[kind];
    }
    var row = mailtplFindRow_(sh, kind);
    if (row < 0) {
      out = { subject: def.subject, body: def.body, custom: false };
    } else {
      var v = sh.getRange(row, 1, 1, MAILTPL_HEAD.length).getValues()[0];
      var subject = asText_(v[1]).trim();
      var body = asText_(v[2]);
      out = (!subject || !body.trim())
        ? { subject: def.subject, body: def.body, custom: false }
        : { subject: subject, body: body, custom: true,
            at: asText_(v[3]), by: asText_(v[4]) };
    }
  } catch (e) {
    logError_('mailtplRead_:' + kind, e);
    out = { subject: def.subject, body: def.body, custom: false };
  }
  _mailtplCache[kind] = out;
  return out;
}

// ─────────────────────────────── 置き換え

/**
 * 差し込みを実際の値に置き換える。
 *
 * 値が空のものは、**その行ごと落とす**。
 * 置き換えて空文字にすると「出店名：」や「　▼」だけの行が残る。
 */
function mailtplRender_(text, vars) {
  var lines = String(text).split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var dropped = false;
    var filled = line.replace(/\{\{([^{}]{1,40})\}\}/g, function (m, name) {
      var key = String(name).trim();
      if (!Object.prototype.hasOwnProperty.call(vars, key)) return m;
      var v = vars[key];
      if (v === null || v === undefined || String(v) === '') { dropped = true; return ''; }
      return String(v);
    });
    // 値が空だった行は、残っても意味が無いので落とす。
    //   ・空になった行              → 「」
    //   ・見出しだけが残った行      → 「出店名：」
    //   ・記号だけが残った行        → 「　▼」
    // 空文字に置き換えるだけだと、届いたメールに
    // 「出店名：」という宙に浮いた行が残る（2026-09-03 の検査で発見）
    if (!dropped) { out.push(filled); continue; }
    if (filled.trim() === '') continue;
    if (/[：:]\s*$/.test(filled)) continue;
    if (/^[\s　▼・\-—]*$/.test(filled)) continue;
    out.push(filled);
  }
  return out.join('\n');
}

/** その行に差し込む値をそろえる */
function mailtplVars_(kind, row, links) {
  var v = {
    'お名前': row.person || '',
    '企業名': row.company || '',
    '出店名': row.shopName || '',
    '受付ID': row.id || '',
    'イベント名': EVENT_NAME,
    '開催情報': eventFactsBlock_(),
    '署名': signature_(),
  };
  if (kind === 'accept') {
    var up = (links && links.upload) || '';
    v['確定情報フォームURL'] = (links && links.confirm) || '';
    v['素材アップロードURL'] = up;
    v['提出期限'] = confirmDeadlineText_();
    v['素材アップロードのご案内'] = up
      ? ['告知に使わせていただく素材（ロゴ・お店の写真など）は、',
         'こちらからご提出ください。',
         '',
         '　▼ 素材アップロード',
         '　' + up,
         ''].join('\n')
      : '';
  }
  return v;
}

/** 文面を組み立てる。Notify.gs の buildAcceptMail_ / buildRejectMail_ がこれを呼ぶ */
function mailtplBuild_(kind, row, links) {
  var tpl = mailtplRead_(kind);
  var vars = mailtplVars_(kind, row, links);
  return {
    subject: mailtplRender_(tpl.subject, vars).split('\n').join(' ').trim(),
    body: mailtplRender_(tpl.body, vars),
  };
}

// ─────────────────────────────── 保存前の検査

/**
 * 保存してよいか。返すのは断る理由の配列（空なら通す）。
 *
 * **ここが、この機能の要**。
 * 自由に書ける画面を出す以上、守るものは保存の時点で守る。
 */
function mailtplValidate_(kind, subject, body) {
  var errs = [];
  var allowed = mailtplAllowedVars_(kind);

  subject = String(subject == null ? '' : subject);
  body = String(body == null ? '' : body);

  if (!subject.trim()) errs.push('件名が空です。');
  if (!body.trim()) errs.push('本文が空です。');
  if (subject.length > MAILTPL_SUBJECT_MAX) {
    errs.push('件名が長すぎます（' + MAILTPL_SUBJECT_MAX + '文字まで）。');
  }
  if (body.length > MAILTPL_BODY_MAX) {
    errs.push('本文が長すぎます（' + MAILTPL_BODY_MAX + '文字まで）。');
  }
  if (subject.indexOf('\n') >= 0) {
    errs.push('件名に改行は入れられません。');
  }

  // ── 知らない差し込み。**送ってから気づくのでは遅い**
  //
  //   件名と本文は**分けて数える**。ひとまとめにしていたので、
  //   件名にリンクを1つ置くだけで「本文にリンクがある」と判定していた。
  //   件名は途中で切れるので、リンクとしては役に立たない
  //   （2026-09-04 の点検で指摘）。
  var acceptOnly = mailtplAcceptOnlyVars_();
  var seen = Object.create(null);
  var seenBody = Object.create(null);
  var scan = function (text, where) {
    var re = /\{\{([^{}]{0,60})\}\}/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var name = String(m[1]).trim();
      if (allowed[name]) {
        seen[name] = true;
        if (where === '本文') seenBody[name] = true;
        continue;
      }
      if (kind === 'reject' && acceptOnly.indexOf(name) >= 0) {
        errs.push(where + 'の {{' + name + '}} は、不採択のご連絡には入れられません。'
          + 'このリンクは、その会社だけの鍵を発行して開くものです。'
          + '不採択の方が出店確定情報フォームを開けてしまいます。');
      } else {
        errs.push(where + 'の {{' + name + '}} は、使える差し込みにありません。'
          + '（このまま送ると、メールに {{' + name + '}} とそのまま出ます）');
      }
    }
  };
  scan(subject, '件名');
  scan(body, '本文');

  // ── ここから先は、**実際に組み立てたもの**を見る。
  //
  //   正規表現で「差し込みらしきもの」を探すだけだと、置き換えの側と食い違う。
  //   実際に抜けていた（2026-09-04）：
  //     ・{{{{お名前}}}}（二重）→ 内側だけ置き換わり **{{小林 大輔}} 様** と届く
  //     ・{{{お名前}}}（奇数）→ **{小林 大輔}** と届く
  //     ・{{あ…}}（名前が60文字超）→ どちらの正規表現にも当たらず素通り
  //   置き換えと同じ関数を通してから探せば、食い違いようがない。
  //   見本の値で組み立てるので、値が空のときの行落ちにも巻き込まれない。
  var sample = mailtplSampleVars_(kind);
  var builtSubject = mailtplRender_(subject, sample);
  var built = builtSubject + '\n' + mailtplRender_(body, sample);

  // 括弧が1つでも残っていたら断る（2つ組だけを見ていると、奇数個が抜ける）
  if (/[{}]/.test(built)) {
    var left = (built.match(/[^\n]{0,20}[{}][^\n]{0,20}/) || [''])[0].trim();
    // 見本の値は「〇〇 太郎」のような、**明らかに例だと分かるもの**にしてある。
    // 以前は模擬データの実在の担当者名を使っていたので、
    // 「打った覚えのない他社の人の名前が出る」と受け取られた
    //（2026-09-04 の最終確認で指摘）
    errs.push('差し込みの書き方が正しくありません。このまま送ると、メールに'
      + (left ? ' ' + left + ' ' : ' ')
      + 'のように括弧がそのまま出ます。'
      + '{{ }} が二重（{{{{お名前}}}}）になっていないか、'
      + '閉じ忘れがないかご確認ください。');
  }

  // ── 不採択に、**出店確定情報フォーム／素材アップロードのリンク**を書かせない。
  //
  // ■ なぜ「リンクを一切禁止」ではないのか
  //   2026-09-04 の点検で、既定の不採択文面が**実際にはURLを含んでいる**と分かった。
  //   {{署名}} に https://bondance.kreha-c.com/ が入っているためである。
  //   つまり「不採択にリンクは入れられません」という画面の主張は、
  //   届くメールにおいて最初から成立していなかった。
  //
  //   守りたいのは「リンクが無いこと」ではなく、
  //   **その会社だけの鍵つきリンク（確定情報フォーム・素材アップロード）を
  //   不採択の方に渡さないこと**。イベントサイトへの案内は載せてよい
  //   （「次回の募集はこちら」と書けないほうが、運用上つらい）。
  //
  // ■ 素の文字列ではなく、**組み立てた本文**を見る
  //   スキーム無し（bondance.kreha-c.com/confirm.html）、全角の ｈｔｔｐｓ、
  //   2行に分けた書き方は、素の文字列を行ごとに見る形では全部すり抜けていた。
  //   全角を半角に直し、空白と改行を落としてから探せば、その3つとも捕まる。
  if (kind === 'reject') {
    var flat = mailtplFlatten_(built);
    var banned = ['confirm.html', 'upload.html'];
    [configText('確定情報フォームURL', ''), configText('素材アップロードURL', '')]
      .forEach(function (u) {
        var key = mailtplFlatten_(String(u || ''));
        if (key && banned.indexOf(key) < 0) banned.push(key);
      });
    for (var bi = 0; bi < banned.length; bi++) {
      if (flat.indexOf(banned[bi]) >= 0) {
        errs.push('不採択のご連絡に「' + banned[bi] + '」へのリンクが入っています。'
          + '出店確定情報フォームと素材アップロードは、'
          + 'その会社だけの鍵で開くものなので、不採択の方にはお渡しできません。'
          + 'この行を消してから、もう一度お試しください。'
          + '（イベントサイトなど、ほかのリンクは入れていただけます）');
        break;
      }
    }
  }

  // 採択なのに**本文に**リンクが無い。
  // 「決定です」だけ送ると、次に何をすればよいか伝わらない
  if (kind === 'accept' && !seenBody['確定情報フォームURL']) {
    errs.push(seen['確定情報フォームURL']
      ? '{{確定情報フォームURL}} が件名にあります。**本文に**入れてください'
        + '（件名は途中で切れるので、リンクとして使えません）。'
      : '採択のご連絡には {{確定情報フォームURL}} を必ず入れてください。'
        + 'これが無いと、事業者は次に何をすればよいか分かりません。');
  }

  return errs;
}

/**
 * リンクを探すために、書き方の違いを潰す。
 * 全角のURL・空白・大文字小文字・行分けを、すべて同じ形にそろえる。
 */
function mailtplFlatten_(text) {
  return String(text)
    .replace(/[！-～]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[\s　]/g, '')
    .toLowerCase();
}

/**
 * 断りはしないが、伝えておきたいこと。
 * 「送ってから気づく」種類のもの。
 */
function mailtplWarnings_(kind, subject, body) {
  var w = [];
  if (kind === 'reject' && /不採択|お断り|見送/.test(subject)) {
    w.push('件名に選考の結果が読み取れる言葉が入っています。'
      + '受信箱の一覧に出るので、人前でメールを開いたときに'
      + '周りの目に入ります。件名は結果が分からない言い方をおすすめします。');
  }
  if (kind === 'accept' && body.indexOf('{{素材アップロード') < 0) {
    w.push('素材（ロゴ・写真）のご案内が本文にありません。'
      + '別の機会にご案内する予定であれば、このままで問題ありません。');
  }
  if (kind === 'accept' && !configText('確定情報フォームURL', '')) {
    w.push('設定の「確定情報フォームURL」がまだ空です。'
      + 'このままでは採択のご連絡を送れません。');
  }
  if (body.indexOf('{{署名}}') < 0) {
    w.push('{{署名}} が本文にありません。差出人と問い合わせ先が本文に出ません。');
  }
  return w;
}

// ─────────────────────────────── 管理API

/** いまの文面と、使える差し込みの一覧を返す */
function adminMailTemplate_(auth, payload) {
  var kind = String((payload && payload.kind) || 'accept');
  if (kind !== 'accept' && kind !== 'reject') {
    return { ok: false, error: 'bad_request', message: '通知の種類が不正です。' };
  }
  var tpl = mailtplRead_(kind);
  var def = mailtplDefault_(kind);
  return {
    ok: true,
    kind: kind,
    subject: tpl.subject,
    body: tpl.body,
    custom: !!tpl.custom,
    at: tpl.at || '',
    by: tpl.by || '',
    isDefault: (tpl.subject === def.subject && tpl.body === def.body),
    // **シートの見出しが壊れていることを、画面に伝える。**
    // 計算していたのに誰も読んでいなかったので、
    // 保存した文面が既定に差し替わっているのに画面は
    // 「はじめの文面のまま」と**嘘をついていた**（2026-09-04 の点検で指摘）
    headBroken: !!tpl.headBroken,
    headBrokenMessage: tpl.headBroken ? mailtplHeadBroken_().message : '',
    vars: MAILTPL_VARS_().filter(function (v) { return v.kinds.indexOf(kind) >= 0; })
      // 例も返す。名前と説明だけでは、似た3つ（確定情報フォームURL／
      // 素材アップロードURL／素材アップロードのご案内）を選び分けられない
      .map(function (v) { return { name: v.name, about: v.about, sample: v.sample }; }),
    subjectMax: MAILTPL_SUBJECT_MAX,
    bodyMax: MAILTPL_BODY_MAX,
  };
}

/** 保存する。**検査を全部通してからでないと1文字も書かない** */
function adminMailTemplateSave_(auth, payload) {
  var kind = String((payload && payload.kind) || '');
  if (kind !== 'accept' && kind !== 'reject') {
    return { ok: false, error: 'bad_request', message: '通知の種類が不正です。' };
  }
  var subject = String((payload && payload.subject) || '');
  var body = String((payload && payload.body) || '');

  var errs = mailtplValidate_(kind, subject, body);
  if (errs.length) {
    return { ok: false, error: 'bad_value', errors: errs,
      message: errs.join(' ／ ') + '　（まだ何も保存していません）' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var sh = mailtplSheet_();
    // 列が入れ替わったシートに書き込むと、件名と本文が入れ替わったまま残る
    if (!mailtplHeadersOk_(sh)) return mailtplHeadBroken_();
    var row = mailtplFindRow_(sh, kind);
    var before = row > 0
      ? sh.getRange(row, 1, 1, MAILTPL_HEAD.length).getValues()[0]
      : ['', '', '', '', ''];
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    var line = [kind, safeCellText_(subject), safeCellText_(body), stamp, auth.person];
    if (row < 0) {
      sh.appendRow(line);
      row = sh.getLastRow();
    } else {
      sh.getRange(row, 1, 1, MAILTPL_HEAD.length).setValues([line]);
    }

    // 何を送るかが変わる。いつ誰が変えたかは必ず残す
    var label = (kind === 'reject' ? '不採択' : '採択') + 'のご連絡';
    if (asText_(before[1]).trim() !== subject.trim()) {
      appendHistory(auth.person, '', 'メール文面：' + label + 'の件名',
        asText_(before[1]), subject, '管理ページから編集');
    }
    if (asText_(before[2]) !== body) {
      appendHistory(auth.person, '', 'メール文面：' + label + 'の本文',
        mailtplShort_(asText_(before[2])), mailtplShort_(body), '管理ページから編集');
    }

    _mailtplCache = null;      // 読み直させる（実行内キャッシュ）
    SpreadsheetApp.flush();
    return { ok: true, kind: kind, at: stamp,
             warnings: mailtplWarnings_(kind, subject, body) };
  } finally {
    lock.releaseLock();
  }
}

/** 既定の文面に戻す */
function adminMailTemplateReset_(auth, payload) {
  var kind = String((payload && payload.kind) || '');
  if (kind !== 'accept' && kind !== 'reject') {
    return { ok: false, error: 'bad_request', message: '通知の種類が不正です。' };
  }
  var def = mailtplDefault_(kind);
  return adminMailTemplateSave_(auth, {
    kind: kind, subject: def.subject, body: def.body,
  });
}

/** 変更履歴に本文をまるごと入れると読めない。頭だけ残す */
function mailtplShort_(text) {
  var t = String(text).split('\n').join(' ↵ ');
  return t.length > 200 ? t.slice(0, 200) + '…' : t;
}
