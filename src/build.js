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
    schema.ledgerHeaders.toString(),
    '',
    schema.testCondition.toString(),
    '',
    schema.isVisible.toString(),
    '',
    schema.isRequired.toString(),
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

function main() {
  console.log('ビルドを開始します');
  const v = verifySchema();
  if (v.errors.length) {
    console.error('\n✖ スキーマに問題があります:');
    v.errors.forEach(e => console.error('   - ' + e));
    process.exit(1);
  }
  console.log('  点検 OK  : 項目 ' + v.fieldCount + ' / 台帳 ' + v.columnCount + ' 列');
  writeIfChanged(OUT_GAS, buildSchemaGs());
  console.log('完了');
}

if (require.main === module) main();
module.exports = { verifySchema, buildSchemaGs };
