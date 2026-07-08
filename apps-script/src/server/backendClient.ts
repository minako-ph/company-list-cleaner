/**
 * バックエンド（Cloud Run）への薄い HTTP クライアント（GAS 依存: UrlFetchApp・PropertiesService）。
 *
 * - `BACKEND_URL`（Script Properties）を読み、各エンドポイントを呼ぶ。未設定は明示エラー（無言で失敗しない）。
 * - `muteHttpExceptions: true` で HTTP エラーも取得し、backend の `{error, message}` を
 *   利用者向けメッセージへ写像した `BackendResult` を返す（N-4: 障害を可視化）。
 * - シートのデータは送らない。送るのは userKey・対象列の値（社名・番号）・付与フラグのみ（N-3）。
 *
 * OAuth: UrlFetchApp = script.external_request で完結（CR-7 スコープ3点を増やさない）。
 */

import {
  parseConsumeResult,
  parseEnrichResults,
  parseInvoiceResults,
  parseLicenseVerification,
  parseResolveResults,
  parseUsage,
  type ConsumeResult,
  type EnrichRow,
  type InvoiceStatus,
  type LicenseVerification,
  type ResolveRow,
  type Usage,
} from './backendDto';

/** Script Property のキー名。 */
const BACKEND_URL_PROP = 'BACKEND_URL';

/** 付与フィールドの選択（/enrich の fields に対応）。 */
export interface EnrichFieldFlags {
  readonly basic: boolean;
  readonly gbizBasic: boolean;
  readonly subsidy: boolean;
  readonly procurement: boolean;
}

/** 成功=data、失敗=利用者向けメッセージ＋コード（HTTP ステータス付き）。 */
export type BackendResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string };

/** BACKEND_URL を読む。未設定・空は明示エラー（無言で失敗させない）。 */
function backendBaseUrl(): string {
  const url = PropertiesService.getScriptProperties().getProperty(BACKEND_URL_PROP);
  if (url === null || url.trim() === '') {
    throw new Error(
      'バックエンドURL（BACKEND_URL）が未設定です。管理者による初期設定が完了するまで実行できません。',
    );
  }
  return url.trim().replace(/\/+$/, '');
}

/** レスポンス本文（JSON 文字列）を安全にパースする。失敗時は null。 */
function parseJson(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** unknown から文字列フィールドを安全に取り出す。 */
function readString(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const v = Reflect.get(body, key);
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** HTTP ステータスに応じた既定メッセージ（backend が message を返さないとき）。 */
function fallbackMessage(status: number): string {
  if (status >= 500) return `バックエンドが応答していません（HTTP ${status}）。時間をおいて再度お試しください。`;
  return `リクエストに失敗しました（HTTP ${status}）。`;
}

/** 非 2xx 応答を BackendResult のエラーへ写す。message は backend の文言を優先（サニタイズ済み）。 */
function toError(status: number, body: unknown): { ok: false; status: number; code: string; message: string } {
  const code = readString(body, 'error') ?? 'unknown';
  const message = readString(body, 'message') ?? fallbackMessage(status);
  return { ok: false, status, code, message };
}

/** 共通リクエスト。2xx は生の body（unknown）を返し、非 2xx はエラーへ写す。 */
function requestRaw(
  method: GoogleAppsScript.URL_Fetch.HttpMethod,
  path: string,
  payload: unknown,
): BackendResult<unknown> {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method,
    muteHttpExceptions: true,
    ...(payload !== undefined
      ? { contentType: 'application/json', payload: JSON.stringify(payload) }
      : {}),
  };
  const response = UrlFetchApp.fetch(backendBaseUrl() + path, options);
  const status = response.getResponseCode();
  const body = parseJson(response.getContentText());
  if (status >= 200 && status < 300) {
    return { ok: true, data: body };
  }
  return toError(status, body);
}

/** GET 用のクエリ文字列を組み立てる（値は encodeURIComponent）。 */
function buildQuery(params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** 2xx の body をパーサへ通して型付き結果にする（型アサーション不使用）。 */
function mapOk<T>(result: BackendResult<unknown>, parse: (body: unknown) => T): BackendResult<T> {
  return result.ok ? { ok: true, data: parse(result.data) } : result;
}

// ---------------------------------------------------------------------------
// 各エンドポイント
// ---------------------------------------------------------------------------

/** GET /usage（FR-9 使用量表示）。 */
export function getUsage(userKey: string, licenseKey?: string): BackendResult<Usage> {
  const query = buildQuery({ userKey, licenseKey });
  return mapOk(requestRaw('get', `/usage${query}`, undefined), parseUsage);
}

/** POST /usage/consume（FR-9 行数消費）。allowed=false は 200 応答（quota_exceeded はここで判定）。 */
export function consumeUsage(
  userKey: string,
  rows: number,
  licenseKey?: string,
): BackendResult<ConsumeResult> {
  const payload = { userKey, rows, ...(licenseKey !== undefined ? { licenseKey } : {}) };
  return mapOk(requestRaw('post', '/usage/consume', payload), parseConsumeResult);
}

/** POST /resolve（FR-2/3 正規化＋法人番号解決）。names は対象列の値のみ（N-3）。 */
export function resolve(userKey: string, names: string[]): BackendResult<ResolveRow[]> {
  return mapOk(requestRaw('post', '/resolve', { userKey, names }), parseResolveResults);
}

/** POST /enrich（FR-4/6 情報付与）。corporateNumbers は番号のみ（N-3）。 */
export function enrich(
  userKey: string,
  corporateNumbers: string[],
  fields: EnrichFieldFlags,
): BackendResult<EnrichRow[]> {
  return mapOk(
    requestRaw('post', '/enrich', { userKey, corporateNumbers, fields }),
    parseEnrichResults,
  );
}

/** POST /invoice（FR-5 インボイス登録確認）。登録番号のみ（CR-1）。503 は invoice_disabled で返る。 */
export function invoice(userKey: string, registrationNumbers: string[]): BackendResult<InvoiceStatus[]> {
  return mapOk(
    requestRaw('post', '/invoice', { userKey, registrationNumbers }),
    parseInvoiceResults,
  );
}

/** POST /license/verify（FR-10 ライセンス検証）。 */
export function verifyLicense(licenseKey: string): BackendResult<LicenseVerification> {
  return mapOk(
    requestRaw('post', '/license/verify', { licenseKey }),
    parseLicenseVerification,
  );
}
