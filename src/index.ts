/**
 * 日本語データ正規化（引継書§3.1 normalize-jp）:
 * 和暦→ISO、全角半角、波ダッシュ、カンマ数値、法人格サフィックス表。
 * 逐語照合（N-9）の前処理としても使うため、変換は決定的・副作用なしに保つ。
 */

const ERA_BASE_YEARS: Record<string, number> = {
  明治: 1867,
  大正: 1911,
  昭和: 1925,
  平成: 1988,
  令和: 2018,
};

/** 全角英数字・記号・スペースを半角へ */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/** 全角チルダ(U+FF5E)を波ダッシュ(U+301C)へ統一 */
export function normalizeWaveDash(input: string): string {
  return input.replace(/～/g, '〜');
}

/**
 * 和暦日付をISO 8601 (YYYY-MM-DD) へ。「令和6年3月31日」「平成元年5月1日」等。
 * 変換不能な場合は null（推測禁止、N-9②）。
 */
export function warekiToIso(input: string): string | null {
  const normalized = toHalfWidth(input.trim());
  const m = normalized.match(/^(明治|大正|昭和|平成|令和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日$/);
  if (!m) return null;
  const [, era, yearRaw, monthRaw, dayRaw] = m;
  if (
    era === undefined ||
    yearRaw === undefined ||
    monthRaw === undefined ||
    dayRaw === undefined
  ) {
    return null;
  }
  const base = ERA_BASE_YEARS[era];
  if (base === undefined) return null;
  const eraYear = yearRaw === '元' ? 1 : Number(yearRaw);
  const year = base + eraYear;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 日本語文書中の数値文字列を number へ。「1,234」「１２３」「1，234」対応。
 * 変換不能な場合は null。
 */
export function parseJpNumber(input: string): number | null {
  const normalized = toHalfWidth(input.trim()).replace(/[,，]/g, '');
  if (normalized === '' || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/**
 * 逐語照合（N-9①）用の原文正規化: 全半角・波ダッシュ・カンマを揃え、空白を除去する。
 * LLM出力の候補値と原文の部分一致検証は、双方をこの関数に通してから行う。
 */
export function normalizeForVerbatimMatch(input: string): string {
  // 波ダッシュ統一を先に行う（toHalfWidthが全角チルダU+FF5EをASCII~へ変換してしまうため）
  return toHalfWidth(normalizeWaveDash(input)).replace(/[,，]/g, '').replace(/\s+/g, '');
}

/** 法人格サフィックス表（名称英語化のルール変換で使用。網羅はTODO: #4着手時に拡充） */
export const CORPORATE_SUFFIXES: ReadonlyArray<{ ja: string; en: string }> = [
  { ja: '株式会社', en: 'Co., Ltd.' },
  { ja: '有限会社', en: 'Ltd.' },
  { ja: '合同会社', en: 'LLC' },
  { ja: '合名会社', en: 'General Partnership' },
  { ja: '合資会社', en: 'Limited Partnership' },
  { ja: '一般社団法人', en: 'General Incorporated Association' },
  { ja: '一般財団法人', en: 'General Incorporated Foundation' },
  { ja: '公益社団法人', en: 'Public Interest Incorporated Association' },
  { ja: '公益財団法人', en: 'Public Interest Incorporated Foundation' },
  { ja: '独立行政法人', en: 'Incorporated Administrative Agency' },
  { ja: '国立大学法人', en: 'National University Corporation' },
];

/**
 * 府省・機関名の英語辞書（Actor#2 FR-2「府省(英)」の辞書＋ルール変換で使用）。
 * 対象はgBizINFO担当府省コード一覧（setcodelist.pdf Ver.1.01）の49機関＋実データに出る下位機関。
 * 訳語は各機関の公式英語名。辞書に無い機関はnull（推測禁止・N-9②準用）。
 */
export const MINISTRY_EN: Readonly<Record<string, string>> = {
  国税庁: 'National Tax Agency',
  会計検査院: 'Board of Audit of Japan',
  内閣官房: 'Cabinet Secretariat',
  人事院: 'National Personnel Authority',
  内閣府: 'Cabinet Office',
  宮内庁: 'Imperial Household Agency',
  国家公安委員会: 'National Public Safety Commission',
  防衛省: 'Ministry of Defense',
  金融庁: 'Financial Services Agency',
  総務省: 'Ministry of Internal Affairs and Communications',
  法務省: 'Ministry of Justice',
  外務省: 'Ministry of Foreign Affairs',
  財務省: 'Ministry of Finance',
  文部科学省: 'Ministry of Education, Culture, Sports, Science and Technology',
  厚生労働省: 'Ministry of Health, Labour and Welfare',
  農林水産省: 'Ministry of Agriculture, Forestry and Fisheries',
  経済産業省: 'Ministry of Economy, Trade and Industry',
  国土交通省: 'Ministry of Land, Infrastructure, Transport and Tourism',
  環境省: 'Ministry of the Environment',
  消費者庁: 'Consumer Affairs Agency',
  復興庁: 'Reconstruction Agency',
  公正取引委員会: 'Japan Fair Trade Commission',
  個人情報保護委員会: 'Personal Information Protection Commission',
  特許庁: 'Japan Patent Office',
  消防庁: 'Fire and Disaster Management Agency',
  資源エネルギー庁: 'Agency for Natural Resources and Energy',
  中小企業庁: 'Small and Medium Enterprise Agency',
  情報処理推進機構: 'Information-technology Promotion Agency, Japan (IPA)',
  製品評価技術基盤機構: 'National Institute of Technology and Evaluation (NITE)',
  '国立研究開発法人新エネルギー・産業技術総合開発機構':
    'New Energy and Industrial Technology Development Organization (NEDO)',
  '工業所有権情報・研修館':
    'National Center for Industrial Property Information and Training (INPIT)',
  中小企業基盤整備機構:
    'Organization for Small & Medium Enterprises and Regional Innovation, Japan (SMRJ)',
  '石油天然ガス・金属鉱物資源機構': 'Japan Organization for Metals and Energy Security (JOGMEC)',
  日本貿易振興機構: 'Japan External Trade Organization (JETRO)',
  観光庁: 'Japan Tourism Agency',
  気象庁: 'Japan Meteorological Agency',
  原子力規制委員会: 'Nuclear Regulation Authority',
  内閣法制局: 'Cabinet Legislation Bureau',
  水産庁: 'Fisheries Agency',
  海上保安庁: 'Japan Coast Guard',
  スポーツ庁: 'Japan Sports Agency',
  警察庁: 'National Police Agency',
  デジタル庁: 'Digital Agency',
  林野庁: 'Forestry Agency',
  文化庁: 'Agency for Cultural Affairs',
  公害等調整委員会: 'Environmental Dispute Coordination Commission',
  こども家庭庁: 'Children and Families Agency',
};

/**
 * 府省・機関名（日本語）→ 英語公式名。ルール: 法人格プレフィックス
 * （独立行政法人・国立研究開発法人・公益財団法人等）を除いた本体名でも辞書を引く。
 * 辞書に無い場合はnull（推測禁止）。
 */
export function ministryToEnglish(ja: string): string | null {
  const trimmed = toHalfWidth(ja.trim()).replace(/\s+/g, '');
  const direct = MINISTRY_EN[trimmed];
  if (direct !== undefined) return direct;
  const stripped = trimmed.replace(
    /^(独立行政法人|国立研究開発法人|公益財団法人|公益社団法人)/,
    '',
  );
  return MINISTRY_EN[stripped] ?? null;
}

// TODO(#4): 住所EN変換（都道府県・市区町村のローマ字表）は Actor#4 着手時に実装する。
