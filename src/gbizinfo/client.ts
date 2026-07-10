import { parseWithBuffer, z, type DriftReport } from '@jp-opendata/schema-buffer';
import { GovHttpClient, HttpStatusError, type FetchLike } from '../http.js';
import { stripNullStrings } from './normalize.js';
import {
  gbizBasicInfoSchema,
  gbizEnvelopeSchema,
  gbizHojinProfileSchema,
  gbizPatentHojinSchema,
  gbizProcurementHojinSchema,
  gbizSubsidyHojinSchema,
  type GbizBasicInfo,
  type GbizHojinProfile,
  type GbizPatentHojin,
  type GbizProcurementHojin,
  type GbizSubsidyHojin,
} from './schema.js';

/**
 * gBizINFO REST API v2 クライアント（docs/research/gbizinfo-v2.md / gbizinfo-subsidy.md）。
 * 対象は柱3 FR-6と柱2 Actor#2に必要な4エンドポイントのみ:
 * - `GET /v2/hojin`（法人検索。Actor#2横断検索・name_en取得）
 * - `GET /v2/hojin/{corporate_number}`（法人基本情報）
 * - `GET /v2/hojin/{corporate_number}/subsidy`（補助金）
 * - `GET /v2/hojin/{corporate_number}/procurement`（調達）
 *
 * 認証はヘッダ `X-hojinInfo-api-token`（コンストラクタで受け取る）。
 * ベースURL末尾スラッシュは500になるため、baseUrlの末尾スラッシュは除去する。
 * 値なし項目 `"Null"`・真のnull はパース前に undefined へ正規化する（stripNullStrings）。
 */

const GBIZINFO_BASE_URL = 'https://api.info.gbiz.go.jp/hojin';
export const GBIZINFO_DEFAULT_INTERVAL_MS = 500;
const API_TOKEN_HEADER = 'X-hojinInfo-api-token';

export interface GbizinfoClientOptions {
  /** API利用トークン。ヘッダ X-hojinInfo-api-token として送出する。 */
  token: string;
  baseUrl?: string;
  http?: GovHttpClient;
  /** テスト用のfetch差し替え（http未指定時に既定クライアントへ注入される）。 */
  fetchFn?: FetchLike;
}

export interface GbizinfoResult<T> {
  id: string;
  message: string;
  hojinInfos: T[];
  drift: DriftReport;
  /** リクエストURL（トークンはヘッダ送出のためURLには含まれない。source_url用）。 */
  publicUrl: string;
}

/**
 * 法人検索 `GET /v2/hojin` のクエリ（Actor#2で使う面のみ。docs/research/gbizinfo-subsidy.md）。
 * pageは1〜10（11以上はAPIが400）、limitは0〜5000。
 */
export interface GbizinfoSearchQuery {
  corporateNumber?: string;
  name?: string;
  /** 補助金名称の部分一致 */
  subsidy?: string;
  /** 担当府省の内部コード（GBIZ_MINISTRY_CODES。カンマ区切り可） */
  ministry?: string;
  /** 出典元: 1調達 2表彰 3届出認定 4補助金 5特許 6財務 */
  source?: string;
  page?: number;
  limit?: number;
}

/** 法人検索のpage上限（APIは11以上を400で拒否する） */
export const GBIZINFO_SEARCH_MAX_PAGE = 10;

function normalizeBaseUrl(baseUrl: string): string {
  // 末尾スラッシュは gBizINFO で500を招くため除去する
  return baseUrl.replace(/\/+$/, '');
}

export class GbizinfoClient {
  private readonly http: GovHttpClient;
  private readonly baseUrl: string;

  constructor(options: GbizinfoClientOptions) {
    if (options.token === '') {
      throw new Error('gBizINFO APIトークンが空');
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? GBIZINFO_BASE_URL);
    this.http =
      options.http ??
      new GovHttpClient({
        intervalMs: GBIZINFO_DEFAULT_INTERVAL_MS,
        headers: { [API_TOKEN_HEADER]: options.token },
        ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      });
  }

  /**
   * `GET /v2/hojin`: 法人検索。0件は404で返るため空結果に写像する（エラー扱いしない）。
   * 応答は法人プロフィール（name_en含む）のみで、補助金レコード自体は含まれない。
   */
  async searchHojin(query: GbizinfoSearchQuery): Promise<GbizinfoResult<GbizHojinProfile>> {
    const params = new URLSearchParams();
    if (query.corporateNumber !== undefined) params.set('corporate_number', query.corporateNumber);
    if (query.name !== undefined) params.set('name', query.name);
    if (query.subsidy !== undefined) params.set('subsidy', query.subsidy);
    if (query.ministry !== undefined) params.set('ministry', query.ministry);
    if (query.source !== undefined) params.set('source', query.source);
    if (query.page !== undefined) {
      if (query.page < 1 || query.page > GBIZINFO_SEARCH_MAX_PAGE) {
        throw new Error(`pageは1〜${GBIZINFO_SEARCH_MAX_PAGE}のみ: ${query.page}`);
      }
      params.set('page', String(query.page));
    }
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const publicUrl = `${this.baseUrl}/v2/hojin?${params.toString()}`;
    try {
      return await this.fetchAndParse(publicUrl, gbizHojinProfileSchema);
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 404) {
        return {
          id: '',
          message: '404 - Not Found.',
          hojinInfos: [],
          drift: { unknownFields: [], missingFields: [], hasDrift: false },
          publicUrl,
        };
      }
      throw error;
    }
  }

  /** `GET /v2/hojin/{corporate_number}`: 法人基本情報。 */
  async getBasicInfo(corporateNumber: string): Promise<GbizinfoResult<GbizBasicInfo>> {
    const publicUrl = `${this.baseUrl}/v2/hojin/${this.assertCorporateNumber(corporateNumber)}`;
    return this.fetchAndParse(publicUrl, gbizBasicInfoSchema);
  }

  /** `GET /v2/hojin/{corporate_number}/subsidy`: 補助金受給実績。 */
  async getSubsidies(corporateNumber: string): Promise<GbizinfoResult<GbizSubsidyHojin>> {
    const publicUrl = `${this.baseUrl}/v2/hojin/${this.assertCorporateNumber(corporateNumber)}/subsidy`;
    return this.fetchAndParse(publicUrl, gbizSubsidyHojinSchema);
  }

  /** `GET /v2/hojin/{corporate_number}/procurement`: 国等との調達実績。 */
  async getProcurements(corporateNumber: string): Promise<GbizinfoResult<GbizProcurementHojin>> {
    const publicUrl = `${this.baseUrl}/v2/hojin/${this.assertCorporateNumber(corporateNumber)}/procurement`;
    return this.fetchAndParse(publicUrl, gbizProcurementHojinSchema);
  }

  /**
   * `GET /v2/hojin/{corporate_number}/patent`: 特許実績。応答は大企業で数MBに達するため
   * レコード内容は解釈せず、patent_count（件数）用途に限る（docs/research/houjin-name-search.md）。
   */
  async getPatents(corporateNumber: string): Promise<GbizinfoResult<GbizPatentHojin>> {
    const publicUrl = `${this.baseUrl}/v2/hojin/${this.assertCorporateNumber(corporateNumber)}/patent`;
    return this.fetchAndParse(publicUrl, gbizPatentHojinSchema);
  }

  private assertCorporateNumber(corporateNumber: string): string {
    if (!/^\d{13}$/.test(corporateNumber)) {
      throw new Error(`corporate_numberは13桁の数字のみ: ${corporateNumber}`);
    }
    return corporateNumber;
  }

  private async fetchAndParse<S extends z.ZodTypeAny>(
    publicUrl: string,
    infoSchema: S,
  ): Promise<GbizinfoResult<z.infer<S>>> {
    const response = await this.http.get(publicUrl);
    const rawParsed: unknown = JSON.parse(response.body);
    const cleaned = stripNullStrings(rawParsed);
    const { value, drift } = parseWithBuffer(gbizEnvelopeSchema(infoSchema), cleaned);
    return {
      id: value.id ?? '',
      message: value.message ?? '',
      hojinInfos: value['hojin-infos'],
      drift,
      publicUrl,
    };
  }

  /** 実行終端の監視集計（N-4）用にHTTP統計を公開する。 */
  getHttpStats(): ReturnType<GovHttpClient['getStats']> {
    return this.http.getStats();
  }
}
