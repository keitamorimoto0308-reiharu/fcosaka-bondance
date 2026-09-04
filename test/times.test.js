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

  test('古い時刻が、どこにも残っていない', () => {
    // 「新しい値がある」だけでは、古い値が別の行に残っていても通ってしまう
    const hay = [
      JSON.stringify(C.FACTS), JSON.stringify(C.OUTLINE),
      read('gas/Mail.gs'), read('gas/Notify.gs'),
    ].join('\n');
    ['8:30〜10:30', '17:30〜19:30', '16:30〜'].forEach(old => {
      assert.ok(!hay.includes(old), '古い時刻が残っています：' + old);
    });
  });
});
