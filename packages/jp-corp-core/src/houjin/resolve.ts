import { toHalfWidth } from '@jp-opendata/normalize-jp';
import type { HoujinResult, HoujinNameOptions } from './client.js';
import type { HoujinCorporation } from './schema.js';

/**
 * 会社名→法人番号の名称解決（Actor#2/#4共通の確度モデル。docs/tasks-phase2.md）。
 * 法人番号Web-API `/4/name` の1回検索で解決し、確度を4値で返す:
 * - exact:     正規化名の完全一致が1社
 * - selected:  完全一致なしだが候補が1社のみ（その1社を採用）
 * - ambiguous: 完全一致が複数 or 候補多数で一意に決められない（採用しない）
 * - not_found: 候補0
 * あいまい検索の文字補正（ひらがな→カタカナ・英小文字→大文字・中点/スペース削除）は
 * API側仕様（docs/research/houjin-webapi-v4.md）に合わせ、比較側も同じ正規化を行う。
 */

export type NameResolutionConfidence = 'exact' | 'selected' | 'ambiguous' | 'not_found';

export interface NameResolution {
  inputName: string;
  confidence: NameResolutionConfidence;
  corporateNumber: string | null;
  resolvedName: string | null;
  /** APIが報告した候補総数（分割時は分割前の総数） */
  candidateCount: number;
}

export interface HoujinNameSearcher {
  searchByName(name: string, options?: HoujinNameOptions): Promise<HoujinResult>;
}

/** ひらがな→カタカナ（法人番号APIのあいまい検索補正と同等の比較用正規化） */
function hiraganaToKatakana(input: string): string {
  return input.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

const HALF_KATAKANA_BASE = '｡「」､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const FULL_KATAKANA_BASE =
  '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';

/** 半角カタカナ→全角（濁点・半濁点の合成を含む。登記名は全角のため比較前に揃える） */
function halfKatakanaToFull(input: string): string {
  let out = '';
  for (const ch of input) {
    const index = HALF_KATAKANA_BASE.indexOf(ch);
    if (index >= 0) {
      out += FULL_KATAKANA_BASE[index];
      continue;
    }
    if (ch === 'ﾞ' || ch === 'ﾟ') {
      const combined = (out.slice(-1) + (ch === 'ﾞ' ? '゙' : '゚')).normalize('NFC');
      out = out.slice(0, -1) + combined;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 名称比較用の正規化（全半角・大文字化・中点/スペース除去・かな→全角カタカナ） */
export function normalizeCompanyNameForMatch(input: string): string {
  return hiraganaToKatakana(halfKatakanaToFull(toHalfWidth(input.trim())).toUpperCase()).replace(
    /[\s・.]/g,
    '',
  );
}

/** 閉鎖済み・非表示レコードを候補から除く（closeDateなし・hihyoji≠1のみ残す） */
function isActiveCandidate(c: HoujinCorporation): boolean {
  return c.closeDate.trim() === '' && c.hihyoji.trim() !== '1';
}

export async function resolveCompanyName(
  searcher: HoujinNameSearcher,
  inputName: string,
): Promise<NameResolution> {
  const base: Omit<NameResolution, 'confidence'> = {
    inputName,
    corporateNumber: null,
    resolvedName: null,
    candidateCount: 0,
  };
  const trimmed = inputName.trim();
  if (trimmed === '') {
    return { ...base, confidence: 'not_found' };
  }
  // 前方一致×あいまい（API既定挙動）。1ページ目のみで判定し、divideは追わない
  const result = await searcher.searchByName(trimmed, { mode: 1, target: 1 });
  const candidates = result.corporations.filter(isActiveCandidate);
  const candidateCount = Math.max(result.header.count, candidates.length);
  if (candidates.length === 0) {
    return { ...base, confidence: 'not_found', candidateCount: 0 };
  }

  const wanted = normalizeCompanyNameForMatch(trimmed);
  const exactMatches = candidates.filter((c) => normalizeCompanyNameForMatch(c.name) === wanted);
  if (exactMatches.length === 1) {
    const hit = exactMatches[0];
    if (hit !== undefined) {
      return {
        inputName,
        confidence: 'exact',
        corporateNumber: hit.corporateNumber,
        resolvedName: hit.name,
        candidateCount,
      };
    }
  }
  if (exactMatches.length === 0 && candidates.length === 1) {
    const only = candidates[0];
    if (only !== undefined) {
      return {
        inputName,
        confidence: 'selected',
        corporateNumber: only.corporateNumber,
        resolvedName: only.name,
        candidateCount,
      };
    }
  }
  // 完全一致が複数（同名法人）／候補多数で一意に絞れない
  return { ...base, confidence: 'ambiguous', candidateCount };
}
