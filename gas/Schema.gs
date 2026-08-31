/**
 * ⚠ このファイルは src/schema.js から自動生成されています。
 * ⚠ 直接編集しないでください。変更は src/schema.js に加え、npm run build を実行してください。
 *
 * 生成日時はコミット履歴で確認できます（内容が変わらない限り差分は出ません）。
 */

var SECTIONS = [
  {
    "id": "applicant",
    "title": "出店者情報",
    "desc": ""
  },
  {
    "id": "content",
    "title": "出店内容",
    "desc": ""
  },
  {
    "id": "space",
    "title": "区画・電源",
    "desc": ""
  },
  {
    "id": "rental",
    "title": "レンタル備品（有料）",
    "desc": "レンタルされない場合は、すべて持ち込みが必須です。"
  },
  {
    "id": "operation",
    "title": "当日の運営",
    "desc": ""
  },
  {
    "id": "consent",
    "title": "ご確認",
    "desc": ""
  }
];

var FIELDS = [
  {
    "key": "companyName",
    "section": "applicant",
    "type": "text",
    "required": true,
    "label": "企業名",
    "sheet": "企業名",
    "maxLength": 100,
    "autocomplete": "organization"
  },
  {
    "key": "boothName",
    "section": "applicant",
    "type": "text",
    "required": false,
    "label": "出店名",
    "sheet": "出店名",
    "maxLength": 100,
    "help": "企業名と異なる場合のみご記入ください。当日の掲示や告知に使用します。"
  },
  {
    "key": "contactName",
    "section": "applicant",
    "type": "text",
    "required": true,
    "label": "ご担当者さまのお名前",
    "sheet": "担当者氏名",
    "maxLength": 50,
    "autocomplete": "name"
  },
  {
    "key": "contactEmail",
    "section": "applicant",
    "type": "email",
    "required": true,
    "label": "ご担当者さまのメールアドレス",
    "sheet": "担当者メール",
    "maxLength": 254,
    "help": "このアドレスに受付確認メールと出店可否のご連絡をお送りします。",
    "autocomplete": "email"
  },
  {
    "key": "contactPhone",
    "section": "applicant",
    "type": "tel",
    "required": true,
    "label": "ご担当者さまの電話番号",
    "sheet": "担当者電話",
    "maxLength": 20,
    "help": "当日ご連絡のつく番号をご記入ください。",
    "autocomplete": "tel"
  },
  {
    "key": "fcosakaStaff",
    "section": "applicant",
    "type": "select",
    "required": true,
    "label": "FC大阪の担当社員",
    "sheet": "FC大阪担当社員",
    "help": "お声がけした担当者をお選びください。",
    "searchable": true,
    "fallbackOptions": [
      "わからない／FC大阪以外からの紹介"
    ],
    "unknownOption": "わからない／FC大阪以外からの紹介"
  },
  {
    "key": "boothTypes",
    "section": "content",
    "type": "checkboxes",
    "required": true,
    "label": "出店の形態",
    "sheet": "出店形態",
    "help": "当てはまるものをすべてお選びください。",
    "options": [
      "飲食",
      "ワークショップ",
      "展示",
      "体験コンテンツ",
      "その他"
    ]
  },
  {
    "key": "boothTypeOther",
    "section": "content",
    "type": "text",
    "label": "出店形態（その他の内容）",
    "sheet": "出店形態その他",
    "maxLength": 100,
    "showIf": {
      "field": "boothTypes",
      "op": "includes",
      "value": "その他"
    },
    "required": {
      "field": "boothTypes",
      "op": "includes",
      "value": "その他"
    }
  },
  {
    "key": "boothDescription",
    "section": "content",
    "type": "textarea",
    "required": true,
    "label": "出店内容のご説明",
    "sheet": "出店内容",
    "maxLength": 1000,
    "rows": 5,
    "help": "販売商品・メニュー・価格帯・体験の内容をご記入ください。体験系の場合は、所要時間・同時参加人数・対象年齢もあわせてご記載ください。"
  },
  {
    "key": "foodLicense",
    "section": "content",
    "type": "radio",
    "label": "飲食の営業許可",
    "sheet": "営業許可",
    "help": "飲食の出店には保健所の臨時営業許可が必要です。取得は出店者さまでお願いしております。",
    "options": [
      "取得済み",
      "取得予定",
      "不要",
      "不明"
    ],
    "showIf": {
      "field": "boothTypes",
      "op": "includes",
      "value": "飲食"
    },
    "required": {
      "field": "boothTypes",
      "op": "includes",
      "value": "飲食"
    }
  },
  {
    "key": "tableware",
    "section": "content",
    "type": "radio",
    "label": "食器・包材の持込予定",
    "sheet": "食器・包材",
    "help": "サステナビリティをテーマとするイベントのため、包材等について主催側からご相談させていただく場合があります。",
    "options": [
      "リユース食器",
      "紙・木・バイオマス等の環境配慮素材",
      "プラスチック",
      "未定"
    ],
    "showIf": {
      "field": "boothTypes",
      "op": "includes",
      "value": "飲食"
    },
    "required": {
      "field": "boothTypes",
      "op": "includes",
      "value": "飲食"
    }
  },
  {
    "key": "sustainability",
    "section": "content",
    "type": "textarea",
    "required": false,
    "label": "サステナビリティに関する取り組み（PR用）",
    "sheet": "サステナ取り組み",
    "maxLength": 1000,
    "rows": 4,
    "help": "環境や地域への取り組みがあればご記入ください。イベントの告知や実施報告でご紹介させていただく場合があります。"
  },
  {
    "key": "boothSize",
    "section": "space",
    "type": "radio",
    "required": true,
    "label": "ご希望の区画",
    "sheet": "希望区画",
    "help": "1区画は約2.7m×3.6m（間口1.5間×奥行2間）です。レンタルテントのサイズと対応しています。",
    "options": [
      {
        "value": "S1",
        "label": "間口1.5間×奥行2間（1区画／約2.7m×3.6m）",
        "units": 1
      },
      {
        "value": "S2",
        "label": "間口3間×奥行2間（2区画／約5.4m×3.6m）",
        "units": 2
      }
    ]
  },
  {
    "key": "power",
    "section": "space",
    "type": "radio",
    "required": true,
    "label": "電源",
    "sheet": "電源",
    "help": "レンタルの可否・料金は追ってご案内します。",
    "options": [
      "必要（発電機を持ち込む）",
      "レンタルを希望する（要確認）",
      "不要"
    ]
  },
  {
    "key": "generatorCapacity",
    "section": "space",
    "type": "text",
    "label": "持ち込む発電機の容量（kVA）",
    "sheet": "発電機容量",
    "maxLength": 30,
    "help": "発電機本体のシールに書かれている数字です（例：2.8kVA）。おわかりにならない場合は「不明」とご記入ください。",
    "showIf": {
      "field": "power",
      "op": "eq",
      "value": "必要（発電機を持ち込む）"
    },
    "required": {
      "field": "power",
      "op": "eq",
      "value": "必要（発電機を持ち込む）"
    }
  },
  {
    "key": "generatorFuel",
    "section": "space",
    "type": "radio",
    "label": "発電機の燃料",
    "sheet": "発電機燃料",
    "options": [
      "ガソリン（携行缶の持込あり）",
      "ガソリン（携行缶の持込なし）",
      "カセットガス",
      "ポータブル蓄電池",
      "その他"
    ],
    "showIf": {
      "field": "power",
      "op": "eq",
      "value": "必要（発電機を持ち込む）"
    },
    "required": {
      "field": "power",
      "op": "eq",
      "value": "必要（発電機を持ち込む）"
    }
  },
  {
    "key": "powerDevices",
    "section": "space",
    "type": "text",
    "label": "使用予定の機器",
    "sheet": "使用機器",
    "maxLength": 200,
    "help": "例：冷蔵ショーケース、電気フライヤー、照明",
    "showIf": {
      "field": "power",
      "op": "ne",
      "value": "不要"
    },
    "required": {
      "field": "power",
      "op": "ne",
      "value": "不要"
    }
  },
  {
    "key": "powerWatt",
    "section": "space",
    "type": "number",
    "label": "合計消費電力（W）",
    "sheet": "合計消費電力(W)",
    "min": 0,
    "max": 100000,
    "showIf": {
      "field": "power",
      "op": "ne",
      "value": "不要"
    },
    "required": {
      "field": "power",
      "op": "ne",
      "value": "不要"
    },
    "unknownCheckbox": {
      "key": "powerWattUnknown",
      "label": "わからない",
      "sheet": "消費電力不明"
    }
  },
  {
    "key": "tentChoice",
    "section": "rental",
    "type": "radio",
    "required": true,
    "label": "テント",
    "sheet": "テント",
    "options": [
      "レンタルする",
      "持ち込む"
    ]
  },
  {
    "key": "tentSize",
    "section": "rental",
    "type": "radio",
    "label": "レンタルするテントのサイズ",
    "sheet": "テントサイズ",
    "options": [
      {
        "value": "T1",
        "label": "間口1.5間×奥行2間（約2.7m×3.6m）",
        "priceKey": "tentT1"
      },
      {
        "value": "T2",
        "label": "間口3間×奥行2間（約5.4m×3.6m）",
        "priceKey": "tentT2"
      }
    ],
    "showIf": {
      "field": "tentChoice",
      "op": "eq",
      "value": "レンタルする"
    },
    "required": {
      "field": "tentChoice",
      "op": "eq",
      "value": "レンタルする"
    }
  },
  {
    "key": "tentOwnWidth",
    "section": "rental",
    "type": "number",
    "label": "お持ち込みテントの間口（m）",
    "sheet": "持込テント間口(m)",
    "min": 0.5,
    "max": 20,
    "help": "区画に収まるサイズかを確認します。",
    "showIf": {
      "field": "tentChoice",
      "op": "eq",
      "value": "持ち込む"
    },
    "required": {
      "field": "tentChoice",
      "op": "eq",
      "value": "持ち込む"
    }
  },
  {
    "key": "tentOwnDepth",
    "section": "rental",
    "type": "number",
    "label": "お持ち込みテントの奥行（m）",
    "sheet": "持込テント奥行(m)",
    "min": 0.5,
    "max": 20,
    "showIf": {
      "field": "tentChoice",
      "op": "eq",
      "value": "持ち込む"
    },
    "required": {
      "field": "tentChoice",
      "op": "eq",
      "value": "持ち込む"
    }
  },
  {
    "key": "tentWeight",
    "section": "rental",
    "type": "radio",
    "label": "テントの重り（ウェイト）",
    "sheet": "テント重り",
    "help": "ウエイト（重り）の持ち込みも必ずお願いいたします。会場は吹きさらしのため、ペグでの固定ができない場合があります。",
    "options": [
      "持参する",
      "持っていない（要相談）"
    ],
    "showIf": {
      "field": "tentChoice",
      "op": "eq",
      "value": "持ち込む"
    },
    "required": {
      "field": "tentChoice",
      "op": "eq",
      "value": "持ち込む"
    }
  },
  {
    "key": "rentalTable",
    "section": "rental",
    "type": "number",
    "required": false,
    "label": "長机（1800×450）",
    "sheet": "長机",
    "min": 0,
    "max": 20,
    "default": 0,
    "priceKey": "table",
    "unitLabel": "台"
  },
  {
    "key": "rentalChair",
    "section": "rental",
    "type": "number",
    "required": false,
    "label": "パイプ椅子",
    "sheet": "パイプ椅子",
    "min": 0,
    "max": 40,
    "default": 0,
    "priceKey": "chair",
    "unitLabel": "脚"
  },
  {
    "key": "rentalOther",
    "section": "rental",
    "type": "textarea",
    "required": false,
    "label": "その他のご要望",
    "sheet": "その他備品要望",
    "maxLength": 500,
    "rows": 3,
    "help": "その他ご要望があればご記載ください。別途お見積もりをお送りします。"
  },
  {
    "key": "agreeAll",
    "section": "consent",
    "type": "consent",
    "required": true,
    "label": "上記の出店条件（営業時間・車両の進入・ごみの持ち帰り・包材・天候・各種届出）を確認し、ご記入いただいた情報を本イベントの運営および告知・実施報告での紹介に使用することに同意します",
    "sheet": "同意"
  },
  {
    "key": "website2",
    "section": "consent",
    "type": "honeypot",
    "sheet": null,
    "label": "この欄は入力しないでください"
  },
  {
    "key": "fireUse",
    "section": "content",
    "stage": "confirm",
    "type": "checkboxes",
    "label": "火気の使用",
    "sheet": "火気使用",
    "help": "使用するものをすべてお選びください。",
    "options": [
      "使用しない",
      "ガス",
      "炭",
      "薪",
      "アルコール・固形燃料",
      "IH・電気調理器",
      "その他"
    ],
    "exclusiveOption": "使用しない",
    "showIf": {
      "field": "boothTypes",
      "op": "includes",
      "value": "飲食"
    },
    "required": {
      "field": "boothTypes",
      "op": "includes",
      "value": "飲食"
    }
  },
  {
    "key": "fireUseOther",
    "section": "content",
    "stage": "confirm",
    "type": "text",
    "label": "火気（その他の内容）",
    "sheet": "火気その他",
    "maxLength": 100,
    "showIf": {
      "field": "fireUse",
      "op": "includes",
      "value": "その他"
    },
    "required": {
      "field": "fireUse",
      "op": "includes",
      "value": "その他"
    }
  },
  {
    "key": "fireExtinguisher",
    "section": "content",
    "stage": "confirm",
    "type": "radio",
    "label": "消火器のご持参",
    "sheet": "消火器",
    "help": "火気を使用される場合は、消火器を1本ご持参ください。",
    "options": [
      "持参する",
      "持参できない（要相談）"
    ],
    "showIf": {
      "field": "fireUse",
      "op": "includesAny",
      "value": [
        "ガス",
        "炭",
        "薪",
        "アルコール・固形燃料",
        "その他"
      ]
    },
    "required": {
      "field": "fireUse",
      "op": "includesAny",
      "value": [
        "ガス",
        "炭",
        "薪",
        "アルコール・固形燃料",
        "その他"
      ]
    }
  },
  {
    "key": "siteManagerName",
    "section": "operation",
    "stage": "confirm",
    "type": "text",
    "required": true,
    "label": "当日の現場責任者",
    "sheet": "現場責任者",
    "maxLength": 50,
    "help": "当日、会場にいらっしゃる方のお名前。応募ご担当者と同じ場合はそのままで結構です。"
  },
  {
    "key": "siteManagerPhone",
    "section": "operation",
    "stage": "confirm",
    "type": "tel",
    "required": true,
    "label": "現場責任者の携帯番号",
    "sheet": "現場責任者携帯",
    "maxLength": 20,
    "help": "当日、会場で必ずつながる携帯番号をご記入ください。"
  },
  {
    "key": "backupPhone",
    "section": "operation",
    "stage": "confirm",
    "type": "tel",
    "required": false,
    "label": "緊急時の第2連絡先",
    "sheet": "第2連絡先",
    "maxLength": 20,
    "help": "現場責任者に連絡がつかないときにおかけします。会社の代表番号でも構いません。"
  },
  {
    "key": "vehicleCount",
    "section": "operation",
    "stage": "confirm",
    "type": "number",
    "required": true,
    "label": "搬入車両の台数",
    "sheet": "搬入車両台数",
    "min": 0,
    "max": 20,
    "default": 0,
    "help": "搬入は8:30〜10:30です。"
  },
  {
    "key": "vehicleType",
    "section": "operation",
    "stage": "confirm",
    "type": "radio",
    "required": true,
    "label": "搬入車両の種類",
    "sheet": "車両種別",
    "help": "一番大きい車両をお選びください。搬入の誘導計画に使います。",
    "options": [
      "軽自動車・軽トラック",
      "普通乗用車・バン",
      "1.5t〜2tトラック",
      "2t超・箱車"
    ]
  },
  {
    "key": "vehicleHeight",
    "section": "operation",
    "stage": "confirm",
    "type": "radio",
    "required": true,
    "label": "車両の全高",
    "sheet": "車両全高",
    "help": "ゲートに高さ制限があるため確認しています。",
    "options": [
      "2.1m以下",
      "2.1mを超える",
      "わからない"
    ]
  },
  {
    "key": "vehiclePlate",
    "section": "operation",
    "stage": "confirm",
    "type": "text",
    "required": false,
    "label": "ナンバー（下4桁）",
    "sheet": "ナンバー下4桁",
    "maxLength": 20,
    "help": "当日、車両の移動をお願いする際に持ち主をすぐ特定するために使います。"
  },
  {
    "key": "parkingRequest",
    "section": "operation",
    "stage": "confirm",
    "type": "radio",
    "required": true,
    "label": "駐車場の利用",
    "sheet": "駐車場利用",
    "options": [
      "希望する",
      "希望しない"
    ]
  },
  {
    "key": "loadInSlot1",
    "section": "operation",
    "stage": "confirm",
    "type": "radio",
    "required": true,
    "label": "搬入希望時間帯（第1希望）",
    "sheet": "搬入希望1",
    "options": [
      "8:30〜9:00",
      "9:00〜9:30",
      "9:30〜10:00",
      "10:00〜10:30",
      "指定なし"
    ]
  },
  {
    "key": "loadInSlot2",
    "section": "operation",
    "stage": "confirm",
    "type": "radio",
    "required": false,
    "label": "搬入希望時間帯（第2希望）",
    "sheet": "搬入希望2",
    "options": [
      "8:30〜9:00",
      "9:00〜9:30",
      "9:30〜10:00",
      "10:00〜10:30",
      "指定なし"
    ]
  },
  {
    "key": "loadOutEarly",
    "section": "operation",
    "stage": "confirm",
    "type": "radio",
    "required": false,
    "label": "17:30より前の撤収",
    "sheet": "早期撤収希望",
    "options": [
      "希望しない",
      "希望する（要相談）"
    ]
  },
  {
    "key": "staffCount",
    "section": "operation",
    "stage": "confirm",
    "type": "number",
    "required": true,
    "label": "当日のスタッフ人数",
    "sheet": "スタッフ人数",
    "min": 1,
    "max": 50
  },
  {
    "key": "rainPolicy",
    "section": "operation",
    "stage": "confirm",
    "type": "radio",
    "required": true,
    "label": "雨天時の対応",
    "sheet": "雨天時対応",
    "help": "雨天実施・荒天中止です。中止の判断はサッカーの試合開催に準じます。",
    "options": [
      "雨天でも出店する",
      "雨天の場合は出店を辞退する"
    ]
  },
  {
    "key": "notes",
    "section": "operation",
    "stage": "confirm",
    "type": "textarea",
    "required": false,
    "label": "備考・ご質問",
    "sheet": "備考",
    "maxLength": 1000,
    "rows": 4
  }
];

var ADMIN_COLUMNS = [
  "受付ID",
  "受付日時",
  "ステータス",
  "割当開始区画",
  "割当区画数",
  "主形態",
  "担当メモ",
  "可否連絡日",
  "採択通知送信日時",
  "搬入予定時刻",
  "撤収予定時刻",
  "当日ステータス",
  "素材トークン",
  "素材提出フォルダURL",
  "重複フラグ",
  "受付メール送信",
  "通知メール送信",
  "生データ(JSON)"
];

var STATUS = [
  "未確認",
  "審査中",
  "採択",
  "不採択",
  "辞退",
  "キャンセル",
  "重複（無効）"
];

var DAY_STATUS = [
  "未着",
  "搬入済",
  "設営完了",
  "撤収完了"
];

function ledgerHeaders() {
  return ['受付ID', '受付日時']
    .concat(columnsFor_(applyFields()))
    .concat(ADMIN_COLUMNS.filter(function (c) { return c !== '受付ID' && c !== '受付日時'; }));
}

function testCondition(cond, values) {
  if (!cond) return true;
  var v = values[cond.field];
  switch (cond.op) {
    case 'eq':       return v === cond.value;
    case 'ne':       return v !== undefined && v !== '' && v !== cond.value;
    case 'includes': return Array.isArray(v) && v.indexOf(cond.value) !== -1;
    // 複数の候補のいずれかを含むか（例：ガス・炭・薪のどれかを使う）
    case 'includesAny':
      if (!Array.isArray(v)) return false;
      for (var i = 0; i < cond.value.length; i++) {
        if (v.indexOf(cond.value[i]) !== -1) return true;
      }
      return false;
    case 'truthy':   return !!v;
    case 'falsy':    return !v;
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
