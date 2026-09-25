/**
 * 「通るはずの応募」。検証を通る、応募段階の必須をすべて満たした値。
 *
 * ■ なぜ1か所に置くか
 *   これを写すと、schema.js に必須項目が増えたときに**片方だけ古くなる**。
 *   古いほうは「必須が欠けている」で落ちるので、検査が本題と関係ない理由で
 *   落ちるようになり、誰かが雑に直して本題の検査が死ぬ。
 *   （引き継ぎ書：写しが増えて、別物を壊していた／n か所と数えた地図は必ず古くなる）
 *
 *   使う側：test/validate.test.js（検証）／test/deadline-run.test.js（締切）
 */
function validApplication(over) {
  return Object.assign({
    companyName: '株式会社テスト',
    boothName: 'テスト出店',
    contactName: 'テスト太郎',
    contactEmail: 'test@example.com',
    contactPhone: '06-1234-5678',
    fcosakaStaff: 'その他',
    boothTypes: ['展示'],
    boothDescription: '展示の内容です。',
    boothSize: 'S1',
    power: '不要',
    tentChoice: '持ち込む',
    tentOwnWidth: 2.5,          // 1区画は約2.7m。これを超えると収まらない
    tentOwnDepth: 3,
    tentWeight: '持参する',
    rentalItems: {},          // 数量で頼む備品は台帳の「レンタル品目」シートで決まる
    agreeAll: true,
  }, over || {});
}

/** 検証で使う、レンタル品目シートの代役（本物は getRentalQtyItems） */
function rentalItemsStub() {
  return [
    { name: '長机（1800×450）', price: 1000, unit: '台', max: 20, note: '' },
    { name: 'パイプ椅子',       price: 500,  unit: '脚', max: 40, note: '' },
  ];
}

module.exports = { validApplication, rentalItemsStub };
