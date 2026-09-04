/**
 * テストデータの一括削除（管理者のみ）。
 *
 * ■ なぜ要るか
 *   2026-09-03 けいた指示：
 *   「公開前に管理画面に入ってるテストデータやダミーデータを一括削除する機能を
 *     トップの管理権限と、安易に押してしまわない仕組みがあればいい」
 *   「ほんとにすべて消してきれいにして変更履歴とかも残してほしくない」
 *
 *   FC大阪への機能説明では、**本物のフォームから実際に送信してもらう**のが
 *   いちばん伝わる。デモ用に別のフォームと別の管理画面を作ると二重になり、
 *   しかも「本物と同じか」を誰も保証できない。
 *   本番にテストデータを入れて、公開前にきれいに消す。そのための道具。
 *
 * ■ 手でシートの行を消すだけでは足りない
 *   取りこぼすものが3つある：
 *     ・Driveの「出店者提出物」に作られた受付IDごとのフォルダ
 *     ・区画シートの「割当受付ID」（残ると、マップに幽霊の割当が出る）
 *     ・退避シート（ハニーポットに引っかかったテスト応募）
 *   受付IDだけは、行を全部消せば SB-0001 に戻る（台帳の最大値から採るため）。
 *
 * ■ 変更履歴も含めて、本当に消す
 *   けいたの指示どおり。ただし**消す前にスプレッドシートを丸ごと複製する**。
 *   複製は別ファイルなので、台帳はきれいなまま。
 *   間違えて本物を消しても、複製から戻せる。
 *   確認が済んだら、複製はDriveから捨ててよい。
 *
 * ■ 安全装置は5つ。1つでも欠けると事故になる
 *   1. 設定の「テストデータの削除」がONのときだけ、入口が開く
 *      （ふだんはボタンが存在しない。ONにしたことは変更履歴に残る）
 *   2. 消える対象を**先に一覧で返す**（何が消えるか見ないまま押せない）
 *   3. 件数を打ち込ませる（惰性で押せない）
 *   4. **下見のときと対象が変わっていたら実行しない**
 *      画面を開いたまま席を立つのは普通に起きる。
 *      その間に本物の応募が来ていたら、巻き込んで消してしまう。
 *   5. 4を**画面に任せない**。下見のときにサーバーが受付IDの集合に署名し
 *      （引換券）、実行にはその券を要る形にする。
 *      2026-09-03の検証で見つかった穴：画面側は一覧の自動再読み込みで
 *      受付IDの控えを黙って差し替えていた。**人が見た一覧は古いまま、
 *      送られる受付IDだけが新しくなる**。件数の照合も、
 *      1件増えて1件減れば通ってしまう。
 *      画面の変数は守りにならない。券はサーバーが出してサーバーが確かめる。
 *
 * ■ 実行したら、設定のスイッチは自動でOFFに戻る
 *   1回ぶんの鍵にする。ONのまま忘れると、安全装置1が働かなくなる。
 *
 * ■ 触らないもの
 *   確認事項（本物の宿題が混ざる）、関係者、設定、レンタル品目、
 *   資料置き場のファイル（主催側の資料で、テストかどうかは人にしか分からない）。
 */

/** 1回に消せる上限。桁を打ち間違えても被害を頭打ちにする */
var PURGE_MAX = 200;

/** 設定のスイッチ。ここがONのときだけ入口が開く */
var PURGE_SWITCH = 'テストデータの削除';

/** 中身を空にするシート（見出しは残す） */
function PURGE_SHEETS_() {
  return [SHEET.LEDGER, SHEET.CONFIRM, SHEET.HISTORY, SHEET.QUARANTINE];
}

/** 引換券の有効時間（分）。下見して席を立ったまま翌日押す、を通さない */
var PURGE_TICKET_MIN = 10;

function purgeEnabled_() {
  return configBool(PURGE_SWITCH);
}

/** 管理トークンとも応募者トークンとも別の鍵。この券で他のAPIに入れないように */
function purgeHmac_(text) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(text, authSecret_() + '|purge'));
}

/** 受付IDの集合を、順番によらない1つの文字列にする */
function purgeIdsFingerprint_(ids) {
  return sha256_('purge|' + (ids || []).map(function (x) { return String(x); })
                                        .sort().join(','));
}

/**
 * 下見した集合に対する引換券。
 * **中身は指紋と期限だけ**。受付IDそのものは入れない（券は画面を経由する）。
 */
function purgeIssueTicket_(ids) {
  var payload = {
    h: purgeIdsFingerprint_(ids),
    n: (ids || []).length,
    e: new Date().getTime() + PURGE_TICKET_MIN * 60000,
  };
  var body = Utilities.base64EncodeWebSafe(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  return body + '.' + purgeHmac_(body);
}

/**
 * 券が、いま消そうとしている集合のものか。
 * 通れば null、通らなければ返すべき返事を返す。
 */
function purgeTicketError_(ticket, ids) {
  var again = 'もう一度「消える対象を確かめる」からやり直してください。';
  var parts = String(ticket || '').split('.');
  if (parts.length !== 2 || !parts[0]) {
    return { ok: false, error: 'no_ticket',
      message: '削除の引換券がありません。' + again };
  }
  if (!safeEquals_(purgeHmac_(parts[0]), parts[1])) {
    return { ok: false, error: 'bad_ticket',
      message: '削除の引換券が確認できませんでした。' + again };
  }
  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (e) { payload = null; }
  if (!payload) {
    return { ok: false, error: 'bad_ticket',
      message: '削除の引換券が確認できませんでした。' + again };
  }
  if (!payload.e || payload.e < new Date().getTime()) {
    return { ok: false, error: 'expired_ticket',
      message: '確かめてから' + PURGE_TICKET_MIN + '分以上が経ちました。' + again };
  }
  // ここが本体。**下見で見せた集合と、いま消そうとしている集合が同じか**。
  // 手前の ids と台帳の照合とは別の error にする。
  // 同じにすると、どちらの歯止めが働いたのか検査で見分けられず、
  // 片方を外しても気づけない（わざと壊す検査が素通りする）
  if (!safeEquals_(String(payload.h), purgeIdsFingerprint_(ids))) {
    return { ok: false, error: 'stale_ticket',
      message: '確かめたときと、消える対象が変わっています。' + again };
  }
  return null;
}

/**
 * 消える対象の下見。**何も書き換えない**。
 * 返した受付IDの集合を、実行時にそのまま突き合わせる。
 */
function adminPurgePreview_(auth) {
  if (!purgeEnabled_()) {
    return { ok: false, error: 'disabled',
      message: 'この操作は、「設定」タブの「テストデータの一括削除を許可」が'
             + 'ONのときだけ使えます。ONにしてから、この画面を読み込み直してください。' };
  }
  var L = readLedger_();
  var rows = liveRows_(L.headers, L.rows);
  var idIdx = L.headers.indexOf(COL.id);
  var coIdx = L.headers.indexOf(COL.company);
  var atIdx = L.headers.indexOf(COL.at);
  var stIdx = L.headers.indexOf(COL.status);

  var items = rows.map(function (r) {
    return {
      id: asText_(r[idIdx]).trim(),
      company: asText_(r[coIdx]),
      at: asText_(r[atIdx]),
      status: asText_(r[stIdx]),
    };
  }).filter(function (x) { return x.id; });

  var ids = items.map(function (x) { return x.id; });
  return {
    ok: true,
    items: items,
    ids: ids,
    // いま見せた集合に対する券。実行にはこれが要る
    ticket: purgeIssueTicket_(ids),
    ticketMin: PURGE_TICKET_MIN,
    max: PURGE_MAX,
    tooMany: items.length > PURGE_MAX,
    sheets: PURGE_SHEETS_(),
    counts: purgeCounts_(),
  };
}

/** 各シートに何行あるか。見出しを除いた数 */
function purgeCounts_() {
  var out = {};
  PURGE_SHEETS_().forEach(function (name) {
    try {
      var sh = ss_().getSheetByName(name);
      out[name] = sh ? Math.max(sh.getLastRow() - 1, 0) : 0;
    } catch (e) { out[name] = 0; }
  });
  return out;
}

/**
 * 実行。ids は下見で返したものをそのまま送り返してもらう。
 * いま台帳にあるものと**1件でも違えば実行しない**。
 */
function adminPurgeRun_(auth, payload) {
  if (!purgeEnabled_()) {
    return { ok: false, error: 'disabled',
      message: '「設定」タブの「テストデータの一括削除を許可」がOFFになっています。' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };

  try {
    var L = readLedger_();
    var idIdx = L.headers.indexOf(COL.id);
    var live = liveRows_(L.headers, L.rows)
      .map(function (r) { return asText_(r[idIdx]).trim(); })
      .filter(function (x) { return x; });

    var sent = (payload && Array.isArray(payload.ids) ? payload.ids : [])
      .map(function (x) { return String(x); });

    // 下見のときと変わっていたら実行しない。
    // 見ている間に本物の応募が来ているかもしれない
    if (live.slice().sort().join(',') !== sent.slice().sort().join(',')) {
      return { ok: false, error: 'changed',
        message: '一覧を開いてから、応募の数が変わりました。'
               + 'もう一度「消える対象を確かめる」からやり直してください。' };
    }
    // ここまでは「画面が送ってきた集合」と「いまの台帳」の照合。
    // それだけだと、**画面が古い一覧を見せたまま新しい集合を送れる**。
    // 券は下見のときにサーバーが出したもの。人が見た集合そのものを指している
    var ticketNg = purgeTicketError_(payload && payload.ticket, live);
    if (ticketNg) return ticketNg;
    if (!live.length) {
      return { ok: false, error: 'empty', message: '消す対象がありません。' };
    }
    if (live.length > PURGE_MAX) {
      return { ok: false, error: 'too_many',
        message: '一度に消せるのは' + PURGE_MAX + '件までです。' };
    }
    // 件数の打ち込み。惰性で押せないようにする
    if (Number(payload && payload.count) !== live.length) {
      return { ok: false, error: 'bad_count',
        message: '件数が一致しません。' + live.length + ' と入力してください。' };
    }

    // ── 消す前に、丸ごと複製しておく。
    //    台帳はきれいにしたい（けいた指示）が、間違えたときの戻り道は要る。
    //    複製は別ファイルなので、台帳には何も残らない。
    var backupUrl = '';
    try { backupUrl = purgeBackup_(); }
    catch (e) {
      logError_('adminPurgeRun_:控え', e);
      return { ok: false, error: 'no_backup',
        message: '消す前の控えを作れませんでした。安全のため、削除は行いませんでした。'
               + 'Driveの空き容量と権限をご確認ください。' };
    }

    var cleared = {};
    PURGE_SHEETS_().forEach(function (name) {
      try { cleared[name] = clearSheetRows_(name); }
      catch (e) { logError_('adminPurgeRun_:' + name, e); cleared[name] = -1; }
    });

    var spaces = 0, folders = 0;
    try { spaces = clearSpaceAssignments_(live); }
    catch (e) { logError_('adminPurgeRun_:区画', e); }
    try { folders = trashVendorFolders_(live); }
    catch (e) { logError_('adminPurgeRun_:Drive', e); }

    // スイッチを戻す。1回ぶんの鍵にする
    try { setPurgeSwitchOff_(); } catch (e) { logError_('adminPurgeRun_:スイッチ', e); }

    SpreadsheetApp.flush();
    return { ok: true, cleared: cleared, spaces: spaces, folders: folders,
             backupUrl: backupUrl, ids: live };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 消す前の控え。スプレッドシートを丸ごと複製する。
 * **複製できなければ削除しない**（戻り道の無い削除はしない）。
 */
function purgeBackup_() {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH-mm');
  var name = '[削除前の控え] ' + ss_().getName() + ' ' + stamp;
  var copy = DriveApp.getFileById(ss_().getId()).makeCopy(name);
  return copy.getUrl();
}

/** 見出しだけ残して、中身を空にする */
function clearSheetRows_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var n = last - 1;
  sh.deleteRows(2, n);
  return n;
}

/** 区画の割当だけを外す。区画の行は会場の形なので消さない */
function clearSpaceAssignments_(ids) {
  var sh = sheet_(SHEET.SPACES);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                  .map(function (h) { return String(h).trim(); });
  var col = headers.indexOf('割当受付ID');
  if (col < 0) return 0;

  var vals = sh.getRange(2, col + 1, last - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (!String(vals[i][0]).trim()) continue;
    sh.getRange(i + 2, col + 1).setValue('');
    n++;
  }
  return n;
}

/**
 * 提出物のフォルダをゴミ箱へ。完全には消さない。
 * 受付IDだけでなく**フォルダ全部**を見る。
 * 台帳から消えた受付IDのフォルダが残ると、次に同じIDが振られたときに
 * **他社の素材が混ざって見える**。
 */
function trashVendorFolders_(ids) {
  var n = 0;
  var root;
  try { root = submissionsFolder_(); } catch (e) { return 0; }
  var it = root.getFolders();
  while (it.hasNext()) { it.next().setTrashed(true); n++; }
  return n;
}

/** 実行したらスイッチを戻す。ONのまま忘れると、安全装置が1つ消える */
function setPurgeSwitchOff_() {
  var sh = sheet_(SHEET.CONFIG);
  var row = findConfigRow_(sh, PURGE_SWITCH);
  if (row) sh.getRange(row, 2).setValue('OFF');
}
