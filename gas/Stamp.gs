// ───────────────────────────────── 設定シートの1行と、「最後に誰がいつ」
/**
 * 設定シートの1行を**読み取りキャッシュを通さずに**読み書きする道具と、
 * 「最後に誰がいつ触ったか」の記録。**①制作スケジュールと②タイムスケジュールが共有する。**
 *
 * ■ なぜ getConfig() を通さないか
 *   `getConfig()` は1回の実行内でキャッシュする（gas/Config.gs）。
 *   ②の版番号も、①②のスタンプも、**実行のさなかに変わる**ものなので、
 *   キャッシュ越しに読むと**書いた直後に古い値が返る**。
 *   ②では、それだと「ぶつかりの検出」そのものが壊れる。
 *
 * ■ ここに置いてあるものは、設定タブ（SETTING_KEYS_）には出さない
 *   人が触るものではないし、触られると記録が嘘になる。
 *   行が無ければ書くときに足すので、**setup() を押し直す必要もない**。
 *
 * ■ 元は gas/Timetable.gs にあった
 *   ①も同じものを必要としたので、2026-09-07 にここへ移して共有にした。
 *   写しを2つ書くと、片方だけ直したときに気づけない。
 */

/**
 * 設定シートの1行を、**読み取りキャッシュを通さずに**読む。
 * 無ければ空文字。**例外にしない**（まだ記録が無いのは、普通の状態）。
 */
function configRaw_(key) {
  var sh = sheet_(SHEET.CONFIG);
  var row = findConfigRow_(sh, key);
  if (!row) return '';
  return sh.getRange(row, 2).getValue();
}

/** 設定シートの1行に書く。**行が無ければ足す**（だから setup() は要らない） */
function setConfigValue_(key, value) {
  var sh = sheet_(SHEET.CONFIG);
  var row = findConfigRow_(sh, key);
  if (row) { sh.getRange(row, 2).setValue(value); return; }
  sh.appendRow([key, value, '（システムが使います。手で変えないでください）']);
}

/**
 * 「最後に誰がいつ」を読む。中身は `名前|時刻(ミリ秒)` の形。
 *
 * ■ 名前に | が入っていても読み違えない
 *   区切りは**最後の |** で見る。氏名に記号が入ることはありうる。
 *
 * ■ 先頭の ' を落とす
 *   書くときに `safeCellText_` を通すので、`=` で始まる氏名にはクォートが付く。
 *   そのまま画面に出すと「'山田さんが編集」になる。
 *
 * @return {{person:string, at:number}} 記録が無ければ {person:'', at:0}
 */
function lastActionGet_(key) {
  var raw = asText_(configRaw_(key)).replace(/^'/, '');
  var i = raw.lastIndexOf('|');
  if (i < 0) return { person: '', at: 0 };
  var at = Number(raw.slice(i + 1));
  if (!isFinite(at) || at <= 0) return { person: '', at: 0 };
  return { person: raw.slice(0, i), at: at };
}

/** 「最後に誰がいつ」を書く。**実際に何かが変わったときだけ呼ぶ** */
function lastActionSet_(key, person, atMs) {
  setConfigValue_(key, safeCellText_(String(person || '') + '|' + atMs));
}
