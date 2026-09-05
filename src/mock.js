/**
 * 管理ページを、本番に触らずに動かして確かめるための模擬サーバー（開発用）。
 *
 *   node src/mock.js  →  http://localhost:4174/admin.html
 *   パスワード: admin（管理者） / staff（一般）
 *
 * ■ なぜ要るか
 *   管理ページのAPIはGASにある。GASへの反映と再デプロイは、
 *   仕様書§14-2でけいたの承認が要る操作なので、承認前に本番へ入れられない。
 *   一方で「画面が本当に動くか」は、動かしてみないと分からない。
 *   そこで、GASと同じ形で応答する模擬サーバーをこちらに置く。
 *
 * ■ 注意
 *   これは**開発用**であって、本番の代わりではない。
 *   ここで動いたからといってGAS側が動く保証にはならない。
 *   GAS側のロジック（Auth.gs / Admin.gs）は別途テストで担保する。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const S = require('./schema.js');
/** 履歴の日時。本番と同じ見え方にする */
// 本番（gas/*.gs）は Utilities.formatDate で 'yyyy-MM-dd HH:mm'。
// ここが 'ja-JP' だったので、変更履歴に「2026/9/4 3:38:15」と「2026-09-16 18:40」が
// 並んでいた（2026-09-04 の最終確認で指摘）
const nowText = () =>
  new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16);
const PORT = 4174;
const SECRET = crypto.randomBytes(32).toString('hex');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.json': 'application/json',
  '.pdf': 'application/pdf' };

// ──────────────────────────────────────────── 模擬データ
const PEOPLE = [
  { row: 2, name: '山田 太郎', org: 'FC大阪', dept: '事業推進部', email: 'yamada@example.com',
    formVisible: true, canLogin: true, role: '管理者', notify: true },
  { row: 3, name: '佐藤 花子', org: 'FC大阪', dept: '営業部', email: 'sato@example.com',
    formVisible: true, canLogin: true, role: '一般', notify: false },
  { row: 4, name: '鈴木 一郎', org: 'FC大阪', dept: '営業部', email: 'suzuki@example.com',
    formVisible: true, canLogin: false, role: '一般', notify: false },
];

const TYPES_JA = ['飲食', 'ワークショップ', '展示', '体験コンテンツ', 'その他'];

/**
 * 模擬データの1行。
 *
 * 列名は src/schema.js の ledgerHeaders() が返す**実在の名前**を使う。
 * ここを勝手な名前で作ると、模擬では正しく見えるのに本番では
 * 「無い列」を引いて黙って0が並ぶ。実際に一度そうなった。
 */
const SCHEMA = require('./schema.js');
const LEDGER_HEADERS = SCHEMA.ledgerHeaders();

/** 選択肢は schema.js から取る。**手で書き写すと、選択肢を変えたときに古くなる** */
const optsOf = key => (SCHEMA.FIELDS.filter(f => f.key === key)[0] || {}).options || [];
const PACK_OPTS = optsOf('packaging');
const WARE_OPTS = optsOf('tableware');

function mkRow(i, over) {
  const id = 'SB-' + String(i).padStart(4, '0');
  const base = {
    '受付ID': id,
    // **今日から遡って作る。** 固定の日付を書いていたので、
    // 今日より先の受付日時になり「まだ来ていない応募が審査中」に見えていた
    //（2026-09-04 の最終確認で指摘）
    '受付日時': (function () {
      const d = new Date(Date.now() - (i % 8 + 1) * 86400000);
      return d.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16);
    })(),
    // 採択を多めに混ぜる。1件しか無いと、採択通知の一括送信を
    // 「1件だけ送る」形でしか試せず、件数の歯止めも上限も確かめられない。
    // ステータスと出店形態は、**採択かつ飲食**の行が必ず含まれるように組む。
    // 確定情報フォームの火気・保険は「飲食のみ」なので、その組み合わせが
    // 1つも無いと、条件つきの必須を模擬で一度も試せない（実際そうなっていた）。
    'ステータス': ['未確認', '採択', '採択', '審査中', '採択', '不採択', '採択', '審査中'][i % 8],
    '企業名': ['株式会社ひがしや', '大阪フードサービス', 'まちのパン工房',
               'グリーンテック株式会社', '東大阪商店会', 'こども工作クラブ',
               '和菓子処 花園', 'リサイクルラボ'][i % 8],
    '出店名': ['焼きそば ひがしや', '唐揚げキッチン', '窯焼きパン', '再エネ体験ブース',
               '商店会PRコーナー', '工作ワークショップ', 'どら焼き実演', 'リユース食器展示'][i % 8],
    '担当者氏名': ['田中 健', '中村 美咲', '小林 大輔'][i % 3],
    // 1件だけ宛先の形を壊しておく。
    // 「この行は送信されません」という警告が本当に出るかを、模擬でも試せるようにする。
    '担当者メール': i === 6 ? 'test6(at)example.com' : 'test' + i + '@example.com',
    '担当者電話': '06-1234-' + String(1000 + i),
    'FC大阪担当社員': ['佐藤 花子', '鈴木 一郎', 'その他'][i % 3],
    // i%8 が 1/2/4/6 のとき採択。そのうち 2 と 4 を飲食にする
    '出店形態': [(i % 8 === 2 || i % 8 === 4) ? '飲食' : TYPES_JA[i % 5],
                 i % 3 === 0 ? TYPES_JA[(i + 2) % 5] : ''].filter(Boolean).join('、'),
    '主形態': (i % 8 === 2 || i % 8 === 4) ? '飲食' : TYPES_JA[i % 5],
    '出店内容': '当日の出店内容の説明が入ります。',
    '営業許可': i % 5 === 0 ? '取得済み' : (i % 5 === 1 ? 'これから申請する' : ''),
    // 2026-09-02 に「食器・包材」は「包材の用意」と「食器」に分かれた。
    // **模擬が古い列名のままだった**ので、ダッシュボードの
    // 「包材の用意（サステナ報告用）」が空の箱になっていた
    //（2026-09-04 の最終確認で発見）。
    // schema.js の options から選ぶので、選択肢を変えてもここは古くならない
    '包材の用意': PACK_OPTS[i % PACK_OPTS.length],
    '食器': WARE_OPTS[i % WARE_OPTS.length],
    'サステナ取り組み': i % 3 === 0 ? '地元産の食材を使用しています。' : '',
    '希望区画': i % 4 === 0 ? '間口3間×奥行2間（2区画／約5.4m×3.6m）'
                            : '間口1.5間×奥行2間（1区画／約2.7m×3.6m）',
    'テント': i % 3 === 0 ? 'レンタルする' : '持ち込む',
    'テントサイズ': i % 3 === 0 ? (i % 4 === 0 ? '間口3間×奥行2間（約5.4m×3.6m）'
                                               : '間口1.5間×奥行2間（約2.7m×3.6m）') : '',
    'レンタル明細': [i % 3 ? '長机（1800×450） × ' + (i % 3) + '台' : '',
                     i % 4 ? 'パイプ椅子 × ' + (i % 4) + '脚' : '']
                    .filter(Boolean).join(' ／ '),
    'レンタル合計(円)': String((i % 3) * 1000 + (i % 4) * 500),
    // 集計は生データから行うので、模擬データにも入れておく。
    // ここが空だと「集計が動いていない」ことに気づけない
    '生データ(JSON)': JSON.stringify({
      rentalItems: Object.assign({},
        i % 3 ? { '長机（1800×450）': i % 3 } : {},
        i % 4 ? { 'パイプ椅子': i % 4 } : {}),
    }),
    '電源': ['必要（発電機を持ち込む）', 'レンタルを希望する', '不要'][i % 3],
    '発電機燃料': i % 3 === 0 ? 'ガソリン' : '',
    '合計消費電力(W)': i % 3 === 2 ? '' : String(500 + i * 120),
    '消費電力不明': i === 6 ? 'わからない' : '',
    '担当メモ': '',
    '割当開始区画': '', '割当区画数': '',
    '搬入予定時刻': '', '撤収予定時刻': '', '当日ステータス': '',
    '重複フラグ': i === 4 ? '同一メール' : '',
    '採択通知送信日時': '',
  };
  // 台帳にある列は必ず持たせる（本番と同じ形にする）
  LEDGER_HEADERS.forEach(h => { if (!(h in base)) base[h] = ''; });
  return Object.assign(base, over || {});
}

const DB = {
  rows: Array.from({ length: 8 }, (_, k) => mkRow(k + 1)),
  spaces: Array.from({ length: 50 }, (_, k) => {
    const t = k / 50 * Math.PI * 2 - Math.PI / 2;
    return { no: k + 1, x: Math.round(Math.cos(t) * 1000) / 1000,
             y: Math.round(Math.sin(t) * 1000) / 1000, id: '' };
  }),
  // 変更履歴の見本。空だと「履歴が消えたか」を確かめられない
  history: [
    { at: '2026-09-16 18:40', who: '山田 太郎', id: 'SB-0004', item: 'ステータス',
      before: '未確認', after: '審査中', reason: '' },
    { at: '2026-09-15 09:12', who: '出店者（本人）', id: 'SB-0002', item: '担当者電話',
      before: '06-1234-1002', after: '090-2222-3333', reason: '担当者の変更' },
  ],
  // 出店確定情報の登録内容（受付ID → { values, at }）
  // 採択後に集めた情報の見本。**出た状態を一度も見ないまま公開しない**ため
  confirm: {
    'SB-0001': { at: '2026-10-05 14:20', values: {
      fireUse: ['カセットコンロ'], fireExtinguisher: '持参する',
      insurance: '加入している',
      siteManagerName: '田村 恵子', siteManagerPhone: '090-1111-2222',
      backupPhone: '06-6000-0000',
      vehicleCount: 1, vehicleType: '軽トラック', vehicleHeight: '2.0m',
      vehiclePlate: '1234', parkingRequest: '希望する',
      loadInSlot1: '9:30〜10:00', loadInSlot2: '10:00〜10:30',
      staffCount: 4, rainPolicy: '実施する', notes: '発電機は持参します。',
      passCount: 4, parkingPassCount: 1, ticketCount: 6,
    } },
  },
  // 資料置き場と素材提出（Driveの代わり。中身は持たず、名前と大きさだけ）
  // 『（未分類）』はフォルダの一番上に置かれたもの。人は区分に入れずここに置く。
  // 実際、けいたが最初に置いた企画書がここにあった。
  docs: {
    '（未分類）': [{ id: 'mock-root-1', name: 'FC大阪様サステナ盆踊り企画.pptx',
                     size: 3631665, sizeText: '3.5 MB', updated: '2026-09-01 21:07',
                     url: 'https://drive.google.com/file/d/mock/view', folder: '（未分類）' }],
    '図面': [], '議事録': [], 'その他': [] },
  vendorFiles: {},   // 受付ID → [{ id, name, size, ... }]
  // 制作スケジュール。遅れ・今週・来週・それ以降が1つずつ出るように置く
  sched: [
    { kind: '期間', date: '2026-09-01', endDate: '2026-09-30', area: '営業',
      companies: ['FC大阪'], people: ['山田 太郎'], title: '出店の募集期間',
      detail: '', status: '', memo: '', doneDate: '',
      author: '山田 太郎', createdAt: '2026-08-20', updatedBy: '', updatedAt: '' },
    { kind: 'タスク', date: '2026-08-28', area: '制作',
      companies: ['FC大阪'], people: ['佐藤 花子'], title: '会場図の最終版をもらう',
      detail: '詳細は https://example.com/kaijou を参照', status: '進行中', memo: '期日を過ぎた例',
      doneDate: '', author: '山田 太郎', createdAt: '2026-08-20', updatedBy: '', updatedAt: '' },
    { kind: 'タスク', date: '2026-09-12', area: '会議',
      companies: ['FC大阪'], people: ['山田 太郎'], title: '定例で電源の可否を確認',
      detail: '', status: '未着手', memo: '', doneDate: '',
      author: '山田 太郎', createdAt: '2026-09-01', updatedBy: '', updatedAt: '' },
    { kind: 'タスク', date: '2026-09-05', area: '制作',
      companies: ['LOP'], people: [], title: '募集要項の印刷手配',
      detail: '', status: '完了', memo: '', doneDate: '2026-09-04',
      author: '山田 太郎', createdAt: '2026-08-25', updatedBy: '', updatedAt: '' },
    { kind: 'マイルストーン', date: '2026-10-24', area: '全体',
      companies: [], people: [], title: '本番（夕照祭2026）',
      detail: '', status: '', memo: '', doneDate: '',
      author: '山田 太郎', createdAt: '2026-08-20', updatedBy: '', updatedAt: '' },
  ],
  todos: [
    { state: '未着手', text: '観戦チケットの枚数をFC大阪に確認する', owner: 'けいた',
      due: '2026-09-08', author: '山田 太郎', createdAt: '2026-09-01', doneAt: '', memo: '' },
    { state: '確認中', text: '来場者数の表記をFC大阪と調整する', owner: 'けいた',
      due: '2026-08-25', author: '山田 太郎', createdAt: '2026-08-20', doneAt: '', memo: '期日を過ぎた例' },
  ],
  settings: { '締切日時': '2026-09-30 18:00', '区画総数': '50', '目標出店社数': '',
              '要対応_経過日数': '3', 'スケジュールの警告日数': '3',
              '進行表の日付': '2026-10-24', '進行表の自動保存分': '3',
              '担当社員への結果通知': 'ON',
              '問い合わせメール': 'fcosaka_bondance@kreha-c.com',
              // ふだんはOFF（本番の既定と同じ）。模擬で通しを試すときにONにする
              'テストデータの削除': 'OFF',
              '事務局の連絡先': '実行委員会事務局（森本啓太／fcosaka_bondance@kreha-c.com）',
              // **入っている状態を既定にする。** 空だと採択メールの説明ができず、
              // 警告だけが出て「これは壊れているのか」と見える。
              // 空のときの挙動を試したいときは、設定タブで消してから試す
              '確定情報フォームURL': 'https://bondance.kreha-c.com/confirm.html',
              '素材アップロードURL': 'https://bondance.kreha-c.com/upload.html',
              '確定情報の回収期限': '2026-10-10' },
  // 編集したメール文面。null なら既定の文面（本番のシートが空の状態と同じ）
  mailTpl: { accept: null, reject: null },
};
// 1件だけ最初から割り当てておく（塗り分けと解除を確かめるため）
DB.rows[0]['割当開始区画'] = '3'; DB.rows[0]['割当区画数'] = '1';
DB.spaces[2].id = 'SB-0001';

const PRICES = { tentT1: 15000, tentT2: 30000 };
/** 数量で頼む備品。本番では台帳の「レンタル品目」シートが正 */
const RENTAL_ITEMS = [
  { name: '長机（1800×450）', price: 1000, unit: '台', max: 20, note: '' },
  { name: 'パイプ椅子',       price: 500,  unit: '脚', max: 40, note: '' },
];

/**
 * レンタル品目シートの代役。本番の列と同じ形で持つ。
 * 紙面（content.js の RENTALS）とのずれを、模擬でも試せるようにする。
 */
const C_ = require('./content.js');
const RENTAL_KINDS = ['テント（1区画）', 'テント（2区画）', '数量'];

/** 送れる通知の種類（本番の gas/Notify.gs NOTIFY_KINDS と同じ） */
// 外から来た文字列で引くので、素の {} にしない（本番 NOTIFY_KINDS と同じ）
const MAIL_KINDS = Object.assign(Object.create(null), {
  accept: { kind: 'accept', status: '採択', sentCol: '採択通知送信日時', label: '採択のご連絡' },
  reject: { kind: 'reject', status: '不採択', sentCol: '不採択通知送信日時', label: '不採択のご連絡' },
});
const rentalRows = [
  { row: 2, order: 1, kind: 'テント（1区画）',
    name: C_.RENTALS[0].label, price: C_.PRICES.tentT1, unit: '張', max: 1,
    w: 2.7, d: 3.6, active: true, note: '' },
  { row: 3, order: 2, kind: 'テント（2区画）',
    name: C_.RENTALS[1].label, price: C_.PRICES.tentT2, unit: '張', max: 1,
    w: 5.4, d: 3.6, active: true, note: '' },
].concat(RENTAL_ITEMS.map((r, i) => ({
  row: 4 + i, order: 3 + i, kind: '数量', name: r.name, price: r.price,
  unit: r.unit, max: r.max, w: 0, d: 0, active: true, note: r.note,
})));

/** 紙面に刷ってある料金表（本番の PUBLISHED_RENTALS と同じ作り方） */
const PUBLISHED = C_.RENTALS.map(r => ({
  label: r.label, unit: r.unit,
  price: r.key ? C_.PRICES[r.key] : r.price,
}));

function rentalPaperDiff() {
  const out = [];
  const paper = {};
  PUBLISHED.forEach(r => { paper[r.label] = r; });
  const live = {};
  rentalRows.forEach(it => {
    if (!it.active) return;
    if (typeof it.price !== 'number' || it.price <= 0) return;
    live[it.name] = it;
  });
  Object.keys(live).forEach(name => {
    const pp = paper[name];
    if (!pp) {
      out.push({ name, kind: 'added',
        message: '「' + name + '」は、募集要項PDFの料金表に載っていません。' });
      return;
    }
    if (Number(pp.price) !== Number(live[name].price)) {
      out.push({ name, kind: 'price',
        message: '「' + name + '」の単価が、紙面は ' + Number(pp.price).toLocaleString()
               + '円、いまのシートは ' + Number(live[name].price).toLocaleString() + '円です。' });
    }
  });
  Object.keys(paper).forEach(name => {
    if (live[name]) return;
    out.push({ name, kind: 'removed',
      message: '「' + name + '」は募集要項PDFに載っていますが、'
             + 'いまのフォームには出ていません（無効、または単価が未設定）。' });
  });
  return out;
}
const COLORS = { '飲食': '#F2A65A', 'ワークショップ': '#7FCAF1', '展示': '#9BD4A8',
                 '体験コンテンツ': '#C9A6D8', 'その他': '#B8B8B8' };
const STATUSES = ['未確認', '審査中', '採択', '不採択', '辞退', 'キャンセル', '重複（無効）'];
const DAY_STATUSES = ['未着', '搬入済', '設営完了', '撤収完了'];
/** 設定タブの項目（本番の gas/Admin.gs SETTING_KEYS_ と同じ） */
/**
 * 設定の一覧は**本番（gas/Admin.gs の SETTING_KEYS_）をそのまま読む**。
 *
 * ここに写しを置いていたら、6項目のまま取り残された。
 * あとから足した「確定情報フォームURL」「素材の提出期限」などが模擬に出ず、
 * さらに項目ごとの説明（help）も出なかった。
 * **模擬で見えないものは、確認したつもりで見落とす。**
 *
 * GAS のファイルは require できないので、配列リテラルだけを vm で読む。
 * 中身は文字列と数値だけなので、外に触れない箱で評価すれば安全。
 */
const SETTING_FIELDS = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'gas', 'Admin.gs'), 'utf8');
  const m = src.match(/var SETTING_KEYS_ = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('gas/Admin.gs の SETTING_KEYS_ を読めませんでした');
  return vm.runInNewContext('(' + m[1] + ')');
})();
/**
/**
 * 数の読み取りを、**本番のソースからそのまま借りる**（gas/Num.gs）。
 *
 * ここに写しを置いていたので、3つ（単価・枚数・合計）が揃っていなかった。
 * 揃っていないことに気づけたのは、点検役が3つ並べて実測したときだけだった
 * （2026-09-04）。写しがあるかぎり、同じことがまた起きる。
 */
const NUM = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'gas', 'Num.gs'), 'utf8');
  const box = { String, Number, RegExp, isFinite };
  vm.createContext(box);
  vm.runInContext(src, box);
  return box;
})();

/** 本番の名前に合わせた別名（模擬の中の呼び出しを変えずに済ませる） */
const confirmCount = t => NUM.numCount_(t);
const aggregateNumber = t => NUM.numAmount_(t);
const rentalNumber = raw => {
  const n = NUM.numAmount_(raw);
  return n === null ? { ok: false, why: NUM.numWhy_(raw) } : { ok: true, value: n };
};

/**
 * メール文面の仕組みを、**本番のソースからそのまま借りる**。
 *
 * 差し込みの一覧・既定の文面・置き換え・保存前の検査は、
 * 写しを作ると必ずどちらかが古くなる。
 * ここは「模擬が本番より緩い」が起きるといちばん困るところ
 * （不採択にリンクを入れさせない、という守りが入っている）。
 *
 * GAS のAPI（SpreadsheetApp など）は使わない関数だけを、外に触れない箱で読む。
 */
const MAILTPL = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'gas', 'MailTemplate.gs'), 'utf8');
  const want = ['MAILTPL_HEAD', 'MAILTPL_SUBJECT_MAX', 'MAILTPL_BODY_MAX',
                'MAILTPL_VARS_', 'mailtplSampleVars_', 'mailtplAllowedVars_',
                'mailtplAcceptOnlyVars_',
                'mailtplDefault_', 'mailtplDefaultAccept_', 'mailtplDefaultReject_',
                // 差し込みの値を作るところも借りる。ここだけ写しを持っていたので、
                // 差し込みを1つ足すと**模擬だけ {{…}} のまま出る**状態だった
                // （2026-09-04 の点検で指摘）
                'mailtplVars_',
                'mailtplRender_', 'mailtplFlatten_',
                'mailtplValidate_', 'mailtplWarnings_',
                'mailtplShort_'];
  const box = {
    Object, String, Number, Array, JSON, RegExp, console,
    // 検査の中で設定を1つ見ている。模擬の設定を渡す
    configText: (k, d) => (DB && DB.settings && DB.settings[k]) || d || '',
    // 差し込みの値を作るのに要るもの。本番では Mail.gs / Notify.gs にある
    EVENT_NAME: '夕照祭2026 FC大阪 秋のサステナ盆踊り',
    eventFactsBlock_: () => ['───────────────────────',
                             '開催日　：2026年10月24日（土）',
                             '会　場　：東大阪市花園ラグビー場（場外エリア）',
                             '搬　入　：9:30〜10:30',
                             '営業時間：11:00〜17:30',
                             '搬　出　：18:00〜19:00',
                             '───────────────────────'].join('\n'),
    signature_: () => ['', '──────────────────────',
                       'FC大阪サステナ盆踊り実行委員会',
                       'fcosaka_bondance@kreha-c.com'].join('\n'),
    // 本番 confirmDeadlineText_ と同じ書き方にする（「2026年10月10日まで」）。
    // 生の「2026-10-10」が見本に出ていた
    confirmDeadlineText_: () => {
      const raw = (DB && DB.settings && DB.settings['確定情報の回収期限']) || '';
      if (!raw) return '出店可否のご連絡から5営業日以内';
      const d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw);
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日まで';
    },
  };
  const cut = [];
  want.forEach(n => {
    const re = new RegExp('(?:^|\\n)(var ' + n + ' = [\\s\\S]*?;\\n|function ' + n
                          + '\\([\\s\\S]*?\\n\\}\\n)');
    const m = src.match(re);
    if (!m) throw new Error('gas/MailTemplate.gs の ' + n + ' を読めませんでした');
    cut.push(m[1]);
  });
  vm.createContext(box);
  vm.runInContext(cut.join('\n'), box);
  return box;
})();

/**
 * 制作スケジュールの検証を、**本番のソースからそのまま借りる**（gas/Sched.gs）。
 *
 * ここに写しを置くと、種類・領域・ステータスを1つ足したときに
 * **模擬だけ古い一覧のまま**になり、「模擬で通るのに本番で落ちる」が起きる。
 * gas/Sched.gs の上部は宣言だけなので、GASのAPIが無くても読める。
 */
const SCHED = (() => {
  // **改行を必ず正規化する。** gas/Admin.gs は CRLF なので、これが無いと
  // 目印が一致せず、切り出しが**空文字**になる。
  // 2026-09-04、そのせいで模擬の保存が100%「asText_ is not defined」で落ちていた
  // （それでもテスト832件は全部通っていた。模擬を通しで呼ぶ検査が無かったため）。
  const norm = t => t.split('\r\n').join('\n');
  const src = norm(fs.readFileSync(path.join(ROOT, 'gas', 'Sched.gs'), 'utf8'));
  const adminSrc = norm(fs.readFileSync(path.join(ROOT, 'gas', 'Admin.gs'), 'utf8'));
  // 検証が使う道具も本番から借りる（正規表現で切ると \s が1層落ちるので indexOf で切る）
  const cutFn = (code, name) => {
    const s = code.indexOf('function ' + name + '(');
    if (s < 0) throw new Error('gas/Admin.gs の ' + name + ' を読めませんでした');
    const e = code.indexOf('\n}\n', s) + 3;
    // 切り出せなかったら、その場で止める。**空文字のまま進むのがいちばん危ない**
    if (e <= s) throw new Error('gas/Admin.gs の ' + name + ' を切り出せませんでした');
    return code.slice(s, e);
  };
  const box = { Object, String, Number, Array, JSON, RegExp, Math, isFinite, Date, console };
  vm.createContext(box);
  vm.runInContext([cutFn(adminSrc, 'asText_'), cutFn(adminSrc, 'safeCellText_'),
                   cutFn(adminSrc, 'normalizeDue_')].join('\n'), box);
  vm.runInContext(src, box);
  return box;
})();

/**
 * ② タイムスケジュールは、**本番の gas/Timetable.gs を丸ごと動かす**。
 *
 * ①（SCHED）は検証の関数だけを借りて、保存の流れは模擬に写しを持っている。
 * そのせいで 2026-09-04、模擬の保存が100%落ちる状態に**誰も気づけなかった**
 * （切り出しが CRLF で空文字になっていた。テスト832件は全部通っていた）。
 *
 * ②は写しをひとつも持たない。シートだけを代役にして、
 * 読み・保存・券・版番号・札は**本番の関数がそのまま走る**。
 * 版のぶつかりは本番では試せないので、ここが唯一の確認手段になる（§7-6）。
 */
const TT = (() => {
  const norm = t => t.split('\r\n').join('\n');
  const G = require('./gasbox.js');
  const src = norm(fs.readFileSync(path.join(ROOT, 'gas', 'Timetable.gs'), 'utf8'));
  const adminSrc = norm(fs.readFileSync(path.join(ROOT, 'gas', 'Admin.gs'), 'utf8'));
  const authSrc = norm(fs.readFileSync(path.join(ROOT, 'gas', 'Auth.gs'), 'utf8'));
  const setupSrc = norm(fs.readFileSync(path.join(ROOT, 'gas', 'Setup.gs'), 'utf8'));

  const TT_HEADERS = ['ID', 'レーン', '開始', '所要分', 'タイトル', '出演者', '詳細', 'ロック', '並び順'];

  /** 見本の時間割。空だと「何を作る画面なのか」が伝わらない */
  const seed = [
    ['tt000001', '全体',     '09:30',  60, '設営・搬入', '', '出店者は9:30〜10:30に搬入', '', 1],
    ['tt000002', '全体',     '10:30',   0, 'ゲートオープン', '', '', 'TRUE', 2],
    ['tt000003', 'イベント', '11:00',  10, 'オープニングセレモニー', '○○市長', '', 'TRUE', 3],
    ['tt000004', 'イベント', '11:10',  30, '和太鼓ステージ', '△△和太鼓保存会', '', '', 4],
    ['tt000005', '備考',     '10:00',   0, '音響チェック', '', '', '', 5],
    ['tt000006', '備考',     '10:40',   0, '来賓到着', '○○市長', '控室へご案内', '', 6],
    ['tt000007', 'イベント', '13:00',  40, '盆踊り講習', '□□先生', '', '', 7],
    ['tt000008', '全体',     '17:30',   0, '営業終了', '', '', '', 8],
  ];

  const sheets = { 'タイムスケジュール': G.makeSheet(TT_HEADERS, seed) };

  /**
   * 設定シートの代役は、**DB.settings をそのまま映す**。
   * 写しを持つと、設定タブで変えた自動保存の間隔が進行表に届かない。
   */
  function configSheet() {
    const keys = () => Object.keys(DB.settings);
    return {
      getLastRow: () => keys().length + 1,
      getLastColumn: () => 3,
      getRange(row, col, nRows) {
        return {
          getValues: () => {
            const ks = keys();
            const out = [];
            for (let r = 0; r < (nRows || 1); r++) out.push([ks[row - 2 + r]]);
            return out;
          },
          getValue: () => {
            const k = keys()[row - 2];
            return col === 1 ? k : DB.settings[k];
          },
          setValue: v => { const k = keys()[row - 2]; if (k !== undefined) DB.settings[k] = v; },
        };
      },
      appendRow: line => { DB.settings[String(line[0])] = line[1]; },
    };
  }

  const cache = G.makeCache();
  const box = {
    Array, Object, String, Number, JSON, RegExp, Math, isFinite, parseInt, Boolean, Date,
    console: { error() {}, log() {} },
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    LOCK_WAIT_MS: 30000,
    CacheService: cache,
    Utilities: G.makeUtilities(),
    SHEET: { TIMETABLE: 'タイムスケジュール', CONFIG: '設定' },
    // 模擬の鍵。本番は gas/Auth.gs（パスワードの指紋を含む）
    authSecret_: () => 'mock-timetable-secret',
    sheet_: name => (name === '設定' ? configSheet() : sheets[name]),
    // 列名は who / id。**operator / receiptId ではない**（DB.history の形に合わせる）
    appendHistory: (operator, receiptId, item, before, after, reason) => {
      DB.history.unshift({ at: nowText(), who: operator, id: receiptId,
                           item, before, after, reason });
    },
    logError_: () => {},
    configNumber: key => {
      const v = DB.settings[key];
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      return isFinite(n) ? n : null;
    },
  };
  vm.createContext(box);
  // 切り出しは src/gasbox.js のもの。切り出せなければ**その場で止まる**
  // （空文字のまま進むのがいちばん危ない。2026-09-04 に①でそれが起きた）
  vm.runInContext([G.cutFunction(adminSrc, 'asText_'), G.cutFunction(adminSrc, 'safeCellText_'),
                   G.cutFunction(authSrc, 'safeEquals_'),
                   G.cutFunction(setupSrc, 'findConfigRow_')]
                  .join(String.fromCharCode(10)), box);
  vm.runInContext(src, box);
  return { box, sheets, cache };
})();

/**
 * 本番の関数を、模擬の中から呼ぶ。
 *
 * **返りは素の値に写す。** `vm.runInContext` の中で作られた配列・オブジェクトは
 * Node のものと別物で、`deepStrictEqual` が
 * 「同じ形だが同一ではない」と言って落ちる（引き継ぎ書§8）。
 * JSON にすると同じに見えるので、**HTTP越しには気づけない**。
 */
function ttCall(name, auth, payload) {
  TT.box.__auth = auth;
  TT.box.__payload = payload === undefined ? null : payload;
  const r = vm.runInContext(name + '(__auth, __payload)', TT.box);
  return r === undefined || r === null ? r : JSON.parse(JSON.stringify(r));
}

/** 行を見分ける印。本番の schedNewId_ と同じ 8桁 */
const schedNewIdMock = () => crypto.randomBytes(4).toString('hex');

/**
 * 「その行が、画面が編集していた行か」を確かめる。本番の schedFindRow_ と同じ考え方。
 *
 * 行番号だけで指すと、他人が1行消した瞬間に全部が繰り上がり、
 * **押した覚えのないタスクが消える／別の行が上書きされる**。
 * 行がずれただけならIDで探し直し、本当に消えていたときだけ断る。
 */
function schedFindMock(row, id) {
  const reload = '画面を読み込み直してから、もう一度お願いします。';
  id = (id == null ? '' : String(id)).trim();
  const i = row - 2;
  const ok = Number.isInteger(row) && i >= 0 && i < DB.sched.length;
  const here = ok ? String(DB.sched[i].id || '') : '';

  if (!ok) return { error: 'not_found', message: 'その行は見つかりませんでした。' + reload };
  if (id && here === id) return { i };
  if (!here && !id) return { i };
  if (!id) return { error: 'stale', message: 'この行を指し示せませんでした。' + reload };

  const j = DB.sched.findIndex(r => String(r.id || '') === id);
  if (j >= 0) return { i: j };
  return { error: 'moved',
           message: 'この行は、ほかの方が削除したようです。' + reload };
}

/** 関係者から「氏名 → 所属」を引く。本番の schedPeople_ が返すものと同じ形 */
function schedPeopleMock() {
  const byName = Object.create(null);
  const byCompany = Object.create(null);
  PEOPLE.forEach(p => {
    byName[p.name] = p.org || '';
    if (p.org) { if (!byCompany[p.org]) byCompany[p.org] = []; byCompany[p.org].push(p.name); }
  });
  return { byName, byCompany };
}

/** 画面に返してはいけない列（本番の gas/Admin.gs NEVER_SEND と同じ） */
const NEVER_SEND = ['生データ(JSON)', '素材トークン'];
const MAX_UNITS = 3;   // GAS側の MAX_UNITS と合わせる

// ──────────────────────────────────────────── 認証（GAS側と同じ形）
const sign = b => crypto.createHmac('sha256', SECRET).update(b).digest('base64url');

// パスワードの指紋。GAS側と同じく、パスワードが変わると既存トークンが失効する
const fingerprint = () => crypto.createHash('sha256')
  .update('pw|admin|staff').digest('base64url').slice(0, 16);

function issue(person, role) {
  const body = Buffer.from(JSON.stringify({
    p: person, r: role, e: Date.now() + 30 * 86400000, f: fingerprint(),
  })).toString('base64url');
  return body + '.' + sign(body);
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [b, s] = token.split('.');
  if (sign(b) !== s) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (p.e < Date.now()) return null;
    if (p.f !== fingerprint()) return null;
    const me = PEOPLE.find(x => x.name === p.p);
    if (!me) return null;
    return { person: me.name, role: me.role === '管理者' && p.r === '管理者' ? '管理者' : '一般' };
  } catch (e) { return null; }
}

// ──────────────────────────────────────────── API
function summary(auth) {
  const rows = DB.rows;
  const byStatus = {}; STATUSES.forEach(s => byStatus[s] = 0);
  // byTent / byPack を集めていなかったので、ダッシュボードの内訳に
  // **空の箱が2つ**並んでいた（2026-09-04 の最終確認で発見）。
  // 「包材の用意（サステナ報告用）」が空なのは、この催しの売りが壊れて見える
  const byStaff = {}, byType = {}, bySize = {}, byPower = {},
        byTent = {}, byPack = {};
  let fire = 0, vehicles = 0, parking = 0, staffTotal = 0, rainDecline = 0;
  let powerWatt = 0, powerUnknown = 0, assigned = 0, dup = 0, unconfirmed = 0;
  const rental = { tentT1: 0, tentT2: 0 };
  const rentalQty = {};   // 品目名 → 合計個数（本番と同じく生データから集める）
  let revenue = 0;

  rows.forEach(r => {
    const st = r['ステータス'] || '未確認';
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (st === '未確認') unconfirmed++;
    if (r['重複フラグ']) dup++;
    if (r['割当開始区画']) assigned += Number(r['割当区画数'] || 1);
    const staff = r['FC大阪担当社員'] || '未選択';
    byStaff[staff] = (byStaff[staff] || 0) + 1;
    String(r['出店形態'] || '').split(/[,、/／]/).forEach(t => {
      t = t.trim(); if (t) byType[t] = (byType[t] || 0) + 1;
    });
    bySize[r['希望区画'] || '未回答'] = (bySize[r['希望区画'] || '未回答'] || 0) + 1;
    byPower[r['電源'] || '未回答'] = (byPower[r['電源'] || '未回答'] || 0) + 1;
    byTent[r['テント'] || '未回答'] = (byTent[r['テント'] || '未回答'] || 0) + 1;
    String(r['包材の用意'] || '').split(/[,、\/／]/).forEach(t => {
      t = t.trim(); if (t) byPack[t] = (byPack[t] || 0) + 1;
    });
    const w = Number(String(r['合計消費電力(W)'] || '').replace(/[^\d.]/g, ''));
    if (w) powerWatt += w; else if (r['電源'] !== '不要') powerUnknown++;
    if (r['火気'] && r['火気'].indexOf('使用しない') < 0) fire++;
    vehicles += Number(r['搬入車両台数'] || 0);
    if (String(r['駐車場']).indexOf('希望する') === 0) parking++;
    staffTotal += Number(r['スタッフ人数'] || 0);
    if (String(r['雨天時対応']).indexOf('辞退') >= 0) rainDecline++;
    if (r['テント'] === 'レンタルする') {
      if (String(r['テントサイズ']).indexOf('1.5間') >= 0) rental.tentT1++;
      else if (r['テントサイズ']) rental.tentT2++;
    }
    revenue += Number(r['レンタル合計(円)'] || 0);
    try {
      const items = (JSON.parse(r['生データ(JSON)'] || '{}') || {}).rentalItems || {};
      Object.keys(items).forEach(n => {
        const q = Number(items[n]) || 0;
        if (q > 0) rentalQty[n] = (rentalQty[n] || 0) + q;
      });
    } catch (e) {}
  });

  revenue += PRICES.tentT1 * rental.tentT1 + PRICES.tentT2 * rental.tentT2;
  const deadline = new Date('2026-09-30T18:00:00+09:00');
  const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86400000);

  // 要対応。本番 gas/Admin.gs と同じものを返す。
  // toAssign / toCheckPower が抜けていたので、
  // 「区画が決まっていない人はここで分かります」という一番効く説明ができなかった
  const toAssign = rows.filter(r => r['ステータス'] === '採択' && !r['割当開始区画'])
    .map(r => r['受付ID']);
  const toCheckPower = rows.filter(r => {
    const p = String(r['電源'] || '');
    return (p.indexOf('持ち込') >= 0 || p.indexOf('発電機') >= 0)
        && ['不採択', '辞退', 'キャンセル', '重複（無効）'].indexOf(r['ステータス']) < 0;
  }).map(r => r['受付ID']);

  return {
    ok: true, role: auth.role, person: auth.person,
    counts: { total: rows.length, byStatus, byStaff, byType, bySize, byPower,
              byTent, byPack,
              fire, vehicles, parking, staffTotal, rainDecline,
              powerWatt, powerUnknown, dup, unconfirmed },
    spaces: { total: DB.spaces.length, assigned,
              rate: Math.round(assigned / DB.spaces.length * 100) },
    rental, rentalQty, revenue, pricesKnown: true,
    // 数を集める項目（本番 aggregateTotals_ と同じ形）。
    // **項目が増えても、ここは変えない**
    totals: S.aggregateFields().map(f => {
      let sum = 0, filled = 0, missing = 0;
      // 誰が未提出なのかも返す（本番と同じ）。数だけでは催促できない
      // **受付IDで重複を見る**（本番 noteMissing_ と同じ）。
      // 社名で潰すと、同じ会社が2区画に応募したときに
      // 画面の「ほかN社」が実際の未提出数と合わなくなり、催促が抜ける
      const missingNames = [];
      const note = r => {
        const id = String(r['受付ID'] || '').trim();
        const nm = String(r['企業名'] || id).trim();
        if (!nm) return;
        if (missingNames.some(x => x.id === id)) return;
        missingNames.push({ id, name: nm });
      };
      DB.rows.forEach(r => {
        // 出店確定情報は採択した方しか出せない。全行を母数にすると
        // 「未提出7社」のような、催促できない数字になる（本番と同じ扱い）
        if (f.stage === 'confirm' && String(r['ステータス'] || '').trim() !== '採択') return;
        const src = f.stage === 'confirm'
          ? ((DB.confirm[r['受付ID']] || {}).values || {})
          : r;
        const raw = f.stage === 'confirm' ? src[f.key] : src[f.sheet];
        const s = String(raw == null ? '' : raw).trim();
        if (s === '') { missing++; note(r); return; }
        const n = aggregateNumber(s);
        if (n === null) { missing++; note(r); return; }
        sum += n; filled++;
      });
      return { key: f.key, label: f.aggregate.label, unit: f.aggregate.unit,
               sum, filled, missing,
               missingNames: missingNames.slice(0, 5).map(x => x.name),
               missingMore: Math.max(missingNames.length - 5, 0),
               stage: f.stage === 'confirm' ? 'confirm' : 'apply' };
    }),
    deadline: '2026年9月30日（水）18:00', daysLeft,
    todo: {
      unconfirmed,
      stale: rows.filter(r => r['ステータス'] === '審査中').slice(0, 2)
        .map(r => ({ id: r['受付ID'], name: r['企業名'], days: 4 })),
      toNotify: rows.filter(r => r['ステータス'] === '採択' && !r['採択通知送信日時'])
        .map(r => ({ id: r['受付ID'], name: r['企業名'] })),
      toAssign, toCheckPower,
      dup,
    },
    // 画面の中で「事務局にご連絡ください」と案内する先（本番と同じ）
    office: DB.settings['事務局の連絡先'] || '',
    recent: rows.slice(-5).reverse().map(r => ({
      id: r['受付ID'], at: r['受付日時'], name: r['企業名'], status: r['ステータス'] })),
  };
}

/**
 * 一覧で選べる列。**台帳の見出しから作る**（本番 LIST_ALL_COLUMNS_ と同じ）。
 * 写しを持つと、2026-09-02 の設定一覧と同じことが起きる
 * （本番が全項目を返すようになっても、模擬は22列のまま）。
 */
const LIST_COLUMNS = S.ledgerHeaders().filter(h => h && !NEVER_SEND.includes(h));

/** 最初から出す列（本番 LIST_DEFAULT_COLUMNS_ と同じ） */
const LIST_DEFAULT_COLUMNS = ['受付ID', '受付日時', 'ステータス', '企業名', '出店形態',
  '希望区画', '割当開始区画', 'FC大阪担当社員', '当日ステータス'];

/** 一覧のセルの上限（本番 LIST_CELL_MAX と同じ）。長文で表が読めなくなるのを防ぐ */
const LIST_CELL_MAX = 120;

/** 確定情報の列につける印（本番 CONFIRM_COL_PREFIX と同じ）。
 *  「備考」が応募一覧にも確定情報にもあるので、印が無いと片方が黙って消える */
const CONFIRM_COL_PREFIX = '確定：';

const EDITABLE = ['ステータス', '担当メモ', '搬入予定時刻', '撤収予定時刻', '当日ステータス', '主形態'];

/**
 * 模擬の採択後トークン。受付IDから作る固定値。
 * 本番は台帳に書いた乱数（UUID）なので、ここは**形だけ**を合わせる。
 * 32桁の16進にしておかないと、本番側の形の検査（/^[0-9a-f]{32}$/）と
 * 食い違い、模擬で通るリンクが本番で弾かれる。
 */
/** アップロードの上限。**本番（gas/Drive.gs）と同じ値にすること** */
const MOCK_UPLOAD_MAX = 10 * 1024 * 1024;
const MOCK_UPLOAD_MAX_FILES = 30;
const MOCK_UPLOAD_MAX_TOTAL = 80 * 1024 * 1024;
// **素のオブジェクトにしないこと**（本番 gas/Drive.gs と同じ理由）。
// {} だと MOCK_ALLOWED['constructor'] が真になり、種類の制限を素通りできる
const MOCK_ALLOWED = Object.assign(Object.create(null), {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/illustrator': 'ai', 'application/postscript': 'ai',
  'application/zip': 'zip',
});
// 本番の safeFileName_ と同じ判定。ずれると「模擬では通るのに本番で名前が変わる」
// が起きる。見えない文字・書字方向を上書きする文字も落とす
const mockSafeName = (name, forceExt) => {
  let s = String(name || '').split('').filter((ch) => {
    const c = ch.charCodeAt(0);
    if (c < 32 || c === 127) return false;
    if (c >= 0x200B && c <= 0x200F) return false;
    if (c >= 0x202A && c <= 0x202E) return false;
    if (c >= 0x2060 && c <= 0x2064) return false;
    return c !== 0xFEFF;
  }).join('').replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '').trim();
  if (forceExt) {
    // 本番と同じく、すでに正しい拡張子なら綴りを残す
    const cur = /\.([A-Za-z0-9]{1,12})$/.exec(s);
    if (cur && cur[1].toLowerCase() === String(forceExt).toLowerCase()) return s.slice(0, 120);
    s = s.replace(/\.[A-Za-z0-9]{1,12}$/, '') || '提出物';
    return s.slice(0, 120 - forceExt.length - 1) + '.' + forceExt;
  }
  return (s || '提出物').slice(0, 120);
};
const mockAllowedExt = (mime) => {
  const v = MOCK_ALLOWED[String(mime || '')];
  return (typeof v === 'string') ? v : '';
};

function mockSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (Math.round(n / 1024 / 1024 * 10) / 10) + ' MB';
}


// ──────────────────────────────────────────── メール文面（本番と同じ仕組み）

/** いまの文面。編集していなければ既定（本番 mailtplRead_ と同じ振る舞い） */
function mailtplNow(kind) {
  const saved = DB.mailTpl[kind];
  const def = MAILTPL.mailtplDefault_(kind);
  if (!saved || !String(saved.subject || '').trim() || !String(saved.body || '').trim()) {
    return { subject: def.subject, body: def.body, custom: false };
  }
  return { subject: saved.subject, body: saved.body, custom: true,
           at: saved.at || '', by: saved.by || '' };
}

// 差し込みの値を作る関数は、**本番のソースから借りている**（上の MAILTPL）。
// ここに写しを置いていたので、差し込みを1つ足すと
// 本番は展開するのに模擬だけ {{…}} のまま出る状態だった（2026-09-04 の点検で指摘）。
const mailtplVars = (kind, r, links) => MAILTPL.mailtplVars_(kind, {
  id: r['受付ID'] || '', person: r['担当者氏名'] || '',
  company: r['企業名'] || '', shopName: r['出店名'] || '',
}, links);

/**
 * メールの見本。
 *
 * **本番とまったく同じ道を通す**：文面（既定または編集したもの）に、
 * その行の値を差し込む。以前はここに文面を写していたので、
 * 不採択を選んでも「出店が決定いたしました」が出ていた（2026-09-03 発見）。
 * 写しを置くかぎり、同じことがまた起きる。
 */
function mockMailSample(kind, r) {
  const tpl = mailtplNow(kind);
  // 設定が空なら、リンクも空にする（本番 acceptLink_ と同じ）。
  // ここを直書きしていたので、「URLが未設定です」と警告しながら
  // 本文にはリンクが出ていた
  const withId = base => (base
    ? base + (base.indexOf('?') >= 0 ? '&' : '?') + 'id=' + r['受付ID'] + '&t=…'
    : '');
  const links = kind === 'accept' ? {
    confirm: withId(DB.settings['確定情報フォームURL'] || ''),
    upload: withId(DB.settings['素材アップロードURL'] || ''),
  } : null;
  const vars = mailtplVars(kind, r, links);
  return {
    to: r['担当者メール'], company: r['企業名'],
    subject: MAILTPL.mailtplRender_(tpl.subject, vars)
               .split(String.fromCharCode(10)).join(' ').trim(),
    body: MAILTPL.mailtplRender_(tpl.body, vars),
  };
}



function mockToken(id) {
  return require('crypto').createHash('sha256').update('mock|' + id)
    .digest('hex').slice(0, 32);
}

/**
 * 一括削除の引換券。**本番 gas/Purge.gs と同じ形にする**。
 * ここを緩めると、画面が古い一覧を見せたまま消せる穴を、模擬が見逃す。
 */
const PURGE_TICKET_MIN = 10;

function purgeHmac(text) {
  return crypto.createHmac('sha256', SECRET + '|purge').update(text).digest('base64url');
}

function purgeIdsFingerprint(ids) {
  return crypto.createHash('sha256')
    .update('purge|' + (ids || []).map(String).sort().join(',')).digest('base64url');
}

function purgeTicket(ids) {
  const body = Buffer.from(JSON.stringify({
    h: purgeIdsFingerprint(ids),
    n: (ids || []).length,
    e: Date.now() + PURGE_TICKET_MIN * 60000,
  })).toString('base64url');
  return body + '.' + purgeHmac(body);
}

/** 通れば null、通らなければ返すべき返事 */
function purgeTicketError(ticket, ids) {
  const again = 'もう一度「消える対象を確かめる」からやり直してください。';
  const parts = String(ticket || '').split('.');
  if (parts.length !== 2 || !parts[0]) {
    return { ok: false, error: 'no_ticket', message: '削除の引換券がありません。' + again };
  }
  if (purgeHmac(parts[0]) !== parts[1]) {
    return { ok: false, error: 'bad_ticket',
      message: '削除の引換券が確認できませんでした。' + again };
  }
  let payload = null;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch (e) { payload = null; }
  if (!payload) {
    return { ok: false, error: 'bad_ticket',
      message: '削除の引換券が確認できませんでした。' + again };
  }
  if (!payload.e || payload.e < Date.now()) {
    return { ok: false, error: 'expired_ticket',
      message: '確かめてから' + PURGE_TICKET_MIN + '分以上が経ちました。' + again };
  }
  if (String(payload.h) !== purgeIdsFingerprint(ids)) {
    return { ok: false, error: 'stale_ticket',
      message: '確かめたときと、消える対象が変わっています。' + again };
  }
  return null;
}

/**
 * 確定情報の検証。**本番の validateFieldList_ と同じ判定にする。**
 * ここを緩めると「模擬では通るのに本番で弾かれる」食い違いが生まれる。
 */
function mockValidateConfirm(values) {
  const errs = [];
  SCHEMA.confirmFields().forEach(f => {
    const raw = values[f.key];
    if (raw !== undefined && raw !== null) {
      const isArr = Array.isArray(raw);
      if (f.type === 'checkboxes') {
        if (!isArr || raw.some(x => typeof x !== 'string')) {
          errs.push({ key: f.key, message: f.label + 'の選択内容をご確認ください。' });
          return;
        }
      } else if (isArr || typeof raw === 'object') {
        errs.push({ key: f.key, message: f.label + 'の形式をご確認ください。' });
        return;
      }
    }
    const visible = SCHEMA.isVisible(f, values);
    const v = values[f.key];
    const empty = (v === undefined || v === null || v === '' ||
                   (Array.isArray(v) && !v.length) || v === false);
    if (!visible) { if (!empty) delete values[f.key]; return; }
    if (SCHEMA.isRequired(f, values) && empty) {
      errs.push({ key: f.key, message: f.label + 'を入力してください。' });
      return;
    }
    if (empty) return;
    if (f.type === 'tel' && !/^[0-9+\-() 　]{8,20}$/.test(String(v))) {
      errs.push({ key: f.key, message: '電話番号の形式をご確認ください。' });
    }
    if (f.type === 'radio') {
      const allowed = (f.options || []).map(o => (typeof o === 'object' ? o.value : o));
      if (allowed.indexOf(v) === -1) {
        errs.push({ key: f.key, message: f.label + 'の選択内容をご確認ください。' });
      }
    }
    if (f.type === 'number') {
      const n = Number(v);
      if (!isFinite(n)) errs.push({ key: f.key, message: f.label + 'は数字でご入力ください。' });
      else if (f.min !== undefined && n < f.min)
        errs.push({ key: f.key, message: f.label + 'は' + f.min + '以上でご入力ください。' });
      else if (f.max !== undefined && n > f.max)
        errs.push({ key: f.key, message: f.label + 'は' + f.max + '以下でご入力ください。' });
    }
    if (typeof v === 'string' && f.type !== 'textarea'
        && /[\r\n]/.test(v)) {
      errs.push({ key: f.key, message: f.label + 'に改行は使えません。' });
    }
    const limit = f.maxLength || 2000;
    if ((typeof v === 'string' || typeof v === 'number') && String(v).length > limit) {
      errs.push({ key: f.key, message: f.label + 'は' + limit + '文字以内でご入力ください。' });
    }
  });
  return errs;
}

function handle(payload) {
  const a = payload.action;

  if (a === 'adminNames') {
    if (payload.password !== 'admin' && payload.password !== 'staff') {
      return { ok: false, error: 'denied', message: 'パスワードが違います。' };
    }
    return { ok: true, names: PEOPLE.map(p => ({ name: p.name, dept: p.dept })) };
  }
  if (a === 'adminLogin') {
    const role = payload.password === 'admin' ? '管理者'
               : payload.password === 'staff' ? '一般' : '';
    const me = PEOPLE.find(p => p.name === payload.person);
    if (!role || !me) return { ok: false, error: 'denied', message: 'お名前またはパスワードが違います。' };
    const eff = (me.role === '管理者' && role === '管理者') ? '管理者' : '一般';
    return { ok: true, token: issue(me.name, eff), person: me.name, role: eff };
  }

  // ── 出店確定情報フォーム。**認証の前**に振り分ける。
  // 本番（gas/Api.gs）も confirm* は管理APIとは別の入口にしてある。
  // switch の中（＝認証のあと）に置くと、鍵を持つ事業者が
  // 管理ページのトークンを持っていないので必ず unauthorized になる。
  if (a === 'confirmLoad' || a === 'confirmSave') {
  // ── 出店確定情報フォーム（本番は gas/Confirm.gs）
  //
  // 模擬のトークンは受付IDから作る固定値。本番は台帳の乱数。
  // ここで確かめたいのは「採択者だけが入れるか」「条件つきの必須が効くか」
  // 「登録した内容が戻ってくるか」の3つ。

    const id = String(payload.id || '').trim().toUpperCase();
    const t = String(payload.t || '').trim();
    const r = DB.rows.find(x => x['受付ID'] === id);
    const want = mockToken(id);
    if (!r || t !== want) {
      return { ok: false, error: 'denied',
        message: 'このリンクは有効ではありません。'
               + '採択通知メールに記載のリンクを、そのままお開きください。' };
    }
    if (r['ステータス'] !== '採択') {
      // 本番（gas/Confirm.gs）と同じく、審査中と「結果が確定している」で分ける。
      // 一律にすると、**不採択の方に「選考中です」と表示される**。
      // 模擬で確かめて良しとした挙動が本番と違う、という一番まずい形になる。
      const decided = ['不採択', '辞退', 'キャンセル', '重複（無効）']
        .indexOf(r['ステータス']) >= 0;
      return { ok: false, error: 'not_accepted',
        message: decided
          ? 'このお申し込みは、現在この画面からのご登録を承っておりません。'
            + 'お手数ですが、担当までご連絡ください。'
          : 'ただいま選考中です。出店決定のご連絡後にご登録いただけます。' };
    }
    const types = String(r['出店形態'] || '').split('、').filter(Boolean);

    if (a === 'confirmLoad') {
      return { ok: true, receiptId: id, company: r['企業名'],
               boothName: r['出店名'], contactName: r['担当者氏名'],
               boothTypes: types,
               values: (DB.confirm[id] && DB.confirm[id].values) || {},
               savedAt: (DB.confirm[id] && DB.confirm[id].at) || '',
               deadlineText: '出店可否のご連絡から5営業日以内' };
    }

    // 保存。**本番と同じ検証を通す**。ここを緩めると
    // 「模擬では通るのに本番で弾かれる」食い違いが生まれる
    const incoming = payload.values || {};
    if (typeof incoming !== 'object' || Array.isArray(incoming)) {
      return { ok: false, error: 'bad_request' };
    }
    const next = {};
    SCHEMA.confirmFields().forEach(f => {
      if (incoming[f.key] !== undefined) next[f.key] = incoming[f.key];
    });
    // 条件判定に使う値は、台帳の値で上書きする（本番と同じ）
    next.boothTypes = types;
    const errs = mockValidateConfirm(next);
    if (errs.length) return { ok: false, error: 'validation', fields: errs };
    delete next.boothTypes;

    const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    DB.confirm[id] = { values: next, at };
    DB.history.unshift({ at, who: '出店者（本人）', id, item: '出店確定情報',
      before: '未登録', after: '登録', reason: '確定情報フォーム' });
    return { ok: true, receiptId: id, savedAt: at, isNew: true };
  }

  // ── 素材アップロード。確定情報フォームと同じく**認証の前**に振り分ける。
  // 本番（gas/Api.gs）も upload* は管理APIとは別の入口にしてある。
  if (a === 'uploadInfo' || a === 'uploadFile') {
    const id = String(payload.id || '').trim().toUpperCase();
    const t = String(payload.t || '').trim();
    const r = DB.rows.find(x => x['受付ID'] === id);
    if (!r || t !== mockToken(id)) {
      return { ok: false, error: 'denied',
        message: 'このリンクは有効ではありません。'
               + '採択通知メールに記載のリンクを、そのままお開きください。' };
    }
    if (r['ステータス'] !== '採択') {
      return { ok: false, error: 'not_accepted',
        message: 'ただいま選考中です。出店決定のご連絡後にご提出いただけます。' };
    }
    if (!DB.vendorFiles[id]) DB.vendorFiles[id] = [];
    const files = DB.vendorFiles[id];

    if (a === 'uploadInfo') {
      return { ok: true, receiptId: id, company: r['企業名'], boothName: r['出店名'],
               files: files.slice().reverse(),
               maxBytes: MOCK_UPLOAD_MAX, maxFiles: MOCK_UPLOAD_MAX_FILES,
               maxSizeText: mockSize(MOCK_UPLOAD_MAX),
               // 本番は設定シートの「素材の提出期限」。模擬では固定値で見え方を確かめる
               deadline: '2026年10月20日まで',
               maxTotalBytes: MOCK_UPLOAD_MAX_TOTAL,
               maxTotalText: mockSize(MOCK_UPLOAD_MAX_TOTAL),
               usedBytes: files.reduce((s, x) => s + (Number(x.size) || 0), 0),
               usedText: mockSize(files.reduce((s, x) => s + (Number(x.size) || 0), 0)),
               allowed: Object.keys(MOCK_ALLOWED) };
    }

    // 歯止めは本番と同じ順・同じ値にする。
    // 緩いと「模擬では通るのに本番で弾かれる」食い違いが生まれる
    const name = String(payload.name || '');
    const mime = String(payload.mime || '');
    const data = String(payload.data || '');
    if (!data) return { ok: false, error: 'empty', message: 'ファイルを読み取れませんでした。' };
    const ext = mockAllowedExt(mime);
    if (!ext) {
      return { ok: false, error: 'type',
        message: 'この種類のファイルはお預かりできません。' };
    }
    const approx = Math.floor(data.length * 3 / 4);
    if (approx > MOCK_UPLOAD_MAX + 3) {
      return { ok: false, error: 'too_large',
        message: 'ファイルが大きすぎます（1つあたり ' + mockSize(MOCK_UPLOAD_MAX) + ' まで）。' };
    }
    if (files.length >= MOCK_UPLOAD_MAX_FILES) {
      return { ok: false, error: 'too_many',
        message: 'ご提出は' + MOCK_UPLOAD_MAX_FILES + '件までです。' };
    }
    const usedNow = files.reduce((s, x) => s + (Number(x.size) || 0), 0);
    if (usedNow + approx > MOCK_UPLOAD_MAX_TOTAL) {
      return { ok: false, error: 'too_much',
        message: 'ご提出の合計が' + mockSize(MOCK_UPLOAD_MAX_TOTAL) + 'を超えます'
               + '（現在 ' + mockSize(usedNow) + '）。' };
    }
    const f = { id: 'mock-' + Date.now() + '-' + files.length,
                // 拡張子は本番と同じく**こちらで付け直す**。
                // 名前を無検査で使うと invoice.pdf.html が置ける
                name: mockSafeName(name, ext),
                size: approx, sizeText: mockSize(approx),
                updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
                url: 'https://drive.google.com/file/d/mock/view', folder: '' };
    files.push(f);
    DB.history.unshift({ at: f.updated, who: '出店者（本人）', id, item: '素材提出',
      before: '', after: f.name, reason: '素材アップロード' });
    return { ok: true, file: f, mailWarning: '' };
  }

  const auth = verify(payload.token);
  if (!auth) return { ok: false, error: 'unauthorized' };

  switch (a) {
    case 'adminWhoami': return { ok: true, person: auth.person, role: auth.role };
    case 'adminSummary': return summary(auth);
    case 'adminList': {
      // 出店確定情報も混ぜて返す（本番 adminList_ と同じ）。
      // 当日の一覧に**現場責任者の携帯**を出すため（けいた指示・2026-09-03）
      const cfFields = S.confirmFields();
      return { ok: true,
        columns: LIST_COLUMNS.concat(cfFields.map(f => CONFIRM_COL_PREFIX + f.sheet)),
        defaultColumns: LIST_DEFAULT_COLUMNS.filter(c => LIST_COLUMNS.includes(c)),
        rows: DB.rows.map(r => {
          const o = {};
          LIST_COLUMNS.forEach(c => {
            const v = String(r[c] == null ? '' : r[c]);
            o[c] = v.length > LIST_CELL_MAX ? v.slice(0, LIST_CELL_MAX) + '…' : v;
          });
          const cf = (DB.confirm[r['受付ID']] || {}).values || {};
          cfFields.forEach(f => {
            const raw = cf[f.key];
            const v = Array.isArray(raw) ? raw.join('、') : String(raw == null ? '' : raw);
            o[CONFIRM_COL_PREFIX + f.sheet] =
              v.length > LIST_CELL_MAX ? v.slice(0, LIST_CELL_MAX) + '…' : v;
          });
          return o;
        }),
        statuses: STATUSES, dayStatuses: ['未着', '搬入済', '設営完了', '撤収完了'] };
    }
    case 'adminDetail': {
      const r = DB.rows.find(x => x['受付ID'] === payload.id);
      if (!r) return { ok: false, error: 'not_found' };
      // 本番は NEVER_SEND を落としてから返す。ここでも同じことをしないと、
      // **サーバー側の除去が壊れても模擬では気づけない**
      const detail = {};
      Object.keys(r).forEach(k => { if (!NEVER_SEND.includes(k)) detail[k] = r[k]; });
      // 採択後に集めた情報も返す（本番 confirmForAdmin_ と同じ形）。
      // ここを返さないと、模擬では「まだ提出されていません」しか見られず、
      // **出た状態を一度も確かめないまま公開する**ことになる
      const cf = DB.confirm[payload.id];
      const cfValues = {};
      if (cf) {
        S.confirmFields().forEach(f => {
          const v = cf.values[f.key];
          if (v === undefined || v === null || v === '') return;
          cfValues[f.sheet || f.key] = Array.isArray(v) ? v.join('／') : String(v);
        });
      }
      return { ok: true, detail,
               confirm: { ok: true, submitted: !!cf, values: cfValues },
               // 打ち込める項目は**サーバーから送る**（本番 countFieldsForAdmin_ と同じ）
               countFields: S.aggregateFields()
                 .filter(f => f.stage === 'confirm')
                 .map(f => ({ key: f.key, label: f.label, sheet: f.sheet,
                              unit: f.aggregate.unit, min: f.min, max: f.max })) };
    }
    case 'adminUpdate': {
      // 本番は検査を全部通してから1バイトも書かない。ここも同じ順序にする
      {
        const bad = Object.keys(payload.patch || {}).filter(k => !EDITABLE.includes(k));
        if (bad.length) {
          return { ok: false, error: 'forbidden_field',
            message: '変更できない項目です: ' + bad.join(', ') };
        }
        const st = payload.patch && payload.patch['ステータス'];
        if (st && !STATUSES.includes(st)) {
          return { ok: false, error: 'bad_value', message: 'ステータスの値が不正です' };
        }
        const ds = payload.patch && payload.patch['当日ステータス'];
        if (ds && !DAY_STATUSES.includes(ds)) {
          return { ok: false, error: 'bad_value', message: '当日ステータスの値が不正です' };
        }
        const NEEDS = ['不採択', '辞退', 'キャンセル', '重複（無効）'];
        if (st && NEEDS.includes(st) && String(payload.reason || '').trim().length < 5) {
          return { ok: false, error: 'reason_required',
            message: '「' + st + '」に変更する理由を、5文字以上でご記入ください。' };
        }
        const memoAdd = payload.patch && payload.patch['担当メモ'];
        if (memoAdd !== undefined && String(memoAdd).trim().length > 2000) {
          return { ok: false, error: 'too_long',
            message: '担当メモの1回の追記は2000文字までです。' };
        }
      }

      // 担当メモは書き換えではなく積み上げ（本番と同じ）
      let memoAdded = 0;
      if (payload.patch && payload.patch['担当メモ'] !== undefined) {
        const add = String(payload.patch['担当メモ']).trim();
        const row0 = DB.rows.find(x => x['受付ID'] === payload.id);
        if (row0) {
          if (add) {
            const before = String(row0['担当メモ'] || '');
            row0['担当メモ'] = nowText() + '  ' + auth.person + '\n' + add
              + (before ? '\n\n' + before : '');
            DB.history.unshift({ at: nowText(), who: auth.person, id: payload.id,
                                 item: '担当メモ', before: '（追記）', after: add, reason: '' });
            memoAdded = 1;   // 本番は積んだ分を件数に数える
          }
        }
        delete payload.patch['担当メモ'];
      }
      const r = DB.rows.find(x => x['受付ID'] === payload.id);
      if (!r) return { ok: false, error: 'not_found' };
      const bad = Object.keys(payload.patch || {}).filter(k => !EDITABLE.includes(k));
      if (bad.length) return { ok: false, error: 'forbidden_field',
        message: '変更できない項目です: ' + bad.join(', ') };
      // GAS側と同じ検証。ここを省くと「模擬では通るのに本番で落ちる」になる
      if (payload.patch['ステータス'] && !STATUSES.includes(payload.patch['ステータス'])) {
        return { ok: false, error: 'bad_value', message: 'ステータスの値が不正です' };
      }
      let n = 0;
      Object.entries(payload.patch).forEach(([k, v]) => {
        if (String(r[k] || '') === String(v || '')) return;
        DB.history.unshift({ at: nowText(), who: auth.person, id: r['受付ID'],
                            item: k, before: String(r[k] || ''), after: String(v || ''),
                            reason: String(payload.reason || '') });
        r[k] = v; n++;
      });
      return { ok: true, changed: n };
    }
    case 'adminSpaces': {
      const owners = {};
      DB.rows.forEach(r => {
        owners[r['受付ID']] = {
          name: r['出店名'] || r['企業名'],
          type: r['主形態'] || String(r['出店形態']).split(/[,、]/)[0].trim(),
          start: Number(r['割当開始区画'] || 0), units: Number(r['割当区画数'] || 0),
          status: r['ステータス'], power: r['電源'], size: r['希望区画'],
        };
      });
      return { ok: true, spaces: DB.spaces, owners, colors: COLORS,
               background: '', total: DB.spaces.length };
    }
    case 'adminAssign': {
      const r = DB.rows.find(x => x['受付ID'] === payload.id);
      if (!r) return { ok: false, error: 'not_found' };
      const units = (payload.units == null)
        ? (String(r['希望区画']).includes('3間') ? 2 : 1)
        : Math.floor(Number(payload.units));
      if (!isFinite(units) || units < 1 || units > MAX_UNITS) {
        return { ok: false, error: 'bad_request', message: '区画数の指定が正しくありません。' };
      }
      const start0 = Number(payload.start);
      if (!isFinite(start0) || start0 < 1 || start0 > DB.spaces.length) {
        return { ok: false, error: 'bad_request', message: '区画番号の指定が正しくありません。' };
      }
      const total = DB.spaces.length;
      const want = [];
      for (let k = 0; k < units; k++) want.push(((Number(payload.start) - 1 + k) % total) + 1);
      const taken = DB.spaces.filter(s => want.includes(s.no) && s.id && s.id !== payload.id);
      if (taken.length) return { ok: false, error: 'occupied',
        message: '区画 ' + taken.map(s => s.no).join('・') + ' はすでに割り当てられています。' };
      DB.spaces.forEach(s => {
        if (want.includes(s.no)) s.id = payload.id;
        else if (s.id === payload.id) s.id = '';
      });
      r['割当開始区画'] = String(payload.start); r['割当区画数'] = String(units);
      return { ok: true, spaces: want };
    }
    case 'adminUnassign': {
      const r = DB.rows.find(x => x['受付ID'] === payload.id);
      if (!r) return { ok: false, error: 'not_found' };
      DB.spaces.forEach(s => { if (s.id === payload.id) s.id = ''; });
      r['割当開始区画'] = ''; r['割当区画数'] = '';
      return { ok: true };
    }
    case 'adminInbox': {
      // 本番と同じく管理者のみ（受信箱を読む権限で動くため）
      // 文言まで本番（gas/Admin.gs）と合わせる。無いと、模擬では
      // 「何も出ない」ように見えて、本番との違いに気づけない
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      return { ok: true, address: 'fcosaka_bondance@kreha-c.com', days: 60, rows: [
        { id: 't1', subject: '出店の件でご質問です', from: '田中 <tanaka@example.com>',
          at: '2026-09-01 09:12', count: 1, unread: true, replied: false,
          url: 'https://mail.google.com/', snippet: '電源について確認させてください。発電機の持ち込みは…' },
        { id: 't2', subject: 'Re: 受付完了のお知らせ', from: '鈴木 <suzuki@example.com>',
          at: '2026-08-31 18:40', count: 3, unread: false, replied: true,
          url: 'https://mail.google.com/', snippet: 'ご対応ありがとうございました。当日はよろしくお願いいたします。' },
      ] };
    }

    // ── 制作スケジュール。**adminOnly には入れない**（全員が触れる・本番と同じ）
    case 'adminSched': {
      const people = schedPeopleMock();
      const companies = SCHED.SCHED_COMPANIES_.slice();
      const add = c => { if (c && !companies.includes(c)) companies.push(c); };
      Object.keys(people.byCompany).forEach(add);
      DB.sched.forEach(r => (r.companies || []).forEach(add));
      const me = PEOPLE.find(p => p.name === auth.person);
      return {
        ok: true,
        rows: DB.sched.map((r, i) => {
          if (!r.id) r.id = schedNewIdMock();   // 種データにも印を振る
          return Object.assign({ row: i + 2, order: i }, r);
        }),
        areas: SCHED.SCHED_AREAS_.slice(),
        statuses: SCHED.SCHED_STATUSES_.slice(),
        kinds: SCHED.SCHED_KINDS_.slice(),
        companies,
        peopleByCompany: people.byCompany,
        me: { person: auth.person, company: me ? me.org : '' },
        // 「まもなく」と出す日数。設定から読む（本番の schedWarnDays_ と同じ倒し方で、
        // 読めなければ3に落とす。0にすると色が一度も出なくなる）
        warnDays: (() => {
          const n = Number(DB.settings['スケジュールの警告日数']);
          return (isFinite(n) && n >= 1 && n === Math.floor(n)) ? Math.min(n, 30) : 3;
        })(),
        // 本番はサーバーの日付を返す。端末の時計を見ない（§3-1）
        today: nowText().slice(0, 10),   // 日本時間。本番は Asia/Tokyo
      };
    }

    case 'adminSchedSave': {
      // 検証は**本番の関数をそのまま呼ぶ**。模擬に写しを持たない
      const v = SCHED.validateSchedRow_(payload.item, schedPeopleMock());
      if (v.message) return { ok: false, error: 'bad_value', message: v.message };
      const item = v.value;
      const today = nowText().slice(0, 10);
      // row の読み方も本番から借りる。Number(...)||0 だと
      // 「読めない row が黙って新規追加になる」形が模擬にだけ残る
      const got = SCHED.schedRowArg_(payload);
      if (got.message) return { ok: false, error: 'bad_value', message: got.message };
      const row = got.row;
      const settled = SCHED.schedSettled_(item.status);

      if (!row) {
        DB.sched.push(Object.assign({}, item, {
          id: schedNewIdMock(),
          doneDate: settled ? today : '',
          author: auth.person, createdAt: today,
          updatedBy: auth.person, updatedAt: nowText(),
        }));
        DB.history.unshift({ at: nowText(), who: auth.person, id: '（スケジュール）',
                             item: '追加', before: '', after: item.title, reason: '' });
        return { ok: true, added: true };
      }
      const found = schedFindMock(row, payload.id);
      if (found.message) return { ok: false, error: found.error, message: found.message };
      const prev = DB.sched[found.i];
      DB.sched[found.i] = Object.assign({}, item, {
        id: prev.id,
        // 手で入れた完了日は上書きしない（本番と同じ）
        doneDate: settled ? (prev.doneDate || today) : '',
        author: prev.author, createdAt: prev.createdAt,
        updatedBy: auth.person, updatedAt: nowText(),
      });
      return { ok: true, added: false };
    }

    case 'adminSchedDelete': {
      const gotDel = SCHED.schedRowArg_(payload);
      if (gotDel.message) return { ok: false, error: 'bad_value', message: gotDel.message };
      const found = schedFindMock(gotDel.row, payload.id);
      if (found.message) return { ok: false, error: found.error, message: found.message };
      const i = found.i;
      // 削除は変更履歴に**行の全文**を残す。これが唯一の復元手段（本番と同じ）
      const gone = DB.sched[i];
      // 列名は who / id。**operator / receiptId ではない**（DB.history の形に合わせる）。
      // ここを本番側の名前で入れると、模擬の変更履歴だけ操作者が空欄に見える
      // （2026-09-03 に同じ形の取り違えが見つかっている）
      DB.history.unshift({ at: new Date().toISOString().slice(0, 16).replace('T', ' '),
                           who: auth.person, id: '（スケジュール）', item: '削除',
                           before: JSON.stringify(gone), after: '', reason: '' });
      DB.sched.splice(i, 1);
      return { ok: true, title: gone.title };
    }

    // ── ② タイムスケジュール。**adminOnly には入れない**（全員が触れる・本番と同じ）。
    //    中身は本番の gas/Timetable.gs がそのまま走る。模擬に写しを持たない
    case 'adminTimetable':          return ttCall('adminTimetable_', auth);
    case 'adminTimetableSave':      return ttCall('adminTimetableSave_', auth, payload);
    case 'adminTimetableHeartbeat': return ttCall('adminTimetableHeartbeat_', auth);

    /*
     * Excel の書き出し。**模擬では本物の xlsx は作れない**
     * （SpreadsheetApp.create も UrlFetchApp も無い）。
     * 中身は本番の gas/Export.gs が作るので、ここでは
     * 「画面が受け取ってダウンロードできるか」だけを確かめられる形にする。
     * **本物より優しくしない**ために、返す形は本番と同じにそろえる。
     */
    case 'adminTimetableExport':
    case 'adminSchedExport': {
      const sched = (a === 'adminSchedExport');
      const rows = sched ? DB.sched.length : ttCall('adminTimetable_', auth).rows.length;
      const day = sched ? '制作スケジュール' : (DB.settings['進行表の日付'] + ' 進行表');
      return {
        ok: true,
        // 模擬の中身は「これは模擬です」と分かる短いテキスト。
        // 本物の xlsx と取り違えないようにする
        base64: Buffer.from('模擬サーバーの書き出しです（本物の xlsx は本番でのみ作れます）',
                            'utf8').toString('base64'),
        filename: nowText().slice(0, 10) + '_' + day.replace(/[\\/:*?"<>|]/g, '') + '.xlsx',
        rows,
        leftover: false,
        mock: true,
      };
    }

    /*
     * **模擬だけの入口。本番のGASにこの経路は無い**（`?probe=` と同じ扱い）。
     *
     * 「ほかの人が先に保存した」を起こす。版のぶつかり（§4-4 の帯）は
     * 本番では試せないので、これが唯一の確認手段になる。
     * 一括削除で同じ判断をした。
     */
    case 'mockTimetableBumpVersion': {
      const other = { person: (payload && payload.person) || '佐藤 花子', role: '担当' };
      const got = ttCall('adminTimetable_', other);
      const rows = JSON.parse(JSON.stringify(got.rows));
      // **同じ印を積み重ねない。**撮影のたびに呼ぶと
      // 「設営・搬入（○○が変更）（○○が変更）…」と伸び続けて、
      // 画像が回を追うごとに違うものになる（2026-09-05 に実際にそうなった）
      var mark = '（' + other.person + 'が変更）';
      if (rows.length && rows[0].title.indexOf(mark) < 0) rows[0].title = rows[0].title + mark;
      const r = ttCall('adminTimetableSave_', other, { ticket: got.ticket, rows });
      return { ok: true, version: r.version, by: other.person };
    }

    case 'adminTodos':
      return { ok: true, rows: DB.todos.map((t, i) => Object.assign({ row: i + 2 }, t)) };

    case 'adminTodoSave': {
      const t = payload.todo || {};
      const text = String(t.text || '').trim();
      if (!text) return { ok: false, error: 'bad_value', message: '内容をご記入ください。' };
      if (text.length > 500) return { ok: false, error: 'too_long', message: '内容は500文字までです。' };
      const state = String(t.state || '未着手');
      if (!['未着手', '確認中', '完了'].includes(state)) {
        return { ok: false, error: 'bad_value', message: '状態が正しくありません。' };
      }
      let due = String(t.due || '').trim();
      if (due) {
        const m = due.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
        if (!m) return { ok: false, error: 'bad_value', message: '期日は「2026-09-08」の形でご入力ください。' };
        due = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
      }
      const today = new Date().toISOString().slice(0, 10);
      const rec = { state, text, owner: String(t.owner || ''), due,
                    author: auth.person, createdAt: today,
                    doneAt: state === '完了' ? today : '', memo: String(t.memo || '') };
      const row = Number(payload.row) || 0;
      if (!row) { DB.todos.push(rec); return { ok: true, added: true }; }
      const i = row - 2;
      if (i < 0 || i >= DB.todos.length) return { ok: false, error: 'not_found' };
      // 起票者と起票日は変えない（本番と同じ）
      rec.author = DB.todos[i].author; rec.createdAt = DB.todos[i].createdAt;
      DB.todos[i] = rec;
      return { ok: true, added: false };
    }

    // テストデータの一括削除。**模擬でしか通しで試せない**
    // （本番で試すと本物を消す）。歯止めの順序まで本番と同じにする
    case 'adminPurgePreview': {
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      if (String(DB.settings['テストデータの削除'] || 'OFF') !== 'ON') {
        return { ok: false, error: 'disabled',
          message: 'この操作は、「設定」タブの「テストデータの一括削除を許可」が'
                 + 'ONのときだけ使えます。ONにしてから、この画面を読み込み直してください。' };
      }
      const items = DB.rows.filter(r => r['受付ID']).map(r => ({
        id: r['受付ID'], company: r['企業名'], at: r['受付日時'], status: r['ステータス'],
      }));
      const pIds = items.map(x => x.id);
      return { ok: true, items, ids: pIds, max: 200,
               // 本番と同じく、見せた集合に署名して渡す
               ticket: purgeTicket(pIds), ticketMin: PURGE_TICKET_MIN,
               tooMany: items.length > 200,
               sheets: ['応募一覧', '出店確定情報', '変更履歴', '退避'],
               counts: { '応募一覧': DB.rows.length,
                         '出店確定情報': Object.keys(DB.confirm).length,
                         '変更履歴': DB.history.length, '退避': 0 } };
    }

    case 'adminPurgeRun': {
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      if (String(DB.settings['テストデータの削除'] || 'OFF') !== 'ON') {
        return { ok: false, error: 'disabled',
          message: '「設定」タブの「テストデータの一括削除を許可」がOFFになっています。' };
      }
      const live = DB.rows.filter(r => r['受付ID']).map(r => r['受付ID']);
      const sent = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
      if (live.slice().sort().join(',') !== sent.slice().sort().join(',')) {
        return { ok: false, error: 'changed',
          message: '一覧を開いてから、応募の数が変わりました。'
                 + 'もう一度「消える対象を確かめる」からやり直してください。' };
      }
      // 画面の変数は守りにならない。**下見のときにサーバーが出した券**を要る形にする
      const ticketNg = purgeTicketError(payload.ticket, live);
      if (ticketNg) return ticketNg;
      if (!live.length) return { ok: false, error: 'empty', message: '消す対象がありません。' };
      if (Number(payload.count) !== live.length) {
        return { ok: false, error: 'bad_count',
          message: '件数が一致しません。' + live.length + ' と入力してください。' };
      }
      // 本番と同じく、**消す前に控えを取る**。控えが取れなければ消さない
      const backupUrl = 'https://docs.google.com/spreadsheets/d/mock-backup/edit';
      const cleared = {
        '応募一覧': DB.rows.length,
        '出店確定情報': Object.keys(DB.confirm).length,
        '変更履歴': DB.history.length,
        '退避': 0,
      };
      let spaces = 0, folders = 0;
      DB.spaces.forEach(s => { if (s.id) { s.id = ''; spaces++; } });
      folders = Object.keys(DB.vendorFiles).length;
      DB.rows = [];
      DB.confirm = {};
      DB.vendorFiles = {};
      // 変更履歴も残さない（けいた指示）。控えの側に全部ある
      DB.history = [];
      DB.settings['テストデータの削除'] = 'OFF';   // 1回ぶんの鍵
      return { ok: true, cleared, spaces, folders, backupUrl, ids: live };
    }

    // 枚数の打ち込み（管理者のみ）。本番 adminConfirmSave_ と同じ歯止め
    case 'adminConfirmSave': {
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      const id = String(payload.id || '').trim().toUpperCase();
      if (!/^SB-\d{4}$/.test(id)) return { ok: false, error: 'bad_request' };
      const vals = payload.values || {};
      // 本番と同じく Object.create(null)。素の {} だと
      // values に 'constructor' を入れるだけで関門を抜けられる
      const allowed = Object.create(null);
      S.aggregateFields().forEach(f => { if (f.stage === 'confirm') allowed[f.key] = f; });
      for (const k of Object.keys(vals)) {
        if (!allowed[k]) return { ok: false, error: 'forbidden_field',
          message: 'この画面から入れられない項目です：' + k };
      }
      // 応募一覧に無い受付IDでは、行を作らない（本番と同じ）。
      // 形だけ見ていたので `SB-9999` で幽霊行が作れた（2026-09-04 の点検で指摘）
      if (!DB.rows.some(r => String(r['受付ID']).trim() === id)) {
        return { ok: false, error: 'not_found',
          message: '受付ID「' + id + '」は応募一覧にありません。IDをお確かめください。' };
      }

      // ① まず全部読む。**1つでも読めなければ、何も書かない**（本番と同じ順序）。
      //    以前は黙って読み飛ばして「変更はありません」とだけ出していたので、
      //    電話で聞いた枚数が消えていた
      const plan = [];
      const bad = [];
      Object.keys(vals).forEach(k => {
        const f = allowed[k];
        const s = String(vals[k] == null ? '' : vals[k]).trim();
        let out = '';
        if (s !== '') {
          const n = confirmCount(s);
          if (n === null) {
            bad.push({ label: f.label, why: NUM.numWhy_(s) });
            return;
          }
          if (typeof f.min === 'number' && n < f.min) {
            bad.push({ label: f.label, why: f.min + ' 以上でご入力ください' });
            return;
          }
          if (typeof f.max === 'number' && n > f.max) {
            bad.push({ label: f.label, why: f.max + ' 以下でご入力ください' });
            return;
          }
          out = n;
        }
        plan.push({ f, k, out });
      });

      if (bad.length) {
        return { ok: false, error: 'bad_value', rejected: bad,
          message: '入れられない値があります：'
                 + bad.map(b => b.label + '（' + b.why + '）').join(' ／ ')
                 + '。ほかの項目も含めて、まだ何も保存していません。' };
      }

      // ② ここから書く。行を作るのもここ（検査の前に作らない）
      if (!DB.confirm[id]) DB.confirm[id] = { at: nowText(), values: {} };
      let changed = 0;
      plan.forEach(({ f, k, out }) => {
        const before = DB.confirm[id].values[k];
        if (String(before == null ? '' : before) === String(out)) return;
        DB.confirm[id].values[k] = out === '' ? '' : out;
        DB.history.unshift({ at: nowText(), who: auth.person, id, item: f.sheet,
          before: String(before == null ? '' : before), after: String(out),
          reason: '管理ページから入力' });
        changed++;
      });
      return { ok: true, changed };
    }

    // メール文面の編集（管理者のみ）。検査は**本番のコードそのもの**を通す
    case 'adminMailTemplate': {
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      const kind = String(payload.kind || 'accept');
      if (kind !== 'accept' && kind !== 'reject') {
        return { ok: false, error: 'bad_request', message: '通知の種類が不正です。' };
      }
      const tpl = mailtplNow(kind);
      const def = MAILTPL.mailtplDefault_(kind);
      return { ok: true, kind,
        subject: tpl.subject, body: tpl.body, custom: !!tpl.custom,
        at: tpl.at || '', by: tpl.by || '',
        isDefault: (tpl.subject === def.subject && tpl.body === def.body),
        vars: MAILTPL.MAILTPL_VARS_().filter(v => v.kinds.includes(kind))
          .map(v => ({ name: v.name, about: v.about, sample: v.sample })),
        subjectMax: MAILTPL.MAILTPL_SUBJECT_MAX,
        bodyMax: MAILTPL.MAILTPL_BODY_MAX };
    }

    case 'adminMailTemplateSave':
    case 'adminMailTemplateReset': {
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      const kind = String(payload.kind || '');
      if (kind !== 'accept' && kind !== 'reject') {
        return { ok: false, error: 'bad_request', message: '通知の種類が不正です。' };
      }
      let subject, body;
      if (a === 'adminMailTemplateReset') {
        const def = MAILTPL.mailtplDefault_(kind);
        subject = def.subject; body = def.body;
      } else {
        subject = String(payload.subject == null ? '' : payload.subject);
        body = String(payload.body == null ? '' : payload.body);
      }
      const errs = MAILTPL.mailtplValidate_(kind, subject, body);
      if (errs.length) {
        return { ok: false, error: 'bad_value', errors: errs,
          message: errs.join(' ／ ') + '　（まだ何も保存していません）' };
      }
      const before = DB.mailTpl[kind] || { subject: '', body: '' };
      const at = nowText();
      DB.mailTpl[kind] = { subject, body, at, by: auth.person };
      const label = (kind === 'reject' ? '不採択' : '採択') + 'のご連絡';
      if (String(before.subject).trim() !== subject.trim()) {
        DB.history.unshift({ at, who: auth.person, id: '',
          item: 'メール文面：' + label + 'の件名',
          before: String(before.subject), after: subject, reason: '管理ページから編集' });
      }
      if (String(before.body) !== body) {
        DB.history.unshift({ at, who: auth.person, id: '',
          item: 'メール文面：' + label + 'の本文',
          before: MAILTPL.mailtplShort_(String(before.body)),
          after: MAILTPL.mailtplShort_(body), reason: '管理ページから編集' });
      }
      return { ok: true, kind, at,
               warnings: MAILTPL.mailtplWarnings_(kind, subject, body) };
    }

    // レンタル品目（管理者のみ）。本番と同じ歯止めにする
    case 'adminRental': {
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      return { ok: true, items: rentalRows.map(r => Object.assign({}, r)),
               kinds: RENTAL_KINDS, priceMax: 500000, maxItems: 60,
               paperDiff: rentalPaperDiff() };
    }

    case 'adminRentalSave': {
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      const it = payload.item || {};
      const name = String(it.name || '').trim();
      if (!name) return { ok: false, error: 'bad_value', message: '品目名をご記入ください。' };
      if (name.length > 60) return { ok: false, error: 'too_long', message: '品目名は60文字までです。' };
      if (!RENTAL_KINDS.includes(String(it.kind || ''))) {
        return { ok: false, error: 'bad_value', message: '種別をお選びください。' };
      }
      const row = Number(payload.row) || 0;
      const dup = rentalRows.find(x => x.name === name && x.row !== row);
      if (dup) return { ok: false, error: 'duplicate',
        message: '「' + name + '」は、すでに登録されています。' };

      // 空欄は「未定」。0 と区別する。
      // 読み取りは本番 gas/Rental.gs の rentalNumber_ と同じ厳しさにする
      let price = '';
      const praw = String(it.price == null ? '' : it.price).trim();
      if (praw !== '') {
        const got = rentalNumber(praw);
        if (!got.ok) return { ok: false, error: 'bad_value',
          message: '単価は0以上の半角数字でご記入ください（' + got.why + '）。' };
        if (got.value > 500000) return { ok: false, error: 'bad_value',
          message: '単価が高すぎます（500,000円まで）。桁をお確かめください。' };
        price = got.value;
      }
      let max = 0;
      const mraw = String(it.max == null ? '' : it.max).trim();
      if (mraw !== '') {
        const gotMax = rentalNumber(mraw);
        if (!gotMax.ok) return { ok: false, error: 'bad_value',
          message: '最大数は0以上の半角数字でご記入ください（' + gotMax.why + '）。' };
        max = Math.min(Math.floor(gotMax.value), 999);
      }

      const rec = { kind: it.kind, name, price, unit: String(it.unit || '個').slice(0, 10),
                    max, note: String(it.note || '').slice(0, 200), active: !!it.active };
      const target = rentalRows.find(x => x.row === row);
      if (target) {
        ['品目', '単価', '有効'].forEach(k => {
          const before = k === '品目' ? target.name
                       : k === '単価' ? (target.price === '' ? '（未定）' : String(target.price))
                       : (target.active ? '有効' : '無効');
          const after = k === '品目' ? rec.name
                      : k === '単価' ? (rec.price === '' ? '（未定）' : String(rec.price))
                      : (rec.active ? '有効' : '無効');
          if (before === after) return;
          DB.history.unshift({ at: nowText(), who: auth.person, id: '',
            item: 'レンタル品目：' + k, before, after, reason: '' });
        });
        Object.assign(target, rec);
        return { ok: true, row };
      }
      if (rentalRows.length >= 60) return { ok: false, error: 'too_many',
        message: '品目は60件までです。' };
      const newRow = Math.max(...rentalRows.map(x => x.row)) + 1;
      rentalRows.push(Object.assign({ row: newRow, order: newRow, w: 0, d: 0 }, rec));
      DB.history.unshift({ at: nowText(), who: auth.person, id: '',
        item: 'レンタル品目：品目', before: '', after: rec.name, reason: '' });
      return { ok: true, row: newRow };
    }

    case 'adminRentalDisable': {
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      const t = rentalRows.find(x => x.row === Number(payload.row));
      if (!t) return { ok: false, error: 'not_found' };
      DB.history.unshift({ at: nowText(), who: auth.person, id: '',
        item: 'レンタル品目：有効', before: t.active ? '有効' : '無効', after: '無効',
        reason: '「' + t.name + '」をフォームから外しました' });
      t.active = false;
      return { ok: true };
    }

    case 'adminSettings': {
      // 文言まで本番（gas/Admin.gs）と合わせる。無いと、模擬では
      // 「何も出ない」ように見えて、本番との違いに気づけない
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      // 本番と同じく、パスワードの値そのものは返さない
      return { ok: true, minPasswordLength: 16,
        fields: SETTING_FIELDS,
        values: Object.assign({}, DB.settings),
        passwords: [
          { key: '管理者パスワード', label: '管理者パスワード', set: true, weak: false },
          { key: '一般パスワード',   label: '一般パスワード',   set: true, weak: false },
        ],
        maxAssignedSpace: DB.spaces.filter(s => s.id).reduce((m, s) => Math.max(m, s.no), 0) };
    }

    case 'adminSettingsSave': {
      // 文言まで本番（gas/Admin.gs）と合わせる。無いと、模擬では
      // 「何も出ない」ように見えて、本番との違いに気づけない
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      const vals = payload.values || {};
      const pws = payload.passwords || {};
      const defs = {};
      SETTING_FIELDS.forEach(f => { defs[f.key] = f; });
      // 本番と同じ判定にする。緩いと模擬で通って本番で落ちる
      for (const k of Object.keys(vals)) {
        if (!defs[k]) return { ok: false, error: 'forbidden_field', message: 'この画面から変更できない項目です: ' + k };
        const d = defs[k], v = String(vals[k] == null ? '' : vals[k]).trim();
        if (d.type === 'deadline') {
          const m = v.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2}):(\d{2})/);
          if (!m) {
            return { ok: false, error: 'bad_value', message: '応募の締切は「2026-09-30 18:00」の形でご入力ください。' };
          }
          // 本番と同じく形をそろえて保存する。
          // ここを揃えないと、画面の表示と実際の値が食い違う
          vals[k] = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2)
                  + ' ' + ('0' + m[4]).slice(-2) + ':' + ('0' + m[5]).slice(-2);
        } else if (d.type === 'int') {
          if (!v && d.allowBlank) continue;
          const n = Number(v);
          if (!isFinite(n) || Math.floor(n) !== n || n < d.min || n > d.max) {
            return { ok: false, error: 'bad_value', message: d.label + 'の値が正しくありません。' };
          }
        } else if (d.type === 'onoff') {
          if (v !== 'ON' && v !== 'OFF') return { ok: false, error: 'bad_value', message: d.label + 'は ON か OFF です。' };
        } else if (d.type === 'email') {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
            return { ok: false, error: 'bad_value', message: d.label + 'の形をご確認ください。' };
          }
        }
      }
      let changed = 0;
      Object.keys(vals).forEach(k => {
        if (String(DB.settings[k] || '') === String(vals[k] || '')) return;
        DB.history.unshift({ at: nowText(), who: auth.person, id: '（設定）',
                             item: defs[k].label, before: String(DB.settings[k] || ''),
                             after: String(vals[k] || ''), reason: '' });
        DB.settings[k] = vals[k]; changed++;
      });
      let pwChanged = false;
      Object.keys(pws).forEach(k => {
        const v = String(pws[k] || '');
        if (!v) return;
        if (v.length < 16) { pwChanged = 'weak'; return; }
        DB.history.unshift({ at: nowText(), who: auth.person, id: '（設定）',
                             item: k, before: '（省略）', after: '（変更しました）', reason: '' });
        changed++; pwChanged = true;
      });
      if (pwChanged === 'weak') {
        return { ok: false, error: 'weak_password', message: 'パスワードは16文字以上にしてください。' };
      }
      return { ok: true, changed, passwordChanged: pwChanged === true };
    }

    case 'adminApplicantFields': {
      const ok = ['text', 'textarea', 'email', 'tel', 'url', 'number'];
      return { ok: true, fields: S.applyFields()
        .filter(f => f.sheet && ok.includes(f.type))
        .map(f => ({ key: f.key, sheet: f.sheet, label: f.label, type: f.type,
                     maxLength: f.maxLength || 0 })) };
    }

    case 'adminApplicantUpdate': {
      const reason = String(payload.reason || '').trim();
      // 本番と同じく理由を必須にする。ここを緩めると、模擬では通るのに本番で弾かれる
      if (reason.length < 5) {
        return { ok: false, error: 'reason_required',
          message: 'なぜ変更したのかを、5文字以上でご記入ください。' };
      }
      const r = DB.rows.find(x => x['受付ID'] === payload.id);
      if (!r) return { ok: false, error: 'not_found' };
      const ok2 = ['text', 'textarea', 'email', 'tel', 'url', 'number'];
      const allowed = Object.create(null);
      S.applyFields().filter(f => f.sheet && ok2.includes(f.type))
        .forEach(f => { allowed[f.key] = f; });
      const bad = Object.keys(payload.patch || {}).filter(k => !allowed[k]);
      if (bad.length) {
        return { ok: false, error: 'forbidden_field',
          message: 'この画面から変更できない項目です: ' + bad.join(', ') };
      }
      // 本番と同じ上限（gas/Admin.gs の REASON_MAX / FIELD_TEXT_MAX）
      if (reason.length > 500) {
        return { ok: false, error: 'too_long', message: '理由が長すぎます。' };
      }
      const over = Object.keys(payload.patch || {}).filter(k => {
        const lim = allowed[k].maxLength || 5000;
        return String(payload.patch[k] == null ? '' : payload.patch[k]).length > lim;
      });
      if (over.length) {
        return { ok: false, error: 'too_long',
          message: '長すぎる項目があります: ' + over.map(k => allowed[k].label).join(', ') };
      }
      // 担当者メールは、事業者さまご本人の確認に使う。一般には開かない
      if (payload.patch && payload.patch.contactEmail !== undefined && auth.role !== '管理者') {
        return { ok: false, error: 'forbidden_field',
          message: 'ご担当者さまのメールアドレスは、管理者のみが変更できます。' };
      }

      const items = [];
      Object.keys(payload.patch || {}).forEach(k => {
        const f = allowed[k];
        const before = String(r[f.sheet] == null ? '' : r[f.sheet]);
        const after = String(payload.patch[k] == null ? '' : payload.patch[k]);
        if (before === after) return;
        r[f.sheet] = after;
        DB.history.unshift({ at: nowText(), who: auth.person, id: payload.id,
                             item: f.label, before, after, reason });
        items.push(f.label);
      });

      // 生データも一緒に直す（本番と同じ。ここを忘れると食い違いに気づけない）
      if (items.length) {
        let raw = {};
        try { raw = JSON.parse(r['生データ(JSON)'] || '{}') || {}; } catch (e) {}
        Object.keys(payload.patch || {}).forEach(k => { raw[k] = payload.patch[k]; });
        r['生データ(JSON)'] = JSON.stringify(raw);
      }
      return { ok: true, changed: items.length, items };
    }

    case 'adminHistory': {
      const limit = Math.min(Math.max(Number(payload.limit) || 200, 1), 500);
      let rows = DB.history;
      if (payload.id) rows = rows.filter(h => h.id === payload.id);
      // **本番は operator という名前で返す**（gas/Admin.gs の adminHistory_）。
      // ここが who のままだったので、模擬では画面の「操作者」欄が
      // ずっと空欄に見えていた（2026-09-03 の検証で指摘）。
      // 名前が違うだけで、画面は何のエラーも出さずに空を表示する
      return { ok: true, total: DB.history.length,
               rows: rows.slice(0, limit).map(h => ({
                 at: h.at, operator: h.who, id: h.id, item: h.item,
                 before: h.before, after: h.after, reason: h.reason,
               })) };
    }

    case 'adminPeople':
      // 文言まで本番（gas/Admin.gs）と合わせる。無いと、模擬では
      // 「何も出ない」ように見えて、本番との違いに気づけない
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      return { ok: true, me: auth.person, people: PEOPLE.map(p => Object.assign({}, p)) };

    case 'adminPeopleSave': {
      // 文言まで本番（gas/Admin.gs）と合わせる。無いと、模擬では
      // 「何も出ない」ように見えて、本番との違いに気づけない
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      const v = payload.person || {};
      const name = String(v.name || '').trim();
      if (!name) return { ok: false, error: 'bad_value', message: '氏名を入力してください。' };
      const email = String(v.email || '').trim();
      if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
        return { ok: false, error: 'bad_value', message: 'メールアドレスの形をご確認ください。' };
      }
      if (v.canLogin && !email) {
        return { ok: false, error: 'bad_value', message: '管理ページを使う方には、メールアドレスが要ります。' };
      }
      const row = Number(payload.row) || 0;
      if (PEOPLE.some(p => p.name === name && p.row !== row)) {
        return { ok: false, error: 'duplicate', message: '同じ氏名の方がすでに登録されています（' + name + '）。' };
      }
      // 締め出しの歯止め。ここを本番と揃えておかないと、
      // 模擬では通るのに本番で弾かれる（またはその逆）という食い違いが起きる
      const after = PEOPLE.map(p => p.row === row
        ? { name, canLogin: !!v.canLogin, role: v.role || '一般' }
        : { name: p.name, canLogin: p.canLogin, role: p.role });
      if (!row) after.push({ name, canLogin: !!v.canLogin, role: v.role || '一般' });
      if (!after.some(p => p.canLogin && p.role === '管理者')) {
        return { ok: false, error: 'lockout', message: '管理者が誰もいなくなります。先に別の方を管理者にしてください。' };
      }
      const meAfter = after.find(p => p.name === auth.person);
      if (meAfter && !(meAfter.canLogin && meAfter.role === '管理者')) {
        return { ok: false, error: 'lockout', message: 'ご自身の管理者権限は外せません。' };
      }
      const rec = {
        row: row || (PEOPLE.length ? Math.max.apply(null, PEOPLE.map(p => p.row)) + 1 : 2),
        name, org: String(v.org || ''), dept: String(v.dept || ''), email,
        formVisible: !!v.formVisible, canLogin: !!v.canLogin,
        role: v.role || '一般', notify: !!v.notify,
      };
      const at = PEOPLE.findIndex(p => p.row === row);
      if (at >= 0) PEOPLE[at] = rec; else PEOPLE.push(rec);
      return { ok: true, row: rec.row, added: at < 0 };
    }

    // ── 採択通知の一括送信（本番は gas/Notify.gs）
    //
    // ここは**本当にメールを送らない**。送ったつもりで台帳の日時だけを埋め、
    // 画面の動きと歯止め（件数の食い違い・上限・宛先の形）を確かめられるようにする。
    // 歯止めの条件は本番と揃えること。緩いと「模擬では通るのに本番で弾かれる」。
    case 'adminNotifyPreview': {
      // 文言まで本番（gas/Admin.gs）と合わせる。無いと、模擬では
      // 「何も出ない」ように見えて、本番との違いに気づけない
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      // 本番と同じく、種類（採択／不採択）で切り替える
      const K = MAIL_KINDS[String(payload.kind || 'accept')];
      if (!K) return { ok: false, error: 'bad_request', message: '通知の種類が不正です。' };
      // **もう片方の通知を送ってしまっている行**は一斉送信に混ぜない（本番と同じ）。
      // 「出店が決定いたしました」を受け取った方に、あとから
      // 「見送らせていただきました」が自動で届くのを止める
      const other = K.kind === 'accept' ? MAIL_KINDS.reject : MAIL_KINDS.accept;
      const all0 = DB.rows.filter(r => r['ステータス'] === K.status && !r[K.sentCol]);
      const flipped = all0.filter(r => r[other.sentCol]).map(r => ({
        id: r['受付ID'], company: r['企業名'],
        sentAt: r[other.sentCol], sentLabel: other.label,
      }));
      const pend = all0.filter(r => !r[other.sentCol]);
      const okRows = pend.filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r['担当者メール'] || ''));
      const bad = pend.filter(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r['担当者メール'] || ''));
      const s0 = okRows[0];
      return {
        ok: true,
        kind: K.kind, kindLabel: K.label,
        rows: okRows.map(r => ({ id: r['受付ID'], company: r['企業名'],
          shopName: r['出店名'], person: r['担当者氏名'],
          email: r['担当者メール'], staff: r['FC大阪担当社員'] })),
        invalid: bad.map(r => ({ id: r['受付ID'], company: r['企業名'], email: r['担当者メール'] })),
        flipped,
        // 見本は**種類で切り替える**。ここを採択で固定していたため、
        // 「不採択のご連絡」を選んでも出店決定の文面が出ていた（2026-09-03 発見）。
        // この画面の3段階（相手を確かめる→本文を読む→送る）の
        // **2段目が機能していなかった**ことになる
        sample: s0 ? mockMailSample(K.kind, s0) : null,
        batchMax: 40,
        deadlineText: '出店可否のご連絡から5営業日以内',
        // **設定シートの値から作る**（本番 adminNotifyPreview_ と同じ）。
        // 直書きしていたので、設定が空でも見本にはリンクが出て、
        // 警告と本文が逆のことを言っていた（2026-09-04 の最終確認で指摘）
        urls: { confirm: DB.settings['確定情報フォームURL'] || '',
                upload: DB.settings['素材アップロードURL'] || '' },
        mail: { aliasRegistered: true, from: 'fcosaka_bondance@kreha-c.com',
                replyTo: 'fcosaka_bondance@kreha-c.com', remainingQuota: 1500,
                note: '（模擬）エイリアスは登録済みです。' },
      };
    }

    case 'adminNotifySend': {
      // 文言まで本番（gas/Admin.gs）と合わせる。無いと、模擬では
      // 「何も出ない」ように見えて、本番との違いに気づけない
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      if (payload.confirm !== true) {
        return { ok: false, error: 'not_confirmed', message: '送信の確認が取れていません。' };
      }
      const K2 = MAIL_KINDS[String(payload.kind || 'accept')];
      if (!K2) return { ok: false, error: 'bad_request', message: '通知の種類が不正です。' };
      const other2 = K2.kind === 'accept' ? MAIL_KINDS.reject : MAIL_KINDS.accept;
      const pend = DB.rows.filter(r => r['ステータス'] === K2.status && !r[K2.sentCol])
        .filter(r => !r[other2.sentCol])
        .filter(r => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r['担当者メール'] || ''));

      // **件数ではなく、受付IDの集合そのものを突き合わせる（本番と同じ）。**
      // 模擬が件数だけを見ていたせいで、画面が ids を送っていない不具合を
      // 見逃していた（本番では必ず changed で弾かれていた・2026-09-03 発見）。
      const nowIds = pend.map(r => r['受付ID']).sort();
      const sawIds = (Array.isArray(payload.ids) ? payload.ids : []).map(String).sort();
      if (nowIds.join(',') !== sawIds.join(',')) {
        const added = nowIds.filter(i => !sawIds.includes(i));
        const gone = sawIds.filter(i => !nowIds.includes(i));
        return { ok: false, error: 'changed',
          message: '対象が変わりました。もう一度、対象一覧をご確認ください。'
                 + (added.length ? '（増えた：' + added.join('、') + '）' : '')
                 + (gone.length ? '（外れた：' + gone.join('、') + '）' : '') };
      }
      if (!pend.length) return { ok: false, error: 'empty', message: '送信対象がありません。' };

      const batch = pend.slice(0, 40);
      const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const sent = batch.map(r => {
        r[K2.sentCol] = now;
        DB.history.unshift({ at: now, who: auth.person, id: r['受付ID'],
          // 本番（gas/Notify.gs:515）は K.label を使う。ここを固定にしていたので、
          // 不採択を送っても変更履歴には「採択通知」と残っていた
          item: K2.label, before: '未送信', after: '送信済み', reason: '一括送信' });
        return { id: r['受付ID'], company: r['企業名'], email: r['担当者メール'] };
      });
      return { ok: true, sent, failed: [], remaining: pend.length - batch.length,
               message: sent.length + '件を送信しました。（模擬サーバーなので実際には送っていません）' };
    }

    // ── 資料置き場（本番は gas/Docs.gs）。Driveの代わりにメモリ上で持つ
    case 'adminDocs': {
      // 本番と同じく、まだ1件も出していない採択先も0件の行として並べる。
      // Driveにあるフォルダだけだと「誰がまだ出していないか」が分からない
      const vIds = new Set(Object.keys(DB.vendorFiles));
      DB.rows.filter(r => r['ステータス'] === '採択')
             .forEach(r => vIds.add(r['受付ID']));
      const vendor = Array.from(vIds).sort().map(id => ({
        id, company: (DB.rows.find(r => r['受付ID'] === id) || {})['企業名'] || '',
        url: 'https://drive.google.com/drive/folders/mock',
        files: (DB.vendorFiles[id] || []).slice().reverse(),
      }));
      return { ok: true,
        rootUrl: 'https://drive.google.com/drive/folders/mock',
        // 本番（gas/Docs.gs）と同じく、直下のものを『（未分類）』として先頭に出す。
        // 中身が無いときは出さない
        folders: ['（未分類）', '図面', '議事録', 'その他']
          .filter(n => n !== '（未分類）' || DB.docs[n].length)
          .map(n => ({
            name: n, url: 'https://drive.google.com/drive/folders/mock',
            files: DB.docs[n].slice().reverse(), more: false,
            note: n === '（未分類）'
              ? 'フォルダの一番上に置かれているものです。区分に移すと、上の各欄に並びます。'
              : undefined })),
        vendor,
        // 提出物は資料フォルダの外（共有しない場所）にある
        submissionsUrl: 'https://drive.google.com/drive/folders/mock-submissions',
        subfolders: ['図面', '議事録', 'その他'],
        maxBytes: MOCK_UPLOAD_MAX, maxSizeText: mockSize(MOCK_UPLOAD_MAX) };
    }

    case 'adminDocsUpload': {
      const folder = String(payload.folder || '');
      // 出店者提出物には置かせない（本番と同じ）。あそこは事業者本人の場所で、
      // こちらが混ぜると「誰が出したのか」が分からなくなる
      if (['図面', '議事録', 'その他'].indexOf(folder) < 0) {
        return { ok: false, error: 'bad_folder',
          message: '置き先をお選びください（出店者提出物には置けません）。' };
      }
      const data = String(payload.data || '');
      if (!data) return { ok: false, error: 'empty', message: 'ファイルを読み取れませんでした。' };
      const approx = Math.floor(data.length * 3 / 4);
      if (approx > MOCK_UPLOAD_MAX) {
        return { ok: false, error: 'too_large',
          message: 'ファイルが大きすぎます（1つあたり ' + mockSize(MOCK_UPLOAD_MAX) + ' まで）。' };
      }
      const f = { id: 'mock-doc-' + Date.now(),
                  name: String(payload.name || '資料').replace(/[\/\\:*?"<>|]/g, '_'),
                  size: approx, sizeText: mockSize(approx),
                  updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
                  url: 'https://drive.google.com/file/d/mock/view', folder };
      DB.docs[folder].push(f);
      DB.history.unshift({ at: f.updated, who: auth.person, id: '', item: '資料',
        before: '', after: folder + '／' + f.name, reason: '資料の追加' });
      return { ok: true, file: f };
    }

    case 'adminDocsDelete': {
      // 文言まで本番（gas/Admin.gs）と合わせる。無いと、模擬では
      // 「何も出ない」ように見えて、本番との違いに気づけない
      if (auth.role !== '管理者') return { ok: false, error: 'forbidden',
        message: 'この操作は管理者のみです。' };
      const fid = String(payload.fileId || '');
      let found = null;
      ['（未分類）', '図面', '議事録', 'その他'].forEach(n => {
        const at = DB.docs[n].findIndex(x => x.id === fid);
        if (at >= 0) { found = DB.docs[n][at].name; DB.docs[n].splice(at, 1); }
      });
      Object.keys(DB.vendorFiles).forEach(id => {
        const at = DB.vendorFiles[id].findIndex(x => x.id === fid);
        if (at >= 0) { found = DB.vendorFiles[id][at].name; DB.vendorFiles[id].splice(at, 1); }
      });
      if (!found) return { ok: false, error: 'not_found', message: 'ファイルが見つかりません。' };
      DB.history.unshift({ at: new Date().toISOString().slice(0, 16).replace('T', ' '),
        who: auth.person, id: '', item: '資料', before: found, after: '（削除）',
        reason: '資料の削除' });
      return { ok: true, name: found };
    }

    default: return { ok: false, error: 'unknown_action' };
  }
}

/**
 * admin.html を、この模擬サーバー自身に向けて配る。
 *
 * admin.html にはビルド時点の本番GASのURLが焼き込まれている。
 * そのまま配ると、模擬サーバーの画面から本番へ書きに行ってしまう。
 * かといって src/endpoint.json を localhost に書き換えて試すやり方は、
 * **戻し忘れたまま公開する**という、より悪い事故を招く。
 * そこで配信のときだけ差し替える。元のファイルには手を触れない。
 */
function serveAdminHtml(extraHead, extraBody) {
  return fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8')
    .replace(/var GAS_URL = "[^"]*"/, 'var GAS_URL = "http://localhost:' + PORT + '/api"')
    .replace('</head>', (extraHead || '') + '</head>')
    .replace('</body>', (extraBody || '') + '</body>');
}

// ──────────────────────────────────────────── サーバー
/**
 * 読み込んだだけでは起動しない（`node src/mock.js` で実行したときだけ立てる）。
 * テストから `handle` を直接呼んで、**実際の応答**を確かめられるようにするため。
 * 「認証の前に振り分けているか」を位置や文字列で見る検査は、
 * `if (false && …)` や名前の付け替えで簡単に素通りした。
 */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (e) {}
      let out;
      try { out = handle(payload); }
      catch (e) { out = { ok: false, error: 'server_error', message: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    });
    return;
  }

  // 開発用の自動入室。?autologin=admin|staff を付けると入室済みで開く。
  // 画面をそのまま撮って残したいときに使う（headless Chrome には手で入室できないため）。
  // このファイルは開発専用で公開物には入らない。本番のGASにこの経路は無い。
  const auto = /[?&]autologin=(admin|staff)/.exec(req.url);
  if (auto && url === '/admin.html') {
    const role = auto[1] === 'admin' ? '管理者' : '一般';
    const me = PEOPLE.find(x => (role === '管理者') === (x.role === '管理者'));
    const sess = JSON.stringify({ token: issue(me.name, role), person: me.name, role });
    // ?probe=<base64のスクリプト> を付けると、その中身を画面に差し込む。
    // 「押したらどうなるか」を人手なしで確かめるための開発用の入口。
    // base64 の + と = は URL 上では %2B / %3D になる。
    // 文字種で切り出すと途中で止まり、壊れたスクリプトが黙って差し込まれる
    const pr = /[?&]probe=([^&]+)/.exec(req.url);
    const probe = pr ? Buffer.from(decodeURIComponent(pr[1]), 'base64').toString('utf8') : '';
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    return res.end(serveAdminHtml(
      '<script>try{localStorage.setItem("bondance.admin.session",'
      + JSON.stringify(sess) + ')}catch(e){}</scr' + 'ipt>',
      probe ? '<script>' + probe + '</scr' + 'ipt>' : ''));
  }

  // 出店確定情報フォーム。本番の送信先を、この模擬サーバーに差し替えて配る。
  // トークンは受付IDから作れるので、リンクは
  //   /confirm.html?id=SB-0001&t=<mockToken('SB-0001')>
  // 起動時に見本のURLを表示する。
  if (url === '/confirm.html' || url === '/upload.html') {
    const name = url.slice(1);
    const f = path.join(ROOT, name);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(name + ' がありません'); }
    let html = fs.readFileSync(f, 'utf8');
    const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'endpoint.json'), 'utf8')).gasUrl;
    html = html.split(live).join('http://localhost:' + PORT + '/api');
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    return res.end(html);
  }

  // 手で入室する場合も、宛先はこの模擬サーバーに向ける。
  // 入室そのものを確かめたいので、こちらでも probe を受ける
  if (url === '/admin.html' || url === '/') {
    const pr2 = /[?&]probe=([^&]+)/.exec(req.url);
    const probe2 = pr2 ? Buffer.from(decodeURIComponent(pr2[1]), 'base64').toString('utf8') : '';
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    return res.end(serveAdminHtml('', probe2 ? '<script>' + probe2 + '</scr' + 'ipt>' : ''));
  }

  let p = decodeURIComponent(url);
  if (p === '/') p = '/admin.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

module.exports = { handle, mockToken, DB, PORT };

if (require.main !== module) return;

server.listen(PORT, () => {
  console.log('模擬サーバー  http://localhost:' + PORT + '/admin.html');
  var sample = DB.rows.filter(function (r) { return r['ステータス'] === '採択'; })[0];
  if (sample) {
    console.log('確定情報フォーム  http://localhost:' + PORT + '/confirm.html?id='
      + sample['受付ID'] + '&t=' + mockToken(sample['受付ID']));
    console.log('素材アップロード  http://localhost:' + PORT + '/upload.html?id='
      + sample['受付ID'] + '&t=' + mockToken(sample['受付ID']));
  }
  console.log('パスワード    admin（管理者） / staff（一般）');
});
