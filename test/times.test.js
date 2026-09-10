/**
 * 時刻が、置いてあるすべての場所で同じ値になっているか。
 *
 * ■ なぜ要るか
 *   営業時間・搬入・搬出・盆踊りは、いま**5か所**に書かれている：
 *     1. src/content.js の FACTS（ページ上部の帯）
 *     2. src/content.js の OUTLINE「当日の運営」
 *     3. src/content.js の OUTLINE「開催概要」のタイムライン
 *     4. gas/Mail.gs の eventFactsBlock_（受付確認・応募通知のメール）
 *     5. 紙面PDF（1〜3から生成されるので、そこが合っていれば合う）
 *
 *   2026-09-02 にFC大阪から「搬入 9:30〜10:30 ／ 搬出 18:00〜19:00」と
 *   修正が来たとき、**4のメール本文だけ 8:30/17:30 のまま**になりかけた。
 *   メールは出店者にしか届かないので、こちらの画面をいくら見ても気づけない。
 *
 *   本来は content.js を唯一の正にすべきだが、GAS は content.js を読めない
 *   （Apps Script に require が無い）。**生成する仕組みを足すまでの間、
 *   食い違いをここで止める。**
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\r\n').join('\n');
const C = require('../src/content.js');

/** いま正とする値。ここを直したら、下の検査が全部の置き場所を追いかける */
const TIMES = {
  open:   '11:00',
  close:  '17:30',
  inFrom:  '9:30',
  inTo:   '10:30',
  outFrom: '18:00',
  outTo:   '19:00',
  odoriFrom: '16:15',
  odoriTo:   '17:30',
};

/** OUTLINE から、ラベルで行を1つ取り出す */
function row(sectionTitle, label) {
  const sec = C.OUTLINE.find(s => s.title === sectionTitle);
  assert.ok(sec, '節が見つかりません：' + sectionTitle);
  const r = sec.body.find(x => x[0] === label);
  assert.ok(r, '行が見つかりません：' + sectionTitle + ' / ' + label);
  return r[1];
}

describe('時刻が、すべての置き場所で揃っているか', () => {

  test('ページ上部の帯（FACTS）', () => {
    const hours = C.FACTS.find(f => f.label === '営業時間');
    assert.strictEqual(hours.big, TIMES.open);
    assert.strictEqual(hours.small, '〜' + TIMES.close);
    assert.ok(hours.note.includes(TIMES.inFrom + '〜' + TIMES.inTo),
      '帯の搬入が違います：' + hours.note);
    assert.ok(hours.note.includes(TIMES.outFrom + '〜' + TIMES.outTo),
      '帯の搬出が違います：' + hours.note);

    const odori = C.FACTS.find(f => f.label === '盆踊り');
    assert.strictEqual(odori.big, TIMES.odoriFrom);
    assert.strictEqual(odori.small, '〜' + TIMES.odoriTo);
  });

  test('募集要項の「当日の運営」', () => {
    assert.ok(row('当日の運営', '搬入').includes(TIMES.inFrom + '〜' + TIMES.inTo),
      '搬入が違います');
    assert.ok(row('当日の運営', '搬出').includes(TIMES.outFrom + '〜' + TIMES.outTo),
      '搬出が違います');

    // 節の要約（lead）にも時刻が入っている。本文だけ直すと、ここが取り残される
    const lead = C.OUTLINE.find(s => s.title === '当日の運営').lead;
    assert.ok(lead.includes(TIMES.inFrom) && lead.includes(TIMES.outFrom),
      '「当日の運営」の要約が本文と食い違っています：' + lead);
  });

  test('募集要項の「開催概要」', () => {
    assert.strictEqual(C.EVENT.hours, TIMES.open + '〜' + TIMES.close);
    const tl = row('開催概要', 'タイムライン');
    assert.ok(tl.includes(TIMES.open), 'タイムラインの開始が違います');
    assert.ok(tl.includes(TIMES.odoriFrom + '〜' + TIMES.odoriTo),
      'タイムラインの盆踊りが違います：' + tl);
  });

  test('メール本文（gas/Mail.gs）', () => {
    // ここが取り残されると、出店者にだけ古い時刻が届く。
    // こちらの画面をいくら見ても気づけない
    const src = read('gas/Mail.gs');
    const i = src.indexOf('function eventFactsBlock_');
    assert.ok(i >= 0, 'eventFactsBlock_ が見つかりません');
    const block = src.slice(i, src.indexOf('\n}\n', i));

    assert.ok(block.includes(TIMES.inFrom + '〜' + TIMES.inTo),
      'メールの搬入が違います');
    assert.ok(block.includes(TIMES.open + '〜' + TIMES.close),
      'メールの営業時間が違います');
    assert.ok(block.includes(TIMES.outFrom + '〜' + TIMES.outTo),
      'メールの搬出が違います');
    // 古い値が残っていないか。足し忘れではなく**直し忘れ**を捕まえる
    ['8:30', '19:30'].forEach(old => {
      assert.ok(!block.includes(old), 'メールに古い時刻が残っています：' + old);
    });
  });

  test('content.js の TIMES が、文章側と同じ値になっている', () => {
    /*
     * 2026-09-09 に足した機械可読の値（搬入の時間割を描くのに要る）。
     * **写しが1つ増えたということ**なので、必ずここで縛る。
     * これが無いと、TIMES だけ直して文章が古いまま、が起こる。
     */
    assert.ok(C.TIMES, 'content.js が TIMES を持っていません');
    assert.strictEqual(C.TIMES.loadInFrom,  TIMES.inFrom,  'TIMES の搬入開始が違います');
    assert.strictEqual(C.TIMES.loadInTo,    TIMES.inTo,    'TIMES の搬入終了が違います');
    assert.strictEqual(C.TIMES.loadOutFrom, TIMES.outFrom, 'TIMES の搬出開始が違います');
    assert.strictEqual(C.TIMES.loadOutTo,   TIMES.outTo,   'TIMES の搬出終了が違います');
    assert.strictEqual(C.TIMES.open,        TIMES.open,    'TIMES の営業開始が違います');
    assert.strictEqual(C.TIMES.close,       TIMES.close,   'TIMES の営業終了が違います');
  });

  test('古い時刻が、どこにも残っていない', () => {
    /*
     * 「新しい値がある」だけでは、古い値が別の行に残っていても通ってしまう。
     *
     * ⚠ 2026-09-09：**この検査には6か所目が抜けていた。**
     *   `src/schema.js` を見ていなかったため、出店確定情報フォームの
     *   - 「搬入は8:30〜10:30です。」（説明文）
     *   - 搬入希望時間帯の選択肢が 8:30〜 から始まる（**窓の外の時刻を選ばせていた**）
     *   - 「17:30より前の撤収」（撤収は18:00〜19:00）
     *   の3件が、1週間以上そのままになっていた。**出店者に直接届く文言。**
     *
     *   教訓：「n か所」と数えた地図は、必ず古くなる。
     *   **項目を足す場所（schema.js）は、いちばん増えやすい。**
     */
    const hay = [
      JSON.stringify(C.FACTS), JSON.stringify(C.OUTLINE),
      read('gas/Mail.gs'), read('gas/Notify.gs'),
      read('src/schema.js'),
      // 7か所目（2026-09-09、検証役が発見）。src/mock.js は gas/Mail.gs の
      // eventFactsBlock_ の写しを持っていて、メール文面の下見に出る。
      // **6か所目を直したその日のうちに、7か所目が見つかった。**
      // 「n か所」と数えるのをやめ、置き場所が増えたら網も広げること。
      read('src/mock.js'),
    ].join('\n');
    ['8:30〜10:30', '17:30〜19:30', '16:30〜',
     '8:30〜9:00', '9:00〜9:30', '17:30より前'].forEach(old => {
      assert.ok(!hay.includes(old), '古い時刻が残っています：' + old);
    });
  });

  test('搬入希望の選択肢が、搬入の窓の中に収まっている', () => {
    /*
     * 選択肢そのものを見る。「古い値が無い」だけでは、
     * 次に誰かが窓の外の時刻を**新しく足した**ときに素通りする。
     */
    const S = require('../src/schema.js');
    const fields = (S.FIELDS || []).filter(f => /^loadInSlot/.test(f.key));
    assert.ok(fields.length >= 1, '搬入希望の項目が見つかりません');

    const toMin = t => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const from = toMin(TIMES.inFrom);
    const to = toMin(TIMES.inTo);

    for (const f of fields) {
      for (const opt of (f.options || [])) {
        if (opt === '指定なし') continue;
        const parts = opt.split('〜');
        assert.strictEqual(parts.length, 2, f.label + ' の選択肢の形が違います：' + opt);
        const a = toMin(parts[0]);
        const b = toMin(parts[1]);
        assert.ok(a !== null && b !== null, f.label + ' の時刻が読めません：' + opt);
        assert.ok(a >= from && b <= to,
          f.label + ' の「' + opt + '」が、搬入の窓（'
          + TIMES.inFrom + '〜' + TIMES.inTo + '）の外です');
        assert.ok(a < b, f.label + ' の「' + opt + '」が、逆順です');
      }
    }
  });
});
