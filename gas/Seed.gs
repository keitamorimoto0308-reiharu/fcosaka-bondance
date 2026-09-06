// ───────────────────────────────── デモ用のテストデータを入れる
/**
 * 出店者一覧にテストデータを入れる。**削除（gas/Purge.gs）と対になる道具。**
 *
 * ■ なぜ要るか
 *   2026-09-07 けいた指示：
 *   「出店者一覧にデモの段階だからテストデータ入れておいて、あとで一括で消すよ」
 *   Purge.gs の冒頭が書いているとおり、FC大阪への説明は**本物の画面**で見せる。
 *   一覧が空だと、区画マップも集計も当日運営も何も見せられない。
 *
 * ■ 行の組み立ては写さない
 *   `appendApplication`（gas/Ledger.gs）をそのまま呼ぶ。
 *   受付IDの採番・重複の検出・生データJSON・レンタルの金額計算は、
 *   **本物の応募とまったく同じ道**を通る。
 *   ここで行を自分で組むと、「デモでは通ったのに本番で列がずれる」が起きる。
 *
 * ■ メールは送らない
 *   `appendApplication` は行を書くだけで、メールは呼び出し側（gas/Api.gs）が送る。
 *   ここからは呼ばないので、**実在しないアドレスに送ろうとして詰まることもない**。
 *
 * ■ 消せる状態でしか入れられない
 *   設定の「テストデータの削除」がONのときだけ動く（PURGE_SWITCH と同じ鍵）。
 *   入れっぱなしにできる道を作らないため。
 *   本物の応募が1件でもあれば断る。混ざると、あとで見分けられない。
 *
 * ■ 使い方（Apps Script の editor から）
 *   1. 管理ページの「設定」で「テストデータの一括削除を許可」をONにする
 *   2. この `seedTestData()` を実行する
 *   3. デモが終わったら、出店者一覧の「テストデータの一括削除」で消す
 */

/** 入れる件数の上限。打ち間違えても被害を頭打ちにする */
var SEED_MAX = 30;

/**
 * デモ用の応募内容。**実在しない企業・実在しないアドレス**にする。
 *
 * メールは送らないが、画面に出る値なので `example.com` で統一する
 * （うっかり送信しても、外に出ない予約ドメイン）。
 * 電話番号も 03-4000-xxxx（ドラマ用の予約番号帯ではないが、
 * 市外局番＋4000番台は未割当が多い）ではなく、**明らかに嘘と分かる形**にする。
 */
function SEED_ROWS_() {
  return [
    { companyName: '【テスト】みどり食堂', boothName: 'みどり食堂', contactName: '試験 太郎',
      contactEmail: 'test1@example.com', contactPhone: '000-0000-0001',
      boothTypes: ['飲食'], boothDescription: '焼きそば・たこ焼きの販売。地元産の野菜を使います。',
      foodLicense: '取得済み', packaging: '自分で用意する（サステナブル素材）',
      packagingDetail: '紙容器・木製フォーク', tableware: '使い捨て（サステナブル素材）',
      sustainability: '容器はすべて紙・木製にし、食品ロスは当日中に持ち帰ります。',
      boothSize: 'S1', power: '必要（発電機を持ち込む）',
      generatorCapacity: '2.0', generatorFuel: 'ガソリン',
      powerDevices: '鉄板、冷蔵ケース', powerWatt: '1800',
      tentChoice: 'レンタルする', tentSize: 'T1', tentWeight: '持参する',
      rentalItems: { '長机（1800×450）': 2, 'パイプ椅子': 4 },
      agreeAll: true },

    { companyName: '【テスト】そら工房', boothName: '',
      contactName: '試験 花子', contactEmail: 'test2@example.com', contactPhone: '000-0000-0002',
      boothTypes: ['ワークショップ'], boothDescription: '端材を使ったキーホルダー作り（所要15分・500円）。',
      foodLicense: '不要', packaging: 'ご相談したい', tableware: '食器は使わない',
      sustainability: '家具工場の端材を引き取って使っています。',
      boothSize: 'S1', power: 'レンタルを希望する（要確認）',
      powerDevices: '電動ドリル', powerWatt: '', powerWattUnknown: true,
      tentChoice: 'レンタルする', tentSize: 'T1', tentWeight: '持参する',
      rentalItems: { '長机（1800×450）': 1, 'パイプ椅子': 6 },
      agreeAll: true },

    { companyName: '【テスト】かがやき電機', boothName: 'かがやきブース',
      contactName: '試験 次郎', contactEmail: 'test3@example.com', contactPhone: '000-0000-0003',
      boothTypes: ['展示', '体験コンテンツ'],
      boothDescription: '再生可能エネルギーのパネル展示と、発電体験のミニゲーム。',
      foodLicense: '不要', packaging: 'ご相談したい', tableware: '食器は使わない',
      sustainability: '展示物は次回以降も使い回します。',
      boothSize: 'S2', power: 'レンタルを希望する（要確認）',
      powerDevices: 'モニター、照明', powerWatt: '600',
      tentChoice: '持ち込む', tentOwnWidth: '5.4', tentOwnDepth: '3.6',
      tentWeight: '持参する',
      rentalItems: { '長机（1800×450）': 3 },
      rentalOther: '延長コードをお借りできますか。',
      agreeAll: true },

    { companyName: '【テスト】まる商店', boothName: '',
      contactName: '試験 三郎', contactEmail: 'test4@example.com', contactPhone: '000-0000-0004',
      boothTypes: ['飲食'], boothDescription: 'コーヒーと焼き菓子の販売。',
      foodLicense: '取得予定', packaging: '運営からの支給を希望する（費用は別途ご相談）',
      tableware: 'リユース食器',
      sustainability: 'リユースカップを導入し、返却で100円お戻しします。',
      boothSize: 'S1', power: '不要',
      tentChoice: 'レンタルする', tentSize: 'T1', tentWeight: '相談したい',
      rentalItems: { '長机（1800×450）': 1, 'パイプ椅子': 2 },
      agreeAll: true },

    { companyName: '【テスト】ひなた保育園', boothName: 'ひなたキッズひろば',
      contactName: '試験 四郎', contactEmail: 'test5@example.com', contactPhone: '000-0000-0005',
      boothTypes: ['体験コンテンツ'], boothDescription: '子ども向けの輪投げと塗り絵コーナー（無料）。',
      foodLicense: '不要', packaging: 'ご相談したい', tableware: '食器は使わない',
      sustainability: '景品は紙製にしています。',
      boothSize: 'S1', power: '不要',
      tentChoice: 'レンタルする', tentSize: 'T1', tentWeight: '持参する',
      rentalItems: { 'パイプ椅子': 4 },
      agreeAll: true },

    { companyName: '【テスト】山の手ベーカリー', boothName: '',
      contactName: '試験 五郎', contactEmail: 'test6@example.com', contactPhone: '000-0000-0006',
      boothTypes: ['飲食'], boothDescription: '天然酵母のパンの販売。',
      foodLicense: '取得済み', packaging: '自分で用意する（サステナブル素材）',
      packagingDetail: '紙袋', tableware: '食器は使わない',
      sustainability: '売れ残りは翌日フードバンクへ寄付します。',
      boothSize: 'S1', power: '不要',
      tentChoice: '持ち込む', tentOwnWidth: '2.7', tentOwnDepth: '3.6',
      tentWeight: '持参する',
      rentalItems: { '長机（1800×450）': 2 },
      agreeAll: true },

    { companyName: '【テスト】あおぞら古着店', boothName: 'あおぞら',
      contactName: '試験 六郎', contactEmail: 'test7@example.com', contactPhone: '000-0000-0007',
      boothTypes: ['その他'], boothTypeOther: '古着の量り売り',
      boothDescription: '古着の量り売りと、リメイクの相談コーナー。',
      foodLicense: '不要', packaging: 'ご相談したい', tableware: '食器は使わない',
      sustainability: '売れ残りは回収して繊維リサイクルに回します。',
      boothSize: 'S1', power: '不要',
      tentChoice: 'レンタルする', tentSize: 'T1', tentWeight: '持参する',
      rentalItems: { '長机（1800×450）': 2, 'パイプ椅子': 2 },
      agreeAll: true },

    { companyName: '【テスト】東大阪コーヒー', boothName: '',
      contactName: '試験 七子', contactEmail: 'test8@example.com', contactPhone: '000-0000-0008',
      boothTypes: ['飲食'], boothDescription: '自家焙煎コーヒーの販売。',
      foodLicense: '取得済み', packaging: '自分で用意する（サステナブル素材）',
      packagingDetail: '紙カップ', tableware: 'リユース食器',
      sustainability: 'コーヒーかすは肥料として引き取ってもらいます。',
      boothSize: 'S1', power: '必要（発電機を持ち込む）',
      generatorCapacity: '1.6', generatorFuel: 'ガソリン',
      powerDevices: 'エスプレッソマシン', powerWatt: '1400',
      tentChoice: 'レンタルする', tentSize: 'T1', tentWeight: '持参する',
      rentalItems: { '長机（1800×450）': 1, 'パイプ椅子': 2 },
      agreeAll: true },
  ];
}

/**
 * テストデータを入れる。Apps Script の editor から実行する。
 *
 * @param {number=} n 入れる件数（省略すると全部）
 */
function seedTestData(n) {
  var sw = String(getConfig(PURGE_SWITCH) || '').trim().toUpperCase();
  if (sw !== 'ON') {
    throw new Error(
      '「設定」タブの「テストデータの一括削除を許可」をONにしてから実行してください。'
      + '（あとで消せない状態でテストデータを入れないための決まりです）');
  }

  /*
   * **本物の応募が1件でもあれば断る。**
   * 混ざると、あとで「どれがテストか」を人が見分けることになる。
   * 一括削除は台帳を丸ごと空にするので、本物まで消えてしまう。
   */
  var sh = sheet_(SHEET.LEDGER);
  if (sh.getLastRow() >= 2) {
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var nameCol = headers.indexOf('企業名') + 1;
    var names = sh.getRange(2, nameCol, sh.getLastRow() - 1, 1).getValues();
    var real = [];
    for (var i = 0; i < names.length; i++) {
      var nm = asText_(names[i][0]).trim();
      if (nm && nm.indexOf('【テスト】') !== 0) real.push(nm);
    }
    if (real.length) {
      throw new Error('本物の応募が ' + real.length + ' 件あります（' + real[0] + ' など）。'
        + 'テストデータは入れません。');
    }
  }

  var rows = SEED_ROWS_();
  var want = (n === undefined || n === null || n === '') ? rows.length : Number(n);
  if (!isFinite(want) || want < 1) throw new Error('件数が読み取れません。');
  want = Math.min(Math.floor(want), rows.length, SEED_MAX);

  var done = [];
  for (var k = 0; k < want; k++) {
    // **本物の応募とまったく同じ道を通す**（受付ID・重複判定・JSON・金額）。
    // 送信IDを付けないので、二重送信よけのキャッシュにも触らない
    var res = appendApplication(rows[k], '');
    done.push(res && res.receiptId ? res.receiptId : '?');
  }

  console.log('テストデータを ' + done.length + ' 件入れました：' + done.join(', '));
  console.log('デモが終わったら、出店者一覧の「テストデータの一括削除」で消してください。');
  return { ok: true, added: done.length, receiptIds: done };
}
