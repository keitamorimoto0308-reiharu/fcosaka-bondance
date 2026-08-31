/**
 * デザインの3方向（仕様書 §14-5・CP2でけいたが1案を選ぶ）。
 *
 * 共通のブランド制約（§8）は全案で固定し、変えるのは3点だけ：
 *   - 和のアクセントの強さ
 *   - 情報密度
 *   - 面（写真・地紋）の使い方
 *
 * 守る制約：
 *   - FC大阪のブランドカラー #7FCAF1 を主役に。ロゴは支給データをそのまま使う
 *   - #7FCAF1 は白背景に対して 1.81:1 しかない。文字色には絶対に使わない。
 *     文字は #231816（#7FCAF1 に対して 9.58:1）を使う
 *   - 和のアクセントは低彩度の暖色1色に限定し、罫・区切り・アイコン程度の面積に留める
 *   - スマートフォン最優先。375px幅で崩れない
 */

const BASE = {
  brand:      '#7FCAF1',
  brandStar:  '#82C7E8',
  brandDeep:  '#3E9FD1', // 罫や図形用にブランド水色を暗くした派生（文字には使わない）
  ink:        '#231816',
  inkMuted:   '#6B6360',
  black:      '#000000',
  white:      '#FFFFFF',
  // 和のアクセント（低彩度の暖色1色）
  accent:     '#B5714C',
  accentPale: '#F5EDE6',
  bg:         '#FFFFFF',
  bgSubtle:   '#F7F9FB',
  error:      '#C0392B',
  radius:     '10px',
  fontBody:   "'Noto Sans JP', system-ui, -apple-system, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif",
  fontDisp:   "'Oswald', 'Noto Sans JP', sans-serif",
};

const THEMES = {
  /** A案：クラブ公式基調。和は最小限、余白広め。信頼感を最優先した最も硬い案。 */
  a: {
    id: 'a', logo: 'a',
    name: 'A案：クラブ公式基調',
    summary: '和の要素を最小限に抑え、FC大阪のクラブサイトの延長として見える硬めの構成。'
           + '余白を広く取り、1画面あたりの情報量を絞って読み進めやすくしています。',
    traits: { wa: '弱', density: '低', surface: '無地' },
    vars: Object.assign({}, BASE, {
      heroStyle:    'flat',
      sectionGap:   '40px',
      cardPad:      '20px',
      summaryCols:  '2',
      ruleWeight:   '1px',
      ruleColor:    BASE.brand,
      patternAlpha: '0',
      headerBg:     BASE.white,
      bodyBg:       BASE.white,
      cardBg:       BASE.bgSubtle,
    }),
  },

  /** B案：和のアクセント。麻の葉の地紋を淡く敷き、情報密度を上げた実務的な案。 */
  b: {
    id: 'b', logo: 'b',
    name: 'B案：和のアクセント',
    summary: '見出しの罫と背景に和の地紋（麻の葉）を淡く入れ、盆踊りらしさを控えめに足した案。'
           + '情報密度を上げ、スクロール量を減らしています。',
    traits: { wa: '中', density: '高', surface: '地紋（淡）' },
    vars: Object.assign({}, BASE, {
      heroStyle:    'pattern',
      sectionGap:   '28px',
      cardPad:      '16px',
      summaryCols:  '2',
      ruleWeight:   '3px',
      ruleColor:    BASE.accent,
      patternAlpha: '0.05',
      headerBg:     BASE.white,
      bodyBg:       BASE.white,
      cardBg:       BASE.accentPale,
    }),
  },

  /** C案：ヒーロー面。上部に大きな面を置き、祭りの高揚感を出した案。 */
  c: {
    id: 'c', logo: 'c',
    name: 'C案：ヒーロー面',
    summary: '冒頭に大きな面（写真差し替え可）を置き、イベントの高揚感を前に出した案。'
           + '和のアクセントを最も強くしています。写真が支給されればそのまま差し替えられます。',
    traits: { wa: '強', density: '中', surface: '大面（写真差替可）' },
    vars: Object.assign({}, BASE, {
      heroStyle:    'hero',
      sectionGap:   '32px',
      cardPad:      '18px',
      summaryCols:  '2',
      ruleWeight:   '4px',
      ruleColor:    BASE.accent,
      patternAlpha: '0.08',
      headerBg:     BASE.ink,
      bodyBg:       BASE.white,
      cardBg:       BASE.bgSubtle,
    }),
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { BASE, THEMES };
