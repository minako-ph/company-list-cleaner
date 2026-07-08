/**
 * インボイスWeb-API（適格請求書発行事業者公表システム）クライアント（FR-5 / 本リポジトリ専用）。
 *
 * 国税庁承認条件の型レベル縛り（引継書 §2 / 要件書 §5 CR-1〜5）:
 * - CR-1/2: 公開できる照会手段は `lookupByRegistrationNumbers`（登録番号のみ）**だけ**。
 *   氏名・所在地・名称など登録番号以外を受け取る引数・関数・オプションを一切設けない。
 *   照会は常に `T＋数字13桁` の登録番号で行う（適法チェーンの終端）。
 * - CR-3: 取得した公表情報を永続化・キャッシュ・ログしない。呼び出し元へ return するのみ。
 * - CR-4: `/1/num`（登録番号指定）のみ。取得期間指定（diff）・登録番号＋日付指定（point）・
 *   全件ダウンロードの各機能は呼ばない。
 * - CR-5: 照会実行時に登録番号ごとに `logAccess({ userKey, registrationNumber })` を記録する
 *   （3点のみ。応答内容は渡さない）。
 *
 * リクエスト（docs/research/invoice-webapi-v1.md / decisions.md）:
 *   GET {apiBase}/1/num?id=<appId>&number=<T+13桁,...(最大10件)>&type=21&history=0
 * アプリケーションID（`id=`）はエラーメッセージにも公開値にも漏らさない（redactUrl）。
 */

import type { SerialQueue } from '../queue.js';

/** 1リクエストで指定できる登録番号の最大件数（decisions.md 2026-07-07: 超過は 400-0002）。 */
const INVOICE_NUM_MAX = 10;

/** 登録番号の形式: `T` ＋ 数字13桁。 */
const REGISTRATION_NUMBER_PATTERN = /^T\d{13}$/;

/** 行単位の照会エラー（FR-8。設定時は登録情報が未確定であることを表す）。 */
export interface InvoiceLookupError {
  /** 'invalid_format' | 'not_configured' | 'http_error' | 'request_failed' */
  readonly code: string;
  /** 利用者向けメッセージ（アプリID・応答本文を含めない）。 */
  readonly message: string;
}

/**
 * 1登録番号あたりの照会結果。
 * `error` が設定されている場合、登録状態（found/registered/各日付）は未確定。
 */
export interface InvoiceStatus {
  /** 照会した登録番号（入力値をそのまま保持。不正形式でも入力を返す）。 */
  readonly registrationNumber: string;
  /** 公表システムに登録情報が存在するか（取消・失効済みを含む）。 */
  readonly found: boolean;
  /** 現在有効な登録か（found かつ 取消・失効いずれもなし）。 */
  readonly registered: boolean;
  /** 登録年月日（あれば）。 */
  readonly registrationDate?: string;
  /** 取消年月日（あれば＝取消済み）。 */
  readonly disposalDate?: string;
  /** 失効年月日（あれば＝失効済み）。 */
  readonly expireDate?: string;
  /** 行単位エラー（FR-8）。 */
  readonly error?: InvoiceLookupError;
}

/** fetch の最小注入面（テストでスタブ可能にする。応答本文は unknown で受ける）。 */
export interface InvoiceFetchResponse {
  readonly status: number;
  json(): Promise<unknown>;
}
export type InvoiceFetch = (url: string) => Promise<InvoiceFetchResponse>;

export interface InvoiceClientDeps {
  /** 接続先ベースURL（本番 or 検証環境。空なら未設定＝照会不可）。 */
  readonly apiBase: string;
  /** アプリケーションID（13桁。空なら未設定＝照会不可）。`id=` として送出しログ・エラーへ漏らさない。 */
  readonly appId: string;
  /** 公的API直列キュー（N-1）。全リクエストを通す。 */
  readonly queue: SerialQueue;
  /** fetch 実装（既定は global fetch のラッパ）。 */
  readonly fetchFn: InvoiceFetch;
  /** CR-5 アクセスログ。userKey と registrationNumber のみ受け取れる型。 */
  readonly logAccess: (input: { userKey: string; registrationNumber: string }) => void;
}

/**
 * 公開クライアント。照会手段は `lookupByRegistrationNumbers` のみ（CR-1/2）。
 */
export interface InvoiceClient {
  lookupByRegistrationNumbers(
    numbers: string[],
    context: { userKey: string },
  ): Promise<InvoiceStatus[]>;
}

/**
 * エラー・公開用にURLからクエリ（`id=`アプリID・登録番号を含む）を除去する。
 * jp-corp-core http.ts の redactUrlForError と同じ流儀（backend 内実装）。
 */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '[invalid url]';
  }
}

/**
 * HTTP 4xx/5xx を表す内部エラー。
 * メッセージに含めるURLは redactUrl 済み（アプリID・登録番号を漏らさない）。
 */
class InvoiceHttpError extends Error {
  constructor(
    public readonly status: number,
    redactedUrl: string,
  ) {
    super(`invoice api responded with HTTP ${status}: ${redactedUrl}`);
    this.name = 'InvoiceHttpError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** レコードから文字列フィールドを安全に取り出す（型アサーション不使用）。 */
function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** 応答ボディから announcement 配列を取り出す。構造不正時は空配列。 */
function extractAnnouncements(body: unknown): Record<string, unknown>[] {
  if (!isRecord(body)) return [];
  const announcement = body['announcement'];
  if (!Array.isArray(announcement)) return [];
  return announcement.filter(isRecord);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function errorStatus(registrationNumber: string, error: InvoiceLookupError): InvoiceStatus {
  return { registrationNumber, found: false, registered: false, error };
}

/**
 * 応答レコードから 1 登録番号の InvoiceStatus を構築する。
 * - found: 一致レコードがあり registrationDate が非空（取消・失効も「登録された」ため found=true）。
 * - registered: found かつ disposalDate・expireDate いずれも空（＝現在有効）。
 */
function buildStatus(
  registrationNumber: string,
  record: Record<string, unknown> | undefined,
): InvoiceStatus {
  if (record === undefined) {
    return { registrationNumber, found: false, registered: false };
  }
  const registrationDate = getString(record, 'registrationDate');
  const disposalDate = getString(record, 'disposalDate');
  const expireDate = getString(record, 'expireDate');

  // registrationDate が空/欠落なら「登録情報なし」とみなす（未登録番号の空エコー・省略の両方に頑健）。
  if (registrationDate === undefined || registrationDate === '') {
    return { registrationNumber, found: false, registered: false };
  }
  const disposed = disposalDate !== undefined && disposalDate !== '';
  const expired = expireDate !== undefined && expireDate !== '';
  return {
    registrationNumber,
    found: true,
    registered: !disposed && !expired,
    registrationDate,
    ...(disposed ? { disposalDate } : {}),
    ...(expired ? { expireDate } : {}),
  };
}

/** 応答ボディを「登録番号 → レコード」へ整理する（registrationDate を持つレコードを優先）。 */
function indexByRegistrationNumber(body: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const record of extractAnnouncements(body)) {
    const number = getString(record, 'registratedNumber');
    if (number === undefined || number === '') continue;
    const existing = map.get(number);
    const existingHasDate =
      existing !== undefined && (getString(existing, 'registrationDate') ?? '') !== '';
    const currentHasDate = (getString(record, 'registrationDate') ?? '') !== '';
    if (existing === undefined || (!existingHasDate && currentHasDate)) {
      map.set(number, record);
    }
  }
  return map;
}

export function createInvoiceClient(deps: InvoiceClientDeps): InvoiceClient {
  const configured = deps.apiBase !== '' && deps.appId !== '';

  function buildRequestUrl(numbers: readonly string[]): string {
    // number は T+13桁のみでURL安全（カンマ区切り）。id は先頭・publicには出さない。
    const query = `id=${deps.appId}&number=${numbers.join(',')}&type=21&history=0`;
    return `${deps.apiBase}/1/num?${query}`;
  }

  function mapChunkError(error: unknown): InvoiceLookupError {
    if (error instanceof InvoiceHttpError) {
      return { code: 'http_error', message: `インボイスAPIがHTTP ${error.status} を返しました` };
    }
    // ネットワーク例外等。詳細（URL・アプリID）は載せない。
    return { code: 'request_failed', message: 'インボイスAPIへのリクエストに失敗しました' };
  }

  async function lookupByRegistrationNumbers(
    numbers: string[],
    context: { userKey: string },
  ): Promise<InvoiceStatus[]> {
    const results: (InvoiceStatus | undefined)[] = numbers.map(() => undefined);
    const validEntries: { index: number; number: string }[] = [];

    numbers.forEach((raw, index) => {
      if (REGISTRATION_NUMBER_PATTERN.test(raw)) {
        validEntries.push({ index, number: raw });
      } else {
        results[index] = errorStatus(raw, {
          code: 'invalid_format',
          message: '登録番号は T＋数字13桁 で指定してください',
        });
      }
    });

    if (!configured) {
      // 未設定時は照会もログもしない（CR-5: 実際に照会した番号のみ記録）。
      for (const entry of validEntries) {
        results[entry.index] = errorStatus(entry.number, {
          code: 'not_configured',
          message: 'インボイス照会は現在利用できません',
        });
      }
      return finalize(results, numbers);
    }

    const chunks = chunk(validEntries, INVOICE_NUM_MAX);

    async function runChunk(entries: { index: number; number: string }[]): Promise<void> {
      try {
        const indexed = await deps.queue.enqueue(async () => {
          // CR-5: 照会する登録番号ごとに 3点ログ（応答内容は渡さない）。
          for (const entry of entries) {
            deps.logAccess({ userKey: context.userKey, registrationNumber: entry.number });
          }
          const url = buildRequestUrl(entries.map((e) => e.number));
          const response = await deps.fetchFn(url);
          if (response.status >= 400) {
            // URLは redactUrl でクエリ（id・番号）を除去してから載せる。
            throw new InvoiceHttpError(response.status, redactUrl(url));
          }
          const body = await response.json();
          return indexByRegistrationNumber(body);
        });
        for (const entry of entries) {
          results[entry.index] = buildStatus(entry.number, indexed.get(entry.number));
        }
      } catch (error) {
        // チャンク単位の失敗は当該行のみエラーにし、他チャンクは継続（FR-8）。
        const mapped = mapChunkError(error);
        for (const entry of entries) {
          results[entry.index] = errorStatus(entry.number, mapped);
        }
      }
    }

    await Promise.all(chunks.map((entries) => runChunk(entries)));
    return finalize(results, numbers);
  }

  return { lookupByRegistrationNumbers };
}

/** 未設定要素が万一残っても型を満たす（防御的フォールバック）。 */
function finalize(results: (InvoiceStatus | undefined)[], numbers: string[]): InvoiceStatus[] {
  return results.map((status, index) => {
    if (status !== undefined) return status;
    return errorStatus(numbers[index] ?? '', {
      code: 'request_failed',
      message: 'インボイスAPIへのリクエストに失敗しました',
    });
  });
}
