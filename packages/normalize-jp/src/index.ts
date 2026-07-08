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

// TODO(#4): 住所EN変換（都道府県・市区町村のローマ字表）は Actor#4 着手時に実装する。
