/**
 * ビルド：src/schema.js から派生物を生成する。
 *
 *   src/schema.js  ──┬──▶ gas/Schema.gs   （GAS側の検証・台帳列定義）
 *                    └──▶ （後続タスクで index.html も生成）
 *
 * GAS には import/require が無いため、schema.js の中身を素の関数群として
 * 書き出す。生成物は手で編集しない（毎回上書きされる）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'src', 'schema.js');
const OUT_GAS = path.join(ROOT, 'gas', 'Schema.gs');

const schema = require(SCHEMA_PATH);
// 紙面に刷ってある料金表を GAS へ焼き込むため（下の PUBLISHED_RENTALS）
const content = require(path.join(ROOT, 'src', 'content.js'));

/** 生成物の先頭に必ず付ける警告。人が手で直して次のビルドで消える事故を防ぐ。 */
const BANNER = [
  '/**',
  ' * ⚠ このファイルは src/schema.js から自動生成されています。',
  ' * ⚠ 直接編集しないでください。変更は src/schema.js に加え、npm run build を実行してください。',
  ' *',
  ' * 生成日時はコミット履歴で確認できます（内容が変わらない限り差分は出ません）。',
  ' */',
  '',
].join('\n');

function buildSchemaGs() {
  // schema.js の関数はそのまま文字列化して埋め込む。
  // フォームとGASが「同じコードで」条件判定することが、二重実装によるズレを防ぐ要点。
  const body = [
    BANNER,
    'var SECTIONS = ' + JSON.stringify(schema.SECTIONS, null, 2) + ';',
    '',
    'var FIELDS = ' + JSON.stringify(schema.FIELDS, null, 2) + ';',
    '',
    'var ADMIN_COLUMNS = ' + JSON.stringify(schema.ADMIN_COLUMNS, null, 2) + ';',
    '',
    'var STATUS = ' + JSON.stringify(schema.STATUS, null, 2) + ';',
    '',
    'var DAY_STATUS = ' + JSON.stringify(schema.DAY_STATUS, null, 2) + ';',
    '',
    // 募集要項PDFに刷ってある料金表を、そのままGASへ焼き込む。
    //
    // ■ なぜ要るか
    //   紙面は src/content.js から刷り、フォームは「レンタル品目」シートを読む。
    //   けいたがシートの単価を直しても、**紙面は古いまま**になる。
    //   ビルドが照合して止めるが、それは私がビルドしたときだけ。
    //   けいたがシートを直した瞬間に気づける場所が、どこにも無かった。
    //   ここに焼き込んでおけば、管理ページが「紙面とずれています」と出せる。
    '/** 募集要項PDFに刷ってある料金表。ビルド時に src/content.js から焼き込む。',
    ' *  シートを直したあと紙面を刷り直していないと、ここと食い違う。 */',
    'var PUBLISHED_RENTALS = ' + JSON.stringify(
      content.RENTALS.map(function (r) {
        return { label: r.label, unit: r.unit,
                 price: r.key ? content.PRICES[r.key] : r.price };
      }), null, 2) + ';',
    '',
    // ledgerHeaders が呼ぶ関数も一緒に埋め込む。
    // ここが漏れると、生成物は「文法としては正しいが実行すると落ちる」状態になる。
    // 実際に columnsFor_ と applyFields が漏れていて、setup() が動かなくなっていた。
    // 下の verifyGenerated() が、生成物を隔離して実行し、この種の漏れを検出する。
    schema.applyFields.toString(),
    '',
    schema.confirmFields.toString(),
    '',
    // 数を集める項目（ダッシュボードの合計・打ち込み欄が使う）。
    // 埋め忘れると、GASは実行するまで気づけない
    schema.aggregateFields.toString(),
    '',
    schema.columnsFor_.toString(),
    '',
    schema.ledgerHeaders.toString(),
    '',
    schema.confirmHeaders.toString(),
    '',
    schema.testCondition.toString(),
    '',
    schema.isVisible.toString(),
    '',
    schema.isRequired.toString(),
    '',
    'var SPACE_SIZE = ' + JSON.stringify(schema.SPACE_SIZE, null, 2) + ';',
    '',
    'var TENT_SIZE = ' + JSON.stringify(schema.TENT_SIZE, null, 2) + ';',
    '',
    schema.crossChecks.toString(),
    '',
  ].join('\n');
  return body;
}

function writeIfChanged(file, content) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (prev === content) {
    console.log('  変更なし :', path.relative(ROOT, file));
    return false;
  }
  fs.writeFileSync(file, content, 'utf8');
  console.log('  書き出し :', path.relative(ROOT, file));
  return true;
}

/** 生成前の自己点検。ここで落ちるなら schema.js が壊れている。 */
function verifySchema() {
  const errors = [];
  const keys = new Set();

  for (const f of schema.FIELDS) {
    if (!f.key)  errors.push('key の無い項目があります');
    if (keys.has(f.key)) errors.push('key が重複: ' + f.key);
    keys.add(f.key);
    if (!f.type) errors.push('type がありません: ' + f.key);
    if (!schema.SECTIONS.some(s => s.id === f.section)) {
      errors.push('存在しないセクションを指しています: ' + f.key + ' -> ' + f.section);
    }
  }

  // 条件式が実在の項目を指しているか
  for (const f of schema.FIELDS) {
    const conds = [f.showIf, typeof f.required === 'object' ? f.required : null];
    for (const c of conds) {
      if (c && !keys.has(c.field)) {
        errors.push('条件式が存在しない項目を参照: ' + f.key + ' -> ' + c.field);
      }
    }
  }

  // 台帳の列名が重複していないか（重複すると書き込み先がずれる＝最悪の事故）
  const headers = schema.ledgerHeaders();
  const seen = new Set();
  for (const h of headers) {
    if (seen.has(h)) errors.push('台帳の列名が重複: ' + h);
    seen.add(h);
  }

  return { errors, fieldCount: keys.size, columnCount: headers.length };
}

/**
 * 生成した Schema.gs が、それ単体で動くかを確かめる。
 *
 * ■ なぜ要るか
 *   verifySchema() は Node の中で schema.js の関数を呼んでいる。
 *   Node では同じファイルに全部あるので、生成物に関数を入れ忘れていても通ってしまう。
 *   実際 columnsFor_ と applyFields が漏れていて、**生成物は文法としては正しいのに
 *   実行すると落ちる**状態だった。setup() が動かず、台帳の列を直せなかった。
 *
 *   ここでは生成した中身を、Nodeの変数が一切見えない箱の中で実行し、
 *   ledgerHeaders() などを実際に呼んで、Nodeでの結果と一致するかを見る。
 *   GASでしか動かないコードは Schema.gs に入れていないので、この方法で確かめられる。
 */
function verifyGenerated(code) {
  const vm = require('vm');
  const box = vm.createContext(Object.create(null));
  const errors = [];

  try {
    vm.runInContext(code, box, { filename: 'gas/Schema.gs' });
  } catch (e) {
    return ['生成した Schema.gs を読み込めません: ' + e.message];
  }

  // 生成物の中だけで呼べるか。呼べなければ、依存する関数が埋め込まれていない
  const checks = [
    ['ledgerHeaders', () => schema.ledgerHeaders()],
    ['confirmHeaders', () => schema.confirmHeaders()],
    ['applyFields', () => schema.applyFields().map(f => f.key)],
    ['confirmFields', () => schema.confirmFields().map(f => f.key)],
    ['aggregateFields', () => schema.aggregateFields().map(f => f.key)],
  ];
  for (const [name, inNode] of checks) {
    let got;
    try {
      got = vm.runInContext(
        name === 'applyFields' || name === 'confirmFields' || name === 'aggregateFields'
          ? name + '().map(function (f) { return f.key; })'
          : name + '()',
        box);
    } catch (e) {
      errors.push(name + '() が生成物の中で動きません（' + e.message
        + '）。呼び出している関数が Schema.gs に埋め込まれていません');
      continue;
    }
    const want = inNode();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      errors.push(name + '() の結果が schema.js と違います');
    }
  }
  return errors;
}

function main() {
  console.log('ビルドを開始します');
  const v = verifySchema();
  if (v.errors.length) {
    console.error('\n✖ スキーマに問題があります:');
    v.errors.forEach(e => console.error('   - ' + e));
    process.exit(1);
  }
  console.log('  点検 OK  : 項目 ' + v.fieldCount + ' / 台帳 ' + v.columnCount + ' 列');

  const code = buildSchemaGs();
  const g = verifyGenerated(code);
  if (g.length) {
    console.error('\n✖ 生成した gas/Schema.gs が単体で動きません:');
    g.forEach(e => console.error('   - ' + e));
    process.exit(1);
  }
  console.log('  実行確認 : gas/Schema.gs は単体で動きます');

  writeIfChanged(OUT_GAS, code);
  console.log('完了');
}

if (require.main === module) main();
module.exports = { verifySchema, buildSchemaGs, verifyGenerated };
