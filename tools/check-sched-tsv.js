/*
 * 制作スケジュールの TSV を、台帳に貼る前に確かめる道具。
 *
 *   node tools/check-sched-tsv.js <ファイル>
 *
 * 判定の規則は gas/Sched.gs の validate と同じにしてある。
 * ここで「問題なし」と出た行は、管理画面からも編集できる。
 *
 * 担当者だけは関係者シートの中身なので、コードからは分からない。
 * 本番に居る人を PEOPLE に書いてある。増えたらここも直す。
 */
'use strict';

var fs = require('fs');

var KINDS    = ['タスク', '期間', 'マイルストーン'];
var AREAS    = ['全体', '会議', '企画', '営業', '制作', '運営'];
var STATUSES = ['未着手', '進行中', '確認中', '完了', '停滞中', '見送り'];
/*
 * 関係者シートの「氏名」そのまま。
 * 応募フォームに出る人（フォーム表示=有効）だけではない点に注意。
 * gas/Sched.gs の schedPeople_ は絞り込まずに全行を読むので、
 * 制作スケジュールの担当者には、この12名すべてが使える。
 *
 * 2026-09-11 に管理ページの「FC大阪の担当者」タブで見た氏名に合わせた
 * （佐藤・奥村が加わり、西村・森本・菊池・豊島はシート上で苗字だけになっていた）。
 */
var PEOPLE = [
  '小谷', '西村', '成田', '田中', '木口', '阿部', '佐藤', '奥村',   // FC大阪
  '森本',                                                        // KREHA Creative
  '田中 浩弥',                                                   // LOP
  '菊池', '豊島',                                                // UPDATER
];

var HEADERS = ['種類', '日付', '終了日', '領域', '担当会社', '担当者',
               'タスク名', '詳細', 'ステータス', '備考'];

var MAX = { 'タスク名': 200, '詳細': 1000, '備考': 500 };

// 全角の数字と記号を半角にする（gas/Sched.gs の schedHalfWidth_ と同じ考え）
function halfWidth(s) {
  return String(s).replace(/[０-９／．－]/g, function (c) {
    return '0123456789/.-'['０１２３４５６７８９／．－'.indexOf(c)];
  });
}

function parseDate(s) {
  var t = halfWidth(s).trim();
  if (!t) return { value: '' };
  var m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (!m) return { error: '「2026-09-08」の形にしてください' };
  var y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (mo < 1 || mo > 12 || da < 1 || da > days[mo - 1]) {
    return { error: 'その日はありません' };
  }
  return { value: y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + da).slice(-2) };
}

function checkRow(cells) {
  var bad = [];
  function no(col, why) { bad.push(col + '：' + why); }

  if (cells.length !== HEADERS.length) {
    no('列数', cells.length + ' 列あります。ちょうど ' + HEADERS.length
             + ' 列にしてください（空の列もタブで詰める）');
  }
  var g = function (name) {
    var i = HEADERS.indexOf(name);
    return String(cells[i] === undefined ? '' : cells[i]).trim();
  };

  var kind = g('種類');
  if (!kind) no('種類', '空です');
  else if (KINDS.indexOf(kind) < 0) {
    no('種類', '「' + kind + '」は使えません（' + KINDS.join('／') + '）');
  }

  var area = g('領域');
  if (!area) no('領域', '空です。必ず選んでください');
  else if (AREAS.indexOf(area) < 0) {
    no('領域', '「' + area + '」は使えません（' + AREAS.join('／') + '）');
  }

  var title = g('タスク名');
  if (!title) no('タスク名', '空です');
  else if (title.length > MAX['タスク名']) {
    no('タスク名', MAX['タスク名'] + '文字までです（' + title.length + '文字）');
  }
  ['詳細', '備考'].forEach(function (k) {
    if (g(k).length > MAX[k]) {
      no(k, MAX[k] + '文字までです（' + g(k).length + '文字）');
    }
  });

  var d = parseDate(g('日付'));
  if (d.error) no('日付', d.error);
  var e = parseDate(g('終了日'));
  if (e.error) no('終了日', e.error);

  if (kind === 'マイルストーン' && !d.value) {
    no('日付', 'マイルストーンには日付が要ります');
  }
  if (kind === '期間') {
    if (!d.value) no('日付', '期間には開始日が要ります');
    if (!e.value) no('終了日', '期間には終了日が要ります');
    if (d.value && e.value && e.value < d.value) {
      no('終了日', '開始日（' + d.value + '）より前になっています');
    }
  } else if (e.value) {
    no('終了日', '期間のときだけ入れてください（この行は「' + kind + '」）');
  }

  var status = g('ステータス');
  if (kind === 'タスク') {
    if (status && STATUSES.indexOf(status) < 0) {
      no('ステータス', '「' + status + '」は使えません（' + STATUSES.join('／') + '）');
    }
  } else if (status) {
    no('ステータス', 'タスクのときだけ入れてください（この行は「' + kind + '」）');
  }

  g('担当者').split(/[,、，]/).forEach(function (p) {
    var name = p.trim();
    if (!name) return;
    if (PEOPLE.indexOf(name) < 0) {
      no('担当者', '「' + name + '」は関係者シートに居ません。'
                 + '担当者を空にして、備考に「担当：' + name + '」と書いてください');
    }
  });

  return bad;
}

function main() {
  var file = process.argv[2];
  if (!file) {
    console.log('使い方： node tools/check-sched-tsv.js <ファイル>');
    process.exit(2);
  }
  var text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });

  // 見出し行が付いていたら読み飛ばす
  var offset = 0;
  if (lines.length && lines[0].split('\t')[0].trim() === '種類') {
    offset = 1;
    console.log('※1行目は見出しとして読み飛ばしました。');
    console.log('  シートに貼るときは、この行を消してから A2 に貼ってください。\n');
  }

  var rows = lines.slice(offset);
  var ng = 0;
  rows.forEach(function (line, i) {
    var bad = checkRow(line.split('\t'));
    if (!bad.length) return;
    ng++;
    var cells = line.split('\t');
    var name = (cells[HEADERS.indexOf('タスク名')] || '（タスク名なし）').trim();
    console.log((i + 1) + '行目：' + name);
    bad.forEach(function (b) { console.log('    - ' + b); });
    console.log('');
  });

  console.log('────────────────────────────────');
  console.log('  ' + rows.length + ' 行を見ました。');
  if (ng === 0) console.log('  直すところはありません。そのまま貼れます。');
  else console.log('  ' + ng + ' 行に直すところがあります。');
  process.exit(ng ? 1 : 0);
}

main();
