/**
 * レンタル品目を、管理ページから編集する（管理者のみ）。
 *
 * ■ なぜ要るか
 *   けいた指摘（このセッションで繰り返し出ている）：
 *   「これくらいはやってほしい。…その条文を修正するなりして外して」
 *
 *   品目や単価を変えるたびにスプレッドシートを開かせるのは、
 *   けいたに手作業を押し付けているのと同じ。
 *
 * ■ ただし、**紙面とのずれは消せない**
 *   募集要項PDFは `src/content.js` から刷る。フォームはこのシートを読む。
 *   シートだけ直すと、**紙とフォームで金額が違う**状態になる。
 *   PDFはGASからは刷れない（Chromeで組版している）ので、この制約は残る。
 *
 *   だから「制約を外す」のではなく、**制約を見えるようにした**。
 *   ビルド時に紙面の料金表を `PUBLISHED_RENTALS` として焼き込んであり、
 *   ここで突き合わせて「紙面とずれています」と画面に出す。
 *   ずれたまま紙を配るのを防ぐには、これしかない。
 *
 * ■ 単価の空欄は「0円」ではなく「未定」
 *   0で受注すると、応募者の画面にも台帳にも 0 と出て整合するので、
 *   **誰も気づけない**。空欄の品目はフォームに出さない。
 */

/** シートの列。順番も含めてここが正 */
var RENTAL_HEAD = ['並び順', '種別', '品目', '単価(円)', '単位', '最大数',
                   '間口(m)', '奥行(m)', '有効', '説明'];

/** 1品目あたりの上限。桁の打ち間違いで数十万円の請求書を作らない */
var RENTAL_PRICE_MAX = 500000;
var RENTAL_MAX_ITEMS = 60;
/** テントなどの寸法の上限（m）。区画図の縮尺が壊れるのを防ぐ */
var RENTAL_SIZE_MAX = 50;

/**
 * 単価・最大数の読み取り。**読めないものは読めないと言う**。
 *
 * 以前は「数字以外を捨てて Number()」で済ませていたが、これは黙って別の数にする：
 *   ・「-500」→ マイナス記号ごと捨てて **500**（符号が消える）
 *   ・「１０００」（全角）→ 全部捨てて '' → Number('') は **0**。
 *     0円は「未定」ではなく**無料**として応募フォームに出る
 *   ・「1e9」→ e を捨てて **19**
 * 単価は請求書になる数字なので、勝手に解釈せず、書き直してもらう。
 * 全角の数字だけは、打ち間違いではなく入力方式の問題なので、半角に直して受ける。
 */
function rentalNumber_(raw) {
  var n = numAmount_(raw);
  if (n === null) return { ok: false, why: numWhy_(raw) };
  return { ok: true, value: n };
}

function adminRental_(auth) {
  var items;
  try {
    items = getRentalItems({}).map(function (it) {
      return {
        row: it.row, order: it.order, kind: it.kind, name: it.name,
        price: it.price, unit: it.unit, max: it.max,
        w: it.w, d: it.d, active: it.active, note: it.note,
      };
    });
  } catch (e) {
    return { ok: false, error: 'server_error',
      message: String((e && e.message) || 'レンタル品目シートを読めませんでした。') };
  }

  return {
    ok: true,
    items: items,
    kinds: [RENTAL_KIND.T1, RENTAL_KIND.T2, RENTAL_KIND.QTY],
    priceMax: RENTAL_PRICE_MAX,
    maxItems: RENTAL_MAX_ITEMS,
    // 紙面と食い違っていないか。**ここが本題**
    paperDiff: rentalPaperDiff_(items),
  };
}

/**
 * 紙面（募集要項PDF）に刷ってある料金表と、いまのシートを突き合わせる。
 *
 * 比べるのは「フォームに出る品目」だけ。
 * 無効にした品目や単価未定の品目は、そもそもフォームに出ないので、
 * 紙面に無くても食い違いではない。
 */
function rentalPaperDiff_(items) {
  var out = [];
  var published = (typeof PUBLISHED_RENTALS === 'undefined') ? [] : PUBLISHED_RENTALS;

  var paper = {};
  published.forEach(function (r) { paper[r.label] = r; });

  var live = {};
  items.forEach(function (it) {
    if (!it.active) return;
    if (typeof it.price !== 'number' || it.price <= 0) return;
    // テントは紙面では正式名称で載っている。突き合わせは品目名で行う
    live[it.name] = it;
  });

  Object.keys(live).forEach(function (name) {
    var p = paper[name];
    if (!p) {
      out.push({ name: name, kind: 'added',
        message: '「' + name + '」は、募集要項PDFの料金表に載っていません。' });
      return;
    }
    if (Number(p.price) !== Number(live[name].price)) {
      out.push({ name: name, kind: 'price',
        message: '「' + name + '」の単価が、紙面は ' + Number(p.price).toLocaleString()
               + '円、いまのシートは ' + Number(live[name].price).toLocaleString() + '円です。' });
    }
  });

  Object.keys(paper).forEach(function (name) {
    if (live[name]) return;
    out.push({ name: name, kind: 'removed',
      message: '「' + name + '」は募集要項PDFに載っていますが、'
             + 'いまのフォームには出ていません（無効、または単価が未設定）。' });
  });

  return out;
}

/**
 * 1品目を保存する。row が 0 なら追加。
 * 単価を変えると**お金の話が変わる**ので、変更は必ず履歴に残す。
 */
function adminRentalSave_(auth, payload) {
  var row = Number(payload && payload.row) || 0;
  var it = (payload && payload.item) || {};

  var name = String(it.name || '').trim();
  if (!name) return { ok: false, error: 'bad_value', message: '品目名をご記入ください。' };
  if (name.length > 60) {
    return { ok: false, error: 'too_long', message: '品目名は60文字までです。' };
  }

  var kind = String(it.kind || '').trim();
  if ([RENTAL_KIND.T1, RENTAL_KIND.T2, RENTAL_KIND.QTY].indexOf(kind) < 0) {
    return { ok: false, error: 'bad_value', message: '種別をお選びください。' };
  }

  // 空欄は「未定」。0 と区別する（0で受注すると誰も気づけない）
  var priceRaw = String(it.price == null ? '' : it.price).trim();
  var price = '';
  if (priceRaw !== '') {
    var got = rentalNumber_(priceRaw);
    if (!got.ok) {
      return { ok: false, error: 'bad_value',
        message: '単価は0以上の半角数字でご記入ください（' + got.why + '）。' };
    }
    if (got.value > RENTAL_PRICE_MAX) {
      return { ok: false, error: 'bad_value',
        message: '単価が高すぎます（' + RENTAL_PRICE_MAX.toLocaleString() + '円まで）。'
               + '桁をお確かめください。' };
    }
    price = got.value;
  }

  var maxRaw = String(it.max == null ? '' : it.max).trim();
  var maxN = 0;
  if (maxRaw !== '') {
    var gotMax = rentalNumber_(maxRaw);
    if (!gotMax.ok) {
      return { ok: false, error: 'bad_value',
        message: '最大数は0以上の半角数字でご記入ください（' + gotMax.why + '）。' };
    }
    maxN = Math.floor(gotMax.value);
    if (maxN > 999) maxN = 999;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };

  try {
    var sh = sheet_(SHEET.RENTAL);
    var headers = rentalHeaders_(sh);
    if (!headers.ok) return headers.error;

    // 同じ品目名が2つあると、フォームの欄が二重に出る
    var dup = rentalFindByName_(sh, headers.idx, name);
    if (dup > 0 && dup !== row) {
      return { ok: false, error: 'duplicate',
        message: '「' + name + '」は、すでに登録されています。' };
    }

    var before = {};
    if (row) {
      if (row < 2 || row > sh.getLastRow()) return { ok: false, error: 'not_found' };
      before = rentalReadRow_(sh, headers.idx, row);
    } else {
      if (sh.getLastRow() - 1 >= RENTAL_MAX_ITEMS) {
        return { ok: false, error: 'too_many',
          message: '品目は' + RENTAL_MAX_ITEMS + '件までです。' };
      }
      sh.appendRow(new Array(headers.width).fill(''));
      row = sh.getLastRow();
    }

    var set = function (col, v) {
      var i = headers.idx[col];
      if (i === undefined) return;
      sh.getRange(row, i + 1).setValue(v);
    };

    /**
     * 画面が送ってこない欄は、**いまシートに入っている値のまま残す**。
     *
     * 管理ページの入力欄は 品目・種別・単価・単位・最大数・説明・有効 の7つだけ。
     * 並び順・間口(m)・奥行(m) は欄が無いので、payload に入ってこない。
     * それを「空で上書き」していたため、単価を1つ直しただけで
     *   ・並び順が行番号に戻り、シートで整えた並びが消える
     *   ・テントの間口・奥行が空になる（区画図の寸法が消える）
     * という壊れ方をしていた（2026-09-03 の点検で指摘）。
     * **画面に無い項目は、触らないのが正しい。**
     */
    var keepCell = function (col) {
      var i = headers.idx[col];
      if (i === undefined) return '';
      return sh.getRange(row, i + 1).getValue();
    };
    var given = function (v) { return v !== undefined && v !== null && v !== ''; };

    // 画面が送ってきた値は、単価と同じ厳しさで読む。
    // 以前は Number() 直呼びで、"0" → 行番号、"1番" → 行番号 と黙って化けた
    // **読み取った値をそのまま使う。**
    // 検査だけ足して `Number(it.order) || row` を残していたので、
    // 「0」「１０」「1,000」がどれも行番号に化けていた（2026-09-04 の点検で指摘）。
    // `|| row` は 0 も潰すので、null かどうかで見る
    var orderVal;
    if (given(it.order)) {
      var gotOrder = rentalNumber_(it.order);
      if (!gotOrder.ok) {
        return { ok: false, error: 'bad_value',
          message: '並び順は半角の数字でご記入ください（' + gotOrder.why + '）。' };
      }
      orderVal = Math.floor(gotOrder.value);
    } else {
      var kept = numAmount_(keepCell('並び順'));
      orderVal = (kept === null) ? row : Math.floor(kept);
    }
    set('並び順', orderVal);
    set('種別', kind);
    set('品目', safeCellText_(name));
    set('単価(円)', price);
    set('単位', safeCellText_(String(it.unit || '個').trim().slice(0, 10)));
    set('最大数', maxN);
    // 寸法は区画図に効く。読めない値で**黙って空にしない**（"2.7m" → '' になっていた）
    var dim = function (key, v, col) {
      if (!given(v)) return keepCell(col);
      var got = rentalNumber_(v);
      if (!got.ok) throw new Error(key + 'は半角の数字でご記入ください（' + got.why + '）。');
      // 区画図の縮尺が壊れるので、常識的な上限を置く（会場の一辺より大きい値は無い）
      if (got.value > RENTAL_SIZE_MAX) {
        throw new Error(key + 'は' + RENTAL_SIZE_MAX + 'm までです（' + got.value + 'm）。');
      }
      return got.value;
    };
    try {
      set('間口(m)', dim('間口', it.w, '間口(m)'));
      set('奥行(m)', dim('奥行', it.d, '奥行(m)'));
    } catch (dimErr) {
      return { ok: false, error: 'bad_value', message: String(dimErr.message || dimErr) };
    }
    set('有効', it.active ? '有効' : '無効');
    set('説明', safeCellText_(String(it.note || '').trim().slice(0, 200)));

    // 単価と有無は、お金と募集内容が変わる。必ず残す
    var now = { 単価: price === '' ? '（未定）' : String(price),
                有効: it.active ? '有効' : '無効', 品目: name };
    ['品目', '単価', '有効'].forEach(function (k) {
      var b = before[k] === undefined ? '' : String(before[k]);
      if (b === String(now[k])) return;
      appendHistory(auth.person, '', 'レンタル品目：' + k, b, String(now[k]), '');
    });

    SpreadsheetApp.flush();
    _rentalCache = null;          // 読み直させる
    return { ok: true, row: row };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 品目を消す。**行は消さず「無効」にする**。
 * 消すと、すでに申し込まれている台帳の「レンタル明細」の行き先が分からなくなる。
 */
function adminRentalDisable_(auth, payload) {
  var row = Number(payload && payload.row) || 0;
  if (!row) return { ok: false, error: 'bad_request' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(SHEET.RENTAL);
    var headers = rentalHeaders_(sh);
    if (!headers.ok) return headers.error;
    if (row < 2 || row > sh.getLastRow()) return { ok: false, error: 'not_found' };

    var before = rentalReadRow_(sh, headers.idx, row);
    sh.getRange(row, headers.idx['有効'] + 1).setValue('無効');
    appendHistory(auth.person, '', 'レンタル品目：有効',
                  String(before['有効'] || ''), '無効',
                  '「' + before['品目'] + '」をフォームから外しました');
    SpreadsheetApp.flush();
    _rentalCache = null;
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** 見出しの位置。1つでも欠けていたら書き込まない（別の列を壊すため） */
function rentalHeaders_(sh) {
  if (sh.getLastColumn() < 1) {
    return { ok: false, error: { ok: false, error: 'server_error',
      message: 'レンタル品目シートが空です。setup() を実行してください。' } };
  }
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
               .map(function (h) { return String(h).trim(); });
  // 素の {} だと、'constructor' などが「実在する列」に見える。
  // この差分で唯一残っていた関門（2026-09-04 の点検で指摘）
  var idx = Object.create(null);
  head.forEach(function (h, i) { idx[h] = i; });
  var missing = RENTAL_HEAD.filter(function (h) { return idx[h] === undefined; });
  if (missing.length) {
    return { ok: false, error: { ok: false, error: 'server_error',
      message: 'レンタル品目シートに「' + missing.join('」「') + '」の列がありません。'
             + 'setup() を実行してください。' } };
  }
  return { ok: true, idx: idx, width: head.length };
}

function rentalReadRow_(sh, idx, row) {
  var vals = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var out = {};
  out['品目'] = asText_(vals[idx['品目']]).trim();
  out['単価'] = asText_(vals[idx['単価(円)']]).trim() || '（未定）';
  out['有効'] = asText_(vals[idx['有効']]).trim();
  return out;
}

function rentalFindByName_(sh, idx, name) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var col = idx['品目'] + 1;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === name) return i + 2;
  }
  return -1;
}
