/**
 * 公開API（ウェブアプリのエンドポイント）。
 *
 * GET  ?action=formConfig   フォーム表示に必要な設定（締切・単価・担当社員リスト）
 * POST { action:'submit' }  応募の受付
 * POST { action:'admin*' }  管理ページ（認証必須。Admin.gs / Auth.gs）
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
    // 管理ページのAPIは、認証も含めて Admin.gs 側にまとめてある。
    // ここで振り分けると「認証を通さない経路」を作ってしまいやすいため、
    // 入口を1つに絞る。
    if (String(payload.action || '').indexOf('admin') === 0) {
      // 管理APIの例外を、この下の catch に落とさない。
      // あちらは「応募の記録に失敗した」ときの処理で、退避シートへ空行を書き、
      // 運用者に「応募が記録できませんでした」という誤ったメールを送ってしまう。
      try {
        return json_(adminDispatch_(payload));
      } catch (err) {
        logError_('admin:' + payload.action, err);
        return json_({ ok: false, error: 'server_error' });
      }
    }
    // 応募済み情報の修正。管理APIとは別の入口で、別の鍵のトークンを使う。
    // 名前が 'admin' で始まらないので、上の管理API分岐には入らない。
    if (String(payload.action || '').indexOf('self') === 0) {
      try {
        return json_(selfDispatch_(payload));
      } catch (err) {
        logError_('self:' + payload.action, err);
        return json_({ ok: false, error: 'server_error',
          message: '処理中に問題が発生しました。お手数ですが、もう一度お試しください。' });
      }
    }

    // 出店確定情報フォーム。採択通知メールのリンク（受付ID＋トークン）から来る。
    // 管理APIとも応募済み修正とも別の鍵なので、入口も分けてある。
    if (String(payload.action || '').indexOf('confirm') === 0) {
      try {
        return json_(confirmDispatch_(payload));
      } catch (err) {
        logError_('confirm:' + payload.action, err);
        return json_({ ok: false, error: 'server_error',
          message: '処理中に問題が発生しました。お手数ですが、もう一度お試しください。' });
      }
    }

    // 素材アップロード。確定情報フォームと同じ鍵・同じ入口の作り。
    // 'admin' で始まらないので、上の管理API分岐には入らない。
    if (String(payload.action || '').indexOf('upload') === 0) {
      try {
        return json_(uploadDispatch_(payload));
      } catch (err) {
        logError_('upload:' + payload.action, err);
        return json_({ ok: false, error: 'server_error',
          message: '処理中に問題が発生しました。お手数ですが、もう一度お試しください。' });
      }
    }

    switch (payload.action) {
      case 'submit': return json_(submit_(payload));
      default:       return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    logError_('doPost:' + payload.action, err);
    // 台帳に書けなかった応募を、必ずどこかに残す。
    // ここで捨てると「送信したのに存在しない応募」が生まれる（§0の最重要要件に反する）。
    var rescued = quarantine_((payload && payload.values) || {}, 'doPost例外: ' + (err && err.message || err));
    try {
      alertOperator_('ledgerWriteFailed', '',
        rescued ? '内容は退避シートに保存できています。' : '退避シートにも保存できませんでした。');
    } catch (e) {}
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
    // 数量で頼む備品。台帳の「レンタル品目」シートで決まる。
    // 行を足せば欄が増えるので、ここもフォームも触らなくてよい
    rentalItems: getRentalQtyItems(),
    // 台帳の列がいまの定義と合っているか。真偽値だけを返す（列名は外に出さない）。
    // 合っていないと応募が記録できず、応募者にはエラーが出る。
    // ビルド（src/build-pdf.js の verifyConfig）がこれを見て、
    // 台帳がずれたまま配布物を作るのを止める。
    ledgerReady: ledgerReady_(),
    // 採択後に集めるシートの列も、同じように見えるようにする。
    // 2026-09-03 に項目を足したとき、**列が入ったかを確かめる手段が無かった**。
    // 列が足りないと、事業者が入力した値が**エラーも出さずに落ちる**。
    // ledgerReady と同じく、真偽値だけを返す（列名は外に出さない）
    confirmReady: confirmReady_(),
    staff: getStaffOptions(),          // 氏名と部署のみ。メールアドレスは含めない
    contact: configText('問い合わせメール', ''),
    // 「来場者数の表記」は返さない。
    // これは**紙面の文言**であって、サーバーが持つ意味が無い。
    // 設定シートにも置いていたため二重管理になり、
    // 片方だけ直しても表示が変わらず、けいたに手作業を強いていた。
    // いまは src/content.js が唯一の正で、ビルド時にページへ焼き込む。
  };
}

/**
 * 台帳の列が、いまの項目定義と一致しているか。
 * 一致していないと appendApplication が止まり、応募が退避シート行きになる。
 * 公開エンドポイントから呼ばれるので、真偽値以外は返さない。
 */
function ledgerReady_() {
  try {
    var sh = sheet_(SHEET.LEDGER);
    if (sh.getLastColumn() < 1) return false;
    assertHeaders_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 出店確定情報シートの列が、いまの項目定義と一致しているか。
 *
 * 一致していないと、事業者が入力した値のうち**列の無いものが黙って消える**。
 * 応募一覧と違って例外にならないので、**これが無いと誰も気づけない**。
 * 公開エンドポイントから呼ばれるので、真偽値以外は返さない。
 */
function confirmReady_() {
  try {
    var sh = sheet_(SHEET.CONFIRM);
    if (sh.getLastColumn() < 1) return false;
    var have = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                 .map(function (h) { return String(h).trim(); });
    var want = confirmHeaders();
    for (var i = 0; i < want.length; i++) {
      if (have.indexOf(want[i]) < 0) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
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
    // メールは送らない。**受け取っても、その場でできることが無い**。
    // 退避シートに行があることは、管理ページのダッシュボードが拾う
    // （2026-09-02 けいた指摘「意味が分からない」「ほんとのアラートだけでいい」）。
    quarantine_(values, 'ハニーポット検知（自動入力による誤検知の可能性あり）');
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
    alertOperator_('receiptMailFailed', saved.receiptId);
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

/**
 * 項目リストを1つ受け取り、1項目ずつ検証する。
 *
 * 応募フォーム（applyFields）と出店確定情報フォーム（confirmFields）の両方が
 * ここを通る。二段階収集なので検証も2つ要るが、実装まで2つにすると
 * 「片方だけ上限が無い」「片方だけ選択肢を見ていない」というズレが必ず生まれる。
 * 見る項目のリストだけを差し替える形にして、判定そのものは1本にしてある。
 */
function validateFieldList_(fields, values) {
  var errors = [];

  fields.forEach(function (f) {
    if (f.type === 'honeypot') return;

    // ■ 型を先に固定する
    //   上限の検査は `typeof v === 'string'` を見ていたので、
    //   **配列で送ると maxLength を素通り**した（400文字がセルに入る）。
    //   オブジェクトを送ると formatCell_ が "[object Object]" を書き、
    //   toString を細工されると String() が例外を投げて原因不明のエラーになる。
    //   「入ってよい形か」を先に決めておけば、以降の検査が意味を持つ。
    var raw = values[f.key];
    if (raw !== undefined && raw !== null) {
      var wantArray = (f.type === 'checkboxes');
      var isArr = Array.isArray(raw);
      if (wantArray) {
        if (!isArr || raw.some(function (x) { return typeof x !== 'string'; })) {
          errors.push({ key: f.key, message: f.label + 'の選択内容をご確認ください。' });
          return;
        }
      } else if (f.type === 'consent' || f.type === 'checkbox') {
        if (typeof raw !== 'boolean' && typeof raw !== 'string' && typeof raw !== 'number') {
          errors.push({ key: f.key, message: f.label + 'をご確認ください。' });
          return;
        }
      } else if (f.type === 'rental') {
        // レンタルは { 品目名: 個数 } のオブジェクトが正しい形。
        // 中身は下の専用の検査で、実在する品目だけに作り直す。
        if (isArr || typeof raw !== 'object') {
          errors.push({ key: f.key, message: f.label + 'のご指定を読み取れませんでした。' });
          return;
        }
      } else if (isArr || (typeof raw === 'object')) {
        errors.push({ key: f.key, message: f.label + 'の形式をご確認ください。' });
        return;
      }
    }

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
        // **数の読み取りは gas/Num.gs に寄せる**（2026-09-04 の点検で指摘）。
        // ここだけ Number() を直に呼んでいたので、書き込みと読み出しがずれていた：
        //   「+5」は Number では 5 だが numAmount_ では読めない
        //   → シートには文字列「+5」が入り、ダッシュボードでは**未提出**に数えられ、
        //     合計から5名ぶん落ちる。事業者の画面には「登録済み・5」と出る
        // 同じ形：0x10→16／1e1→10／5.→5。
        // 逆に「１０」（全角）や「1,000」は、応募者側だけが断られていた
        var n = numAmount_(v);
        if (n === null) {
          errors.push({ key: f.key,
            message: f.label + 'は半角の数字でご入力ください（' + numWhy_(v) + '）。' });
          break;
        }
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

    // 改行は許さない。企業名は通知メールの**件名**に入るので、
    // 改行が混ざると件名がそこで切れる（ヘッダーの構造にも触れうる）。
    if (typeof v === 'string' && f.type !== 'textarea'
        && /[\r\n]/.test(v)) {
      errors.push({ key: f.key, message: f.label + 'に改行は使えません。' });
    }

    // 長すぎる値は appendRow を失敗させ、応募そのものを落とす。項目ごとの上限が
    // 無いものにも既定の上限を掛ける。
    // 長さを見るのは文字列と数値だけにする。
    // オブジェクトに String() を掛けると、toString を細工された値で
    // **例外が飛んで原因不明のエラーになる**（レンタルは object が正しい形なので、
    // ここまで到達する）。形の検査は上で済ませてあるので、ここは素直に絞る。
    var limit = f.maxLength || 2000;
    if ((typeof v === 'string' || typeof v === 'number')
        && String(v).length > limit) {
      errors.push({ key: f.key, message: f.label + 'は' + limit + '文字以内でご入力ください。' });
    }
  });

  return errors;
}

/**
 * 応募内容の検証。
 *
 * 見るのは**応募段階の項目だけ**。採択後に聞く項目（現場責任者・搬入車両台数・
 * 車両種別など）はこのフォームに存在しないので、必須として要求してはいけない。
 * ここで FIELDS 全部を回していたため、**どの応募も検証で弾かれていた**。
 * しかも返るエラーは画面に無い項目を指すので、利用者から見ると
 * 「送信を押しても何も起きない」という現れ方をする。
 */
function validate_(values) {
  var errors = validateFieldList_(applyFields(), values);

  // 項目どうしの食い違い（希望区画にテントが収まるか など）。
  // フォームと同じ関数を呼ぶので、判定が二重にならない。
  crossChecks(values).forEach(function (e) { errors.push(e); });

  // レンタルの数量。金額は送らせず、こちらで計算するので、
  // ここで見るのは「実在する品目か」「数が常識的か」だけ。
  //
  // 大事なのは、**通ったあとに values.rentalItems を作り直す**こと。
  // 弾くだけだと、知らない品目名がそのまま生データ(JSON)に残り、
  // 管理ページの集計にも応募者が書いた任意の文字列が並ぶ。
  var qty = values.rentalItems;
  if (qty === undefined || qty === null) {
    values.rentalItems = {};
  } else if (typeof qty !== 'object' || Array.isArray(qty)) {
    errors.push({ key: 'rentalItems', message: 'レンタルのご指定を読み取れませんでした。' });
    values.rentalItems = {};
  } else {
    // Object.create(null) にしないと、constructor や toString が
    // 「実在する品目」として通ってしまう（it.max が undefined になり上限検査が効かない）
    var known = Object.create(null);
    getRentalQtyItems().forEach(function (it) { known[it.name] = it; });

    var names = Object.keys(qty);
    if (names.length > 30) {
      errors.push({ key: 'rentalItems', message: 'レンタルのご指定が多すぎます。' });
      names = names.slice(0, 30);
    }

    var clean = {};
    names.forEach(function (name) {
      var it = known[name];
      // 知らない品目は黙って落とす。こちらが品目を無効にした直後に、
      // 下書きから復元した応募者が送信できなくなるのを避けるため、エラーにはしない。
      if (!it) return;
      // レンタルの数量も、共通の読み取りを通す（gas/Num.gs）。
      // ここだけ Number() を直に呼んでいたので、
      // 全角の「２」が断られ、「1e1」が10として通っていた（2026-09-04 の点検で指摘）
      var n = numCount_(qty[name]);
      if (n === null) {
        errors.push({ key: 'rentalItems',
          message: it.name + 'の数量は0以上の整数でご記入ください（'
                 + numWhy_(qty[name]) + '）。' });
        return;
      }
      if (n > it.max) {
        errors.push({ key: 'rentalItems',
          message: it.name + 'は' + it.max + it.unit + 'までとさせていただいております。' });
        return;
      }
      if (n > 0) clean[it.name] = n;
    });
    values.rentalItems = clean;
  }

  return errors;
}

/** 失敗はスプレッドシートに残さず、Apps Script のログに出す（台帳を汚さない）。 */
function logError_(where, err) {
  console.error('[' + where + '] ' + (err && err.stack ? err.stack : err));
}
