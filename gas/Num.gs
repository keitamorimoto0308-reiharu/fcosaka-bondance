/**
 * 人が打ち込んだ「数」の読み取り。**ここが唯一の正**。
 *
 * ■ なぜ1か所にまとめるか
 *   単価（レンタル品目）・枚数（出店確定情報）・合計（ダッシュボード）で
 *   同じことを3回書いていた。2026-09-04 の点検で3つを並べて実測したところ、
 *   **揃っていなかった**：
 *
 *   | 入力 | 枚数 | 合計 | 単価 |
 *   |---|---|---|---|
 *   | `3-5`      | 断る | **3**   | 断る |
 *   | `10〜15`   | 断る | **10**  | 断る |
 *   | `12abc`    | 断る | **12**  | 断る |
 *   | `-5`       | 断る | **-5**  | 断る |
 *   | `０．５`   | 断る | **0**   | 0.5 |
 *
 *   合計だけが前方一致で、しかも「入力済み」に数えていた。
 *   ＝**「未提出」にも出ず、合計だけが静かにずれる**。いちばん気づけない形。
 *
 * ■ 「読めないものは 0 にしない」
 *   0 は「0名」「無料」という意味を持ってしまう。読めなければ null を返し、
 *   呼ぶ側が「未入力」として扱う。
 *
 * ■ 区切りの除去は「3桁区切りの形」に限る
 *   以前は `[，,\s]` を全部落としていたので、
 *   `10 000` → 10000 と一緒に **`1 0` → 10、`10 20` → 1020** も通っていた。
 *   単価で `10 20` が 1020円になる（2026-09-04 の点検で実測）。
 */

/** 全角の数字・記号を半角へ。IMEのままでも受けるため */
function numHankaku_(text) {
  return String(text).trim()
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[．]/g, '.')
    .replace(/[－ー−]/g, '-');
}

/**
 * 3桁区切り（1,000 / 10 000）だけを、区切りとして落とす。
 * その形でなければ**触らない**（内部の空白が残れば、後段の形の検査で落ちる）。
 */
function numStripGroups_(text) {
  var t = String(text);
  if (/^[0-9]{1,3}([,，　 ][0-9]{3})+$/.test(t)) return t.replace(/[,，　 ]/g, '');
  // 区切りが1つも無いものは、そのまま返す（空白が入っていれば形の検査で落ちる）
  return t;
}

/** 円記号と単位を落とす。意味を変えないもの限定 */
function numStripUnits_(text) {
  return String(text)
    .replace(/^[¥￥]/, '')
    .replace(/(円|名|人|枚|台|個)$/, '');
}

/**
 * 0以上の整数だけを受ける（枚数・人数・最大数）。読めなければ null。
 * 小数は受けない（「2.5名」に意味が無い）。
 */
function numCount_(text) {
  var t = numStripGroups_(numStripUnits_(numHankaku_(text)));
  if (!/^[0-9]+$/.test(t)) return null;
  var n = Number(t);
  return isFinite(n) ? n : null;
}

/**
 * 0以上の数（小数可）を受ける（単価・合計）。読めなければ null。
 * **末尾まで数であること**を要求する。前方一致にすると
 * 「3-5」→3、「12abc」→12 と黙って別の数になる。
 */
function numAmount_(text) {
  var t = numStripGroups_(numStripUnits_(numHankaku_(text)));
  if (!/^[0-9]+(\.[0-9]+)?$/.test(t)) return null;
  var n = Number(t);
  return isFinite(n) ? n : null;
}

/**
 * 読めなかった理由。画面にそのまま出す。
 * 「なぜ断られたか」が分からないと、打ち直しようがない。
 */
function numWhy_(text) {
  var raw = String(text).trim();
  if (raw === '') return '数字が読み取れません';
  var t = numHankaku_(raw);
  if (t.charAt(0) === '-') return 'マイナスは指定できません';
  if (/[0-9]\s+[0-9]/.test(numStripUnits_(t))) {
    return '数字の間に空白が入っています（3桁区切りのときだけ使えます）';
  }
  return '「' + raw + '」は数として読めません';
}
