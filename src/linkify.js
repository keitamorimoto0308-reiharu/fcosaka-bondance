/**
 * 詳細欄に書かれたURLを、安全な形でだけリンクにする。
 *
 * ① 制作スケジュール表（design_schedule_plan.md §5-1）と
 * ② タイムスケジュール（design_timetable.md §7-1）が**同じものを共有する**。
 * 2つ書くと必ずズレるので、ここ以外に書かない。
 *
 * ── なぜここだけ画面側の守りになるか ──
 * この仕組みは「守りはすべてサーバー側」で通してきた。リンク化だけは
 * 画面がHTMLを組み立てる処理なので、ここに穴が開く。
 * 詳細欄は**全員が書ける**うえ、管理ページは応募企業の個人情報を読める画面なので、
 * ここで差し込みを許すと台帳の中身を外へ持ち出せる。
 *
 * ── 埋め込み方（src/schema.js と同じ方式）──
 * `linkifyDetail.toString()` を src/build-admin.js が画面に書き出す。
 * **`.toString()` は関数の外側のスコープを失う**ので、この関数は
 * 自分の引数だけで完結していなければならない。
 * だから `esc` をモジュールから呼ばず、**引数で受け取る**。
 * （画面側には既に esc が1つある。ここで2つ目を定義すると、
 *   引き継ぎ書§5の「同名の関数が2つあると静かに混ざる」を踏む）
 *
 * ── 改行は扱わない ──
 * <br> への変換はしない。表示側の CSS（white-space: pre-wrap）に任せる。
 * タグを1種類でも増やすと、そのぶん組み立ての穴が増える。
 */

/**
 * @param {string} text  人が書いた詳細（生の文字列）
 * @param {function(string):string} esc  HTMLエスケープ関数（画面側の esc をそのまま渡す）
 * @return {string} リンクだけが <a> になった、それ以外は無害な文字列
 */
function linkifyDetail(text, esc) {
  var s = esc(text == null ? '' : String(text));

  // ここから先は**エスケープ済みの文字列**を走査する。順番が命。
  //   先にリンク化してからエスケープすると、作った <a> まで壊れる。
  //   エスケープせずにリンク化すると <img onerror=...> が通る。
  //
  // URLの構成文字は、RFC 3986 が許すものだけに**絞り込む**。
  //   unreserved   A-Z a-z 0-9 - . _ ~
  //   gen-delims   : / ? # [ ] @
  //   sub-delims   ! $ ( ) * + , ; =     （& と ' は下記のとおり除く）
  //   percent      %
  //
  // 「空白以外は全部URL」にしてはいけない。**日本語は空白で区切らない**ので、
  //   「詳細は https://example.com/a、次に…」の「、次に…」まで飲み込む。
  //   英語で試すと通ってしまう形なので、ここは実際に落として直した。
  //
  // & と ' を外す理由は別にある。この時点で文字列は**エスケープ済み**なので、
  //   生の < > " ' & は1文字も残っておらず、すべて &lt; &quot; &#39; &amp; という
  //   「& で始まる並び」になっている。& を1文字として許すと、URLの直後の
  //   &lt;script&gt; を飲み込んでしまう。だから **&amp; だけを塊として許す**。
  var re = /https?:\/\/(?:&amp;|[A-Za-z0-9\-._~:/?#[\]@!$()*+,;=%])+/gi;

  return s.replace(re, function (url) {
    // 末尾の句読点・閉じ括弧は、URLではなく文のほうの記号であることが多い。
    // 「詳細は https://example.com/a を見てください。」の「。」まで飲み込むと、
    // リンクが切れる（しかも見た目では気づけない）。
    var tail = '';
    while (url.length > 0 && '.,;:!?)]}。、）」』'.indexOf(url.charAt(url.length - 1)) !== -1) {
      tail = url.charAt(url.length - 1) + tail;
      url = url.slice(0, -1);
    }
    // 削った結果、スキームだけ（https:// で終わり）になったらリンクにしない。
    if (/^https?:\/\/$/i.test(url)) return url + tail;

    // href に入れるのはエスケープ済みの文字列そのもの。
    // ここで再エスケープすると &amp; が &amp;amp; になって、リンク先が変わる。
    //
    // target="_blank" には rel="noopener noreferrer" を必ず付ける。
    // 付けないと、開いた先が window.opener からこの管理ページを操作できる。
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>' + tail;
  });
}

module.exports = { linkifyDetail: linkifyDetail };
