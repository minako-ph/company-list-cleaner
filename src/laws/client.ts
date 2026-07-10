import { parseWithBuffer, type DriftReport } from '@jp-opendata/schema-buffer';
import { GovHttpClient, HttpStatusError, type FetchLike } from '../http.js';
import {
  lawDataResponseSchema,
  lawsSearchResponseSchema,
  type LawDataResponse,
  type LawsSearchEntry,
} from './schema.js';

/**
 * 法令API v2 クライアント（docs/research/laws-api-v2.md・認証不要）。
 *
 * **全法令ループ取得の禁止（提供元禁止事項）の第1層**: このクライアントは
 * 一覧巡回・ページング機能を実装しない。検索は法令名/法令番号の条件付きのみ、
 * 本文取得は法令ID/法令番号の単発指定のみ。バルク需要は公式XML一括ダウンロード
 * （https://laws.e-gov.go.jp/bulkdownload/）を案内する。
 */

const LAWS_BASE_URL = 'https://laws.e-gov.go.jp/api/2';
export const LAWS_DEFAULT_INTERVAL_MS = 1_000;

export interface LawsClientOptions {
  baseUrl?: string;
  http?: GovHttpClient;
  fetchFn?: FetchLike;
}

export interface LawsSearchQuery {
  /** 法令名の部分一致 */
  lawTitle?: string;
  /** 法令番号の完全一致（漢数字表記） */
  lawNum?: string;
}

export interface LawsSearchResult {
  totalCount: number;
  laws: LawsSearchEntry[];
  drift: DriftReport;
  publicUrl: string;
}

export interface LawDataResult {
  data: LawDataResponse;
  drift: DriftReport;
  publicUrl: string;
  /** 指定law_id/law_numに該当法令が無い（404）。エラーでなく不存在 */
  found: boolean;
}

export class LawsClient {
  private readonly http: GovHttpClient;
  private readonly baseUrl: string;

  constructor(options: LawsClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? LAWS_BASE_URL).replace(/\/+$/, '');
    this.http =
      options.http ??
      new GovHttpClient({
        intervalMs: LAWS_DEFAULT_INTERVAL_MS,
        ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      });
  }

  /** `GET /laws`: 法令検索（法令名部分一致 or 法令番号）。0件は404→空結果 */
  async searchLaws(query: LawsSearchQuery): Promise<LawsSearchResult> {
    if ((query.lawTitle ?? '') === '' && (query.lawNum ?? '') === '') {
      throw new Error('law検索にはlawTitleまたはlawNumが必要（無条件の全件取得は禁止）');
    }
    const params = new URLSearchParams();
    if (query.lawTitle !== undefined && query.lawTitle !== '') {
      params.set('law_title', query.lawTitle);
    }
    if (query.lawNum !== undefined && query.lawNum !== '') params.set('law_num', query.lawNum);
    params.set('response_format', 'json');
    const publicUrl = `${this.baseUrl}/laws?${params.toString()}`;
    try {
      const response = await this.http.get(publicUrl);
      const raw: unknown = JSON.parse(response.body);
      const { value, drift } = parseWithBuffer(lawsSearchResponseSchema, raw);
      return { totalCount: value.total_count, laws: value.laws ?? [], drift, publicUrl };
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 404) {
        return {
          totalCount: 0,
          laws: [],
          drift: { unknownFields: [], missingFields: [], hasDrift: false },
          publicUrl,
        };
      }
      throw error;
    }
  }

  /** `GET /law_data/{law_id|law_num}`: 法令本文（JSON）。時点指定はasof。404はfound:false */
  async getLawData(lawIdOrNum: string, asof?: string): Promise<LawDataResult> {
    if (lawIdOrNum.trim() === '') {
      throw new Error('law_id/law_numは空にできない');
    }
    const params = new URLSearchParams();
    if (asof !== undefined && asof !== '') params.set('asof', asof);
    params.set('response_format', 'json');
    const publicUrl = `${this.baseUrl}/law_data/${encodeURIComponent(lawIdOrNum.trim())}?${params.toString()}`;
    try {
      const response = await this.http.get(publicUrl);
      const raw: unknown = JSON.parse(response.body);
      const { value, drift } = parseWithBuffer(lawDataResponseSchema, raw);
      return { data: value, drift, publicUrl, found: true };
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 404) {
        return {
          data: {
            law_info: { law_id: '' },
            revision_info: { law_revision_id: '', law_title: '' },
            law_full_text: null,
          },
          drift: { unknownFields: [], missingFields: [], hasDrift: false },
          publicUrl,
          found: false,
        };
      }
      throw error;
    }
  }

  /** 実行終端の監視集計（N-4）用にHTTP統計を公開する。 */
  getHttpStats(): ReturnType<GovHttpClient['getStats']> {
    return this.http.getStats();
  }
}
