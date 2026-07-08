/**
 * 社名→法人番号の解決サービス（FR-2＋FR-3）。
 *
 * 手順（1社名ごと）:
 *   ① normalizeCompanyName で表記正規化（FR-2・ルールベース・LLM不使用）
 *   ② 正規化済み名称を法人番号Web-API名称検索（完全一致）へ渡し候補を得る（`search`）
 *   ③ 候補件数から confidence を決める（1件=exact / 複数=ambiguous / 0件=not_found）
 *
 * confidence は API 側では 3 値（exact/ambiguous/not_found）のみ。'selected' は
 * ユーザーが候補から選んだ後に GAS 側で付く値であり API は返さない（要件書 FR-3）。
 *
 * 行単位部分失敗（FR-8）: 1社名の API 失敗は当該行に `error` を付けて返し、他行は継続する。
 * `search` の実体は呼び出し側で直列キュー（N-1）にくるんで注入する（本サービスはキューを知らない）。
 *
 * CR-3/CR-5: 本サービスは応答を保存・キャッシュ・ログしない。logAccess も呼ばない
 * （インボイス照会専用のため。routes 層の設計判断・decisions.md 参照）。
 */

import type { HoujinCorporation } from '@jp-opendata/gov-clients/houjin';
import { normalizeCompanyName } from './normalizeCompanyName.js';
import { mapApiError, type ApiFieldError } from './apiError.js';

export type ResolveConfidence = 'exact' | 'ambiguous' | 'not_found';

export interface ResolveCandidate {
  readonly corporateNumber: string;
  readonly name: string;
  /** 都道府県＋市区町村＋番地を連結した所在地。 */
  readonly address: string;
}

/**
 * 1社名ぶんの解決結果。
 * - 成功時: `confidence` と `candidates`（exact=1件 / ambiguous=複数 / not_found=空）。
 * - 失敗時: `error` のみ（confidence/candidates は付けない）。
 */
export interface ResolveRow {
  readonly input: string;
  readonly normalized: string;
  readonly confidence?: ResolveConfidence;
  readonly candidates?: ResolveCandidate[];
  readonly error?: ApiFieldError;
}

/** 正規化済み名称で名称検索し、ヒットした法人配列を返す関数（キュー・クライアントは注入側の責務）。 */
export type SearchByName = (normalizedName: string) => Promise<HoujinCorporation[]>;

/** 都道府県＋市区町村＋番地を連結する（各要素は文字列保全済み・欠落時は空文字）。 */
function formatAddress(c: HoujinCorporation): string {
  return `${c.prefectureName}${c.cityName}${c.streetNumber}`;
}

/**
 * 法人配列を候補リストへ整形する。
 * 同一法人番号の重複（履歴レコード等）は 1 件に畳み込む（件数を誤って ambiguous にしないため・C4）。
 * 法人番号が空のレコードは候補にしない。
 */
function toCandidates(corporations: readonly HoujinCorporation[]): ResolveCandidate[] {
  const seen = new Set<string>();
  const out: ResolveCandidate[] = [];
  for (const c of corporations) {
    if (c.corporateNumber === '' || seen.has(c.corporateNumber)) continue;
    seen.add(c.corporateNumber);
    out.push({ corporateNumber: c.corporateNumber, name: c.name, address: formatAddress(c) });
  }
  return out;
}

function confidenceOf(candidateCount: number): ResolveConfidence {
  if (candidateCount === 0) return 'not_found';
  if (candidateCount === 1) return 'exact';
  return 'ambiguous';
}

async function resolveOne(input: string, search: SearchByName): Promise<ResolveRow> {
  const normalized = normalizeCompanyName(input);
  // 正規化後に空（空欄・空白のみの入力）なら照会せず not_found（search は空名で throw するため先に弾く）。
  if (normalized === '') {
    return { input, normalized, confidence: 'not_found', candidates: [] };
  }
  try {
    const corporations = await search(normalized);
    const candidates = toCandidates(corporations);
    return { input, normalized, confidence: confidenceOf(candidates.length), candidates };
  } catch (error) {
    return { input, normalized, error: mapApiError(error, '法人番号API') };
  }
}

/**
 * 複数社名を解決する。入力順を保つ（Promise.all のインデックス順）。
 * 各 search は注入された直列キュー経由で実行されるため、並行起動しても実際の送信は直列（N-1）。
 */
export async function resolveNames(names: readonly string[], search: SearchByName): Promise<ResolveRow[]> {
  return Promise.all(names.map((input) => resolveOne(input, search)));
}
