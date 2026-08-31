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

/** エイリアスが Gmail に登録されているか。未登録なら null を返す。 */
function resolveAlias_() {
  var want = configText('問い合わせメール', 'fcosaka_bondance@kreha-c.com');
  try {
    var aliases = GmailApp.getAliases();
    for (var i = 0; i < aliases.length; i++) {
      if (aliases[i].toLowerCase() === want.toLowerCase()) return want;
    }
  } catch (e) { /* 権限が無い場合はフォールバックする */ }
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
    '──────────────────────',
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
    '出店の可否は、応募締切後3営業日以内にメールでご連絡いたします。',
    'ご記入内容の変更は、本メールへのご返信でご連絡ください。',
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
  var recipients = getNotifyRecipients(values.fcosakaStaff);
  if (!recipients.length) return { sent: 0 };

  var types = Array.isArray(values.boothTypes) ? values.boothTypes.join('・') : '';
  var size = displayValue_(FIELDS.filter(function (f) { return f.key === 'boothSize'; })[0], values);

  var subject = '【新規応募】' + receiptId + ' ' + (values.companyName || '') +
                '（' + types + '／' + size + '）';

  var head = [
    '新しい出店応募が届きました。',
    '',
    '受付ID：' + receiptId,
    '企業名：' + (values.companyName || ''),
    '担当社員：' + (values.fcosakaStaff || ''),
    '連絡先：' + (values.contactEmail || '') + ' / ' + (values.contactPhone || ''),
  ];
  if (duplicateFlag) {
    head.push('');
    head.push('※ ' + duplicateFlag + 'です。複数ブースのお申し込みか、重複応募かをご確認ください。');
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

  GmailApp.sendEmail(recipients.join(','), subject, body, mailOptions_());
  return { sent: recipients.length };
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
