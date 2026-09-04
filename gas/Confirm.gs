/**
 * 出店確定情報フォーム（採択された事業者が、当日の運営情報を登録する）。
 *
 * 入口は受付ID＋トークンのリンクのみ。Notify.gs が採択通知メールに載せる。
 *
 * ■ 応募済み修正（SelfEdit.gs）と作りが違う理由
 *   あちらは「メールアドレス＋受付ID」で本人確認する。受付IDが連番なので
 *   総当たりが効き、失敗回数の制限と待ち時間が要る。
 *   こちらは**128ビットの乱数トークン**が鍵なので総当たりは成立しない。
 *   そのぶん、鍵が漏れたときの被害を「その1社の当日情報」に限る作りにしてある。
 *
 * ■ 採択者以外は入れない
 *   トークンが合っていても、ステータスが「採択」でなければ開かない。
 *   採択を取り消した相手のリンクが生き続けないようにするため。
 *
 * ■ 条件付きの必須は、台帳の値で評価する
 *   火気と保険は「飲食を選んだ方にだけ聞く」。この条件は boothTypes という
 *   **応募段階の値**を見る。ブラウザから送らせると
 *   「飲食ではない」と偽って必須を回避できるので、必ず台帳から読み直す。
 */

var CONFIRM_LOCKED_STATUS = ['不採択', '辞退', 'キャンセル', '重複（無効）'];

function confirmDispatch_(payload) {
  var action = payload && payload.action;
  if (action === 'confirmLoad') return confirmLoad_(payload);
  if (action === 'confirmSave') return confirmSave_(payload);
  return { ok: false, error: 'unknown_action' };
}

/** どの失敗でも同じ文言。どこが違うのかを教えない */
function confirmDenied_() {
  return { ok: false, error: 'denied',
    message: 'このリンクは有効ではありません。'
           + '採択通知メールに記載のリンクを、そのままお開きください。' };
}

/**
 * 応募段階の値のうち、確定情報の条件判定に要るものだけを台帳から取り出す。
 * ここを増やすときは「ブラウザに書き換えられてはいけない値か」を必ず考える。
 */
function confirmBaseValues_(raw) {
  var v = {};
  try { v = JSON.parse(raw || '{}') || {}; } catch (e) { v = {}; }
  return {
    boothTypes: Array.isArray(v.boothTypes) ? v.boothTypes : [],
    // 通知の宛先を決めるのに要る。ここで持てば台帳を読み直さずに済む
    fcosakaStaff: String(v.fcosakaStaff || ''),
    companyName: String(v.companyName || ''),
    boothName: String(v.boothName || ''),
    contactName: String(v.contactName || ''),
    contactEmail: String(v.contactEmail || ''),
    contactPhone: String(v.contactPhone || ''),
  };
}

/** 「出店確定情報」シートの、その受付IDの行番号。無ければ -1 */
function confirmFindRow_(sh, receiptId) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === receiptId) return i + 2;
  }
  return -1;
}

function confirmSheetHeaders_(sh) {
  if (sh.getLastColumn() < 1) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
}

// ─────────────────────────────── 読み込み

function confirmLoad_(payload) {
  var receiptId = String((payload && payload.id) || '').trim().toUpperCase();
  var token = String((payload && payload.t) || '').trim();

  var hit = findAcceptedRow_(receiptId, token);
  if (!hit) { confirmNoteFailure_(); return confirmDenied_(); }

  if (hit.status !== '採択') {
    // トークンは合っているので、状況は伝えてよい
    return { ok: false, error: 'not_accepted',
      message: CONFIRM_LOCKED_STATUS.indexOf(hit.status) >= 0
        ? 'このお申し込みは、現在この画面からのご登録を承っておりません。'
          + 'お手数ですが、担当までご連絡ください。'
        : 'ただいま選考中です。出店決定のご連絡後にご登録いただけます。' };
  }
  var base = confirmBaseValues_(hit.raw);

  // 既に登録済みなら、その内容を戻して「続きから直せる」ようにする
  var sh = sheet_(SHEET.CONFIRM);
  var headers = confirmSheetHeaders_(sh);
  // 保存側と同じガードを、**開く時点でも**掛ける。
  // ここが無いと、白紙のフォームを見せて記入させたあと、保存で落ちる。
  if (!headers.length || headers.indexOf('受付ID') !== 0) {
    logError_('confirmLoad_', new Error('出店確定情報シートの見出しが壊れています'));
    return { ok: false, error: 'server_error',
      message: '登録先の準備ができていません。お手数ですが担当までご連絡ください。' };
  }
  var rowNo = confirmFindRow_(sh, receiptId);
  var values = {};
  var savedAt = '';
  if (rowNo > 0) {
    var rawIdx = headers.indexOf('生データ(JSON)');
    var atIdx = headers.indexOf('回答日時');
    var row = sh.getRange(rowNo, 1, 1, headers.length).getValues()[0];
    if (rawIdx >= 0) {
      try { values = JSON.parse(String(row[rawIdx] || '{}')) || {}; } catch (e) { values = {}; }
    }
    if (atIdx >= 0) savedAt = asText_(row[atIdx]);
  }

  return {
    ok: true,
    receiptId: receiptId,
    company: base.companyName,
    boothName: base.boothName,
    contactName: base.contactName,
    // 条件判定に使う。画面側もこれを使って火気・保険の表示を決める
    boothTypes: base.boothTypes,
    values: confirmPublicValues_(values),
    savedAt: savedAt,
    deadlineText: confirmDeadlineText_(),
  };
}

/** 返してよい値だけにする。確定情報フォームにある項目に限る */
function confirmPublicValues_(values) {
  var out = {};
  confirmFields().forEach(function (f) {
    if (values[f.key] !== undefined) out[f.key] = values[f.key];
    if (f.unknownCheckbox && values[f.unknownCheckbox.key] !== undefined) {
      out[f.unknownCheckbox.key] = values[f.unknownCheckbox.key];
    }
  });
  return out;
}

// ─────────────────────────────── 保存

function confirmSave_(payload) {
  var receiptId = String((payload && payload.id) || '').trim().toUpperCase();
  var token = String((payload && payload.t) || '').trim();

  var incoming = (payload && payload.values) || {};
  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    return { ok: false, error: 'bad_request' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };

  try {
    // 読み込みのあとに採択が取り消された、という行き違いを防ぐため、
    // 保存の直前にもう一度、鍵とステータスの両方を確かめる
    var hit = findAcceptedRow_(receiptId, token);
    if (!hit) { confirmNoteFailure_(); return confirmDenied_(); }
    if (hit.status !== '採択') {
      return { ok: false, error: 'not_accepted',
        message: 'このお申し込みは、現在この画面からのご登録を承っておりません。'
               + 'お手数ですが、担当までご連絡ください。' };
    }
    var base = confirmBaseValues_(hit.raw);

    // 確定情報の項目だけを受け取る。
    // **条件判定に使う応募段階の値は、台帳から読んだもので上書きする。**
    // ブラウザから boothTypes を送らせると、飲食なのに「飲食ではない」と偽って
    // 火気・保険の必須を回避できてしまう。
    var next = {};
    confirmFields().forEach(function (f) {
      if (incoming[f.key] !== undefined) next[f.key] = incoming[f.key];
      if (f.unknownCheckbox && incoming[f.unknownCheckbox.key] !== undefined) {
        next[f.unknownCheckbox.key] = incoming[f.unknownCheckbox.key];
      }
    });
    next.boothTypes = base.boothTypes;

    var errors = validateFieldList_(confirmFields(), next);
    if (errors.length) return { ok: false, error: 'validation', fields: errors };

    // 検証を通ったあとに、条件判定用の値を落とす。
    // 残すと「出店確定情報」シートの生データに応募段階の値が混ざり、
    // どちらが正なのか分からなくなる。
    delete next.boothTypes;

    var sh = sheet_(SHEET.CONFIRM);
    var headers = confirmSheetHeaders_(sh);
    if (!headers.length || headers.indexOf('受付ID') !== 0) {
      logError_('confirmSave_', new Error('出店確定情報シートの見出しが壊れています'));
      return { ok: false, error: 'server_error',
        message: '登録先の準備ができていません。お手数ですが担当までご連絡ください。' };
    }

    var byLabel = {};
    confirmFields().forEach(function (f) {
      if (f.sheet) byLabel[f.sheet] = f;
      if (f.unknownCheckbox) {
        byLabel[f.unknownCheckbox.sheet] = { key: f.unknownCheckbox.key, type: 'consent' };
      }
    });

    var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    var line = headers.map(function (h) {
      if (h === '受付ID') return receiptId;
      if (h === '企業名') return safeCell_(base.companyName);
      if (h === '回答日時') return now;
      if (h === '生データ(JSON)') return rawJson_(next);
      var f = byLabel[h];
      // 定義に無い列（運用者が手で足した列）は触らない
      return f ? formatCell_(f, next[f.key]) : null;
    });

    var rowNo = confirmFindRow_(sh, receiptId);
    var isNew = rowNo < 0;
    if (isNew) {
      sh.appendRow(line.map(function (v) { return v === null ? '' : v; }));
    } else {
      // 触らない列（null）を飛ばして、1セルずつ書く
      line.forEach(function (v, i) {
        if (v === null) return;
        sh.getRange(rowNo, i + 1).setValue(v);
      });
    }
    SpreadsheetApp.flush();

    var histNote = '確定情報フォーム';

    // ■ 内容が変わっていなければ通知しない
    //   正しい鍵を持つ相手（事業者本人。メールの転送先も含む）が
    //   同じ内容を繰り返し保存できるので、そのたびに通知すると
    //   Gmailの日次上限を使い切り、**採択通知そのものが送れなくなる**。
    //   シートは1行のまま更新されるのに、メールと履歴だけが積み上がっていた。
    var digest = sha256_(JSON.stringify(next)).slice(0, 24);
    var seenKey = 'cf_seen_' + receiptId;
    var unchanged = false;
    try {
      unchanged = (CacheService.getScriptCache().get(seenKey) === digest);
      CacheService.getScriptCache().put(seenKey, digest, 3600);
    } catch (e) {}

    if (!unchanged) {
      appendHistory('出店者（本人）', receiptId, '出店確定情報',
        isNew ? '未登録' : '登録済み', '登録' + (isNew ? '' : '（更新）'), histNote);
    }

    var mailWarning = '';
    if (!unchanged) {
      try { confirmNotify_(receiptId, base, next, isNew); }
      catch (e) {
        logError_('confirmNotify_', e);
        mailWarning = 'notify';
        // 事業者には「登録できました」と見えるのに、社内には何も届かない状態を作らない
        alertOperator_('noticeMailFailed', receiptId,
          '出店確定情報の登録がありました。確定情報シートをご確認ください。');
      }
    }

    return { ok: true, receiptId: receiptId, savedAt: now,
             isNew: isNew, mailWarning: mailWarning };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 担当社員と通知ONの管理者に知らせる。
 * 全文ではなく、当日の運営に効く項目だけを拾って件名と冒頭に出す
 * （50社ぶん届くので、開かずに把握できる形にする）。
 */
function confirmNotify_(receiptId, base, values, isNew) {
  var recipients = getNotifyRecipients(base.fcosakaStaff).filter(function (a) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
  });
  if (!recipients.length) {
    alertOperator_('staffUnknown', receiptId, '出店確定情報の登録がありました。');
    return;
  }

  var subject = '【確定情報' + (isNew ? '登録' : '更新') + '】' + receiptId + ' '
              + (base.companyName || '');

  var head = [
    (base.companyName || '') + ' さまが、出店確定情報を'
      + (isNew ? '登録' : '更新') + 'されました。',
    '',
    '受付ID　：' + receiptId,
    '現場責任者：' + (values.siteManagerName || '') + '（' + (values.siteManagerPhone || '') + '）',
    '搬入車両　：' + (values.vehicleCount || 0) + '台／' + (values.vehicleType || '')
                 + '／全高 ' + (values.vehicleHeight || ''),
    '搬入希望　：' + (values.loadInSlot1 || '') + '（第2 ' + (values.loadInSlot2 || '—') + '）',
    'スタッフ　：' + (values.staffCount || '') + '名',
    '雨天時　　：' + (values.rainPolicy || ''),
    '',
    '───────────────────────',
  ];

  // isVisible は boothTypes を見る（火気・保険は飲食のみ）。
  // 保存時に落としているので、表示のためにここで戻す。
  // 戻さないと **飲食の方の火気と保険が、通知メールから丸ごと消える。**
  var forRender = Object.assign({}, values, { boothTypes: base.boothTypes });
  var body = head.concat(renderConfirmAnswers_(forRender), [signature_()]).join('\n');

  MailApp.sendEmail(Object.assign({
    to: recipients.join(','), subject: subject, body: body,
  }, mailOptions_()));
}

/** 確定情報を人が読める形に。応募側の renderAnswers_ と同じ考え方 */
function renderConfirmAnswers_(values) {
  var lines = [];
  SECTIONS.forEach(function (sec) {
    var body = [];
    confirmFields().forEach(function (f) {
      if (f.section !== sec.id || !f.sheet) return;
      if (!isVisible(f, values)) return;
      body.push('  ' + f.label + '：' + displayValue_(f, values));
    });
    if (body.length) {
      lines.push('■ ' + sec.title);
      lines = lines.concat(body);
      lines.push('');
    }
  });
  return lines;
}


// ─────────────────────────────── 管理ページからの打ち込み

/**
 * 採択後の情報を、管理ページから直接入れる（管理者のみ）。
 *
 * ■ なぜ要るか
 *   2026-09-03 けいた指示：
 *   「応募フォームから吸い上げ、および、管理画面で打ち込み、
 *     ダッシュボードで総数が分かれば便利」
 *
 *   枚数は電話で聞くことがある。フォームからの提出を待つしかない作りだと、
 *   分かっているのに数えられない。
 *
 * ■ 入れられるのは「数を集める項目」だけ
 *   事業者が書いた文章（備考・現場責任者名）を主催側が書き換えられると、
 *   **誰が書いたのか分からなくなる**。数えるための数字に限る。
 *
 * ■ 誰が入れたかを残す
 *   フォームからの提出と、こちらの打ち込みは、後から区別できないと困る。
 *   変更履歴に「（管理ページから入力）」として残す。
 */
function adminConfirmSave_(auth, payload) {
  var receiptId = String((payload && payload.id) || '').trim().toUpperCase();
  var values = (payload && payload.values) || {};
  if (!/^SB-\d{4}$/.test(receiptId)) return { ok: false, error: 'bad_request' };
  if (typeof values !== 'object' || Array.isArray(values)) {
    return { ok: false, error: 'bad_request' };
  }

  // 入れてよいのは、数を集める項目のうち採択後のものだけ。
  // 素の {} を索引に使うと、外から来た文字列で prototype の中身に当たる。
  // 'constructor' や 'toString' は**必ず真**なので、
  // 「一覧にあるものだけ通す」という関門が、そこだけ開く。
  // Object.create(null) には prototype が無いので、その道が消える。
  var allowed = Object.create(null);
  aggregateFields().forEach(function (f) {
    if (f.stage === 'confirm') allowed[f.key] = f;
  });

  var keys = Object.keys(values);
  for (var i = 0; i < keys.length; i++) {
    if (!allowed[keys[i]]) {
      return { ok: false, error: 'forbidden_field',
        message: 'この画面から入れられない項目です：' + keys[i] };
    }
  }
  if (!keys.length) return { ok: false, error: 'bad_request', message: '入力がありません。' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };

  try {
    var sh = sheet_(SHEET.CONFIRM);
    var headers = confirmSheetHeaders_(sh);
    if (!headers.length || headers[0] !== '受付ID') {
      return { ok: false, error: 'server_error',
        message: '出店確定情報シートの見出しが壊れています。setup() を実行してください。' };
    }

    // 応募一覧に無い受付IDでは、行を作らない。
    // 以前は形（SB-0000）だけ見ていたので、`SB-9999` を投げれば
    // **どの応募にも紐づかない幽霊行**が確定情報シートに残った。
    // 集計の母数は採択者だけなので、誰も気づけない（2026-09-04 の点検で指摘）
    var L0 = readLedger_();
    var idIdx0 = L0.headers.indexOf(COL.id);
    var known = false;
    for (var li = 0; li < L0.rows.length; li++) {
      if (asText_(L0.rows[li][idIdx0]).trim() === receiptId) { known = true; break; }
    }
    if (!known) {
      return { ok: false, error: 'not_found',
        message: '受付ID「' + receiptId + '」は応募一覧にありません。IDをお確かめください。' };
    }

    var rowNo = confirmFindRow_(sh, receiptId);

    // ── ① まず全部読む。**1つでも読めなければ、何も書かない。**
    //    以前は読めない値を黙って読み飛ばし、画面には「変更はありません」とだけ
    //    出していた。電話で聞いた枚数を打ち込む画面なので、
    //    **入れたつもりの数が消える**（2026-09-03 の検証で指摘）
    var plan = [];
    var bad = [];
    keys.forEach(function (k) {
      var f = allowed[k];
      var col = headers.indexOf(f.sheet);
      if (col < 0) {
        bad.push({ label: f.label, why: 'この項目の列が出店確定情報シートにありません' });
        return;
      }

      var s = String(values[k] == null ? '' : values[k]).trim();
      if (s !== '') {
        var got = confirmCount_(s);
        if (got === null) {
          // 理由は gas/Num.gs が持っている（「マイナスは指定できません」など）。
          // 「半角の数字で」一辺倒だと、全角は実際には受け付けるので誤解を招く
          //（2026-09-04 の最終確認で指摘）
          bad.push({ label: f.label, why: numWhy_(s) });
          return;
        }
        if (typeof f.min === 'number' && got < f.min) {
          bad.push({ label: f.label, why: f.min + ' 以上でご入力ください' });
          return;
        }
        if (typeof f.max === 'number' && got > f.max) {
          bad.push({ label: f.label, why: f.max + ' 以下でご入力ください' });
          return;
        }
        s = String(got);
      }
      plan.push({ f: f, col: col, text: s });
    });

    if (bad.length) {
      return { ok: false, error: 'bad_value', rejected: bad,
        message: '入れられない値があります：'
               + bad.map(function (b) { return b.label + '（' + b.why + '）'; }).join(' ／ ')
               + '。ほかの項目も含めて、まだ何も保存していません。' };
    }

    // ── ② ここから書く。
    //    行を作るのも**ここ**。以前は検査の前に appendRow していたので、
    //    「まだ何も保存していません」と返しながら空行が1本増えていた。
    //    しかもその会社が確定情報フォームから初回提出したときに
    //    「更新」扱いになり、社内通知の件名が【確定情報更新】になっていた
    //    （2026-09-04 の点検で指摘）
    if (rowNo < 0) {
      sh.appendRow([receiptId]);
      rowNo = sh.getLastRow();
    }

    var changed = 0;
    plan.forEach(function (it) {
      var before = asText_(sh.getRange(rowNo, it.col + 1).getValue()).trim();
      if (before === it.text) return;
      sh.getRange(rowNo, it.col + 1).setValue(it.text === '' ? '' : Number(it.text));
      appendHistory(auth.person, receiptId, it.f.sheet, before, it.text, '管理ページから入力');
      changed++;
    });

    SpreadsheetApp.flush();
    return { ok: true, changed: changed };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 枚数・人数の読み取り。0以上の整数だけを受ける。読めなければ null。
 *
 * 全角はスマホの日本語入力で普通に混ざるので、半角に直して受ける。
 * 「10枚」のように単位が付いていても受ける（言いたいことは明らかなので）。
 * **読めないものを 0 にはしない。** 0は「0名」という意味を持ってしまう。
 */
function confirmCount_(text) {
  return numCount_(text);
}
