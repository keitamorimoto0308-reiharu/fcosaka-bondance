/**
 * 「押す前に見せるもの」と「実際に起きること」が、**同じ判定を通っているか。**
 *
 * ■ なぜ要るか（2026-09-10、けいた指摘「そういうエラーが多すぎる」）
 *   この案件はこの形で何度も事故を起こしている：
 *
 *   - 一斉メールの下見は「{{搬入予定時刻}} が空の2社では、その行が消えます」と
 *     **正しく警告していた**のに、本文では消えていなかった
 *   - 制作スケジュールの取り込みで、**実行側だけが「置き換える」を受け取り、
 *     下見側は読み捨てていた**（けいたが本番で踏んだ。ボタンが押せないまま）
 *   - 搬入の時間割で、枠が「9:30 に4社」と出るのに、押すと2件しか出なかった
 *
 *   **片方だけを見る検査では、絶対に捕まらない。**
 *   下見の検査も実行の検査も、それぞれは正しく通っているのだから。
 *
 * ■ やること
 *   下見と実行の組ごとに、**両方が同じ判定関数を通っているか**を見る。
 *   通っていれば、判定がずれる余地がそもそも無い。
 *
 * ■ 限界
 *   「同じ関数を呼んでいる」しか見ていないので、**渡す引数が違う**のは
 *   `test/payload-fields.test.js` の側で見ている。両方あって初めて塞がる。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);

const GAS = fs.readdirSync(path.join(ROOT, 'gas'))
  .filter(f => /\.gs$/.test(f))
  .map(f => fs.readFileSync(path.join(ROOT, 'gas', f), 'utf8').split('\r\n').join(NL))
  .join(NL);

function bodyOf(name) {
  const i = GAS.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let k = i; k < GAS.length; k++) {
    const c = GAS[k];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return GAS.slice(i, k + 1); }
  }
  return '';
}

const callsIn = body =>
  [...new Set([...body.matchAll(/([a-zA-Z][A-Za-z0-9]*_)\(/g)].map(m => m[1]))];

/**
 * 下見と実行の組。
 *
 * `shared` は「**この判定は必ず両方が通ること**」。
 * ここがずれると、押す前に見せたものと実際に起きることが食い違う。
 */
const PAIRS = [
  { label: '一斉メール',
    preview: 'adminBroadcastPreview_', apply: 'adminBroadcastSend_',
    shared: ['broadcastRows_', 'broadcastValidate_', 'broadcastBuild_'],
    why: '宛先の選び方・断り方・本文の組み立てが、下見と本番で同じであること。'
       + 'メールは取り消せない' },

  { label: '選考結果の送信',
    preview: 'adminNotifyPreview_', apply: 'adminNotifySend_',
    shared: ['notifyKind_', 'pendingNotifyRows_', 'buildAcceptMail_', 'buildRejectMail_'],
    why: '「誰に送るか」と「何を送るか」が、下見と本番で同じであること' },

  { label: 'テストデータの一括削除',
    preview: 'adminPurgePreview_', apply: 'adminPurgeRun_',
    shared: ['purgeEnabled_', 'liveRows_', 'SHEETS_'],
    why: '「何件消えるか」の数え方が、下見と本番で同じであること。元に戻せない' },

  { label: '制作スケジュールの取り込み',
    preview: 'adminSchedImportRead_', apply: 'adminSchedImportApply_',
    shared: ['schedImportPlan_', 'schedPeople_'],
    why: '**2026-09-10 にここが崩れた。** 実行側だけが「置き換える」を受け取り、'
       + '下見側が読み捨てていたので、33行すべてが赤くなってボタンが押せなかった' },
];

describe('押す前に見せるものと、実際に起きることが、同じ判定を通っているか', () => {

  test('組を読めている（この検査が空振りしていないこと）', () => {
    for (const p of PAIRS) {
      assert.ok(bodyOf(p.preview), p.preview + ' が見つかりません');
      assert.ok(bodyOf(p.apply), p.apply + ' が見つかりません');
    }
  });

  for (const p of PAIRS) {
    test(p.label + '：下見と実行が、同じ判定を通っている', () => {
      const a = callsIn(bodyOf(p.preview));
      const b = callsIn(bodyOf(p.apply));
      const missing = [];
      for (const fn of p.shared) {
        if (a.indexOf(fn) < 0) missing.push('下見（' + p.preview + '）が ' + fn + ' を通らない');
        if (b.indexOf(fn) < 0) missing.push('実行（' + p.apply + '）が ' + fn + ' を通らない');
      }
      assert.deepStrictEqual(missing, [],
        NL + p.label + '：下見と実行で、通る判定が違います：' + NL + missing.join(NL)
        + NL + '（' + p.why + '）' + NL
        + '→ **押す前に見せたものと、実際に起きることが食い違います。**'
        + '片方だけを見る検査では捕まりません');
    });
  }

  /*
   * 判定を1か所に置いていても、**渡す値が違えば結果は変わる**。
   * 2026-09-10 の不具合がまさにそれ（同じ schedImportPlan_ を呼んでいたのに、
   * 片方だけ `{ replace: … }` を渡していなかった）。
   */
  test('制作スケジュールの取り込みは、下見も実行も同じ形で判定を呼ぶ', () => {
    const pv = bodyOf('adminSchedImportRead_');
    const ap = bodyOf('adminSchedImportApply_');
    for (const [label, body] of [['下見', pv], ['実行', ap]]) {
      // ※ [^)]* にしない。`schedPeople_()` の括弧で止まってしまう
      //   （2026-09-10、実際にそう外れた）
      assert.ok(/schedImportPlan_\([^;]*\{\s*replace:/.test(body),
        label + ' が schedImportPlan_ に「置き換えるか」を渡していません。'
        + '**画面で指定したのに効かない**、という形の不具合になります'
        + '（2026-09-10、けいたが本番で踏んだ）');
    }
  });
});
