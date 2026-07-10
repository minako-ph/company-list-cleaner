/**
 * 社名→法人番号の解決サービス（FR-2＋FR-3）。
 *
 * 手順（1社名ごと）:
 *   ① normalizeCompanyName で表記正規化（FR-2・ルールベース・LLM不使用）
 *   ② 正規化済み名称を jp-corp-core の `resolveCompanyName` へ委譲して解決する。
 *      法人格除去クエリ・全角化・あいまい比較・確度判定（exact/selected/ambiguous/not_found）は
 *      すべて `resolveCompanyName` が担う（実データ検証済み。柱2 Step A 追従・decisions.md 参照）。
 *   ③ UI 提示用の候補リスト（FR-3）は `resolveCompanyName` が返さないため、注入した
 *      searcher をラップして最後の HoujinResult をクロージャで捕捉し、確度に応じて整形する。
 *
 * confidence 語彙は 4 値（exact/selected/ambiguous/not_found・FR-3 と一致）:
 *   - exact:     正規化名の完全一致が1社
 *   - selected:  完全一致なしだが候補が1社のみ（その1社を自動採用）
 *   - ambiguous: 一意に決められない（候補リストを提示しユーザー選択待ち）
 *   - not_found: 候補0
 * 'selected' は jp-corp-core の確度モデルに由来し、GAS がユーザー選択後に付ける 'selected' と
 * 同語彙（いずれも「一意確定済み」を意味する）。
 *
 * 行単位部分失敗（FR-8）: 1社名の API 失敗は当該行に `error` を付けて返し、他行は継続する。
 * searcher の実体は呼び出し側で直列キュー（N-1）にくるんで注入する（本サービスはキューを知らない）。
 *
 * CR-3/CR-5: 本サービスは応答を保存・キャッシュ・ログしない。logAccess も呼ばない
 * （インボイス照会専用のため。routes 層の設計判断・decisions.md 参照）。
 */

import type { HoujinCorporation, HoujinResult } from '@jp-opendata/gov-clients/houjin';
import {
  resolveCompanyName,
  type HoujinNameSearcher,
  type NameResolution,
} from '@jp-opendata/gov-clients/houjin';
import { normalizeCompanyName } from './normalizeCompanyName.js';
import { mapApiError, type ApiFieldError } from './apiError.js';

export type ResolveConfidence = 'exact' | 'selected' | 'ambiguous' | 'not_found';

export interface ResolveCandidate {
  readonly corporateNumber: string;
  readonly name: string;
  /** 都道府県＋市区町村＋番地を連結した所在地。 */
  readonly address: string;
}

/**
 * 1社名ぶんの解決結果。
 * - 成功時: `confidence` と `candidates`（exact/selected=1件 / ambiguous=複数 / not_found=空）。
 * - 失敗時: `error` のみ（confidence/candidates は付けない）。
 */
export interface ResolveRow {
  readonly input: string;
  readonly normalized: string;
  readonly confidence?: ResolveConfidence;
  readonly candidates?: ResolveCandidate[];
  readonly error?: ApiFieldError;
}

/** 名称検索して HoujinResult を返す searcher（キュー・クライアントは注入側の責務）。 */
export type NameSearcher = HoujinNameSearcher;

/** 都道府県＋市区町村＋番地を連結する（各要素は文字列保全済み・欠落時は空文字）。 */
function formatAddress(c: HoujinCorporation): string {
  return `${c.prefectureName}${c.cityName}${c.streetNumber}`;
}

/**
 * 閉鎖済み・非表示レコードを候補から除く（closeDateなし・hihyoji≠'1' のみ残す）。
 * jp-corp-core resolve.ts の private isActiveCandidate と同条件（あちらは非公開のため
 * ambiguous 候補リストの整形時に backend 側で同条件を適用する。出所: houjin/resolve.ts）。
 */
function isActiveCandidate(c: HoujinCorporation): boolean {
  return c.closeDate.trim() === '' && c.hihyoji.trim() !== '1';
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

/**
 * 解決結果と捕捉した HoujinResult から UI 提示用の候補リストを組み立てる。
 * - exact / selected → 解決された1社（所在地は捕捉結果から法人番号一致で引く）
 * - ambiguous       → 活性候補（isActiveCandidate）を toCandidates で整形
 * - not_found       → 空
 */
function buildCandidates(
  resolution: NameResolution,
  captured: HoujinResult | undefined,
): ResolveCandidate[] {
  const corporations = captured?.corporations ?? [];
  if (resolution.confidence === 'ambiguous') {
    return toCandidates(corporations.filter(isActiveCandidate));
  }
  if (resolution.confidence === 'exact' || resolution.confidence === 'selected') {
    const number = resolution.corporateNumber;
    if (number === null) return [];
    const hit = corporations.find((c) => c.corporateNumber === number);
    return [
      {
        corporateNumber: number,
        name: resolution.resolvedName ?? '',
        address: hit !== undefined ? formatAddress(hit) : '',
      },
    ];
  }
  // not_found。
  return [];
}

async function resolveOne(input: string, searcher: NameSearcher): Promise<ResolveRow> {
  const normalized = normalizeCompanyName(input);
  // 正規化後に空（空欄・空白のみの入力）なら照会せず not_found
  // （resolveCompanyName も空入力は検索せず not_found を返すが、無駄な呼び出しを避けるため先に弾く）。
  if (normalized === '') {
    return { input, normalized, confidence: 'not_found', candidates: [] };
  }
  // searchByName の最後の HoujinResult を捕捉するラッパ。resolveOne 呼び出しごとに独立して
  // 生成するため、クロージャがリクエスト間・行間で共有されない（並行リクエスト安全）。
  let captured: HoujinResult | undefined;
  const capturing: HoujinNameSearcher = {
    searchByName: async (name, options) => {
      const result = await searcher.searchByName(name, options);
      captured = result;
      return result;
    },
  };
  try {
    const resolution = await resolveCompanyName(capturing, normalized);
    return {
      input,
      normalized,
      confidence: resolution.confidence,
      candidates: buildCandidates(resolution, captured),
    };
  } catch (error) {
    return { input, normalized, error: mapApiError(error, '法人番号API') };
  }
}

/**
 * 複数社名を解決する。入力順を保つ（Promise.all のインデックス順）。
 * 各 searchByName は注入された直列キュー経由で実行されるため、並行起動しても実際の送信は直列（N-1）。
 */
export async function resolveNames(
  names: readonly string[],
  searcher: NameSearcher,
): Promise<ResolveRow[]> {
  return Promise.all(names.map((input) => resolveOne(input, searcher)));
}
