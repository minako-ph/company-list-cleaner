import { parseWithBuffer, type DriftReport } from '@jp-opendata/schema-buffer';
import { GovHttpClient } from '../http.js';
import {
  edinetDocumentListSchema,
  edinetErrorSchema,
  type EdinetDocumentResult,
} from './schema.js';

/**
 * EDINET API v2 クライアント（引継書§4.1）。
 * - 一覧は日単位（期間指定は呼び出し側で日ループ）
 * - レート: 1req/秒仮置き（未決#2。実測で更新）
 * - 認証はクエリ Subscription-Key。キーはログ・source_url・fixtureに含めない
 */

const EDINET_BASE_URL = 'https://api.edinet-fsa.go.jp/api/v2';
export const EDINET_DEFAULT_INTERVAL_MS = 1_000;

export class EdinetApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(`EDINET APIエラー ${statusCode}: ${message}`);
    this.name = 'EdinetApiError';
  }
}

export interface EdinetListResult {
  documents: EdinetDocumentResult[];
  drift: DriftReport;
  /** キーを含まない公開可能なリクエストURL（source_url用） */
  publicUrl: string;
}

export interface EdinetClientOptions {
  apiKey: string;
  http?: GovHttpClient;
  baseUrl?: string;
}

export class EdinetClient {
  private readonly apiKey: string;
  private readonly http: GovHttpClient;
  private readonly baseUrl: string;

  constructor(options: EdinetClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? EDINET_BASE_URL;
    this.http = options.http ?? new GovHttpClient({ intervalMs: EDINET_DEFAULT_INTERVAL_MS });
  }

  /** 指定日の提出書類一覧を取得する（type=2: メタデータ＋書類一覧） */
  async listDocuments(date: string): Promise<EdinetListResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`dateはYYYY-MM-DD形式のみ: ${date}`);
    }
    const publicUrl = `${this.baseUrl}/documents.json?date=${date}&type=2`;
    const response = await this.http.get(`${publicUrl}&Subscription-Key=${this.apiKey}`);
    const parsed: unknown = JSON.parse(response.body);

    // EDINETはエラーをHTTP 200＋ボディ内StatusCodeで返すことがある（2026-07-07実測）
    const asError = edinetErrorSchema.safeParse(parsed);
    if (asError.success) {
      throw new EdinetApiError(asError.data.StatusCode, asError.data.message);
    }

    const { value, drift } = parseWithBuffer(edinetDocumentListSchema, parsed);
    if (value.metadata.status !== '200') {
      throw new EdinetApiError(Number(value.metadata.status), value.metadata.message);
    }
    // 書類ゼロの日はresultsが空配列または欠落 → 0件として扱う
    return { documents: value.results ?? [], drift, publicUrl };
  }

  // TODO(Phase 1): getDocument(docId, type=5) — CSV(財務値ソース)・PDF・XBRL zipのバイナリ取得。
  // GovHttpClientにバイナリ応答対応を足してから実装する。
}
