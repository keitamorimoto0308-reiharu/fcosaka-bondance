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
    logError_('doGet:' + action, err);
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
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
    // 応募者には再送を促す。原因はログに残す。
    return json_({
      ok: false, error: 'server_error',
      message: '送信の処理中に問題が発生しました。お手数ですが、もう一度お試しください。',
    });
  }
}

/** フォームが起動時に取得する設定。公開情報のみを返す（パスワード・メールは返さない）。 */
function formConfig_() {
  var deadline = getDeadline();
  return {
    ok: true,
    closed: isClosed(),
    deadline: deadline ? Utilities.formatDate(deadline, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
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
  var hp = FIELDS.filter(function (f) { return f.type === 'honeypot'; })[0];
  if (hp && String(values[hp.key] || '').trim() !== '') {
    logError_('honeypot', new Error('honeypot filled'));
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
  var saved = appendApplication(values, payload.submissionId || '');

  // 5) メール：記録は済んでいるので、送信に失敗しても応募は成立させる。
  //    「応募が届かない事故をゼロに」＝ 台帳に残ることが最優先（仕様書§0）。
  var mailWarning = '';
  try {
    sendReceiptMail(values, saved.receiptId);
  } catch (err) {
    logError_('sendReceiptMail:' + saved.receiptId, err);
    mailWarning = 'receipt_failed';
  }
  try {
    sendNotifyMail(values, saved.receiptId, saved.duplicateFlag || '', configText('管理ページURL', ''));
  } catch (err) {
    logError_('sendNotifyMail:' + saved.receiptId, err);
  }

  return {
    ok: true,
    receiptId: saved.receiptId,
    mailWarning: mailWarning,
  };
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

    // 表示されていない項目に値が入っているのは不正な送信。値を捨てる。
    if (!visible) { if (!empty) delete values[f.key]; return; }

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
    }

    if (f.maxLength && String(v).length > f.maxLength) {
      errors.push({ key: f.key, message: f.label + 'は' + f.maxLength + '文字以内でご入力ください。' });
    }
  });

  return errors;
}

/** 失敗はスプレッドシートに残さず、Apps Script のログに出す（台帳を汚さない）。 */
function logError_(where, err) {
  console.error('[' + where + '] ' + (err && err.stack ? err.stack : err));
}
