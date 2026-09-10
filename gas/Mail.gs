/**
 * メール送信。
 *
 * すべて fcosaka_bondance@kreha-c.com（表示名は設定シートの「送信元表示名」）から送る。
 * このアドレスは hello@kreha-c.com のエイリアスとして Gmail に登録されている必要がある。
 * 未登録のまま送ると差出人が hello@ になるため、送信前に登録状況を確認する。
 *
 * 署名は「サステナ盆踊り実行委員会（FC大阪／UPDATER）」（共同主催の見え方・monitor U5）。
 */

// ⚠ src/content.js の EVENT.name と同じ値にすること。
//   GAS からは content.js を読めないため、ここだけ手で持っている。
//   食い違うと**メールの件名だけ旧名のまま**になり、誰も気づかない。
//   test/assets.test.js がこの2つの一致を検査する。
var EVENT_NAME = '夕照祭2026 FC大阪 秋のサステナ盆踊り';

/**
 * エイリアスが Gmail に登録されているか。未登録なら null を返す。
 * 未登録・権限不足のどちらも「差出人が実行アカウントになる」という重い結果を招くので、
 * 黙って握りつぶさず必ずログに残す。
 */
function resolveAlias_() {
  var want = configText('送信元アドレス', configText('問い合わせメール', ''));
  if (!want) { logError_('resolveAlias_', new Error('送信元アドレスが未設定')); return null; }
  try {
    var aliases = GmailApp.getAliases();
    for (var i = 0; i < aliases.length; i++) {
      if (aliases[i].toLowerCase() === want.toLowerCase()) return want;
    }
    logError_('resolveAlias_', new Error('エイリアスが未登録：' + want
      + '（登録済み：' + aliases.join(', ') + '）'));
  } catch (e) {
    logError_('resolveAlias_:権限', e);
  }
  return null;
}

function mailOptions_() {
  var alias = resolveAlias_();
  var opt = {
    name: configText('送信元表示名', 'FC大阪サステナ盆踊り実行委員会'),
    replyTo: configText('ReplyTo', configText('問い合わせメール', '')),
  };
  if (alias) opt.from = alias;
  return opt;
}

function signature_() {
  var contact = configText('問い合わせメール', 'fcosaka_bondance@kreha-c.com');
  return [
    '',
    '──────────────────────',
    configText('送信元表示名', 'FC大阪サステナ盆踊り実行委員会'),
    '主催：FC大阪／UPDATER',
    'お問い合わせ：' + contact,
    configText('公開URL', 'https://bondance.kreha-c.com/'),
    '──────────────────────',
  ].join('\n');
}

/**
 * 応募者が当日まで参照する基本情報。受付確認メールの冒頭に必ず入れる。
 * 応募者は当日の朝、このメールを見て会場に向かう（モニター：たこ焼き店主）。
 * 自分が書いた答えだけが返ってくるメールは、控えとしては半分しか機能しない。
 */
function eventFactsBlock_() {
  var deadline = '';
  try {
    deadline = formatJa(getDeadline());
  } catch (e) { deadline = '（別途ご案内）'; }
  return [
    '───────────────────────',
    '開催日　：2026年10月24日（土）',
    '会　場　：東大阪市花園ラグビー場（場外エリア）',
    '搬　入　：9:30〜10:30',
    '営業時間：11:00〜17:30',
    '搬　出　：18:00〜19:00',
    '応募締切：' + deadline,
    '───────────────────────',
  ].join('\n');
}

/**
 * 応募内容を人が読める形に整形する。受付確認・応募通知の両方で使う。
 *
 * ⚠ 見るのは**応募段階の項目だけ**（applyFields）。
 *   FIELDS 全部を回すと、採択後に聞く項目（現場責任者・搬入車両・保険など）が
 *   「（未記入）」で控えメールに並ぶ。必須の項目は「任意で未記入なら出さない」の
 *   条件から外れるため、全応募者に出てしまう。
 *   応募者からは「必須を書き落としたのに受け付けられた」と読める。
 *   validate_ は二段階収集に直したのに、ここだけ取り残されていた。
 */
function renderAnswers_(values) {
  var lines = [];
  SECTIONS.forEach(function (sec) {
    var body = [];
    applyFields().forEach(function (f) {
      if (f.section !== sec.id || f.type === 'honeypot' || !f.sheet) return;
      if (!isVisible(f, values)) return;

      var v = values[f.key];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) {
        if (!isRequired(f, values)) return; // 任意で未記入なら行ごと出さない
      }
      body.push('  ' + f.label + '：' + displayValue_(f, values));

      if (f.unknownCheckbox && values[f.unknownCheckbox.key]) {
        body.push('  （' + f.unknownCheckbox.label + ' にチェック）');
      }
    });
    if (body.length) {
      lines.push('■ ' + sec.title);
      lines = lines.concat(body);
      lines.push('');
    }
  });
  return lines.join('\n');
}

function displayValue_(field, values) {
  var v = values[field.key];

  // レンタルは { 品目名: 個数 } のオブジェクト。そのまま String() すると
  // 「[object Object]」になり、応募者の控えとして役に立たない。
  // 金額のもめごとが起きたとき、応募者の手元にある唯一の記録がこれになる。
  if (field.type === 'rental') {
    var r = rentalSummary_(values);
    if (!r.detail) return 'ご利用なし';
    return r.detail + (r.total === '' ? '' : '（合計 ' + Number(r.total).toLocaleString('ja-JP') + '円）');
  }

  if (v === undefined || v === null || v === '') return '（未記入）';
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ';
  if (Array.isArray(field.options) && field.options.length && typeof field.options[0] === 'object') {
    for (var i = 0; i < field.options.length; i++) {
      if (field.options[i].value === v) return field.options[i].label;
    }
  }
  return String(v);
}

/** 応募者への受付確認メール。記入内容を全文控えとして返す（monitor A：控えとして安心）。 */
function sendReceiptMail(values, receiptId) {
  var subject = '【受付完了】' + EVENT_NAME + ' 出店応募（受付ID：' + receiptId + '）';
  var body = [
    (values.contactName || '') + ' 様',
    '',
    'このたびは「' + EVENT_NAME + '」への出店にお申し込みいただき、',
    'ありがとうございます。以下の内容で応募を受け付けました。',
    '',
    '受付ID：' + receiptId,
    '',
    eventFactsBlock_(),
    '',
    '出店の可否は、応募締切後3営業日以内にメールでご連絡いたします。',
    'ご記入内容の変更は、本メールへのご返信でご連絡ください。',
    '',
    '※ レンタル備品の単価が未確定の場合は、確定しだい別途ご連絡します。',
    '　 金額をご確認のうえでのお取り消し・数量変更も承ります。',
    '',
    '───────────────────────',
    'ご記入いただいた内容',
    '───────────────────────',
    '',
    renderAnswers_(values),
    signature_(),
  ].join('\n');

  GmailApp.sendEmail(values.contactEmail, subject, body, mailOptions_());
}

/** 担当社員＋通知ON管理者への応募通知メール。 */
function sendNotifyMail(values, receiptId, duplicateFlag, adminUrl) {
  // 形式の壊れたアドレスが1件混じっただけで全員分が落ちるのを防ぐ
  var recipients = getNotifyRecipients(values.fcosakaStaff).filter(function (a) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
  });
  if (!recipients.length) {
    logError_('sendNotifyMail', new Error('通知の宛先が0件です：' + receiptId
      + '／担当社員=' + (values.fcosakaStaff || '(未選択)')));
    alertOperator_('staffUnknown', receiptId,
      '応募で選ばれた担当社員：' + (values.fcosakaStaff || '（未選択）'));
    return { sent: 0, failed: [] };
  }

  // 件名はスマホの一覧で切れないよう短くする。区画はラベル全文ではなく短縮表記。
  var types = Array.isArray(values.boothTypes) ? values.boothTypes : [];
  var typeLabel = types.length ? (types[0] + (types.length > 1 ? 'ほか' + (types.length - 1) : '')) : '';
  var sizeLabel = { S1: '1区画', S2: '2区画', S3: '3区画' }[values.boothSize] || '';

  var subject = (duplicateFlag ? '【重複確認】' : '【新規応募】')
    + receiptId + ' ' + (values.companyName || '')
    + '（' + typeLabel + '／' + sizeLabel + '）';

  var head = [
    '新しい出店応募が届きました。',
    '',
    '受付ID　：' + receiptId,
    '企業名　：' + (values.companyName || ''),
    '出店名　：' + (values.boothName || '（企業名と同じ）'),
    '受付日時：' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'),
    '担当社員：' + (values.fcosakaStaff || ''),
    '連絡先　：' + (values.contactEmail || '') + ' / ' + (values.contactPhone || ''),
  ];
  if (duplicateFlag) {
    head.push('');
    head.push('※ 同一企業からの応募が' + duplicateFlag + 'あります。');
    head.push('　 複数ブースのお申し込みであれば、そのままで問題ありません。');
  }
  if (adminUrl) {
    head.push('');
    head.push('管理ページ：' + adminUrl);
  }

  var body = head.concat([
    '',
    '───────────────────────',
    '応募内容',
    '───────────────────────',
    '',
    renderAnswers_(values),
    signature_(),
  ]).join('\n');

  // 宛先ごとに送る。1件失敗しても残りには届く。
  var sent = 0, failed = [];
  var opt = mailOptions_();
  recipients.forEach(function (to) {
    try { GmailApp.sendEmail(to, subject, body, opt); sent++; }
    catch (e) { failed.push(to); logError_('sendNotifyMail:' + to, e); }
  });
  if (failed.length) alertOperator_('noticePartlyFailed', receiptId, '届かなかった宛先：' + failed.join(', '));
  return { sent: sent, failed: failed };
}

/**
 * 運用者への警報。
 *
 * ■ 送るのは「人が動かないと直らないこと」だけ
 *   2026-09-02 けいた指摘：
 *   「応募システムの異常っていうメールが頻発してるけどこれは何。
 *     …このメールの意味が分からない。ほんとのアラートだけでいい」
 *
 *   それまでは、深刻さの違う15種類が**すべて同じ件名**で飛んでいた。
 *   「鍵の合わないアクセスがありました」のように、
 *   **受け取っても何もできないもの**まで混ざっていた。
 *   警報が多すぎると、本当の警報が埋もれる。それがいちばん危ない。
 *
 * ■ 文面は、受け取る人が読んで動ける形にする
 *   受け取るのはけいただけではない。FC大阪の社員も一般権限で入る。
 *   1件ごとに **何が起きたか／いま困ること／していただきたいこと** を持たせる。
 *   test/alerts.test.js が、3つとも埋まっていることを見張っている。
 *
 * ■ 深刻さを件名に出す
 *   【至急】　… 応募や連絡が失われている。すぐ手を打つ必要がある
 *   【要確認】… 動いてはいるが、確かめないと後で困る
 */
var ALERT_ = {
  ledgerWriteFailed: {
    level: '至急', title: '応募を記録できませんでした',
    what: '応募フォームから届いた内容を、応募一覧に書き込めませんでした。',
    impact: '応募者の画面には受付番号が出ていません。'
          + 'このまま放置すると、この応募は誰にも気づかれないまま消えます。',
    todo: 'スプレッドシートの「退避」シートを開いてください。'
        + '届いた内容はそこに残してあります。'
        + '応募者へのご連絡と、応募一覧への手入力をお願いします。',
  },
  receiptMailFailed: {
    level: '要確認', title: '応募者への受付確認メールを送れませんでした',
    what: '応募は記録できましたが、応募者あての受付確認メールが送れませんでした。',
    impact: '応募者は「届いたのかどうか分からない」状態です。'
          + '同じ内容で二重に応募される原因になります。',
    todo: '応募一覧でこの受付IDの行を開き、メールアドレスをご確認のうえ、'
        + '受け付けた旨をご連絡ください。',
  },
  historyWriteFailed: {
    level: '至急', title: '変更履歴を残せませんでした',
    what: '応募一覧の内容は書き換わりましたが、その記録を変更履歴に残せませんでした。',
    impact: '誰がいつ何を変えたかが追えません。'
          + '「言った・言わない」になったときに、こちらに根拠が残りません。',
    todo: '変更履歴シートが壊れていないかご確認ください。'
        + '直前に行った操作の内容を、念のためメモに控えてください。',
  },
  confirmColumnsMissing: {
    level: '至急', title: '出店確定情報に、記録できていない項目があります',
    what: '出店確定情報シートに、いまの項目定義より少ない列しかありません。'
        + '足りない列の値は、シートには入っていません。',
    impact: '出店者さまが入力した内容が、**シートの上では空欄に見えます**。'
          + '当日の運営でその項目を見ると、聞いていないのと同じ状態になります。'
          + '（値そのものは「生データ(JSON)」の列に残っているので、復元はできます）',
    todo: '「出店確定情報」のシートに、列を足す必要があります。'
        + '事務局にご連絡いただくか、Apps Script から setup() を1回実行してください'
        + '（足りない列が後ろに足されます）。そのあと、これまでに届いた分を'
        + '「出店確定情報」の「生データ(JSON)」の列からご確認ください。',
  },
  noticeMailFailed: {
    level: '要確認', title: '担当者への通知メールを送れませんでした',
    what: '内容は記録できましたが、担当者あてのお知らせメールが送れませんでした。',
    impact: '担当の方が、この動きに気づけていません。',
    todo: '管理ページで内容をご確認のうえ、担当の方へ口頭かチャットでお伝えください。',
  },
  staffUnknown: {
    level: '要確認', title: '担当者が分からない応募・更新がありました',
    what: 'お知らせすべき担当者のメールアドレスが、関係者に登録されていませんでした。',
    impact: 'その担当の方には届いていません。'
          + '（このメールを受け取っている方には届いています）',
    todo: '管理ページの「関係者」タブで、その方のメールアドレスをご登録ください。'
        + '登録すれば、次回から直接届きます。',
  },
  noticePartlyFailed: {
    level: '要確認', title: '通知メールの一部が届きませんでした',
    what: '担当者あてのお知らせのうち、一部の宛先で送信に失敗しました。',
    impact: 'その方だけ、この動きに気づけていません。',
    todo: '下の宛先が正しいか、「関係者」タブでご確認ください。',
  },
  acceptMailFailed: {
    level: '至急', title: '採択通知を送れなかった先があります',
    what: '出店決定のご案内メールで、送信に失敗した相手がいます。',
    impact: 'その事業者は、採択されたことも、確定情報の提出期限も知りません。',
    todo: '「メール送信」タブを開き、失敗した相手にもう一度お送りください。'
        + '宛先が間違っている場合は、先に応募一覧で直してください。',
  },
  loginFailures: {
    level: '要確認', title: '管理ページのログインが続けて失敗しています',
    what: '1時間のあいだに、管理ページのログインが何度も失敗しました。',
    impact: 'ご自身の打ち間違いなら問題ありません。'
          + '心当たりが無い場合、パスワードを探られている可能性があります。',
    todo: '心当たりが無ければ、「設定」タブでパスワードを変更してください。'
        + '変更すると、いま入っている方も入り直しになります。',
  },
  probing: {
    level: '要確認', title: '専用リンクへの不一致アクセスが続いています',
    what: '出店確定情報フォーム・素材アップロードの専用リンクに、'
        + '合わない鍵でのアクセスが短時間に多数ありました。',
    impact: 'リンクの鍵は32桁なので、当たることはまず考えられません。'
          + 'いますぐ困ることはありません。',
    todo: '心当たりが無ければ、そのままで構いません。'
        + '続くようであれば、ご相談ください。',
  },
};

/**
 * 運用者（設定シートの「障害通知先」、既定は問い合わせメール）に警報を送る。
 * 通知が飛ばない事故は、通知が飛ばないので誰も気づかない。その輪を断つための最後の一本。
 *
 * key は ALERT_ の名前。**生の文字列は受け取らない**
 * （文面を書く場所を1か所に閉じ、書き手に3つの項目を必ず埋めさせるため）。
 */
function alertOperator_(key, receiptId, extra) {
  try {
    var a = ALERT_[key];
    if (!a) {
      console.error('[alertOperator_] 知らない警報です: ' + key);
      return;
    }
    var to = configText('障害通知先', configText('問い合わせメール', ''));
    if (!to) return;

    var body = [
      a.what,
      '',
      '■ いま困ること',
      '　' + a.impact,
      '',
      '■ していただきたいこと',
      '　' + a.todo,
    ];
    if (extra) body = body.concat(['', '■ 詳細', '　' + extra]);
    body = body.concat([
      '',
      '───────────────────────',
      '受付ID　：' + (receiptId || '（なし）'),
      '発生時刻：' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'),
      '',
      'このメールは、応募システムが自動で送っています。',
    ]);

    GmailApp.sendEmail(to, '【' + a.level + '】サステナ盆踊り｜' + a.title,
      body.join('\n'), { name: 'サステナ盆踊り 応募システム' });
  } catch (e) {
    console.error('[alertOperator_] 通知にも失敗: ' + e);
  }
}

/**
 * 送信前の自己診断。デプロイ直後に1回実行して、差出人と残量を確認する。
 * 本番アドレスには送らない（けいたの確認なしに実アドレスへ送らないため）。
 */
function diagnoseMail() {
  var alias = resolveAlias_();
  return {
    aliasRegistered: !!alias,
    from: alias || Session.getActiveUser().getEmail(),
    replyTo: configText('ReplyTo', ''),
    remainingQuota: MailApp.getRemainingDailyQuota(),
    note: alias ? 'エイリアスは登録済みです。'
                : '⚠ エイリアスが未登録です。Gmailの「他のメールアドレスを追加」で登録してください。'
                + '未登録のままだと差出人が実行アカウントのアドレスになります。',
  };
}
