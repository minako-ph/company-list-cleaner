import { parseWithBuffer, type DriftReport } from '@jp-opendata/schema-buffer';
import { GovHttpClient, HttpStatusError } from '../http.js';
import {
  xit001ResponseSchema,
  xit002ResponseSchema,
  type ReinfolibMunicipality,
  type ReinfolibTransaction,
} from './schema.js';

/**
 * 不動産情報ライブラリ APIクライアント（引継書§4.3）。
 * - 認証: ヘッダ `Ocp-Apim-Subscription-Key`（URLに含めない＝publicUrl/エラーに漏れない。F-1維持）
 * - レート: 明示上限なし・「間隔を空ける」要請 → 直列1req/秒。429/403は共通HTTP層の
 *   指数バックオフ3回で中断（N-1）
 * - **404はエラーでなく「該当なし・0件」**（2026-07-08実疎通で確認済み。タイル系のみ200＋空）
 * - gzip応答はNode fetch(undici)が透過的に伸長する
 * - ブラウザからの直接リクエストは提供元規約で禁止（サーバ実行のActorはOK）
 */

const REINFOLIB_BASE_URL = 'https://www.reinfolib.mlit.go.jp/ex-api/external';
export const REINFOLIB_DEFAULT_INTERVAL_MS = 1_000;

export type ReinfolibLanguage = 'ja' | 'en';

/** priceClassification: 01=不動産取引価格情報のみ / 02=成約価格情報のみ / 省略=両方（実証済み） */
export type ReinfolibPriceClassification = '01' | '02';

export interface ReinfolibTransactionQuery {
  year: number;
  quarter?: number;
  /** 都道府県コード2桁 */
  area?: string;
  /** 市区町村コード5桁 */
  city?: string;
  /** 駅コード6桁 */
  station?: string;
  priceClassification?: ReinfolibPriceClassification;
  language: ReinfolibLanguage;
}

export interface ReinfolibTransactionsResult {
  records: ReinfolibTransaction[];
  drift: DriftReport;
  publicUrl: string;
}

export interface ReinfolibMunicipalitiesResult {
  municipalities: ReinfolibMunicipality[];
  drift: DriftReport;
  publicUrl: string;
}

const NO_DRIFT: DriftReport = { unknownFields: [], missingFields: [], hasDrift: false };

export interface ReinfolibClientOptions {
  apiKey: string;
  http?: GovHttpClient;
  baseUrl?: string;
}

export class ReinfolibClient {
  private readonly http: GovHttpClient;
  private readonly baseUrl: string;

  constructor(options: ReinfolibClientOptions) {
    this.baseUrl = options.baseUrl ?? REINFOLIB_BASE_URL;
    this.http =
      options.http ??
      new GovHttpClient({
        intervalMs: REINFOLIB_DEFAULT_INTERVAL_MS,
        headers: { 'Ocp-Apim-Subscription-Key': options.apiKey },
      });
  }

  /** XIT001: 不動産価格（取引価格・成約価格）情報。404は0件として空配列 */
  async listTransactions(query: ReinfolibTransactionQuery): Promise<ReinfolibTransactionsResult> {
    const params = new URLSearchParams();
    params.set('year', String(query.year));
    if (query.quarter !== undefined) params.set('quarter', String(query.quarter));
    if (query.area !== undefined) params.set('area', query.area);
    if (query.city !== undefined) params.set('city', query.city);
    if (query.station !== undefined) params.set('station', query.station);
    if (query.priceClassification !== undefined) {
      params.set('priceClassification', query.priceClassification);
    }
    params.set('language', query.language);
    const publicUrl = `${this.baseUrl}/XIT001?${params.toString()}`;

    const body = await this.getOrNull(publicUrl);
    if (body === null) return { records: [], drift: NO_DRIFT, publicUrl };

    const { value, drift } = parseWithBuffer(xit001ResponseSchema, JSON.parse(body));
    return { records: value.data ?? [], drift, publicUrl };
  }

  /** XIT002: 都道府県内市区町村一覧。language対応（en=英語名）を実証済み */
  async listMunicipalities(
    area: string,
    language: ReinfolibLanguage,
  ): Promise<ReinfolibMunicipalitiesResult> {
    const publicUrl = `${this.baseUrl}/XIT002?area=${encodeURIComponent(area)}&language=${language}`;
    const body = await this.getOrNull(publicUrl);
    if (body === null) return { municipalities: [], drift: NO_DRIFT, publicUrl };

    const { value, drift } = parseWithBuffer(xit002ResponseSchema, JSON.parse(body));
    return { municipalities: value.data ?? [], drift, publicUrl };
  }

  /** 404のみnull（=0件）。401/403等の認証・レートは共通HTTP層の分類のままthrow */
  private async getOrNull(url: string): Promise<string | null> {
    try {
      const response = await this.http.get(url);
      return response.body;
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 404) return null;
      throw error;
    }
  }

  /** 実行終端の監視集計（N-4）用にHTTP統計を公開する */
  getHttpStats(): ReturnType<GovHttpClient['getStats']> {
    return this.http.getStats();
  }
}
