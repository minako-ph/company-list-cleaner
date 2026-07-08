/**
 * 公的APIクライアント（法人番号API / gBizINFO）の例外を、利用者向けの行/フィールド
 * エラー（コード＋メッセージ）へ写す共通ヘルパ。
 *
 * 絶対規則: エラーメッセージにアプリID・トークン・URL・応答本文を載せない（引継書§9・CR-3）。
 * jp-corp-core の http 層は redactUrlForError 済みだが、ここでは元例外の message を
 * そのまま echo せず、必ず自前の定型文へ写す（二重防御）。
 */

import { HttpStatusError, RateLimitAbortError } from '@jp-opendata/gov-clients/http';

export interface ApiFieldError {
  /** 'http_error' | 'rate_limited' | 'request_failed' */
  readonly code: string;
  /** 利用者向けメッセージ（機微情報を含めない）。 */
  readonly message: string;
}

/**
 * @param apiLabel 表示用のAPI名（例: '法人番号API' / 'gBizINFO'）。値ではなく固定ラベルのみ。
 */
export function mapApiError(error: unknown, apiLabel: string): ApiFieldError {
  if (error instanceof HttpStatusError) {
    return { code: 'http_error', message: `${apiLabel}がHTTP ${error.status} を返しました` };
  }
  if (error instanceof RateLimitAbortError) {
    return { code: 'rate_limited', message: `${apiLabel}のレート制限により中断しました` };
  }
  // ネットワーク例外・パース失敗等。詳細は載せない。
  return { code: 'request_failed', message: `${apiLabel}へのリクエストに失敗しました` };
}
