/**
 * 公開API（ウェブアプリのエンドポイント）。
 *
 * GET  ?action=formConfig   フォーム表示に必要な設定（締切・単価・担当社員リスト）
 * POST { action:'submit' }  応募の受付
 *
 * CORS：GitHub Pages（https://bondance.kreha-c.com）から呼ばれる。
 * プリフライトを発生させないため、フロント側は Content-Type: text/plain で送る。
 * カスタムヘッダーは使わない。
 */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'formConfig';
  try {
    switch (action) {
      case 'formConfig': return json_(formConfig_());
      case 'ping':       return json_({ ok: true, time: new Date().toISOString() });
      default:           return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    // 公開エンドポイントなので、シート名や内部構造を外に出さない
    logError_('doGet:' + action, err);
    return json_({ ok: false, error: 'server_error' });
  }
}

function doPost(e) {
  var payload = {};
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }

  try {
    switch (payload.action) {
      case 'submit': return json_(submit_(payload));
      default:       return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    logError_('doPost:' + payload.action, err);
    // 台帳に書けなかった応募を、必ずどこかに残す。
    // ここで捨てると「送信したのに存在しない応募」が生まれる（§0の最重要要件に反する）。
    var rescued = quarantine_(payload.values || {}, 'doPost例外: ' + (err && err.message || err));
    try { alertOperator_('応募の記録に失敗しました' + (rescued ? '（退避シートに保存済み）' : '（退避にも失敗）'), ''); } catch (e) {}
    return json_({
      ok: false, error: 'server_error',
      message: '送信の処理中に問題が発生しました。お手数ですが、もう一度お試しください。'
             + '繰り返し失敗する場合は、お手数ですがメールでご連絡ください。',
    });
  }
}

/** フォームが起動時に取得する設定。公開情報のみを返す（パスワード・メールは返さない）。 */
function formConfig_() {
  var deadline = null;
  try { deadline = getDeadline(); } catch (e) { logError_('formConfig_:締切', e); }
  return {
    ok: true,
    closed: isClosed(),
    deadline: formatJa(deadline),
    prices: getPrices(),
    staff: getStaffOptions(),          // 氏名と部署のみ。メールアドレスは含めない
    contact: configText('問い合わせメール', ''),
    attendanceNote: configText('来場者数の表記', ''),
  };
}

/** 応募の受付。検証 → 記録 → メール、の順で、前段が失敗したら次に進まない。 */
function submit_(payload) {
  var values = payload.values || {};

  // 1) ハニーポット：値が入っていれば破棄する。
  //    ボットに「弾かれた」と学習させないため、成功と同じ形の応答を返す。
  //    ブラウザの自動入力やパスワードマネージャが画面外の欄を埋めることがあるため、
  //    「破棄」ではなく「退避」する。誤検知だった場合に人の目で救い出せる状態を残す。
  var hp = FIELDS.filter(function (f) { return f.type === 'honeypot'; })[0];
  if (hp && String(values[hp.key] || '').trim() !== '') {
    logError_('honeypot', new Error('ハニーポットに値が入っていました'));
    quarantine_(values, 'ハニーポット検知（自動入力による誤検知の可能性あり）');
    alertOperator_('ハニーポットで隔離した応募があります。退避シートをご確認ください。', '');
    return { ok: true, receiptId: 'SB-0000', discarded: true };
  }

  // 2) 締切：フロントと両側で制御する（直接POSTされても拒否する）
  if (isClosed()) {
    return { ok: false, error: 'closed', message: '応募の受付は終了しました。' };
  }

  // 3) 検証：フォームと同じ関数（isVisible / isRequired）で判定する
  var errors = validate_(values);
  if (errors.length) {
    return { ok: false, error: 'validation', fields: errors };
  }

  // 4) 記録：ここが成功しない限りメールは送らない
  //    冪等キーは送信IDだけでなく内容のハッシュと組み合わせる。
  //    通信エラー後に内容を直して再送したとき、古い結果を返して修正を捨てないため。
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(values))
    .map(function (b) { return ((b & 255) + 256).toString(16).slice(1); }).join('').slice(0, 16);
  var idemKey = String(payload.submissionId || '').slice(0, 100) + '_' + digest;

  var saved = appendApplication(values, idemKey);

  // 5) メール：記録は済んでいるので、送信に失敗しても応募は成立させる。
  //    「応募が届かない事故をゼロに」＝ 台帳に残ることが最優先（仕様書§0）。
  //    ただし誰に届いていないかを後から特定できるよう、結果を台帳に書き戻す。
  var mailWarning = '';
  var receiptStatus, notifyStatus;
  try {
    sendReceiptMail(values, saved.receiptId);
    receiptStatus = '送信済 ' + nowText_();
  } catch (err) {
    logError_('sendReceiptMail:' + saved.receiptId, err);
    receiptStatus = '失敗 ' + nowText_();
    mailWarning = 'receipt_failed';
    alertOperator_('受付確認メールの送信に失敗しました（応募は記録済み）', saved.receiptId);
  }
  try {
    var r = sendNotifyMail(values, saved.receiptId, saved.duplicateFlag || '',
                           configText('管理ページURL', ''));
    notifyStatus = (r.sent ? '送信済 ' + r.sent + '件 ' : '宛先0件 ') + nowText_()
                 + (r.failed && r.failed.length ? '／失敗:' + r.failed.join(',') : '');
  } catch (err) {
    logError_('sendNotifyMail:' + saved.receiptId, err);
    notifyStatus = '失敗 ' + nowText_();
  }
  writeMailStatus_(saved.receiptId, receiptStatus, notifyStatus);

  return {
    ok: true,
    receiptId: saved.receiptId,
    mailWarning: mailWarning,
  };
}

function nowText_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd HH:mm');
}

/** メールの到達状況を台帳に書き戻す。失敗しても応募の成立には影響させない。 */
function writeMailStatus_(receiptId, receiptStatus, notifyStatus) {
  try {
    var sh = sheet_(SHEET.LEDGER);
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var colId = headers.indexOf('受付ID') + 1;
    var colR  = headers.indexOf('受付メール送信') + 1;
    var colN  = headers.indexOf('通知メール送信') + 1;
    if (!colId || !colR || !colN) return;

    var last = sh.getLastRow();
    var ids = sh.getRange(2, colId, last - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) { // 直近の行から探す
      if (String(ids[i][0]) === receiptId) {
        sh.getRange(i + 2, colR).setValue(receiptStatus);
        sh.getRange(i + 2, colN).setValue(notifyStatus);
        return;
      }
    }
  } catch (e) {
    logError_('writeMailStatus_', e);
  }
}

/** サーバー側の検証。フロントを迂回して直接POSTされても、ここで必ず通る。 */
function validate_(values) {
  var errors = [];

  FIELDS.forEach(function (f) {
    if (f.type === 'honeypot') return;

    var visible = isVisible(f, values);
    var v = values[f.key];
    var empty = (v === undefined || v === null || v === '' ||
                 (Array.isArray(v) && v.length === 0) || v === false);

    // 表示されていない項目に値が入っているのは不正な送信、または選び直しの残骸。
    // 付随する「わからない」チェックも一緒に消さないと、集計が狂う。
    if (!visible) {
      if (!empty) delete values[f.key];
      if (f.unknownCheckbox) delete values[f.unknownCheckbox.key];
      return;
    }

    // 「わからない」にチェックがあれば数値未入力を許す
    if (f.unknownCheckbox && values[f.unknownCheckbox.key]) empty = false;

    if (isRequired(f, values) && empty) {
      errors.push({ key: f.key, message: f.label + 'を入力してください。' });
      return;
    }
    if (empty) return;

    switch (f.type) {
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) {
          errors.push({ key: f.key, message: 'メールアドレスの形式をご確認ください。' });
        }
        break;
      case 'tel':
        if (!/^[0-9+\-() 　]{8,20}$/.test(String(v))) {
          errors.push({ key: f.key, message: '電話番号の形式をご確認ください。' });
        }
        break;
      case 'url':
        if (!/^https?:\/\/.+/.test(String(v))) {
          errors.push({ key: f.key, message: 'URLは http:// または https:// から始めてください。' });
        }
        break;
      case 'number':
        var n = Number(v);
        if (isNaN(n)) { errors.push({ key: f.key, message: f.label + 'は数字でご入力ください。' }); break; }
        if (f.min !== undefined && n < f.min) errors.push({ key: f.key, message: f.label + 'は' + f.min + '以上でご入力ください。' });
        if (f.max !== undefined && n > f.max) errors.push({ key: f.key, message: f.label + 'は' + f.max + '以下でご入力ください。' });
        break;
      case 'radio':
        var allowed = (f.options || []).map(function (o) { return typeof o === 'object' ? o.value : o; });
        if (allowed.indexOf(v) === -1) errors.push({ key: f.key, message: f.label + 'の選択内容をご確認ください。' });
        break;
      case 'checkboxes':
        if (!Array.isArray(v)) { errors.push({ key: f.key, message: f.label + 'の選択内容をご確認ください。' }); break; }
        for (var i = 0; i < v.length; i++) {
          if ((f.options || []).indexOf(v[i]) === -1) {
            errors.push({ key: f.key, message: f.label + 'の選択内容をご確認ください。' });
            break;
          }
        }
        break;
      case 'select':
        // 担当社員は関係者シートの実在ラベル、または「わからない」のみ許可する
        var allowedStaff = getStaffOptions().map(function (o) { return o.label; });
        if (f.unknownOption) allowedStaff.push(f.unknownOption);
        (f.fallbackOptions || []).forEach(function (o) { allowedStaff.push(o); });
        if (allowedStaff.indexOf(String(v)) === -1) {
          errors.push({ key: f.key, message: f.label + 'をお選びください。' });
        }
        break;
    }

    // 長すぎる値は appendRow を失敗させ、応募そのものを落とす。項目ごとの上限が
    // 無いものにも既定の上限を掛ける。
    var limit = f.maxLength || 2000;
    if (typeof v === 'string' && v.length > limit) {
      errors.push({ key: f.key, message: f.label + 'は' + limit + '文字以内でご入力ください。' });
    }
  });

  return errors;
}

/** 失敗はスプレッドシートに残さず、Apps Script のログに出す（台帳を汚さない）。 */
function logError_(where, err) {
  console.error('[' + where + '] ' + (err && err.stack ? err.stack : err));
}
