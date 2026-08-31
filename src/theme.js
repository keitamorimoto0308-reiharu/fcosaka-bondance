/**
 * デザイントークン（単一の正）。
 *
 * 設計の骨子（ui-ux-pro-max の推奨「Event/Conference Landing × Hero-Centric」に、
 * FC大阪のブランド制約を上書きしたもの）：
 *
 *  - ブランド水色 #7FCAF1 は「面」で使う。文字色には使わない。
 *    白背景に対して 1.81:1 しかなく、文字にすると読めないため。
 *    水色の面の上に濃色文字（9.58:1）、濃色の面の上に水色文字（8.0:1）ならどちらも通る。
 *  - 和のアクセントは低彩度の暖色1色のみ。罫・小さな図形程度の面積に留める。
 *  - 見出しの数字と欧文は Bebas Neue（縦長・詰まった大文字。数字が主役になる）。
 *    日本語は Noto Sans JP。Bebas Neue に日本語が無いための2書体構成。
 */

const TOKENS = {
  // ── ブランド
  brand:      '#7FCAF1',  // FC大阪ブランド水色。面で使う
  brandDeep:  '#2F8FC4',  // 罫・アイコン・ボタンの影。文字には使わない
  brandPale:  '#EAF6FD',  // 淡い面
  ink:        '#231816',  // 本文・見出し。ブランド水色に対して 9.58:1
  inkMuted:   '#6B6360',
  inkFaint:   '#9A928F',
  white:      '#FFFFFF',
  // ── 和のアクセント（低彩度の暖色1色）
  accent:     '#B5714C',
  accentPale: '#F5EDE6',
  // ── 面
  bg:         '#FFFFFF',
  bgSubtle:   '#F7F9FB',
  border:     '#E4E0DE',
  error:      '#C0392B',

  // ── 余白（4/8pt刻み）
  s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '24px',
  s6: '32px', s7: '48px', s8: '64px', s9: '96px',

  radius:   '12px',
  radiusLg: '20px',

  fontJa:   "'Noto Sans JP', system-ui, -apple-system, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif",
  fontDisp: "'Bebas Neue', 'Noto Sans JP', sans-serif",
};

/** アイコン（SVG）。絵文字は使わない。線幅は 1.8 で統一する。 */
const ICONS = {
  calendar: '<path d="M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>',
  pin:      '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  tag:      '<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  grid:     '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  truck:    '<path d="M3 16V6a1 1 0 0 1 1-1h10v11M14 9h4l3 3v4h-3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  check:    '<path d="M20 6 9 17l-5-5"/>',
  gift:     '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18M12 8v13M12 8S9.5 3 7 4.5 9 8 12 8zM12 8s2.5-5 5-3.5S15 8 12 8z"/>',
  info:     '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

function icon(name, size) {
  return `<svg class="ic" width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { TOKENS, ICONS, icon };
