// ─────────────────────────────────────── ② タイムスケジュール（当日の時間割）
/**
 * 2026-10-24（本番）の進行の時間割を組む。
 * 仕様は docs/internal/design_timetable.md（gitignore 対象・手元にある）。
 *
 * ■ 「当日運営」タブとは別物
 *   当日運営タブは**出店者の一覧**（搬入時間・現場責任者）。
 *   こちらは**進行の時間割**（進行・音響・司会が見る）。
 *
 * ■ 誰が触れるか
 *   **全員**（けいた確定・2026-09-04）。①制作スケジュール表と同じ。
 *   `adminOnly` には入れない。管理者だけにすると、結局シートを直接開くことになって
 *   形骸化する。代わりに、保存のたびに誰が何件動かしたかを変更履歴に残す。
 *
 * ■ 保存は「まるごと差し替え」しかない（§3-3）
 *   自動ずらしがあるので、1つ動かすと後ろが全部動く。
 *   差分で送る作りにすると、**送る側と受ける側の両方にずらしを実装**することになり、
 *   必ずズレる。行数は多くて40なので、まるごと書いても1回の setValues で足りる。
 *
 * ■ ぶつかりの検出は gas/Purge.gs の引換券をまねる（§3-2）
 *   新しい仕組みを作らない。**鍵は分ける**（`|timetable` と `|purge`）。
 *   混ざると、片方の券で他方のAPIに入れる。
 */

/**
 * レーンは**ここが正**。画面は adminTimetable_ が返した配列から組む。
 *
 * 配列にしてあるのは意図的で、照合は indexOf で行う。
 * 素のオブジェクトのキー照合にすると、`constructor` と書くだけで真になる
 * （2026-09-02 に UPLOAD_ALLOWED が素の {} だったため .exe が置けた）。
 */
var TT_LANES_ = ['全体', 'イベント', '備考'];

/** 仕様書 §2-1 の列。**IDが1列目**（行の並べ替えでも変わらない印） */
var TT_HEADERS_ = ['ID', 'レーン', '開始', '所要分', 'タイトル', '出演者', '詳細', 'ロック', '並び順'];

var TT_TITLE_MAX_  = 100;
var TT_DETAIL_MAX_ = 500;
var TT_CAST_MAX_   = 10;    // 出演者の人数
var TT_CAST_LEN_   = 30;    // 出演者ひとりの字数
var TT_MIN_MAX_    = 600;   // 所要分の上限（10時間）
var TT_ROWS_MAX_   = 200;   // 行数の上限（暴走を止める）
var TT_DAY_MIN_    = 24 * 60;

/**
 * 版番号の置き場所。**設定シートに1行**（§2-2）。
 *
 * 失われると「ぶつかり」を検出できなくなるので、キャッシュには置かない。
 * 人が触るものではないので SETTING_KEYS_（設定タブ）には出さない。
 */
var TT_VERSION_KEY_ = 'タイムスケジュール版';

/** 誰がいつ保存したか。断るときの帯（§4-4）に「小谷さんが2分前」と出すために要る */
var TT_LASTBY_KEY_ = 'タイムスケジュール最終更新';

/** 進行表が指す日。イベント固有の値はコードに直書きしない（仕様書§0） */
var TT_DAY_KEY_ = '進行表の日付';

/**
 * 引換券の有効時間（**時間**）。一括削除の10分ではない。
 *
 * 編集は長くかかりうるので、10分だと**普通に使っていて切れる**。
 * 版番号が進んだ時点で無効になるので、期限は「使い回しを防ぐ上限」として置くだけ。
 */
var TT_TICKET_HOURS_ = 6;

// ───────────────────────────────────────────────── 時刻（分に直す口は1つだけ）

/**
 * `11:00` → 660。**ほかの場所で分に直さない。**
 *
 * 開始時刻をテキストで持つのは、シートの時刻値が GAS では Date として読まれ、
 * タイムゾーンで化けるから（§2-1）。この案件は「黙って別の値になる」で
 * 何度も刺されている（`Number('')` が 0 ／全角数字が 0 ／`-500` が 500）。
 *
 * @return {number|null} 読めなければ null（0 に倒さない）
 */
function hhmmToMin_(s) {
  var m = String(s == null ? '' : s).match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 660 → `11:00`。読めない値は空文字（勝手に 00:00 にしない） */
function minToHhmm_(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0 || n !== Math.floor(n)) return '';
  var h = Math.floor(n / 60), m = n % 60;
  return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
}

/**
 * 全角の数字と記号を半角に直す。
 *
 * **これは「黙って別の値になる」変換ではない。** 日本語IMEでは「１１：００」が
 * 普通に出るので、文字の書き分けを揃えているだけで、値は同じ。
 * 禁じているのは `Number('５')` のように**読めないものを勝手に数にする**ほう。
 * （①の schedHalfWidth_ と同じ考え方。こちらはコロンも直す）
 */
function ttHalfWidth_(v) {
  return asText_(v)
    .replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[：︓]/g, ':')
    .replace(/　/g, ' ');
}

/**
 * 文字の欄を読む。**読み取れないものは、読み取れないと返す。**
 *
 * `asText_` は何でも `String()` に通すので、`{}` を送ると
 * 「[object Object]」というタイトルの行が残る（①で検証役が見つけた形）。
 * 受けるのは文字と数だけ。真偽値・配列・オブジェクト・関数は断る。
 */
function ttText_(v, label) {
  if (v === null || v === undefined) return { value: '' };
  var t = typeof v;
  if (t === 'number') {
    if (!isFinite(v)) return { message: label + 'を読み取れませんでした。' };
    return { value: String(v) };
  }
  if (t !== 'string') return { message: label + 'を読み取れませんでした。' };
  return { value: v.trim() };
}

/** 行を見分ける印。8桁の英数字。行の並べ替えでも変わらない（§2-1） */
function ttNewId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

/**
 * シートの欄から時刻を読む。
 *
 * **人がシートの表示形式を時刻に変えると、Sheets は Date を返してくる。**
 * ①で実際に踏んだ（日付列に表示形式を付けたら `2026-09-20 00:00` になった）。
 * テキストで持つ約束にしていても、読む側は Date に備える。**読む口を1つにする。**
 */
function ttCellTime_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'HH:mm');
  }
  return ttHalfWidth_(v).trim();
}

// ───────────────────────────────────────────────── 版番号（設定シートの1行）

function ttSheet_() {
  return sheet_(SHEET.TIMETABLE);
}

/**
 * 設定シートの1行を、**読み取りキャッシュを通さずに**読む。
 *
 * `getConfig()` は1回の実行内でキャッシュする（gas/Config.gs）。
 * 版番号は保存のたびに変わるので、キャッシュ越しに読むと
 * **保存した直後に古い版が返る**。ぶつかりの検出そのものが壊れる。
 */
function ttConfigRaw_(key) {
  var sh = sheet_(SHEET.CONFIG);
  var row = findConfigRow_(sh, key);
  if (!row) return '';
  return sh.getRange(row, 2).getValue();
}

function ttSetConfig_(key, value) {
  var sh = sheet_(SHEET.CONFIG);
  var row = findConfigRow_(sh, key);
  if (row) { sh.getRange(row, 2).setValue(value); return; }
  sh.appendRow([key, value, '（システムが使います。手で変えないでください）']);
}

/**
 * いまの版番号。**読めなければ 0 に落とす。**
 *
 * ここだけは 0 に倒してよい。版番号は「前と同じか」を見るためのもので、
 * 読めない値のまま進むと、誰の券も通らなくなって**保存が一切できなくなる**。
 * 0 に落ちても、次の保存で 1 になって普通に動きだす。
 */
function ttVersion_() {
  var n = Number(ttHalfWidth_(ttConfigRaw_(TT_VERSION_KEY_)));
  if (!isFinite(n) || n < 0 || n !== Math.floor(n)) return 0;
  return n;
}

/** 誰がいつ保存したか。`小谷|1760000000000` の形で持つ */
function ttLastBy_() {
  var raw = asText_(ttConfigRaw_(TT_LASTBY_KEY_));
  var i = raw.lastIndexOf('|');
  if (i < 0) return { person: '', at: 0 };
  var at = Number(raw.slice(i + 1));
  return { person: raw.slice(0, i), at: isFinite(at) ? at : 0 };
}

function ttSetLastBy_(person, at) {
  ttSetConfig_(TT_LASTBY_KEY_, safeCellText_(String(person || '') + '|' + at));
}

/** 進行表が指す日。設定に無ければ空で返す（勝手な日付を作らない） */
function ttDay_() {
  return asText_(ttConfigRaw_(TT_DAY_KEY_)).trim().slice(0, 10);
}

// ───────────────────────────────────────────────── 引換券（§3-2）

/**
 * 管理トークンとも `|purge` とも別の鍵。
 * **混ざると、片方の券で他方のAPIに入れる。**
 */
function ttHmac_(text) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(text, authSecret_() + '|timetable'));
}

/**
 * いまの版に対する引換券。
 *
 * ■ なぜ版番号だけでは足りないか
 *   版番号は小さい整数なので、画面が「読んでいないのに 12 と言う」ことができる。
 *   署名した券なら、**サーバーが渡した券以外は通らない**。
 */
function ttIssueTicket_(version) {
  var payload = {
    v: version,
    e: new Date().getTime() + TT_TICKET_HOURS_ * 3600000,
  };
  var body = Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  return body + '.' + ttHmac_(body);
}

/**
 * 券が、いまの版のものか。通れば null、通らなければ返すべき返事を返す。
 *
 * **error は1件ずつ分ける。** 同じにすると、どちらの歯止めが働いたのか
 * 検査で見分けられず、片方を外しても気づけない（gas/Purge.gs と同じ理屈）。
 */
function ttTicketError_(ticket, version) {
  var again = '画面を読み込み直してから、もう一度お願いします。';
  var parts = String(ticket || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, error: 'no_ticket',
      message: '保存の引換券がありません。' + again };
  }
  if (!safeEquals_(ttHmac_(parts[0]), parts[1])) {
    return { ok: false, error: 'bad_ticket',
      message: '保存の引換券を確認できませんでした。' + again };
  }
  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (e) { payload = null; }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'bad_ticket',
      message: '保存の引換券を確認できませんでした。' + again };
  }
  if (!payload.e || payload.e < new Date().getTime()) {
    return { ok: false, error: 'expired_ticket',
      message: 'この画面を開いてから' + TT_TICKET_HOURS_ + '時間以上たちました。' + again };
  }
  // ここが本体。**読んだときの版と、いまの版が同じか。**
  if (Number(payload.v) !== Number(version)) {
    return { ok: false, error: 'conflict' };
  }
  return null;
}

// ───────────────────────────────────────────────── 検証（§3-4）

/**
 * 送られた行を全部検証して、シートに書ける形に整える。
 * **1行でも通らなければ、何も書かずに断る**（§3-3 の1）。
 *
 * 断るときは**何行目の何か**を書く。「入力が正しくありません」では直せない。
 */
function validateTimetableRows_(rows) {
  var reload = '画面を読み込み直してから、もう一度お願いします。';

  if (!Array.isArray(rows)) {
    return { message: '送信された内容を読み取れませんでした。' + reload };
  }
  if (rows.length > TT_ROWS_MAX_) {
    return { message: '予定は' + TT_ROWS_MAX_ + '件までです。'
                    + '（' + rows.length + '件が送られました）' };
  }

  var out = [];
  // IDの重複を見る入れ物。**素の {} にしない**。
  // `constructor` というIDを送るだけで「もう見た」と判定される（§7-2）
  var seen = Object.create(null);

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    // 断るときは**何件目の何が悪いか**を書く。
    // 「入力が正しくありません」では、40件の中から探せない
    var where = (i + 1) + '件目の予定';

    if (row === null || row === undefined || typeof row !== 'object' || Array.isArray(row)) {
      return { message: where + 'を読み取れませんでした。' + reload };
    }

    var ng;

    // ── レーン。照合は配列の indexOf（許可リストを素のオブジェクトにしない・§7-2）
    var lane = ttText_(row.lane, where + 'のレーン');
    if (lane.message) return lane;
    if (!lane.value) {
      return { message: where + 'のレーンが空です。' };
    }
    if (TT_LANES_.indexOf(lane.value) < 0) {
      return { message: where + 'のレーン「' + lane.value.slice(0, 20) + '」は使えません。' };
    }

    // ── 開始時刻。**数字を拾って作らない。** 分に直す口は hhmmToMin_ ひとつだけ
    var startT = ttText_(row.start, where + 'の開始時刻');
    if (startT.message) return startT;
    var start = hhmmToMin_(ttHalfWidth_(startT.value));
    if (start === null) {
      return { message: where + 'の開始時刻は「11:00」の形でご入力ください。' };
    }

    // ── 所要分。**空を 0 に倒すのは、ここでだけ許される。**
    //    0 は「時刻だけの目印」（ゲートオープンなど）という意味を持っている。
    //    ただし「読めない値」は 0 にしない（Number('') が 0 になって
    //    予定が目印に化ける、という形を作らない）
    var minT = ttText_(row.min, where + 'の所要時間');
    if (minT.message) return minT;
    var minRaw = ttHalfWidth_(minT.value).trim();
    var minutes = minRaw === '' ? 0 : Number(minRaw);
    if (!isFinite(minutes) || minutes !== Math.floor(minutes)
        || minutes < 0 || minutes > TT_MIN_MAX_) {
      return { message: where + 'の所要時間は0〜' + TT_MIN_MAX_ + '分の整数でご入力ください。' };
    }

    // ── 日をまたがせない（1日ぶんと決めた・§8）。
    //    またげる作りにすると、印刷のA4・1枚（§6-1）に収まらなくなる
    if (start + minutes > TT_DAY_MIN_) {
      return { message: where + 'が翌日にかかっています。'
                      + '当日のうちに終わる時間でご入力ください。' };
    }

    // ── タイトル。**先に長さを見ると配列で制限を回避できる**ので、
    //    必ず ttText_ を通してから length を見る（①で検証役が見つけた抜け道）
    var titleT = ttText_(row.title, where + 'のタイトル');
    if (titleT.message) return titleT;
    if (!titleT.value) {
      return { message: where + 'のタイトルをご記入ください。' };
    }
    if (titleT.value.length > TT_TITLE_MAX_) {
      return { message: where + 'のタイトルは' + TT_TITLE_MAX_ + '文字までです。' };
    }

    var detailT = ttText_(row.detail, where + 'の詳細');
    if (detailT.message) return detailT;
    if (detailT.value.length > TT_DETAIL_MAX_) {
      return { message: where + 'の詳細は' + TT_DETAIL_MAX_ + '文字までです。' };
    }

    // ── 出演者。自由入力（§2-3）。関係者シートからは選ばせない
    //    （○○市長・△△先生は主催側の関係者ではない）
    ng = ttCasts_(row.casts, where);
    if (ng.message) return ng;

    // ── ID。**勝手に振り直さない。**
    //    形が違うものを黙って新しいIDにすると、画面が指していた予定と
    //    別のものが残り、しかも ok が返る（①で行番号を使っていたときと同じ形）
    var idT = ttText_(row.id, where + 'のID');
    if (idT.message) return idT;
    if (idT.value) {
      if (!/^[0-9a-zA-Z]{8}$/.test(idT.value)) {
        return { message: where + 'を指し示せませんでした。' + reload };
      }
      if (seen[idT.value]) {
        return { message: '同じ予定が2件送られました。' + reload };
      }
      seen[idT.value] = true;
    }

    out.push({
      id: idT.value,
      lane: lane.value,
      start: minToHhmm_(start),
      min: minutes,
      title: titleT.value,
      casts: ng.value,
      detail: detailT.value,
      // シートは 'TRUE' / 空 で持つ（§2-1）。画面からは真偽値で来る
      locked: row.locked === true || row.locked === 'TRUE' || row.locked === 'true',
      order: i,
    });
  }
  return { value: out };
}

/**
 * 出演者の欄を読む。配列でもカンマ区切りでも受ける。
 * @return {{value:Array}|{message:string}}
 */
function ttCasts_(raw, where) {
  var list = Array.isArray(raw) ? raw : ttCastList_(raw);
  // 人数は**中身を読む前に**見る。1万人ぶんを1件ずつ検証すると、そこで時間を使う
  if (list.length > TT_CAST_MAX_) {
    return { message: where + 'の出演者は' + TT_CAST_MAX_ + '人までです。' };
  }
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var t = ttText_(list[i], where + 'の出演者');
    if (t.message) return t;
    if (!t.value) continue;
    if (t.value.length > TT_CAST_LEN_) {
      return { message: where + 'の出演者「' + t.value.slice(0, 10) + '…」は'
                      + TT_CAST_LEN_ + '文字までです。' };
    }
    // シートにはカンマ区切りで入れる。名前の中のカンマは**区切りに化ける**ので断る。
    // 黙って消すと、保存したあとに名前が変わっていることになる
    if (t.value.indexOf(',') >= 0 || t.value.indexOf('、') >= 0) {
      return { message: where + 'の出演者名に「,」は使えません。'
                      + 'お一人ずつ分けてご入力ください。' };
    }
    if (out.indexOf(t.value) < 0) out.push(t.value);
  }
  return { value: out };
}

/** カンマ区切りの欄を配列にする。空は落とす */
function ttCastList_(v) {
  if (v === null || v === undefined || v === '') return [];
  if (typeof v !== 'string' && typeof v !== 'number') return [v];   // 型は ttText_ が断る
  return asText_(v).split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

// ───────────────────────────────────────────────── 編集中の札（§4-6）

/**
 * 札は**キャッシュに置く**（§2-2）。
 *
 * ■ 分け方の基準は「失われて困るか」
 *   版番号は失われると、ぶつかりを検出できなくなる → シート。
 *   札は**見えるだけ**のもので、消えても誰も困らない → キャッシュ。
 *
 * ■ なぜシートに書かないか
 *   60秒ごとに全員が書き込むことになる。シートへの1回の書き込みは1〜2秒かかるので、
 *   人数ぶんだけ保存が詰まる。**見えるだけのもののために、保存を遅くしない。**
 *
 * ■ 締め出さない
 *   けいた確定（09-03）：「編集中の札は見えるだけ。締め出さない。
 *   ぶつかったら保存時に断る」。ブラウザを閉じ忘れた人がいても、誰も止まらない。
 */
var TT_EDITORS_KEY_ = 'tt-editors';

/** 3分以上更新が無い札は消える。60秒ごとに叩くので、2回落としても残る */
var TT_LEASE_SEC_ = 180;

/** 自動保存の間隔（分）。設定シートで変えられる（§4-5） */
var TT_AUTOSAVE_KEY_ = '進行表の自動保存分';
var TT_AUTOSAVE_DEFAULT_ = 3;

/**
 * 自動保存の間隔。**読めない値は既定の3に落とす。0にしない。**
 *
 * 0 に倒すと自動保存が一度も走らなくなり、
 * 「保存したつもり」が起きる（単価が空欄で0円になった件と同じ倒し方をしない）。
 */
function ttAutosaveMin_() {
  var n = configNumber(TT_AUTOSAVE_KEY_);
  if (n === null || n === undefined || !(n >= 1) || n !== Math.floor(n)) {
    return TT_AUTOSAVE_DEFAULT_;
  }
  return Math.min(n, 30);
}

/**
 * いまの札を読む。**読めなければ空として扱う。**
 *
 * 札が壊れていて画面が開けなくなるのは、割に合わない。
 * 見えるだけのものなので、読めなければ「誰もいない」でよい。
 */
function ttEditorsRaw_() {
  var raw;
  try { raw = CacheService.getScriptCache().get(TT_EDITORS_KEY_); }
  catch (e) { return {}; }
  if (!raw) return {};
  var o;
  try { o = JSON.parse(raw); } catch (e) { return {}; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  return o;
}

/**
 * 期限切れを落とした札の一覧。自分は除く（自分の札は出さない・§4-6）。
 *
 * @param {string} me いま見ている人の名前
 * @return {Array<{person:string, agoSec:number}>}
 */
function ttEditors_(me) {
  var all = ttEditorsRaw_();
  var now = new Date().getTime();
  var out = [];
  Object.keys(all).forEach(function (person) {
    if (!person || person === me) return;
    var at = Number(all[person]);
    if (!isFinite(at)) return;
    var agoSec = Math.round((now - at) / 1000);
    if (agoSec > TT_LEASE_SEC_ || agoSec < 0) return;
    out.push({ person: person, agoSec: Math.max(agoSec, 0) });
  });
  // 古い人ほど下。画面は上から読むので、いま動いている人を先に出す
  out.sort(function (a, b) { return a.agoSec - b.agoSec; });
  return out;
}

/**
 * 札を立て直す（60秒ごと）。返りは**いまの札の一覧**。
 *
 * ■ 全員ぶんを1つの塊で持つ
 *   CacheService には「鍵の一覧を出す」がないので、人ごとの鍵にすると
 *   誰がいるのか読み出せない。読んで足して書き戻す形にする。
 *   同時に叩くと片方の更新が落ちうるが、**落ちても60秒後にまた立つ**。
 *   見えるだけのものなので、ここに鍵（LockService）は持ち込まない
 *   （保存の鍵と取り合って、本物の保存を待たせるほうが害が大きい）。
 */
function adminTimetableHeartbeat_(auth) {
  var me = (auth && auth.person) || '';
  var now = new Date().getTime();

  if (me) {
    var all = ttEditorsRaw_();
    all[me] = now;
    // 期限切れを落としてから書き戻す。放っておくと辞めた人の名前が溜まる
    Object.keys(all).forEach(function (person) {
      var at = Number(all[person]);
      if (!isFinite(at) || (now - at) / 1000 > TT_LEASE_SEC_) delete all[person];
    });
    try {
      CacheService.getScriptCache().put(TT_EDITORS_KEY_, JSON.stringify(all), TT_LEASE_SEC_ * 2);
    } catch (e) { logError_('adminTimetableHeartbeat_', e); }
  }

  return { ok: true, editors: ttEditors_(me) };
}

// ───────────────────────────────────────────────── 読み・保存

/** シートの全行を、画面が使う形にする */
function ttReadRows_() {
  var sh = ttSheet_();
  if (sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var idx = {};
  values[0].forEach(function (h, i) { idx[String(h).trim()] = i; });

  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var title = asText_(r[idx['タイトル']]).trim();
    if (!title) continue;                      // 空行は無いものとして扱う
    var min = Number(asText_(r[idx['所要分']]).trim());
    out.push({
      id:     asText_(r[idx['ID']]).trim(),
      lane:   asText_(r[idx['レーン']]).trim(),
      start:  ttCellTime_(r[idx['開始']]),
      min:    (isFinite(min) && min >= 0) ? Math.floor(min) : 0,
      title:  title,
      casts:  ttCastList_(asText_(r[idx['出演者']])),
      detail: asText_(r[idx['詳細']]).trim(),
      locked: asText_(r[idx['ロック']]).trim().toUpperCase() === 'TRUE',
      order:  Number(r[idx['並び順']]) || 0,
    });
  }
  return out;
}

/** 全行＋版番号＋引換券を返す */
function adminTimetable_(auth) {
  var rows = ttReadRows_();

  // 出演者の候補は「すでに使われた名前」から作る（§2-3）。
  // 候補を出さないと「○○バンド」「○○band」「〇〇バンド」が並ぶ
  var casts = [];
  rows.forEach(function (r) {
    r.casts.forEach(function (c) { if (casts.indexOf(c) < 0) casts.push(c); });
  });

  return {
    ok: true,
    version: ttVersion_(),
    ticket: ttIssueTicket_(ttVersion_()),
    rows: rows,
    lanes: TT_LANES_.slice(),
    casts: casts,
    day: ttDay_(),
    // 札は読み出しにも乗せる。画面を開いた瞬間に「誰がいるか」が分かる
    editors: ttEditors_((auth && auth.person) || ''),
    autosaveMin: ttAutosaveMin_(),
    me: { person: (auth && auth.person) || '' },
  };
}

/**
 * まるごと差し替え（§3-3）。
 *
 * 順番が肝。**券の照合を先に**する。
 * 検証を先にすると、券を持たない人が「何を送ると通るか」を試せる
 * （引き継ぎ書§6「守りになっているかを、送る側から見て確かめる」）。
 */
function adminTimetableSave_(auth, payload) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    return { ok: false, error: 'busy',
             message: 'ほかの方が保存中です。少し待ってから、もう一度お願いします。' };
  }
  try {
    var version = ttVersion_();
    var ng = ttTicketError_(payload && payload.ticket, version);
    if (ng && ng.error === 'conflict') return ttConflict_(version);
    if (ng) return ng;

    var v = validateTimetableRows_(payload && payload.rows);
    if (v.message) return { ok: false, error: 'bad_value', message: v.message };
    var rows = v.value;

    var before = ttReadRows_();
    ttWriteRows_(rows);

    var next = version + 1;
    ttSetConfig_(TT_VERSION_KEY_, next);
    var now = new Date().getTime();
    ttSetLastBy_((auth && auth.person) || '', now);
    SpreadsheetApp.flush();

    /*
     * 変更履歴は**1回の保存につき1行だけ**（§3-3 の4）。
     * 自動保存が2〜3分おきに走るので、1件ずつ残すと本当の変更が埋もれる。
     * 変わっていないときは残さない（①のステータスのチップと同じ理屈）。
     */
    var beforeText = ttDigest_(before);
    var afterText = ttDigest_(rows);
    if (beforeText !== afterText) {
      appendHistory((auth && auth.person) || '', '（進行表）', '保存',
                    beforeText, afterText, '');
    }

    return { ok: true, version: next, ticket: ttIssueTicket_(next),
             count: rows.length, rows: ttReadRows_() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 断るときは、**最新の行と新しい券を一緒に返す**（§4-4）。
 * 返さないと、画面は読み直すために別の往復が要る。
 */
function ttConflict_(version) {
  var last = ttLastBy_();
  var agoSec = last.at ? Math.max(Math.round((new Date().getTime() - last.at) / 1000), 0) : 0;
  return {
    ok: false, error: 'conflict',
    message: '保存できませんでした。あなたが開いてから、ほかの方が変更しています。',
    version: version, ticket: ttIssueTicket_(version),
    rows: ttReadRows_(), by: last.person, agoSec: agoSec,
  };
}

/** 変更履歴に残す要約。行の中身をそのまま持つ（削除の復元手段になる） */
function ttDigest_(rows) {
  return JSON.stringify(rows.map(function (r) {
    return [r.lane, r.start, r.min, r.title, r.casts.join(','), r.detail,
            r.locked ? 'TRUE' : ''];
  }));
}

/**
 * 2行目以降を消して、送られた行を書く。行数は多くて40なので1回で足りる。
 *
 * **開始時刻はテキストのまま書く。** シートの時刻値は GAS では Date として
 * 読まれてタイムゾーンで化ける（§2-1）。
 */
function ttWriteRows_(rows) {
  var sh = ttSheet_();
  var last = sh.getLastRow();
  if (last >= 2) sh.deleteRows(2, last - 1);
  if (!rows.length) return;

  var lines = rows.map(function (r, i) {
    return [
      r.id || ttNewId_(),
      r.lane,
      r.start,
      r.min,
      safeCellText_(r.title),
      safeCellText_(r.casts.join(', ')),
      safeCellText_(r.detail),
      r.locked ? 'TRUE' : '',
      i + 1,
    ];
  });
  sh.getRange(2, 1, lines.length, TT_HEADERS_.length).setValues(lines);
}
