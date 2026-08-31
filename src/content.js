/**
 * イベント概要の文言（仕様書 §3-1）。
 *
 * ここはイベント固有の情報なので、別イベントへ転用するときはこのファイルを差し替える。
 * コード側（build-form.js / schema.js）はこの中身を知らない構造にしてある。
 *
 * 値が未確定（仕様書のX項目）のものは placeholder:true を付けている。
 * 確定したらここを直して再ビルドする。設定シートで動かせるもの（締切・単価・
 * 来場者数の表記）はここには置かず、GASから受け取る。
 */

const EVENT = {
  name: 'FC OSAKA×UPDATER サステナ盆踊り',
  organizer: 'サステナ盆踊り実行委員会',
  organizerNote: 'FC大阪／UPDATER',
  date: '2026年10月24日（土）',
  venue: '東大阪市花園ラグビー場（場外エリア）',
  hours: '11:00〜17:30',
  fee: '無料',
};

/** 要約カード：スマホで最初に目に入る4つ（monitor A1：知りたいのは、いつ・どこ・いくら・締切） */
const SUMMARY = [
  { label: '開催日',   value: EVENT.date,  icon: 'calendar' },
  { label: '会場',     value: '花園ラグビー場 場外エリア', icon: 'pin' },
  { label: '出店料',   value: '無料',      icon: 'tag' },
  { label: '応募締切', value: '',          icon: 'clock', fromConfig: 'deadline' },
];

/**
 * 詳細。折りたたまずに全文を出す（けいた判断：畳みたくない）。
 * group ごとにカードで区切り、サマリだけ見ても分かるようにする。
 */
const DETAILS = [
  {
    group: '開催概要',
    items: [
      { label: 'イベント名', value: EVENT.name },
      { label: '主催',       value: EVENT.organizer + '（' + EVENT.organizerNote + '）' },
      { label: '開催日',     value: EVENT.date },
      { label: '会場',       value: EVENT.venue },
      { label: '営業時間',   value: EVENT.hours },
      {
        label: 'タイムライン',
        value: 'イベント開始 11:00 ／ KICK OFF 14:00（FC大阪 vs 鹿児島ユナイテッドFC） ／ 盆踊り 16:15〜',
      },
      { label: '来場について', value: '', fromConfig: 'attendanceNote' },
    ],
  },
  {
    group: '出店条件',
    items: [
      { label: '出店料', value: '無料' },
      {
        label: '区画',
        value: '1区画＝間口1間×奥行2間（約1.8m×3.6m）。'
             + 'テントは区画と同じサイズのものをレンタルいただくか、ご持参ください。',
      },
      { label: 'レンタル備品', value: 'テント・長机・パイプ椅子をご用意しています（有料）。', priceNote: true },
      {
        label: 'お支払い',
        value: '方法・時期は追ってご連絡いたします。請求書の発行に対応します'
             + '（領収書の発行はいたしかねます）。',
      },
      {
        label: '複数ブース',
        value: '複数のブースをご希望の場合は、ブースごとにご応募ください。',
      },
    ],
  },
  {
    group: '当日の運営',
    items: [
      { label: '搬入', value: '8:30〜10:30' },
      { label: '撤収', value: '17:30〜19:30' },
      {
        label: '車両の進入',
        value: '搬入・撤収の時間以外は車両の進入ができません。'
             + '記載の時間以外での搬入出、および開始・終了時間の変更をご希望の場合はご相談ください。',
      },
      { label: '駐車場', value: '搬入後の駐車場所は別途ご案内します。応募フォームで利用のご希望を伺います。' },
      {
        label: '給排水',
        value: '会場に給排水の設備はありません。必要な水は各自でご用意ください。',
        emphasis: true,
      },
      { label: 'ごみ', value: '出店者さまでのお持ち帰りをお願いしています。' },
    ],
  },
  {
    group: 'ご確認いただきたいこと',
    items: [
      {
        label: '各種届出',
        value: '飲食の出店に必要な届出（保健所の臨時営業許可、火気を使用される場合は消防への届出）は、'
             + '出店者さまご自身でお願いいたします。',
        emphasis: true,
      },
      {
        label: '包材について',
        value: 'サステナビリティをテーマとするイベントのため、包材等について主催側から'
             + '指定させていただく場合があります。ご協力をお願いします。',
      },
      {
        label: '天候',
        value: '雨天実施・荒天中止です。中止の判断基準はサッカーの試合開催に準じます。',
      },
      { label: '出店可否のご連絡', value: '応募締切後、3営業日以内にメールでご回答します。' },
    ],
  },
  {
    group: '出店者特典',
    placeholder: true,
    items: [
      {
        label: '特典',
        value: '観戦チケットの進呈、クラブ公式SNSでの当日告知などを予定しています。'
             + '詳細は確定しだいご案内します。',
      },
    ],
  },
];

/** 問い合わせ先。実値は設定シートから受け取る。 */
const CONTACT = {
  name: 'サステナ盆踊り実行委員会',
  emailFromConfig: 'contact',
};

const CONTENT = { EVENT, SUMMARY, DETAILS, CONTACT };

if (typeof module !== 'undefined' && module.exports) module.exports = CONTENT;
