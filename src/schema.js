/**
 * サステナ盆踊り 出店応募フォーム 項目定義（単一の正）
 *
 * このファイルが唯一の定義元。ここから以下がすべて生成される：
 *   - 応募フォームのHTML（入力欄・条件表示・バリデーション）
 *   - GAS側の受信時検証（Schema.gs）
 *   - 応募一覧シートの列順とヘッダー
 *   - 受付確認メール／応募通知メールの本文
 *
 * 項目を増減するときはこのファイルだけを直し、build で再生成する。
 * フォームだけ直して台帳の列がずれる、という事故を構造的に防ぐための設計。
 *
 * イベント固有の値（開催日・会場・区画数・単価など）はここに書かない。
 * それらは設定シートから読む（仕様書§0 設計原則：別イベントへ転用可能にする）。
 */

const SECTIONS = [
  { id: 'applicant', title: '出店者情報', desc: '' },
  { id: 'content',   title: '出店内容',   desc: '' },
  { id: 'space',     title: '区画・電源', desc: '' },
  { id: 'rental',    title: 'レンタル備品（有料）', desc: 'レンタルされない場合は、すべて持ち込みが必須です。' },
  { id: 'operation', title: '当日の運営', desc: '' },
  { id: 'consent',   title: 'ご確認',     desc: '' },
];

/**
 * type:
 *   text / email / tel / url / textarea / number / radio / checkboxes / select / consent / honeypot
 * required:
 *   true | false | { field, op, value }   条件付き必須（条件を満たすときだけ必須）
 * showIf:
 *   { field, op, value }                  条件付き表示。op は eq / ne / includes / truthy
 * sheet:
 *   台帳の列見出し。null なら台帳に列を作らない（honeypot 等）
 */
const FIELDS = [
  // ───────────────────────── 出店者情報
  {
    key: 'companyName', section: 'applicant', type: 'text', required: true,
    label: '企業名', sheet: '企業名', maxLength: 100, autocomplete: 'organization',
  },
  {
    key: 'boothName', section: 'applicant', type: 'text', required: false,
    label: '出店名', sheet: '出店名', maxLength: 100,
    help: '企業名と異なる場合のみご記入ください。当日の掲示や告知に使用します。',
  },
  {
    key: 'contactName', section: 'applicant', type: 'text', required: true,
    label: 'ご担当者さまのお名前', sheet: '担当者氏名', maxLength: 50, autocomplete: 'name',
  },
  {
    key: 'contactEmail', section: 'applicant', type: 'email', required: true,
    label: 'ご担当者さまのメールアドレス', sheet: '担当者メール', maxLength: 254,
    help: 'このアドレスに受付確認メールと出店可否のご連絡をお送りします。',
    autocomplete: 'email',
  },
  {
    key: 'contactPhone', section: 'applicant', type: 'tel', required: true,
    label: 'ご担当者さまの電話番号', sheet: '担当者電話', maxLength: 20,
    help: '当日ご連絡のつく番号をご記入ください。', autocomplete: 'tel',
  },
  {
    key: 'websiteUrl', section: 'applicant', type: 'url', required: false,
    label: '会社HP・SNSのURL', sheet: 'HP・SNS', maxLength: 300,
    help: 'イベント告知でご紹介する際に使用します。',
  },
  {
    key: 'fcosakaStaff', section: 'applicant', type: 'select', required: true,
    label: 'FC大阪の担当社員', sheet: 'FC大阪担当社員',
    help: 'お声がけした担当者をお選びください。お名前の一部を入力すると絞り込めます。',
    searchable: true,
    // 選択肢は GAS が関係者シート（フォーム表示＝有効）から配信する。
    // 取得に失敗しても応募を止めないため、この既定値だけは常に存在させる。
    fallbackOptions: ['わからない／FC大阪以外からの紹介'],
    unknownOption: 'わからない／FC大阪以外からの紹介',
  },

  // ───────────────────────── 出店内容
  {
    key: 'boothTypes', section: 'content', type: 'checkboxes', required: true,
    label: '出店の形態', sheet: '出店形態',
    help: '当てはまるものをすべてお選びください。',
    options: ['飲食', 'ワークショップ', '展示', '体験コンテンツ', 'その他'],
  },
  {
    key: 'boothTypeOther', section: 'content', type: 'text',
    label: '出店形態（その他の内容）', sheet: '出店形態その他', maxLength: 100,
    showIf:   { field: 'boothTypes', op: 'includes', value: 'その他' },
    required: { field: 'boothTypes', op: 'includes', value: 'その他' },
  },
  {
    key: 'boothDescription', section: 'content', type: 'textarea', required: true,
    label: '出店内容のご説明', sheet: '出店内容', maxLength: 1000, rows: 5,
    help: '販売商品・メニュー・価格帯・体験の内容をご記入ください。体験系の場合は、所要時間・同時参加人数・対象年齢もあわせてご記載ください。',
  },
  {
    key: 'fireUse', section: 'content', type: 'radio', required: true,
    label: '火気の使用', sheet: '火気使用',
    options: ['使用しない', 'ガス', '炭', 'IH・電気調理器', 'その他'],
  },
  {
    key: 'fireUseOther', section: 'content', type: 'text',
    label: '火気（その他の内容）', sheet: '火気その他', maxLength: 100,
    showIf:   { field: 'fireUse', op: 'eq', value: 'その他' },
    required: { field: 'fireUse', op: 'eq', value: 'その他' },
  },
  {
    key: 'foodLicense', section: 'content', type: 'radio',
    label: '飲食の営業許可', sheet: '営業許可',
    help: '飲食の出店には保健所の臨時営業許可が必要です。取得は出店者さまでお願いしております。',
    options: ['取得済み', '取得予定', '不要', '不明'],
    showIf:   { field: 'boothTypes', op: 'includes', value: '飲食' },
    required: { field: 'boothTypes', op: 'includes', value: '飲食' },
  },
  {
    key: 'tableware', section: 'content', type: 'radio',
    label: '食器・包材の持込予定', sheet: '食器・包材',
    help: 'サステナビリティをテーマとするイベントのため、包材等について主催側からご相談させていただく場合があります。',
    options: ['リユース食器', '紙・木・バイオマス等の環境配慮素材', 'プラスチック', '未定'],
    showIf:   { field: 'boothTypes', op: 'includes', value: '飲食' },
    required: { field: 'boothTypes', op: 'includes', value: '飲食' },
  },
  {
    key: 'sustainability', section: 'content', type: 'textarea', required: false,
    label: 'サステナビリティに関する取り組み（PR用）', sheet: 'サステナ取り組み',
    maxLength: 1000, rows: 4,
    help: '環境や地域への取り組みがあればご記入ください。イベントの告知や実施報告でご紹介させていただく場合があります。',
  },

  // ───────────────────────── 区画・電源
  {
    key: 'boothSize', section: 'space', type: 'radio', required: true,
    label: 'ご希望の区画', sheet: '希望区画',
    help: '1区画は間口1間×奥行2間（約1.8m×3.6m）です。',
    // value は台帳・マップと共有する正規化キー。label が画面表示。
    options: [
      { value: 'S1', label: '間口1間×奥行2間（1区画／約1.8m×3.6m）', units: 1 },
      { value: 'S2', label: '間口2間×奥行2間（2区画／約3.6m×3.6m）', units: 2 },
      { value: 'S3', label: '間口3間×奥行2間（3区画／約5.4m×3.6m）', units: 3 },
    ],
  },
  {
    key: 'power', section: 'space', type: 'radio', required: true,
    label: '電源', sheet: '電源',
    help: 'レンタルの可否・料金は追ってご案内します。',
    options: ['必要（発電機を持ち込む）', 'レンタルを希望する（要確認）', '不要'],
  },
  {
    key: 'generatorCapacity', section: 'space', type: 'text',
    label: '持ち込む発電機の容量（kVA）', sheet: '発電機容量', maxLength: 30,
    showIf:   { field: 'power', op: 'eq', value: '必要（発電機を持ち込む）' },
    required: { field: 'power', op: 'eq', value: '必要（発電機を持ち込む）' },
  },
  {
    key: 'powerDevices', section: 'space', type: 'text',
    label: '使用予定の機器', sheet: '使用機器', maxLength: 200,
    help: '例：冷蔵ショーケース、電気フライヤー、照明',
    showIf:   { field: 'power', op: 'ne', value: '不要' },
    required: { field: 'power', op: 'ne', value: '不要' },
  },
  {
    key: 'powerWatt', section: 'space', type: 'number',
    label: '合計消費電力（W）', sheet: '合計消費電力(W)', min: 0, max: 100000,
    showIf:   { field: 'power', op: 'ne', value: '不要' },
    required: { field: 'power', op: 'ne', value: '不要' },
    // このチェックが入っているときは数値未入力でも通す
    unknownCheckbox: { key: 'powerWattUnknown', label: 'わからない', sheet: '消費電力不明' },
  },

  // ───────────────────────── レンタル備品
  // 単価は設定シートから読む。未設定の間は「単価：調整中」と表示し、数量のみ受け付ける。
  {
    key: 'rentalTent', section: 'rental', type: 'consent',
    label: 'テントをレンタルする', sheet: 'テントレンタル',
    // 区画サイズ＝テントサイズ。1区画に2張りは物理的に入らないため数量は1で固定する。
    // 2張り必要な場合は「ブースごとに応募」の運用で表現する。
    help: 'お選びいただいた区画と同じサイズのテントをご用意します（1張り）。レンタルされない場合はご持参ください。',
    priceKey: 'tent', quantityFixed: 1,
  },
  {
    key: 'rentalTable', section: 'rental', type: 'number', required: false,
    label: '長机（1800×450）', sheet: '長机', min: 0, max: 20, default: 0,
    priceKey: 'table', unitLabel: '台',
  },
  {
    key: 'rentalChair', section: 'rental', type: 'number', required: false,
    label: 'パイプ椅子', sheet: 'パイプ椅子', min: 0, max: 40, default: 0,
    priceKey: 'chair', unitLabel: '脚',
  },

  // ───────────────────────── 当日の運営
  {
    key: 'vehicleCount', section: 'operation', type: 'number', required: true,
    label: '搬入車両の台数', sheet: '搬入車両台数', min: 0, max: 20, default: 0,
    help: '搬入は8:30〜10:30です。搬入後の駐車場所は別途ご案内します。',
  },
  {
    key: 'parkingRequest', section: 'operation', type: 'radio', required: true,
    label: '駐車場の利用', sheet: '駐車場利用',
    options: ['希望する', '希望しない'],
  },
  {
    key: 'staffCount', section: 'operation', type: 'number', required: true,
    label: '当日のスタッフ人数', sheet: 'スタッフ人数', min: 1, max: 50,
  },
  {
    key: 'rainPolicy', section: 'operation', type: 'radio', required: true,
    label: '雨天時の対応', sheet: '雨天時対応',
    help: '雨天実施・荒天中止です。中止の判断はサッカーの試合開催に準じます。',
    options: ['雨天でも出店する', '雨天の場合は出店を辞退する'],
  },
  {
    key: 'notes', section: 'operation', type: 'textarea', required: false,
    label: '備考・ご質問', sheet: '備考', maxLength: 1000, rows: 4,
    help: '搬入・撤収時間のご相談もこちらにご記入ください。',
  },

  // ───────────────────────── 同意
  {
    key: 'agreeTerms', section: 'consent', type: 'consent', required: true,
    label: '上記の出店条件（営業時間・車両の進入・ごみの持ち帰り・包材・天候・各種届出）を確認し、同意します',
    sheet: '条件同意',
  },
  {
    key: 'agreePrivacy', section: 'consent', type: 'consent', required: true,
    label: 'ご記入いただいた情報を本イベントの運営目的以外には使用しないことを確認しました',
    sheet: '個人情報同意',
  },

  // ───────────────────────── スパム対策（画面には出さない）
  {
    key: 'website2', section: 'consent', type: 'honeypot', sheet: null,
    label: 'この欄は入力しないでください',
  },
];

/** 管理側で付与する列。応募者の入力列のあとに、この順で並ぶ。 */
const ADMIN_COLUMNS = [
  '受付ID', '受付日時', 'ステータス',
  '割当開始区画', '割当区画数', '主形態',
  '担当メモ', '可否連絡日', '採択通知送信日時',
  '搬入予定時刻', '撤収予定時刻', '当日ステータス',
  '素材トークン', '素材提出フォルダURL', '重複フラグ',
];

const STATUS = ['未確認', '審査中', '採択', '不採択', '辞退', 'キャンセル', '重複（無効）'];
const DAY_STATUS = ['未着', '搬入済', '設営完了', '撤収完了'];

/** 台帳「応募一覧」の列見出しを、この定義から機械的に組み立てる。 */
function ledgerHeaders() {
  const cols = [];
  for (const f of FIELDS) {
    if (!f.sheet) continue;
    cols.push(f.sheet);
    if (f.unknownCheckbox) cols.push(f.unknownCheckbox.sheet);
  }
  return ['受付ID', '受付日時']
    .concat(cols)
    .concat(ADMIN_COLUMNS.filter(c => c !== '受付ID' && c !== '受付日時'));
}

/** showIf / required の条件を評価する。フォームとGASの両方が同じ関数を使う。 */
function testCondition(cond, values) {
  if (!cond) return true;
  const v = values[cond.field];
  switch (cond.op) {
    case 'eq':       return v === cond.value;
    case 'ne':       return v !== undefined && v !== '' && v !== cond.value;
    case 'includes': return Array.isArray(v) && v.indexOf(cond.value) !== -1;
    case 'truthy':   return !!v;
    default:         return true;
  }
}

function isVisible(field, values) {
  return testCondition(field.showIf, values);
}

function isRequired(field, values) {
  if (field.required === true) return true;
  if (!field.required) return false;
  return testCondition(field.required, values);
}

const SCHEMA = {
  SECTIONS, FIELDS, ADMIN_COLUMNS, STATUS, DAY_STATUS,
  ledgerHeaders, testCondition, isVisible, isRequired,
};

if (typeof module !== 'undefined' && module.exports) module.exports = SCHEMA;
