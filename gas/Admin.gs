/**
 * 管理ページのデータAPI。
 *
 * すべての入口で requireAuth_ を通す。トークンが無ければ何も返さない。
 * ここは公開URLから叩かれる前提で書くこと。
 *
 * 応募一覧シートの列は schema.js から生成されている（gas/Schema.gs の FIELDS）。
 * 列の位置を数えて書かず、必ず見出し名で引く。列が増減しても壊れないようにするため。
 */

/**
 * 応募一覧の列名。ここを唯一の参照元にする。
 *
 * 以前は各所に列名を直書きしていて、実在しない名前（'企業・団体名' など）が
 * 混ざっていた。cell_() は無い列に '' を返すため、**ダッシュボードが黙って0を並べる**
 * 状態になっていた。test/admin.test.js が、ここの名前が本当に台帳にあるかを検査する。
 *
 * 火気・搬入車両・スタッフ人数などは「出店確定情報」シート側（採択後に集める）で、
 * 応募一覧には無い。応募段階の画面で0件と出すと嘘になるので、ここには入れない。
 */
var COL = {
  id:          '受付ID',
  at:          '受付日時',
  company:     '企業名',
  shopName:    '出店名',
  person:      '担当者氏名',
  email:       '担当者メール',
  phone:       '担当者電話',
  staff:       'FC大阪担当社員',
  types:       '出店形態',
  license:     '営業許可',
  packaging:   '包材の用意',
  sustain:     'サステナ取り組み',
  size:        '希望区画',
  power:       '電源',
  genFuel:     '発電機燃料',
  watt:        '合計消費電力(W)',
  wattUnknown: '消費電力不明',
  tent:        'テント',
  tentSize:    'テントサイズ',
  rentalDetail: 'レンタル明細',
  rentalTotal:  'レンタル合計(円)',
  raw:          '生データ(JSON)',
  status:      'ステータス',
  spaceStart:  '割当開始区画',
  spaceUnits:  '割当区画数',
  mainType:    '主形態',
  memo:        '担当メモ',
  inAt:        '搬入予定時刻',
  outAt:       '撤収予定時刻',
  dayStatus:   '当日ステータス',
  notifiedAt:  '採択通知送信日時',
  rejectedAt:  '不採択通知送信日時',
  dup:         '重複フラグ',
};

/** 応募一覧を読み、見出し→列番号の対応と行データを返す */
function readLedger_() {
  var sh = sheet_(SHEET.LEDGER);
  var last = sh.getLastRow();
  if (last < 2) return { headers: ledgerHeaders_(sh), rows: [], sheet: sh };
  var values = sh.getDataRange().getValues();
  return { headers: values[0].map(function (h) { return String(h).trim(); }),
           rows: values.slice(1), sheet: sh };
}

function ledgerHeaders_(sh) {
  if (sh.getLastRow() < 1) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
}

function indexOf_(headers, name) {
  var i = headers.indexOf(name);
  if (i < 0) throw new Error('台帳に列がありません: ' + name);
  return i;
}

/** 空行（受付IDが無い行）を落とす */
function liveRows_(headers, rows) {
  var idId = indexOf_(headers, COL.id);
  return rows.filter(function (r) { return String(r[idId] || '').trim() !== ''; });
}

function cell_(headers, row, name) {
  var i = headers.indexOf(name);
  return i < 0 ? '' : row[i];
}

/** スプレッドシートに数式として解釈されない形にする */
function safeCellText_(v) {
  var s = String(v == null ? '' : v);
  // gas/Ledger.gs の safeCell_ と同じ判定にそろえる（TAB・CR も数式の起点になりうる）
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function asText_(v) {
  if (v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  }
  return String(v);
}

/**
 * ブラウザへ送らない列。
 *
 * 素材トークンは、公開の素材アップロードページ（§6-3）のアクセス鍵。
 * 画面側で「表示しない」だけにすると、開発者ツールの通信欄や拡張機能から素通しになる。
 * 「画面を隠しても意味がない、守りはサーバー側」という原則は、ここにも適用する。
 */
var NEVER_SEND = ['生データ(JSON)', '素材トークン'];

/** 一覧・詳細でそのまま出せる素の値にする */
function rowToObject_(headers, row) {
  var o = {};
  for (var i = 0; i < headers.length; i++) {
    if (!headers[i] || NEVER_SEND.indexOf(headers[i]) >= 0) continue;
    o[headers[i]] = asText_(row[i]);
  }
  return o;
}

// ──────────────────────────────────────────── ダッシュボード

function adminSummary_(auth) {
  var L = readLedger_();
  var rows = liveRows_(L.headers, L.rows);
  var H = L.headers;
  var get = function (r, name) { return asText_(cell_(H, r, name)); };

  var byStatus = {};
  STATUS_LIST_().forEach(function (s) { byStatus[s] = 0; });
  var byStaff = {}, byType = {}, bySize = {}, byPower = {}, byPack = {}, byTent = {};
  var powerWatt = 0, powerUnknown = 0, genset = 0;
  // 品目ごとの数は生データから拾う。台帳に品目ごとの列を作らない代わりに、
  // 集計はここで行う。品目が増えても、この行は変えなくてよい
  var rental = { tentT1: 0, tentT2: 0 };
  var rentalQty = {};        // 品目名 → 合計個数
  var rentalRevenue = 0;     // 応募時に確定した金額の合計
  var assigned = 0, dup = 0, unconfirmed = 0, sustainWritten = 0, license = 0;

  var stale = [], staleDays = configNumber('要対応_経過日数') || 3;
  var now = new Date().getTime();

  rows.forEach(function (r) {
    var st = get(r, COL.status) || '未確認';
    if (byStatus[st] == null) byStatus[st] = 0;
    byStatus[st]++;
    if (st === '未確認') unconfirmed++;

    if (String(get(r, COL.dup)).trim()) dup++;
    if (String(get(r, COL.spaceStart)).trim()) assigned += Number(get(r, COL.spaceUnits) || 1);

    var staff = get(r, COL.staff) || '未選択';
    byStaff[staff] = (byStaff[staff] || 0) + 1;

    // 出店形態は複数選択。延べ数で数える
    splitMulti_(get(r, COL.types)).forEach(function (t) {
      byType[t] = (byType[t] || 0) + 1;
    });

    var size = get(r, COL.size) || '未回答';
    bySize[size] = (bySize[size] || 0) + 1;

    var pw = get(r, COL.power) || '未回答';
    byPower[pw] = (byPower[pw] || 0) + 1;
    if (pw.indexOf('持ち込') >= 0 || pw.indexOf('発電機') >= 0) genset++;

    // ここも「数字以外を捨てて Number()」だった。禁じた書き方そのもの
    //（2026-09-04 の点検で発見）。共通の読み取りに寄せる
    var w = numAmount_(get(r, COL.watt));
    if (w === null) w = NaN;
    if (w) powerWatt += w;
    if (String(get(r, COL.wattUnknown) || '').trim()) powerUnknown++;

    // 包材の用意の内訳（仕様書§6-2「サステナ報告用」）。
    // 2026-09-02 に「食器・包材」から「包材の用意」へ。
    // 包材はサステナブル素材のみになったので、報告で見たいのは
    // 「自分で用意／支給を希望／相談したい」の内訳
    splitMulti_(get(r, COL.packaging)).forEach(function (t) {
      byPack[t] = (byPack[t] || 0) + 1;
    });
    if (String(get(r, COL.sustain) || '').trim()) sustainWritten++;
    if (String(get(r, COL.license) || '').trim()) license++;

    var tent = get(r, COL.tent) || '未回答';
    byTent[tent] = (byTent[tent] || 0) + 1;
    if (tent.indexOf('レンタル') >= 0) {
      if (get(r, COL.tentSize).indexOf('1.5間') >= 0) rental.tentT1++;
      else if (get(r, COL.tentSize)) rental.tentT2++;
    }
    // 金額は応募時に台帳の単価で確定させている。あとから単価を変えても、
    // 既に受け付けた分の見積りは動かさない（動くと請求と食い違う）
    rentalRevenue += Number(get(r, COL.rentalTotal) || 0);

    // 品目ごとの個数は生データから。台帳の列に依存しないので、品目が増えても壊れない
    try {
      var rawJson = get(r, COL.raw);
      if (rawJson) {
        var items = (JSON.parse(rawJson) || {}).rentalItems || {};
        Object.keys(items).forEach(function (name) {
          var n = Number(items[name]) || 0;
          if (n > 0) rentalQty[name] = (rentalQty[name] || 0) + n;
        });
      }
    } catch (e) { /* 読めない行があっても集計は続ける */ }

    // 審査中のまま何日も置かれている応募
    if (st === '審査中') {
      var d = cell_(H, r, COL.at);
      var t = (Object.prototype.toString.call(d) === '[object Date]') ? d.getTime() : Date.parse(asText_(d));
      if (t && (now - t) / 86400000 >= staleDays) {
        stale.push({ id: get(r, COL.id), name: get(r, COL.company),
                     days: Math.floor((now - t) / 86400000) });
      }
    }
  });

  var revenue = rentalRevenue;

  var deadline = null;
  try { deadline = getDeadline(); } catch (e) {}
  var daysLeft = deadline ? Math.ceil((deadline.getTime() - now) / 86400000) : null;

  var total = configNumber('区画総数') || 50;
  var goal = configNumber('目標出店社数') || 0;

  // 採択済みなのに通知を送っていないもの
  var toNotify = rows.filter(function (r) {
    return get(r, COL.status) === '採択' && !String(get(r, COL.notifiedAt)).trim();
  }).map(function (r) { return { id: get(r, COL.id), name: get(r, COL.company) }; });

  // 採択済みなのに区画が決まっていないもの（開催直前に効く滞留）
  var toAssign = rows.filter(function (r) {
    return get(r, COL.status) === '採択' && !String(get(r, COL.spaceStart)).trim();
  }).map(function (r) { return { id: get(r, COL.id), name: get(r, COL.company) }; });

  // 発電機の持ち込みは、消防・騒音・配置の事前確認が要る
  var toCheckPower = rows.filter(function (r) {
    var pw = get(r, COL.power);
    return (pw.indexOf('持ち込') >= 0 || pw.indexOf('発電機') >= 0)
        && get(r, COL.status) === '未確認';
  }).map(function (r) { return { id: get(r, COL.id), name: get(r, COL.company) }; });

  var dayCount = {};
  ['未着', '搬入済', '設営完了', '撤収完了'].forEach(function (k) { dayCount[k] = 0; });
  rows.forEach(function (r) {
    var d = get(r, COL.dayStatus) || '未着';
    if (dayCount[d] == null) dayCount[d] = 0;
    dayCount[d]++;
  });

  return {
    ok: true,
    role: auth.role,
    person: auth.person,
    asOf: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    counts: {
      total: rows.length, goal: goal,
      byStatus: byStatus, byStaff: byStaff, byType: byType, bySize: bySize,
      byPower: byPower, byPack: byPack, byTent: byTent,
      powerWatt: powerWatt, powerUnknown: powerUnknown, genset: genset,
      dup: dup, unconfirmed: unconfirmed,
      sustainWritten: sustainWritten, license: license,
      day: dayCount,
    },
    spaces: { total: total, assigned: assigned,
              rate: total ? Math.round(assigned / total * 100) : 0 },
    rental: rental, rentalQty: rentalQty, revenue: revenue,
    // 数を集める項目（schema.js の aggregate）。**ここは項目が増えても変えない**
    totals: aggregateTotals_(rows, L.headers),
    // 単価が分かっているか。レンタル品目シートが空だと合計を出せない
    pricesKnown: getPrices().tentT1 != null,
    deadline: formatJa(deadline), daysLeft: daysLeft,
    todo: { unconfirmed: unconfirmed, stale: stale, toNotify: toNotify,
            toAssign: toAssign, toCheckPower: toCheckPower, dup: dup },
    // 画面の中で「事務局にご連絡ください」と案内する先。
    // 以前は個人名が直書きされていて、**新しく入った方には誰か分からず、
    // 連絡先も書いていなかった**（2026-09-03 の検証で指摘）。
    // どのタブからでも使うので、最初に読むこの返事に載せる
    office: configText('事務局の連絡先', ''),
    recent: rows.slice(-5).reverse().map(function (r) {
      return { id: get(r, COL.id), at: get(r, COL.at),
               name: get(r, COL.company), status: get(r, COL.status) };
    }),
  };
}

/** 複数選択の値を分ける。区切りはカンマ・読点・スラッシュのいずれか */
function splitMulti_(v) {
  return String(v || '').split(/[,、\/／]/)
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return t; });
}

function STATUS_LIST_() {
  return ['未確認', '審査中', '採択', '不採択', '辞退', 'キャンセル', '重複（無効）'];
}

// ──────────────────────────────────────────── 一覧・詳細

/**
 * 最初から表に出しておく列。
 * ここに無い列も**選べば出せる**（LIST_ALL_COLUMNS_ を参照）。
 */
function LIST_DEFAULT_COLUMNS_() {
  return [COL.id, COL.at, COL.status, COL.company, COL.types,
          COL.size, COL.spaceStart, COL.staff, COL.dayStatus];
}

/**
 * 一覧で選べる列。**台帳にある項目は全部**。
 *
 * 2026-09-02 まで22列に絞っていたが、
 * けいた指摘「出店者一覧でみれる項目が少なすぎない？
 * 電力やテントのレンタル有り無しなど…すべて見れないとだめなんじゃないか」。
 * 絞る側がどれを要ると思うかは、その日の仕事によって変わる。
 * **選ぶのは使う人**にして、こちらは全部渡す。
 */
function LIST_ALL_COLUMNS_(headers) {
  return headers.filter(function (h) {
    return h && NEVER_SEND.indexOf(h) < 0;
  });
}

/**
 * 一覧のセルは長すぎると表が読めなくなる（PR文は1000文字入る）。
 * 頭だけ返す。**全文は詳細で見る**。
 */
var LIST_CELL_MAX = 120;

/**
 * 出店確定情報の列を一覧に混ぜるとき、頭につける印。
 *
 * ■ なぜ印をつけるか
 *   確定情報シートにも応募一覧にも「備考」がある。
 *   そのまま混ぜると、**片方が黙って消える**。
 *   印をつければ衝突しないうえに、列を選ぶ画面で
 *   「これは採択後にいただいた情報だ」と読んで分かる。
 */
var CONFIRM_COL_PREFIX = '確定：';

/**
 * 一覧に出す行。応募一覧に、出店確定情報を混ぜて返す。
 *
 * ■ 混ぜる理由（けいた指示・2026-09-03）
 *   当日の一覧に**現場責任者の携帯**を出したい。
 *   当日は電波が切れることがあるので、印刷する表に入っている必要がある。
 *   応募時のご担当者は会社にいることがあり、現場では通じない。
 *
 *   あわせて、列を選ぶ画面から確定情報の全項目を出せるようになる
 *   （けいた指摘「採択確定後にフォームで吸い上げる情報はすべて見れないとだめ」）。
 *
 * ■ 確定情報は1回だけ読む
 *   行ごとに読むと50社で50回になり、GASの実行時間に効いてくる。
 */
function adminList_(auth) {
  var L = readLedger_();
  var rows = liveRows_(L.headers, L.rows);
  var cols = LIST_ALL_COLUMNS_(L.headers);
  var idIdx = L.headers.indexOf(COL.id);

  var confirmAll = {};
  var confirmCols = [];
  try {
    confirmAll = readConfirmAll_();
    // 列の並びはシートの見出しの順にしたい。中身から拾うと行ごとにばらつく
    var sh = sheet_(SHEET.CONFIRM);
    confirmSheetHeaders_(sh).forEach(function (h) {
      if (!h || h === COL.id) return;
      if (NEVER_SEND.indexOf(h) >= 0) return;
      confirmCols.push(h);
    });
  } catch (e) { logError_('adminList_:確定情報', e); }

  return {
    ok: true,
    columns: cols.concat(confirmCols.map(function (h) { return CONFIRM_COL_PREFIX + h; })),
    defaultColumns: LIST_DEFAULT_COLUMNS_().filter(function (c) {
      return cols.indexOf(c) >= 0;
    }),
    rows: rows.map(function (r) {
      var o = {};
      cols.forEach(function (c) {
        var v = asText_(cell_(L.headers, r, c));
        o[c] = v.length > LIST_CELL_MAX ? v.slice(0, LIST_CELL_MAX) + '…' : v;
      });
      var cf = confirmAll[asText_(r[idIdx]).trim()] || {};
      confirmCols.forEach(function (h) {
        var v = asText_(cf[h]);
        o[CONFIRM_COL_PREFIX + h] =
          v.length > LIST_CELL_MAX ? v.slice(0, LIST_CELL_MAX) + '…' : v;
      });
      return o;
    }),
    statuses: STATUS_LIST_(),
    dayStatuses: ['未着', '搬入済', '設営完了', '撤収完了'],
  };
}

function adminDetail_(auth, payload) {
  var id = String((payload && payload.id) || '').trim();
  if (!id) return { ok: false, error: 'bad_request' };
  var L = readLedger_();
  var idIdx = indexOf_(L.headers, COL.id);
  var row = L.rows.filter(function (r) { return String(r[idIdx]).trim() === id; })[0];
  if (!row) return { ok: false, error: 'not_found' };
  return { ok: true, detail: rowToObject_(L.headers, row), confirm: confirmForAdmin_(id),
           countFields: countFieldsForAdmin_() };
}

/**
 * 管理ページから入れられる「数を集める項目」。
 * 画面がこの一覧から入力欄を組み立てる。**画面側に項目名を書かない**。
 */
function countFieldsForAdmin_() {
  return aggregateFields().filter(function (f) { return f.stage === 'confirm'; })
    .map(function (f) {
      return { key: f.key, label: f.label, sheet: f.sheet,
               unit: (f.aggregate && f.aggregate.unit) || '',
               min: f.min, max: f.max };
    });
}

/**
 * 数を集める項目の合計。
 *
 * 2026-09-03 けいた指示：
 * 「今後もダッシュボードに出したいものは運用しながら増えていくかも」
 *
 * **項目が増えても、この関数は変えない。**
 * schema.js の項目に aggregate を付けるだけで、ここが拾って合計を出す。
 * 個別に足していく作りにすると、必ずどこかで追いつかなくなる。
 *
 * ■ 応募時のものと、採択後のものが混ざる
 *   応募時（stage未指定）は応募一覧、採択後（stage:'confirm'）は
 *   出店確定情報シートにある。読む先を項目ごとに選ぶ。
 *
 * ■ 未提出は「0」ではなく「未提出」として数える
 *   0と未提出を同じにすると、**まだ聞けていないのか、要らないのか**が
 *   分からなくなる。枚数を手配する人がいちばん困るところ。
 */
function aggregateTotals_(rows, headers) {
  var fields = aggregateFields();
  if (!fields.length) return [];

  var confirmValues = null;   // 受付ID → { 列名: 値 }
  var needConfirm = fields.some(function (f) { return f.stage === 'confirm'; });
  if (needConfirm) {
    try { confirmValues = readConfirmAll_(); } catch (e) { logError_('aggregateTotals_', e); }
  }

  var idIdx = headers.indexOf(COL.id);
  var stIdx = headers.indexOf(COL.status);

  var coIdx = headers.indexOf(COL.company);

  return fields.map(function (f) {
    var sum = 0, filled = 0, missing = 0;
    // **誰が未提出なのか**も返す。数だけでは催促できず、
    // 一覧で5手順かけて自力で調べることになっていた（2026-09-04 の検証で指摘）
    var missingNames = [];
    rows.forEach(function (r) {
      var raw;
      if (f.stage === 'confirm') {
        // **出店確定情報は、採択した方しか出せない。**
        // 全行を母数にすると「未提出7社」のような、催促できない数字になる
        //（実際は採択4社のうち3社が未提出）。
        // 枚数を手配する人が見る数字なので、母数がずれると発注がずれる
        if (!AGGREGATE_CONFIRM_STATUS_[asText_(r[stIdx]).trim()]) return;
        if (!confirmValues) { missing++; noteMissing_(missingNames, r, coIdx, idIdx); return; }
        var id = asText_(r[idIdx]).trim();
        var row = confirmValues[id];
        raw = row ? row[f.sheet] : undefined;
      } else {
        raw = cell_(headers, r, f.sheet);
      }
      var s = asText_(raw).trim();
      if (s === '') { missing++; noteMissing_(missingNames, r, coIdx, idIdx); return; }
      var n = aggregateNumber_(s);
      if (n === null) { missing++; noteMissing_(missingNames, r, coIdx, idIdx); return; }
      sum += n;
      filled++;
    });
    return {
      key: f.key,
      label: (f.aggregate && f.aggregate.label) || f.label,
      unit: (f.aggregate && f.aggregate.unit) || '',
      sum: sum, filled: filled, missing: missing,
      // 何社まで名前を出すか。50社ぶん並べても読めないので頭だけ
      missingNames: missingNames.slice(0, AGGREGATE_NAMES_MAX)
        .map(function (x) { return x.name; }),
      // 「ほかN社」は、**出した名前の数**から数える。
      // missing から引くと、社名を出せなかった行があったときにずれる
      missingMore: Math.max(missingNames.length - AGGREGATE_NAMES_MAX, 0),
      stage: f.stage === 'confirm' ? 'confirm' : 'apply',
    };
  });
}

/** 未提出の社名を控える。画面で「誰に催促するか」を出すため */
var AGGREGATE_NAMES_MAX = 5;

function noteMissing_(list, row, coIdx, idIdx) {
  var id = idIdx >= 0 ? asText_(row[idIdx]).trim() : '';
  var name = coIdx >= 0 ? asText_(row[coIdx]).trim() : '';
  if (!name) name = id;
  if (!name) return;
  // **社名ではなく受付IDで重複を見る。**
  // 同じ会社名で2区画に応募することがある（別の行＝別の未提出）。
  // 社名で潰すと、画面の「ほかN社」が実際の未提出数と合わなくなり、
  // 催促が抜ける（2026-09-04 の点検で指摘）
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return;
  list.push({ id: id, name: name });
}

/**
 * 出店確定情報を出す側にいる方のステータス。
 * 辞退・キャンセルは、採択したが当日いないので母数から外す。
 */
// 台帳の値で引くので、素の {} にしない（'constructor' が真になる）
var AGGREGATE_CONFIRM_STATUS_ = Object.assign(Object.create(null), { '採択': true });

/**
 * 集計のための数の読み取り。読めなければ null（0ではない）。
 *
 * 「数字以外を捨てて Number()」だと、全角の「１０」が '' になり
 * **Number('') が 0**。入っているのに 0 として足され、しかも
 * 「入力済み」に数えられるので、**誰も気づけない**。
 */
function aggregateNumber_(text) {
  return numAmount_(text);
}

/** 出店確定情報シートを丸ごと読む。受付ID → { 列名: 値 } */
function readConfirmAll_() {
  var sh = sheet_(SHEET.CONFIRM);
  var headers = confirmSheetHeaders_(sh);
  if (!headers.length || headers[0] !== '受付ID') return {};
  var last = sh.getLastRow();
  if (last < 2) return {};

  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var out = {};
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0]).trim();
    if (!id) continue;
    var o = {};
    for (var c = 1; c < headers.length; c++) {
      if (headers[c]) o[headers[c]] = values[i][c];
    }
    out[id] = o;
  }
  return out;
}

/**
 * 採択後に集めた「出店確定情報」を、管理ページから読む。
 *
 * ■ なぜ要るか
 *   2026-09-02 まで、確定情報シートは**管理ページのどこからも読まれていなかった**。
 *   現場責任者・搬入車両・保険といった、当日いちばん要る情報を
 *   集めているのに、スプレッドシートを直接開かないと見られない状態だった。
 *   けいた指摘：「応募フォームで吸い上げる情報や、採択確定後にフォームで
 *   吸い上げる情報はすべて見れないとだめなんじゃないか」
 *
 * ■ 事業者向けの入口（confirmLoad_）とは別にする
 *   あちらは**32桁の鍵**で本人だけを通す。こちらは**管理ページの権限**で通す。
 *   同じ関数にすると、片方の条件を緩めたときにもう片方まで緩む。
 *
 * ■ 読めなくても詳細は出す
 *   シートが無い・見出しが壊れている、で応募の詳細まで開けなくなると、
 *   本来できる仕事まで止まる。ここは空を返して、画面側で「未提出」と出す。
 */
function confirmForAdmin_(receiptId) {
  try {
    var sh = sheet_(SHEET.CONFIRM);
    var headers = confirmSheetHeaders_(sh);
    if (!headers.length || headers.indexOf('受付ID') !== 0) {
      return { ok: false, reason: 'no_sheet' };
    }
    var rowNo = confirmFindRow_(sh, receiptId);
    if (rowNo < 0) return { ok: true, submitted: false, values: {} };

    var row = sh.getRange(rowNo, 1, 1, headers.length).getValues()[0];
    var out = {};
    for (var i = 0; i < headers.length; i++) {
      if (!headers[i] || headers[i] === '受付ID') continue;
      if (NEVER_SEND.indexOf(headers[i]) >= 0) continue;
      var v = asText_(row[i]);
      if (v !== '') out[headers[i]] = v;
    }
    return { ok: true, submitted: true, values: out };
  } catch (e) {
    logError_('confirmForAdmin_:' + receiptId, e);
    return { ok: false, reason: 'error' };
  }
}

/** 更新できる列。ここに無い列は、どの役割でも書き換えられない */
var MEMO_ADD_MAX   = 2000;    // 1回の追記の上限
var MEMO_TOTAL_MAX = 45000;   // 積み上げた全体の上限（セルは5万字）
var FIELD_TEXT_MAX = 5000;    // 1項目に入れられる文字数
var REASON_MAX     = 500;     // 変更理由の上限

/** 後戻りしにくいステータス。ここへ変えるときは理由を残す */
var STATUS_NEEDS_REASON_ = ['不採択', '辞退', 'キャンセル', '重複（無効）'];

/**
 * 変更履歴を書く。書けなかったときは理由の文字列を返す（成功なら空）。
 *
 * 履歴が残らないまま台帳だけが変わるのが、この仕組みで一番まずい状態。
 * 例外を握りつぶさず、呼び出し側に返して利用者にも運用者にも伝える。
 */
function recordHistory_(operator, id, changed, reason) {
  try {
    changed.forEach(function (c) {
      appendHistory(operator, id, c.item, c.before, c.after, reason || '');
    });
    return '';
  } catch (e) {
    logError_('recordHistory_', e);
    try {
      alertOperator_('historyWriteFailed', id,
        '操作者 ' + operator + '／' + (e && e.message || e));
    } catch (e2) {}
    return String((e && e.message) || e).slice(0, 120);
  }
}

function EDITABLE_() {
  return [COL.status, COL.memo, COL.inAt, COL.outAt, COL.dayStatus, COL.mainType];
}

function adminUpdate_(auth, payload) {
  var id = String((payload && payload.id) || '').trim();
  var patch = (payload && payload.patch) || {};
  if (!id) return { ok: false, error: 'bad_request' };

  var editable = EDITABLE_();
  var bad = Object.keys(patch).filter(function (k) { return editable.indexOf(k) < 0; });
  if (bad.length) {
    // 画面のバグでも、不正なリクエストでも、ここで止める
    return { ok: false, error: 'forbidden_field', message: '変更できない項目です: ' + bad.join(', ') };
  }
  if (patch[COL.status] && STATUS_LIST_().indexOf(patch[COL.status]) < 0) {
    return { ok: false, error: 'bad_value', message: 'ステータスの値が不正です' };
  }
  // 当日ステータスも決められた値だけ。任意の文字列が入ると、
  // 当日運営の集計が勝手に項目を増やして実態と合わなくなる
  if (patch[COL.dayStatus] && DAY_STATUS.indexOf(patch[COL.dayStatus]) < 0) {
    return { ok: false, error: 'bad_value', message: '当日ステータスの値が不正です' };
  }
  // 後戻りしにくいステータスへの変更は、理由を残す。
  // 「申告内容の修正には理由が要るのに、採否の変更には要らない」のは筋が通らない
  if (patch[COL.status] && STATUS_NEEDS_REASON_.indexOf(patch[COL.status]) >= 0
      && String(payload.reason || '').trim().length < 5) {
    return { ok: false, error: 'reason_required',
      message: '「' + patch[COL.status] + '」に変更する理由を、5文字以上でご記入ください。' };
  }
  // 長すぎる値でシートへの書き込みごと落とさない
  // 担当メモは積み上げ式で扱いが違うので、ここでは見ない（下で専用の上限を掛ける）
  if (patch[COL.memo] !== undefined
      && String(patch[COL.memo]).trim().length > MEMO_ADD_MAX) {
    return { ok: false, error: 'too_long',
      message: '担当メモの1回の追記は' + MEMO_ADD_MAX + '文字までです。' };
  }
  var tooLong = Object.keys(patch).filter(function (k) {
    if (k === COL.memo) return false;
    return String(patch[k] == null ? '' : patch[k]).length > FIELD_TEXT_MAX;
  });
  if (tooLong.length) {
    return { ok: false, error: 'too_long',
      message: '長すぎる項目があります: ' + tooLong.join(', ') };
  }
  if (String(payload.reason || '').length > REASON_MAX) {
    return { ok: false, error: 'too_long', message: '理由が長すぎます。' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var L = readLedger_();
    var idIdx = indexOf_(L.headers, COL.id);
    var rowNo = -1;
    for (var i = 0; i < L.rows.length; i++) {
      if (String(L.rows[i][idIdx]).trim() === id) { rowNo = i + 2; break; }
    }
    if (rowNo < 0) return { ok: false, error: 'not_found' };

    var changed = [];
    Object.keys(patch).forEach(function (k) {
      var col = L.headers.indexOf(k);
      if (col < 0) return;
      var before = asText_(L.sheet.getRange(rowNo, col + 1).getValue());
      var after = String(patch[k] == null ? '' : patch[k]);

      // 担当メモは書き換えではなく**積み上げ**。
      // 上書きにすると、前の担当が書いた経緯が黙って消える。
      // 誰がいつ書いたかを自動で付け、新しいものを上に置く。
      if (k === COL.memo) {
        var add = after.trim();
        if (!add) return;                       // 追記が空なら何もしない
        // 1回の追記の上限は、この関数の入口で断っている。
        // ここで切るのは積み上げた「全体」のほう（下）。
        var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
                  + '  ' + (auth.person || '');
        after = stamp + String.fromCharCode(10) + add
              + (before ? String.fromCharCode(10) + String.fromCharCode(10) + before : '');
        if (after.length > MEMO_TOTAL_MAX) {
          after = after.slice(0, MEMO_TOTAL_MAX)
                + String.fromCharCode(10) + String.fromCharCode(10)
                + '（これ以前の記録は「変更履歴」タブでご覧いただけます）';
        }
        L.sheet.getRange(rowNo, col + 1).setValue(safeCellText_(after));
        changed.push({ item: k, before: '（追記）', after: add });
        return;
      }

      if (before === after) return;
      // 先頭が = や + の文字列は、スプレッドシートに数式として入る。
      // Excel書き出し（§6-2）を通じて他のPCへ広がるので、ここで無害化する
      L.sheet.getRange(rowNo, col + 1).setValue(safeCellText_(after));
      changed.push({ item: k, before: before, after: after });
    });

    // 台帳を先に書いているので、ここで落ちると「変更は入ったのに記録が無い」状態になる。
    // 黙って server_error にせず、何が起きたかを返して運用者にも知らせる。
    var histError = recordHistory_(auth.person, id, changed, payload.reason || '');
    if (histError) {
      return { ok: false, error: 'history_failed', changed: changed.length,
        message: '変更は保存しましたが、変更履歴に残せませんでした（' + histError + '）。'
               + '「変更履歴」タブをご確認のうえ、担当までお知らせください。' };
    }
    return { ok: true, changed: changed.length };
  } finally {
    lock.releaseLock();
  }
}

// ──────────────────────────────────────────── 区画マップ

function adminSpaces_(auth) {
  var sh = sheet_(SHEET.SPACES);
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  var iNo = head.indexOf('区画番号'), iX = head.indexOf('X'), iY = head.indexOf('Y'),
      iId = head.indexOf('割当受付ID');

  var spaces = [];
  for (var i = 1; i < values.length; i++) {
    var no = Number(values[i][iNo]);
    if (!no) continue;
    spaces.push({ no: no, x: Number(values[i][iX]) || 0, y: Number(values[i][iY]) || 0,
                  id: String(values[i][iId] || '').trim() });
  }

  // 出店者側の情報（名前・主形態）をあわせて返す。マップの塗り分けに使う
  var L = readLedger_();
  var rows = liveRows_(L.headers, L.rows);
  var owners = {};
  rows.forEach(function (r) {
    var id = asText_(cell_(L.headers, r, COL.id));
    owners[id] = {
      name: asText_(cell_(L.headers, r, COL.shopName)) || asText_(cell_(L.headers, r, COL.company)),
      type: asText_(cell_(L.headers, r, COL.mainType))
            || splitMulti_(asText_(cell_(L.headers, r, COL.types)))[0] || '',
      start: Number(asText_(cell_(L.headers, r, COL.spaceStart)) || 0),
      units: Number(asText_(cell_(L.headers, r, COL.spaceUnits)) || 0),
      status: asText_(cell_(L.headers, r, COL.status)),
      power: asText_(cell_(L.headers, r, COL.power)),
      size: asText_(cell_(L.headers, r, COL.size)),
    };
  });

  var colors = {};
  ['飲食', 'ワークショップ', '展示', '体験コンテンツ', 'その他'].forEach(function (t) {
    colors[t] = configText('色_' + t, '#B8B8B8');
  });

  return { ok: true, spaces: spaces, owners: owners, colors: colors,
           background: configText('マップ背景画像', ''),
           total: configNumber('区画総数') || spaces.length };
}

// 1社が押さえられる区画数の上限（仕様書§6-2の最大は3区画）
var MAX_UNITS = 3;

/** 希望区画から、押さえる区画数を決める */
function unitsFor_(sizeLabel) {
  var s = String(sizeLabel || '');
  if (s.indexOf('3間') >= 0 || s.indexOf('2区画') >= 0) return 2;
  return 1;
}

function adminAssign_(auth, payload) {
  var id = String((payload && payload.id) || '').trim();
  var start = Number((payload && payload.start) || 0);
  if (!id || !start) return { ok: false, error: 'bad_request' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var sp = adminSpaces_(auth);
    var owner = sp.owners[id];
    if (!owner) return { ok: false, error: 'not_found' };

    var total = sp.spaces.length;

    // 区画数と開始番号は必ず検証する。
    // 検証せずに大きな値を受けると、この下のループがスクリプトロックを握ったまま
    // 実行上限まで走る。そのロックは応募の記録（Ledger.gs）と同じものなので、
    // その間ずっと応募が台帳に書けない。仕様書§0の最重要要件に直撃する。
    var units = (payload.units == null) ? unitsFor_(owner.size) : Math.floor(Number(payload.units));
    if (!isFinite(units) || units < 1 || units > MAX_UNITS) {
      return { ok: false, error: 'bad_request', message: '区画数の指定が正しくありません。' };
    }
    if (!isFinite(start) || start < 1 || start > total) {
      return { ok: false, error: 'bad_request', message: '区画番号の指定が正しくありません。' };
    }

    // 環状なので、最終番号と①はつながっている（仕様書§6-2）
    var want = [];
    for (var k = 0; k < units; k++) want.push(((start - 1 + k) % total) + 1);

    var taken = sp.spaces.filter(function (s) {
      return want.indexOf(s.no) >= 0 && s.id && s.id !== id;
    });
    if (taken.length) {
      return { ok: false, error: 'occupied',
        message: '区画 ' + taken.map(function (s) { return s.no; }).join('・')
               + ' はすでに割り当てられています。' };
    }

    writeSpaceAssignment_(id, want);
    setLedgerCells_(id, { '割当開始区画': start, '割当区画数': units });
    appendHistory(auth.person, id, '区画割当', '', start + '〜（' + units + '区画）',
                  payload.reason || '');
    return { ok: true, spaces: want };
  } finally {
    lock.releaseLock();
  }
}

function adminUnassign_(auth, payload) {
  var id = String((payload && payload.id) || '').trim();
  if (!id) return { ok: false, error: 'bad_request' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    if (!setLedgerCells_(id, { '割当開始区画': '', '割当区画数': '' })) {
      return { ok: false, error: 'not_found' };
    }
    writeSpaceAssignment_(id, []);
    appendHistory(auth.person, id, '区画割当', '割当済', '解除', payload.reason || '');
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** 区画シートの割当列を、この受付IDについて want の集合に合わせる */
function writeSpaceAssignment_(id, want) {
  var sh = sheet_(SHEET.SPACES);
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  var iNo = head.indexOf('区画番号'), iId = head.indexOf('割当受付ID');

  for (var i = 1; i < values.length; i++) {
    var no = Number(values[i][iNo]);
    if (!no) continue;
    var cur = String(values[i][iId] || '').trim();
    var should = want.indexOf(no) >= 0 ? id : (cur === id ? '' : cur);
    if (cur !== should) sh.getRange(i + 1, iId + 1).setValue(should);
  }
}

function setLedgerCells_(id, patch) {
  var L = readLedger_();
  var idIdx = indexOf_(L.headers, COL.id);
  for (var i = 0; i < L.rows.length; i++) {
    if (String(L.rows[i][idIdx]).trim() !== id) continue;
    Object.keys(patch).forEach(function (k) {
      var col = L.headers.indexOf(k);
      if (col >= 0) L.sheet.getRange(i + 2, col + 1).setValue(patch[k]);
    });
    return true;
  }
  return false;
}

// ──────────────────────────────────────────── 入口

/**
 * 管理APIの振り分け。
 * ここを通らないと1件もデータが出ない、という形にしておく。
 */
// ─────────────────────────────────────────── 関係者（管理者のみ）
/**
 * 関係者シートの読み書き。
 *
 * ■ 消さずに無効にする
 *   行ごと消すと、過去の応募が持つ「FC大阪の担当社員」の値が宙に浮く。
 *   誰の紹介だったのか後から辿れなくなるので、退職・異動は
 *   「フォーム表示＝無効」「管理ページ利用＝無」で扱う。
 *
 * ■ 締め出しを作らない
 *   自分自身の管理者権限を落とせると、最後の管理者が自分を降格した瞬間に
 *   誰も設定を触れなくなる。スプレッドシートを直接開けば直せるが、
 *   それは「管理ページで完結させたい」という前提を壊す。
 *   そこで保存の直前に、変更後の状態を組み立てて確かめる。
 */
var PEOPLE_HEADERS_ = ['氏名', '所属', '部署', 'メール', 'フォーム表示', '管理ページ利用', '役割', '通知'];

function adminPeople_(auth) {
  var people = getPeople();
  return {
    ok: true,
    me: auth.person,
    people: people.map(function (p) {
      return {
        row: p.row, name: p.name, org: p.org, dept: p.dept, email: p.email,
        formVisible: p.formVisible, canLogin: p.canLogin, role: p.role, notify: p.notify,
      };
    }),
  };
}

/** 入力を整えて検証する。戻り値は { error, message } か { value } */
function normalizePerson_(v) {
  var name = safeCellText_(String(v.name || '').trim());
  if (!name) return { error: 'bad_value', message: '氏名を入力してください。' };
  if (name.length > 40) return { error: 'bad_value', message: '氏名が長すぎます。' };

  var email = String(v.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return { error: 'bad_value', message: 'メールアドレスの形をご確認ください。' };
  }

  var role = String(v.role || '一般').trim();
  if (['管理者', '一般'].indexOf(role) < 0) {
    return { error: 'bad_value', message: '役割は「管理者」か「一般」です。' };
  }

  var canLogin = !!v.canLogin;
  if (canLogin && !email) {
    // 通知も本人確認も、届け先が無いと成立しない
    return { error: 'bad_value', message: '管理ページを使う方には、メールアドレスが要ります。' };
  }

  return { value: {
    name: name,
    org:  safeCellText_(String(v.org  || '').trim()).slice(0, 40),
    dept: safeCellText_(String(v.dept || '').trim()).slice(0, 40),
    email: safeCellText_(email).slice(0, 120),
    formVisible: !!v.formVisible,
    canLogin: canLogin,
    role: role,
    notify: !!v.notify,
  } };
}

function adminPeopleSave_(auth, payload) {
  var v = (payload && payload.person) || {};
  var targetRow = Number(payload && payload.row) || 0;   // 0 なら新規

  var n = normalizePerson_(v);
  if (n.error) return { ok: false, error: n.error, message: n.message };
  var np = n.value;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(SHEET.PEOPLE);
    var before = getPeople();

    // 同姓同名は担当社員の選択肢が見分けられなくなるので許さない
    var dup = before.filter(function (p) {
      return p.name === np.name && p.row !== targetRow;
    });
    if (dup.length) {
      return { ok: false, error: 'duplicate',
               message: '同じ氏名の方がすでに登録されています（' + np.name + '）。' };
    }

    if (targetRow && !before.some(function (p) { return p.row === targetRow; })) {
      return { ok: false, error: 'not_found', message: 'その行は見つかりませんでした。' };
    }

    // 保存したあとの状態を先に組み立て、締め出しが起きないかを確かめる
    var after = before.map(function (p) {
      return (p.row === targetRow)
        ? { name: np.name, canLogin: np.canLogin, role: np.role }
        : { name: p.name, canLogin: p.canLogin, role: p.role };
    });
    if (!targetRow) after.push({ name: np.name, canLogin: np.canLogin, role: np.role });

    var admins = after.filter(function (p) { return p.canLogin && p.role === '管理者'; });
    if (!admins.length) {
      return { ok: false, error: 'lockout',
               message: '管理者が誰もいなくなります。先に別の方を管理者にしてください。' };
    }
    var meAfter = after.filter(function (p) { return p.name === auth.person; })[0];
    if (auth.person && meAfter && !(meAfter.canLogin && meAfter.role === '管理者')) {
      return { ok: false, error: 'lockout',
               message: 'ご自身の管理者権限は外せません。'
                      + '別の管理者の方に操作していただくか、先に交代してください。' };
    }

    var rowValues = [np.name, np.org, np.dept, np.email,
                     np.formVisible ? '有効' : '無効',
                     np.canLogin ? '有' : '無',
                     np.role,
                     np.notify ? 'ON' : 'OFF'];

    var writeRow = targetRow || (sh.getLastRow() + 1);
    sh.getRange(writeRow, 1, 1, rowValues.length).setValues([rowValues]);

    return { ok: true, row: writeRow, added: !targetRow };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────── 応募内容の修正（管理側）
/**
 * 応募者が書いた内容を、こちら側から直す。
 *
 * ■ なぜ普通の更新と分けるか
 *   これは「事業者さまが申告した内容」を書き換える操作で、性質が違う。
 *   電話で聞いた訂正を反映する、といった正当な用途はあるが、
 *   **なぜ変えたのかが残らないと、あとで誰も判断できない**。
 *   そこで理由を必須にし、変更前と変更後を必ず履歴に残す。
 *
 * ■ 直せる項目を絞る理由
 *   台帳のセルには「表示用の文字列」が入っている（選択肢は日本語ラベル、
 *   複数選択は「展示、飲食」のように連結）。
 *   これを書き換えても、生データ(JSON) は元のままなので、
 *   **応募者が修正画面を開くと古い値が出てくる**という食い違いが生まれる。
 *   文字列がそのまま値になる項目（記入欄・数値）だけに限れば、両方を揃えて直せる。
 *   選択肢の変更は、応募者本人に直してもらうのが正しい。
 */
function applicantEditable_() {
  var ok = ['text', 'textarea', 'email', 'tel', 'url', 'number'];
  return applyFields().filter(function (f) {
    return f.sheet && ok.indexOf(f.type) >= 0;
  });
}

function adminApplicantFields_(auth) {
  return {
    ok: true,
    fields: applicantEditable_().map(function (f) {
      return { key: f.key, sheet: f.sheet, label: f.label, type: f.type,
               maxLength: f.maxLength || 0 };
    }),
  };
}

function adminApplicantUpdate_(auth, payload) {
  var id = String((payload && payload.id) || '').trim();
  var patch = (payload && payload.patch) || {};
  var reason = String((payload && payload.reason) || '').trim();
  if (!id) return { ok: false, error: 'bad_request' };

  // 理由を必須にする。ここを緩めると、誰も経緯を追えなくなる
  if (reason.length < 5) {
    return { ok: false, error: 'reason_required',
      message: 'なぜ変更したのかを、5文字以上でご記入ください。'
             + '（例：お電話で訂正のご連絡あり）' };
  }

  // 素の {} だと constructor / toString / __proto__ が
  // 「実在する項目」として通ってしまい、検査が働かない
  var allowed = Object.create(null);
  applicantEditable_().forEach(function (f) { allowed[f.key] = f; });
  if (reason.length > REASON_MAX) {
    return { ok: false, error: 'too_long', message: '理由が長すぎます。' };
  }
  var bad = Object.keys(patch).filter(function (k) { return !allowed[k]; });
  if (bad.length) {
    return { ok: false, error: 'forbidden_field',
      message: 'この画面から変更できない項目です: ' + bad.join(', ')
             + '（選択式の項目は、事業者さまご本人に直していただいてください）' };
  }
  var over = Object.keys(patch).filter(function (k) {
    var lim = allowed[k].maxLength || FIELD_TEXT_MAX;
    return String(patch[k] == null ? '' : patch[k]).length > lim;
  });
  if (over.length) {
    return { ok: false, error: 'too_long',
      message: '長すぎる項目があります: '
             + over.map(function (k) { return allowed[k].label; }).join(', ') };
  }
  // 担当者メールは、事業者さまご本人の確認（メール＋受付ID）に使っている。
  // ここを差し替えられると、その応募の修正画面を乗っ取れる。
  // 一般権限には開かない。
  if (patch.contactEmail !== undefined && auth.role !== '管理者') {
    return { ok: false, error: 'forbidden_field',
      message: 'ご担当者さまのメールアドレスは、管理者のみが変更できます。'
             + '（このアドレスは、事業者さまご本人の確認に使われています）' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var L = readLedger_();
    var idIdx = indexOf_(L.headers, COL.id);
    var rawIdx = L.headers.indexOf(COL.raw);
    var rowNo = -1, raw = {};
    for (var i = 0; i < L.rows.length; i++) {
      if (String(L.rows[i][idIdx]).trim() !== id) continue;
      rowNo = i + 2;
      try { raw = JSON.parse(String(L.rows[i][rawIdx] || '{}')) || {}; } catch (e) { raw = {}; }
      break;
    }
    if (rowNo < 0) return { ok: false, error: 'not_found' };

    // 応募時と同じ検証を通す。こちらから直すときだけ緩める理由がない
    var next = {};
    Object.keys(raw).forEach(function (k) { next[k] = raw[k]; });
    Object.keys(patch).forEach(function (k) {
      var f = allowed[k];
      // 数の項目も共通の読み取りを通す。ここだけ Number() 直呼びだった
    next[k] = (f.type === 'number')
      ? numAmount_(patch[k])
      : String(patch[k] == null ? '' : patch[k]);
    });
    // validate_ は渡したオブジェクトを書き換える（非表示項目を消し、
    // レンタルの数量を作り直す）。next をそのまま渡すと、
    // 企業名を1文字直しただけで、無効にした品目が生データから消え、
    // あとで事業者さまが修正したときに請求額が黙って減る。
    var check = JSON.parse(JSON.stringify(next));
    var errors = validate_(check);
    if (errors.length) return { ok: false, error: 'validation', fields: errors };

    // 「わからない」のチェックと数値の食い違いをそろえる。
    // 数値を入れたのにチェックが残ると、ダッシュボードの件数がずれる
    applicantEditable_().forEach(function (f) {
      if (!f.unknownCheckbox) return;
      if (patch[f.key] === undefined) return;
      var filled = String(patch[f.key] == null ? '' : patch[f.key]).trim() !== '';
      if (!filled) return;
      next[f.unknownCheckbox.key] = false;
      var uCol = L.headers.indexOf(f.unknownCheckbox.sheet);
      if (uCol >= 0) L.sheet.getRange(rowNo, uCol + 1).setValue('');
    });

    var changed = [];
    Object.keys(patch).forEach(function (k) {
      var f = allowed[k];
      var col = L.headers.indexOf(f.sheet);
      if (col < 0) return;
      var before = asText_(L.sheet.getRange(rowNo, col + 1).getValue());
      var after = String(next[k] == null ? '' : next[k]);
      if (before === after) return;
      L.sheet.getRange(rowNo, col + 1).setValue(safeCellText_(after));
      changed.push({ item: f.label, before: before, after: after });
    });

    if (!changed.length) return { ok: true, changed: 0 };

    // 生データも一緒に直す。ここを忘れると、事業者さまが修正画面を開いたとき
    // 古い値が出てきて、こちらの修正が黙って巻き戻る
    if (rawIdx >= 0) {
      L.sheet.getRange(rowNo, rawIdx + 1).setValue(rawJson_(next));
    }

    var histError = recordHistory_(auth.person, id, changed, reason);
    SpreadsheetApp.flush();
    if (histError) {
      return { ok: false, error: 'history_failed', changed: changed.length,
        message: '変更は保存しましたが、変更履歴に残せませんでした（' + histError + '）。'
               + '「変更履歴」タブをご確認のうえ、担当までお知らせください。' };
    }
    return { ok: true, changed: changed.length,
             items: changed.map(function (c) { return c.item; }) };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────── 変更履歴
/**
 * 変更履歴を新しい順に返す。
 * 「誰が・いつ・何を・なぜ」を ひとつの画面で追えるようにするためのもの。
 */
function adminHistory_(auth, payload) {
  var limit = Math.min(Math.max(Number(payload && payload.limit) || 200, 1), 500);
  var id = String((payload && payload.id) || '').trim();

  var sh = sheet_(SHEET.HISTORY);
  if (sh.getLastRow() < 2) return { ok: true, rows: [], total: 0 };

  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  head.forEach(function (h, i) { idx[h] = i; });

  var out = [];
  for (var i = values.length - 1; i >= 1; i--) {      // 新しい順
    var r = values[i];
    var rec = {
      at:       asText_(r[idx['日時']]),
      operator: asText_(r[idx['操作者']]),
      id:       asText_(r[idx['受付ID']]),
      item:     asText_(r[idx['項目']]),
      before:   asText_(r[idx['変更前']]),
      after:    asText_(r[idx['変更後']]),
      reason:   asText_(r[idx['理由メモ']]),
    };
    if (id && rec.id !== id) continue;
    out.push(rec);
    if (out.length >= limit) break;
  }
  return { ok: true, rows: out, total: values.length - 1 };
}

// ─────────────────────────────────────────── 設定（管理者のみ）
/**
 * 設定シートの値を、管理ページから変える。
 *
 * ■ パスワードは絶対に返さない
 *   「いま何が入っているか」を返すと、管理ページを開けた人が
 *   一般パスワードだけで管理者パスワードを読めてしまう。
 *   設定済みかどうかと、長さが足りているかだけを返す。
 *
 * ■ 締切は壊れると応募が止まる
 *   `isClosed()` は締切を読めないとき「締切済み」に倒す（安全側）。
 *   つまり書式を間違えると、その瞬間から**誰も応募できなくなる**。
 *   保存の前に必ず解釈できるかを確かめる。
 *
 * ■ 変更履歴にパスワードを書かない
 *   履歴は一般も見られる。値ではなく「変更しました」だけを残す。
 */
/**
 * 設定の一覧。**help は必須**（test/admin-help.test.js が空を許さない）。
 *
 * ■ なぜ説明を必ず書かせるか
 *   けいたは分かっていても、この画面はFC大阪の方にも渡る。
 *   「通知 ON/OFF って何だっけ」と作った本人に聞かないと分からない画面は、
 *   渡した先で止まる（2026-09-02 にけいたから実際に指摘があった）。
 *   説明はコードのコメントではなく、**画面に出す**こと。
 */
var SETTING_KEYS_ = [
  { key: '締切日時',           label: '応募の締切',           type: 'deadline',
    help: 'この日時を過ぎると、応募フォームは受付を止めて「締め切りました」と表示します。'
        + '募集ページと募集要項PDFの締切表記も、ここに合わせて変わります。' },
  { key: 'スケジュールの警告日数', label: 'まもなく期日と出す日数', type: 'int', min: 1, max: 30,
    help: '制作スケジュールで、期日の**何日前から**「まもなく」の色を出すかです。'
        + '出るのは**未着手と停滞中**のものだけで、進行中や確認中には出しません'
        + '（手が付いているものに急かす色を出しても、することがありません）。' },
  // ② タイムスケジュール。**版番号（タイムスケジュール版）と最終更新は、ここに出さない。**
  // あれは人が触るものではなく、触られると「ぶつかり」の検出が壊れる。
  { key: '進行表の日付',        label: 'タイムスケジュールの日',  type: 'date',
    help: 'タイムスケジュール（当日の時間割）が指す日です。'
        + '**当日運営タブの出店者一覧とは別物**で、こちらは進行・音響・司会が見る'
        + '「11:00 オープニング」のような時間割です。'
        + 'いまは1日ぶんだけ組めます。' },
  { key: '進行表の自動保存分',  label: 'タイムスケジュールの自動保存', type: 'int', min: 1, max: 30,
    help: 'タイムスケジュールを**何分おきに自動保存するか**です。'
        + 'ドラッグのたびには保存しません（保存が追いつかないため）。'
        + '空欄や読み取れない値のときは3分で動きます。' },
  { key: '区画総数',           label: '区画の総数',           type: 'int', min: 1, max: 500,
    help: '会場に用意する区画の数です。出店エリアマップのマス目の数になります。'
        + 'すでに割り当てた番号より小さくすることはできません。' },
  { key: '目標出店社数',       label: '目標の出店社数',       type: 'int', min: 0, max: 1000, allowBlank: true,
    help: 'ダッシュボードの進捗バーの分母です。空欄なら進捗バーを出しません。'
        + '応募者には見えません。' },
  { key: '要対応_経過日数',     label: '「要対応」に出すまでの日数', type: 'int', min: 1, max: 60,
    help: '「審査中」のまま何日たったら、ダッシュボードの「要対応」に出すか。'
        + '放置されている応募を拾うための目安です。' },
  { key: '担当社員への結果通知', label: '採否を担当社員にも知らせる', type: 'onoff',
    help: 'ONにすると、採択・不採択が決まったときに、'
        + 'その事業者が応募フォームで選んだ担当社員にもメールが届きます。'
        + '（届くのは、関係者にメールアドレスが登録されている方だけです）' },
  { key: '事務局の連絡先',      label: '事務局の連絡先（画面に出す）', type: 'text',
    allowBlank: true,
    help: '管理ページの中で「ここから先は事務局にご相談ください」と案内するときに、'
        + 'そのまま表示します。**名前だけでなく、メールアドレスか電話番号まで**'
        + 'ご記入ください。例：実行委員会事務局（森本／ moriya@example.com ／ 06-0000-0000）。'
        + '空欄のときは「実行委員会事務局」とだけ表示します。' },
  { key: '問い合わせメール',    label: '問い合わせ先メール',   type: 'email',
    help: '募集ページ・募集要項PDF・応募者へのメールに載る問い合わせ先です。'
        + '応募者からの返信もここに届きます。' },
  // 採択通知に載せるリンクと期限。ここが空だと採択通知は送れない作りなので、
  // **管理ページから直せる場所を用意しておく**（設定シートを開かせない）。
  { key: '確定情報フォームURL', label: '出店確定情報フォームのURL', type: 'url', allowBlank: true,
    help: '採択通知メールに載せるリンクです。採択された事業者が、当日の運営に必要な情報'
        + '（現場責任者・搬入車両など）を入力する画面。'
        + '**空だと採択通知を送れません。**' },
  { key: '素材アップロードURL', label: '素材アップロードのURL',     type: 'url', allowBlank: true,
    help: '採択通知メールに載せるリンクです。告知に使うロゴや写真を提出してもらう画面。'
        + '空のままでも採択通知は送れますが、リンクは載りません。' },
  { key: '確定情報の回収期限',   label: '確定情報の提出期限',
    type: 'date', allowBlank: true,
    help: '採択通知メールに「◯月◯日まで」と載る期限です。'
        + '空欄なら「出店可否のご連絡から5営業日以内」と書きます。'
        + 'この日を過ぎても入力は止まりません（催促の目安です）。' },
  { key: 'テストデータの削除',   label: 'テストデータの一括削除を許可', type: 'onoff',
    help: 'ONにすると、出店者一覧に「テストデータの一括削除」が現れます。'
        + '応募・確定情報・変更履歴・区画の割当・提出物をまとめて**完全に消します**。'
        + '**元に戻せません。公開前の掃除にだけ使ってください。**'
        + '消す直前に台帳の控えをDriveに作ります。実行すると自動でOFFに戻ります。' },
  { key: '素材の提出期限',       label: '素材（ロゴ・写真）の提出期限',
    type: 'date', allowBlank: true,
    help: '素材アップロード画面に「◯月◯日まで」と出る期限です。'
        + '空欄なら期限を表示しません。この日を過ぎても提出は止まりません。' },
];

var PASSWORD_KEYS_ = [
  { key: '管理者パスワード', label: '管理者パスワード' },
  { key: '一般パスワード',   label: '一般パスワード' },
];

function adminSettings_(auth) {
  var out = { ok: true, values: {}, passwords: [], minPasswordLength: MIN_PASSWORD_LEN };
  SETTING_KEYS_.forEach(function (d) {
    out.values[d.key] = configText(d.key, '');
  });
  out.fields = SETTING_KEYS_;

  PASSWORD_KEYS_.forEach(function (d) {
    // 値そのものは返さない。設定済みか、長さが足りているかだけ
    var v = configText(d.key, '');
    out.passwords.push({
      key: d.key, label: d.label,
      set: !!v,
      weak: !!v && v.length < MIN_PASSWORD_LEN,
    });
  });

  // いま何区画が割り当て済みか（総数を減らすときの歯止めに使う）
  try {
    var sp = sheet_(SHEET.SPACES);
    var vals = sp.getDataRange().getValues();
    var head = vals[0].map(function (h) { return String(h).trim(); });
    var iNo = head.indexOf('区画番号'), iId = head.indexOf('割当受付ID');
    var maxAssigned = 0;
    for (var i = 1; i < vals.length; i++) {
      if (String(vals[i][iId] || '').trim()) {
        maxAssigned = Math.max(maxAssigned, Number(vals[i][iNo]) || 0);
      }
    }
    out.maxAssignedSpace = maxAssigned;
  } catch (e) { out.maxAssignedSpace = 0; }

  return out;
}

/** 1件ぶんの値を確かめる。通れば正規化した値、通らなければ message を返す */
function checkSetting_(def, raw) {
  var v = String(raw === undefined || raw === null ? '' : raw).trim();

  if (def.type === 'deadline') {
    if (!v) return { message: '応募の締切は空にできません（空だと受付が止まります）。' };
    var m = v.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2}):(\d{2})/);
    if (!m) {
      return { message: '応募の締切は「2026-09-30 18:00」の形でご入力ください。'
                      + '（読み取れない書き方だと、その時点で受付が止まります）' };
    }
    var mo = Number(m[2]), da = Number(m[3]), ho = Number(m[4]), mi = Number(m[5]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31 || ho > 23 || mi > 59) {
      return { message: '応募の締切の日時が正しくありません。' };
    }
    return { value: m[1] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + da).slice(-2)
                   + ' ' + ('0' + ho).slice(-2) + ':' + ('0' + mi).slice(-2) };
  }

  if (def.type === 'url') {
    if (!v) {
      if (def.allowBlank) return { value: '' };
      return { message: def.label + 'は空にできません。' };
    }
    // https のみ。http だと、リンクを踏んだ事業者の画面に警告が出る
    if (!/^https:\/\/[^\s]+$/.test(v)) {
      return { message: def.label + 'は https:// から始まるURLでご入力ください。' };
    }
    if (v.length > 300) return { message: def.label + 'が長すぎます。' };
    return { value: v };
  }

  if (def.type === 'date') {
    if (!v) {
      if (def.allowBlank) return { value: '' };
      return { message: def.label + 'は空にできません。' };
    }
    var dm = v.match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})$/);
    if (!dm) return { message: def.label + 'は「2026-10-10」の形でご入力ください。' };
    var dmo = Number(dm[2]), dda = Number(dm[3]);
    if (dmo < 1 || dmo > 12 || dda < 1 || dda > 31) {
      return { message: def.label + 'の日付が正しくありません。' };
    }
    return { value: dm[1] + '-' + ('0' + dmo).slice(-2) + '-' + ('0' + dda).slice(-2) };
  }

  if (def.type === 'int') {
    if (!v) {
      if (def.allowBlank) return { value: '' };
      return { message: def.label + 'は空にできません。' };
    }
    // 読み取りは gas/Num.gs に寄せる。ここだけ Number() を直に呼んでいたので、
    // 全角の「５０」が断られ、「1e2」が 100 として通っていた
    var n = numCount_(v);
    if (n === null) {
      return { message: def.label + 'は整数でご入力ください（' + numWhy_(v) + '）。' };
    }
    if (n < def.min || n > def.max) {
      return { message: def.label + 'は' + def.min + '〜' + def.max + 'の範囲でご入力ください。' };
    }
    return { value: String(n) };
  }

  if (def.type === 'onoff') {
    if (v !== 'ON' && v !== 'OFF') return { message: def.label + 'は ON か OFF です。' };
    return { value: v };
  }

  if (def.type === 'email') {
    if (!v) return { message: def.label + 'は空にできません。' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return { message: def.label + 'の形をご確認ください。' };
    }
    return { value: v };
  }

  return { message: '不明な項目です。' };
}

function adminSettingsSave_(auth, payload) {
  var values = (payload && payload.values) || {};
  var passwords = (payload && payload.passwords) || {};
  if (typeof values !== 'object' || Array.isArray(values)) return { ok: false, error: 'bad_request' };

  var defs = {};
  SETTING_KEYS_.forEach(function (d) { defs[d.key] = d; });

  // 先に全部確かめる。1つでも通らなければ、1件も書かない
  var checked = [];
  var keys = Object.keys(values);
  for (var i = 0; i < keys.length; i++) {
    var def = defs[keys[i]];
    if (!def) {
      return { ok: false, error: 'forbidden_field',
        message: 'この画面から変更できない項目です: ' + keys[i] };
    }
    var r = checkSetting_(def, values[keys[i]]);
    if (r.message) return { ok: false, error: 'bad_value', message: r.message };
    checked.push({ def: def, value: r.value });
  }

  // 区画の総数を、割り当て済みより小さくしない
  for (var j = 0; j < checked.length; j++) {
    if (checked[j].def.key !== '区画総数') continue;
    var info = adminSettings_(auth);
    if (info.maxAssignedSpace && Number(checked[j].value) < info.maxAssignedSpace) {
      return { ok: false, error: 'bad_value',
        message: '区画の総数を' + checked[j].value + 'にすると、'
               + 'すでに割り当て済みの' + info.maxAssignedSpace + '番が消えてしまいます。' };
    }
  }

  // パスワードは別扱い。長さを満たさないものは受けない
  var pwToSet = [];
  var pwKeys = Object.keys(passwords);
  for (var k = 0; k < pwKeys.length; k++) {
    var pk = pwKeys[k];
    if (pk !== '管理者パスワード' && pk !== '一般パスワード') {
      return { ok: false, error: 'forbidden_field', message: 'この項目は変更できません: ' + pk };
    }
    var pv = String(passwords[pk] || '');
    if (!pv) continue;                       // 空欄は「変えない」の意味
    if (pv.length < MIN_PASSWORD_LEN) {
      return { ok: false, error: 'weak_password',
        message: pk + 'は' + MIN_PASSWORD_LEN + '文字以上にしてください。'
               + '（短いと管理ページが開けなくなります）' };
    }
    if (pv.length > 200) {
      return { ok: false, error: 'too_long', message: pk + 'が長すぎます。' };
    }
    pwToSet.push({ key: pk, value: pv });
  }

  if (!checked.length && !pwToSet.length) {
    return { ok: true, changed: 0, message: '変更はありませんでした。' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(SHEET.CONFIG);
    var changed = [];

    checked.forEach(function (c) {
      var row = findConfigRow_(sh, c.def.key);
      if (!row) return;
      var before = String(sh.getRange(row, 2).getValue() == null ? '' : sh.getRange(row, 2).getValue());
      if (before === c.value) return;
      sh.getRange(row, 2).setValue(safeCellText_(c.value));
      changed.push({ item: c.def.label, before: before, after: c.value });
    });

    pwToSet.forEach(function (pw) {
      var row = findConfigRow_(sh, pw.key);
      if (!row) return;
      sh.getRange(row, 2).setValue(pw.value);
      // **値は履歴に残さない。** 履歴は一般も見られる
      changed.push({ item: pw.key, before: '（省略）', after: '（変更しました）' });
    });

    SpreadsheetApp.flush();
    var histError = recordHistory_(auth.person, '（設定）', changed,
      String((payload && payload.reason) || '').slice(0, REASON_MAX));

    return {
      ok: !histError,
      error: histError ? 'history_failed' : undefined,
      changed: changed.length,
      items: changed.map(function (c) { return c.item; }),
      // パスワードを変えると、自分も含めて全員が入り直しになる
      passwordChanged: pwToSet.length > 0,
      message: histError
        ? '設定は保存しましたが、変更履歴に残せませんでした（' + histError + '）。'
        : undefined,
    };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────── 確認事項（ToDo）
/**
 * 打ち合わせで出た「これは確認します」を残す場所。
 *
 * 一般も書けて、一般も完了にできる。持ち帰った宿題は誰の手元にもあるので、
 * 管理者だけが触れる形にすると、結局シートを直接開くことになって形骸化する。
 * 代わりに「誰が起票したか」を必ず残す。
 */
var TODO_STATES_ = ['未着手', '確認中', '完了'];
var TODO_TEXT_MAX = 500;

function todoRows_() {
  var sh = sheet_(SHEET.TODO);
  if (sh.getLastRow() < 2) return { sheet: sh, headers: [], rows: [] };
  var values = sh.getDataRange().getValues();
  return { sheet: sh,
           headers: values[0].map(function (h) { return String(h).trim(); }),
           rows: values.slice(1) };
}

function adminTodos_(auth) {
  var T = todoRows_();
  if (!T.headers.length) return { ok: true, rows: [] };
  var idx = {};
  T.headers.forEach(function (h, i) { idx[h] = i; });

  var out = [];
  for (var i = 0; i < T.rows.length; i++) {
    var r = T.rows[i];
    var text = asText_(r[idx['内容']]).trim();
    if (!text) continue;
    out.push({
      row: i + 2,
      state: asText_(r[idx['状態']]).trim() || '未着手',
      text: text,
      owner: asText_(r[idx['担当']]).trim(),
      due: asText_(r[idx['期日']]).trim(),
      author: asText_(r[idx['起票者']]).trim(),
      createdAt: asText_(r[idx['起票日']]).trim(),
      doneAt: asText_(r[idx['完了日']]).trim(),
      memo: asText_(r[idx['メモ']]).trim(),
    });
  }
  return { ok: true, rows: out };
}

/** 期日は「2026-09-08」の形にそろえる。空欄は空欄のまま */
function normalizeDue_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return { value: '' };
  var m = s.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) {
    // 「9/8」のように年が無い書き方も受ける（今年として扱う）
    var m2 = s.match(/^(\d{1,2})\D(\d{1,2})$/);
    if (!m2) return { message: '期日は「2026-09-08」の形でご入力ください。' };
    m = [null, String(new Date().getFullYear()), m2[1], m2[2]];
  }
  var mo = Number(m[2]), da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) {
    return { message: '期日の日付が正しくありません。' };
  }
  return { value: m[1] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + da).slice(-2) };
}

function adminTodoSave_(auth, payload) {
  var row = Number(payload && payload.row) || 0;     // 0 なら新規
  var t = (payload && payload.todo) || {};

  var text = String(t.text || '').trim();
  if (!text) return { ok: false, error: 'bad_value', message: '内容をご記入ください。' };
  if (text.length > TODO_TEXT_MAX) {
    return { ok: false, error: 'too_long',
      message: '内容は' + TODO_TEXT_MAX + '文字までです。' };
  }
  var state = String(t.state || '未着手').trim();
  if (TODO_STATES_.indexOf(state) < 0) {
    return { ok: false, error: 'bad_value', message: '状態が正しくありません。' };
  }
  var due = normalizeDue_(t.due);
  if (due.message) return { ok: false, error: 'bad_value', message: due.message };

  var owner = String(t.owner || '').trim().slice(0, 60);
  var memo = String(t.memo || '').trim().slice(0, TODO_TEXT_MAX);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    var T = todoRows_();
    var sh = T.sheet;
    var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

    if (!row) {
      // 起票者は名乗らせない。入室している人の名前を必ず使う
      sh.appendRow([state, safeCellText_(text), safeCellText_(owner), due.value,
                    safeCellText_(auth.person), today,
                    state === '完了' ? today : '', safeCellText_(memo)]);
      SpreadsheetApp.flush();
      appendHistory(auth.person, '（確認事項）', '追加', '', text, '');
      return { ok: true, added: true };
    }

    if (row < 2 || row > sh.getLastRow()) return { ok: false, error: 'not_found' };
    var before = sh.getRange(row, 1, 1, 8).getValues()[0];
    var wasDone = String(before[0]).trim() === '完了';
    var doneAt = asText_(before[6]).trim();
    if (state === '完了' && !wasDone) doneAt = today;
    if (state !== '完了') doneAt = '';

    sh.getRange(row, 1, 1, 8).setValues([[
      state, safeCellText_(text), safeCellText_(owner), due.value,
      asText_(before[4]),                 // 起票者は変えない
      asText_(before[5]),                 // 起票日も変えない
      doneAt, safeCellText_(memo),
    ]]);
    SpreadsheetApp.flush();

    if (String(before[0]).trim() !== state) {
      appendHistory(auth.person, '（確認事項）', text,
                    String(before[0]).trim(), state, '');
    }
    return { ok: true, added: false };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────── 問い合わせメール（管理者のみ）
/**
 * 実行委員会アドレス宛のメールを、管理ページから見る。
 *
 * ■ なぜ管理者だけか
 *   この仕組みは**けいたさんの受信箱**を読む権限で動いている。
 *   検索条件を間違えれば、イベントと無関係な私信まで公開URLの画面に出せてしまう。
 *   一般パスワードはFC大阪営業に広く配るものなので、ここは開かない。
 *
 * ■ 検索条件を画面から受け取らない
 *   条件を渡せるようにすると、それは「受信箱を自由に検索できるAPI」になる。
 *   宛先は設定シートの問い合わせアドレスに固定し、期間と件数だけを絞る。
 *
 * ■ 本文は返さない
 *   冒頭の抜粋（snippet）とGmailへのリンクだけを返す。
 *   全文を公開URLの画面に流し込む必要はないし、流すと戻せない。
 */
var INBOX_MAX = 30;
var INBOX_DAYS = 60;

function adminInbox_(auth) {
  var addr = configText('問い合わせメール', '');
  if (!addr) {
    return { ok: true, rows: [], message: '設定シートの「問い合わせメール」が空です。' };
  }

  // 宛先は固定。画面から検索条件は受け取らない
  var q = 'to:' + addr + ' newer_than:' + INBOX_DAYS + 'd';
  var threads;
  try {
    threads = GmailApp.search(q, 0, INBOX_MAX);
  } catch (e) {
    logError_('adminInbox_', e);
    return { ok: false, error: 'gmail_failed',
      message: 'メールを読み取れませんでした。権限の承認が必要な可能性があります。' };
  }

  var rows = threads.map(function (th) {
    var msgs = th.getMessages();
    var last = msgs[msgs.length - 1];
    var first = msgs[0];
    // 最後の1通がこちらから出たものなら「返信済み」とみなす
    var lastFromUs = String(last.getFrom() || '').toLowerCase().indexOf(addr.toLowerCase()) >= 0;
    return {
      id: th.getId(),
      subject: th.getFirstMessageSubject() || '（件名なし）',
      from: first.getFrom(),
      at: Utilities.formatDate(th.getLastMessageDate(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
      count: msgs.length,
      unread: th.isUnread(),
      replied: lastFromUs,
      snippet: String(last.getPlainBody() || '').replace(/\s+/g, ' ').slice(0, 160),
      url: th.getPermalink(),
    };
  });

  return { ok: true, rows: rows, address: addr, days: INBOX_DAYS };
}

function adminDispatch_(payload) {
  var action = payload.action;

  // 認証の前に通す2つ。ここ以外は必ずトークンを要求する
  if (action === 'adminNames') return adminNames_(payload);
  if (action === 'adminLogin') return adminLogin_(payload);

  var v = verifyTokenDetail_(payload && payload.token);
  if (!v.auth) {
    return { ok: false, error: 'unauthorized',
             reason: v.reason, message: authMessage_(v.reason) };
  }
  var auth = v.auth;

  // 管理者だけの操作
  // 受信箱を読む権限で動くので、問い合わせの閲覧も管理者だけに限る
  // 採択通知は取り消せないので、管理者だけに限る（仕様書§6-1の権限表）
  var adminOnly = ['adminPeople', 'adminPeopleSave', 'adminSettings', 'adminSettingsSave',
                   'adminInbox', 'adminNotifyPreview', 'adminNotifySend',
                   // 資料の削除は管理者のみ（一覧と追加は一般もできる・§6-1）
                   'adminDocsDelete', 'adminPurgePreview', 'adminPurgeRun',
                   'adminConfirmSave',
                   // 単価はお金の話。一般権限には触らせない
                   'adminRental', 'adminRentalSave', 'adminRentalDisable',
                   // 文面を変えると、50社に届く文が変わる。管理者だけに限る
                   'adminMailTemplate', 'adminMailTemplateSave', 'adminMailTemplateReset'];
  if (adminOnly.indexOf(action) >= 0 && auth.role !== '管理者') {
    return { ok: false, error: 'forbidden', message: 'この操作は管理者のみです。' };
  }

  switch (action) {
    case 'adminSummary':  return adminSummary_(auth);
    case 'adminList':     return adminList_(auth);
    case 'adminDetail':   return adminDetail_(auth, payload);
    case 'adminUpdate':   return adminUpdate_(auth, payload);
    case 'adminSpaces':   return adminSpaces_(auth);
    case 'adminAssign':   return adminAssign_(auth, payload);
    case 'adminUnassign': return adminUnassign_(auth, payload);
    case 'adminApplicantFields': return adminApplicantFields_(auth);
    case 'adminApplicantUpdate': return adminApplicantUpdate_(auth, payload);
    case 'adminHistory':    return adminHistory_(auth, payload);
    case 'adminInbox':      return adminInbox_(auth);
    case 'adminTodos':      return adminTodos_(auth);
    case 'adminTodoSave':   return adminTodoSave_(auth, payload);
    // 制作スケジュール。**adminOnly には入れない**（全員が触れる・けいた確定）。
    // 管理者だけにすると、結局シートを直接開くことになって形骸化する
    case 'adminSched':       return adminSched_(auth);
    case 'adminSchedSave':   return adminSchedSave_(auth, payload);
    case 'adminSchedDelete': return adminSchedDelete_(auth, payload);
    // ② タイムスケジュール。①と同じく **adminOnly には入れない**（全員が触れる）。
    // 削除の action が無いのは、保存が「まるごと差し替え」だから
    // （消したい行を外して保存する。§3-3）
    case 'adminTimetable':          return adminTimetable_(auth);
    case 'adminTimetableSave':      return adminTimetableSave_(auth, payload);
    case 'adminTimetableHeartbeat': return adminTimetableHeartbeat_(auth);
    // 書き出しは①②で共通（gas/Export.gs）。**adminOnly には入れない**
    case 'adminTimetableExport':    return adminTimetableExport_(auth);
    case 'adminSchedExport':        return adminSchedExport_(auth);
    // Excelの取り込み。①は全員が触れるので **adminOnly には入れない**
    case 'adminSchedImportRead':   return adminSchedImportRead_(auth, payload);
    case 'adminSchedImportApply':  return adminSchedImportApply_(auth, payload);
    case 'adminConfirmSave':  return adminConfirmSave_(auth, payload);
    case 'adminMailTemplate':      return adminMailTemplate_(auth, payload);
    case 'adminMailTemplateSave':  return adminMailTemplateSave_(auth, payload);
    case 'adminMailTemplateReset': return adminMailTemplateReset_(auth, payload);
    case 'adminRental':        return adminRental_(auth);
    case 'adminRentalSave':    return adminRentalSave_(auth, payload);
    case 'adminRentalDisable': return adminRentalDisable_(auth, payload);
    case 'adminPurgePreview': return adminPurgePreview_(auth);
    case 'adminPurgeRun':     return adminPurgeRun_(auth, payload);
    case 'adminSettings':     return adminSettings_(auth);
    case 'adminSettingsSave': return adminSettingsSave_(auth, payload);
    case 'adminPeople':     return adminPeople_(auth);
    case 'adminPeopleSave': return adminPeopleSave_(auth, payload);
    case 'adminDocs':       return adminDocs_(auth);
    case 'adminDocsUpload': return adminDocsUpload_(auth, payload);
    case 'adminDocsDelete': return adminDocsDelete_(auth, payload);
    case 'adminNotifyPreview': return adminNotifyPreview_(auth, payload);
    case 'adminNotifySend':    return adminNotifySend_(auth, payload);
    case 'adminWhoami':   return { ok: true, person: auth.person, role: auth.role };
    default:              return { ok: false, error: 'unknown_action' };
  }
}
