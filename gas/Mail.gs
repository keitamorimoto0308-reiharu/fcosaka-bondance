/**
 * メール送信。
 *
 * すべて fcosaka_bondance@kreha-c.com（表示名「サステナ盆踊り実行委員会」）から送る。
 * このアドレスは hello@kreha-c.com のエイリアスとして Gmail に登録されている必要がある。
 * 未登録のまま送ると差出人が hello@ になるため、送信前に登録状況を確認する。
 *
 * 署名は「サステナ盆踊り実行委員会（FC大阪／UPDATER）」（共同主催の見え方・monitor U5）。
 */

var EVENT_NAME = 'FC OSAKA×UPDATER サステナ盆踊り';

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
    name: configText('送信元表示名', 'サステナ盆踊り実行委員会'),
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
    'サステナ盆踊り実行委員会（FC大阪／UPDATER）',
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
    deadline = Utilities.formatDate(getDeadline(), 'Asia/Tokyo', 'yyyy年M月d日 HH:mm');
  } catch (e) { deadline = '（別途ご案内）'; }
  return [
    '───────────────────────',
    '開催日　：2026年10月24日（土）',
    '会　場　：東大阪市花園ラグビー場（場外エリア）',
    '搬　入　：8:30〜10:30',
    '営業時間：11:00〜17:30',
    '撤　収　：17:30〜19:30',
    '応募締切：' + deadline,
    '───────────────────────',
  ].join('\n');
}

/** 応募内容を人が読める形に整形する。受付確認・応募通知の両方で使う。 */
function renderAnswers_(values) {
  var lines = [];
  SECTIONS.forEach(function (sec) {
    var body = [];
    FIELDS.forEach(function (f) {
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
    alertOperator_('応募通知の宛先が0件でした', receiptId);
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
    head.push('台帳・管理ページ：' + adminUrl);
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
  if (failed.length) alertOperator_('応募通知の一部が送信できませんでした：' + failed.join(', '), receiptId);
  return { sent: sent, failed: failed };
}

/**
 * 運用者（設定シートの「障害通知先」、既定は問い合わせメール）に異常を知らせる。
 * 通知が飛ばない事故は、通知が飛ばないので誰も気づかない。その輪を断つための最後の一本。
 */
function alertOperator_(message, receiptId) {
  try {
    var to = configText('障害通知先', configText('問い合わせメール', ''));
    if (!to) return;
    GmailApp.sendEmail(to, '【要確認】サステナ盆踊り 応募システムの異常',
      [message, '', '受付ID：' + (receiptId || '（なし）'),
       '発生時刻：' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'),
       '', '台帳をご確認ください。'].join('\n'),
      { name: 'サステナ盆踊り 応募システム' });
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
