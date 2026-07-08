import { parseWithBuffer, z, type DriftReport } from '@jp-opendata/schema-buffer';
import { GovHttpClient, type FetchLike } from '../http.js';
import { stripNullStrings } from './normalize.js';
import {
  gbizBasicInfoSchema,
  gbizEnvelopeSchema,
  gbizProcurementHojinSchema,
  gbizSubsidyHojinSchema,
  type GbizBasicInfo,
  type GbizProcurementHojin,
  type GbizSubsidyHojin,
} from './schema.js';

/**
 * gBizINFO REST API v2 クライアント（docs/research/gbizinfo-v2.md）。
 * 対象は柱3 FR-6（補助金受給・国等との調達実績）に必要な3エンドポイントのみ:
 * - `GET /v2/hojin/{corporate_number}`（法人基本情報）
 * - `GET /v2/hojin/{corporate_number}/subsidy`（補助金）
 * - `GET /v2/hojin/{corporate_number}/procurement`（調達）
 *
 * 認証はヘッダ `X-hojinInfo-api-token`（コンストラクタで受け取る）。
 * ベースURL末尾スラッシュは500になるため、baseUrlの末尾スラッシュは除去する。
 * 値なし項目 `"Null"` はパース前に undefined へ正規化する（stripNullStrings）。
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
      id: value.id,
      message: value.message,
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
