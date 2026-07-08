/**
 * POST /invoice（FR-5・機能フラグ）。
 *
 * - body: `{ userKey: string, registrationNumbers: string[] }`
 * - `INVOICE_ENABLED=false`（縮退公開）のときは 503 で明示応答（無言で失敗しない・N-4）。
 * - 有効時はクライアントを呼び、行単位の部分失敗を許容して結果配列を返す（FR-8）。
 * - 照会キーは登録番号のみ（CR-1/2）。応答はクライアントから受け取りそのまま返す（保存・ログしない・CR-3）。
 */

import type { Hono } from 'hono';
import type { InvoiceStatus } from '../clients/invoice.js';

/** 1リクエストで受け付ける登録番号の上限（サイドバーの50行バッチに対応）。 */
export const INVOICE_MAX_NUMBERS_PER_REQUEST = 50;

export interface InvoiceRouteDeps {
  /** INVOICE_ENABLED。false のとき 503 を返す。 */
  readonly invoiceEnabled: boolean;
  /** 1リクエストの登録番号上限（既定 50）。 */
  readonly maxNumbersPerRequest?: number;
  /** インボイスクライアントの照会関数（登録番号のみ）。 */
  lookup(numbers: string[], context: { userKey: string }): Promise<InvoiceStatus[]>;
}

type ParseResult =
  | { readonly ok: true; readonly userKey: string; readonly registrationNumbers: string[] }
  | { readonly ok: false; readonly message: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** リクエストボディ（unknown）を検証・narrowする。型アサーション不使用。 */
function parseBody(body: unknown, maxNumbers: number): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'リクエストボディが不正です' };
  }
  const userKey = Reflect.get(body, 'userKey');
  const registrationNumbers = Reflect.get(body, 'registrationNumbers');
  if (typeof userKey !== 'string' || userKey === '') {
    return { ok: false, message: 'userKey は必須です' };
  }
  if (!isStringArray(registrationNumbers)) {
    return { ok: false, message: 'registrationNumbers は文字列配列で指定してください' };
  }
  if (registrationNumbers.length > maxNumbers) {
    return { ok: false, message: `registrationNumbers は最大 ${maxNumbers} 件です` };
  }
  return { ok: true, userKey, registrationNumbers };
}

export function registerInvoiceRoute(app: Hono, deps: InvoiceRouteDeps): void {
  const maxNumbers = deps.maxNumbersPerRequest ?? INVOICE_MAX_NUMBERS_PER_REQUEST;

  app.post('/invoice', async (c) => {
    // 縮退公開: 明示的に 503 を返す（無言で失敗させない）。
    if (!deps.invoiceEnabled) {
      return c.json({ error: 'invoice_disabled', message: '準備中' }, 503);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request', message: 'JSON ボディを解析できません' }, 400);
    }

    const parsed = parseBody(raw, maxNumbers);
    if (!parsed.ok) {
      return c.json({ error: 'invalid_request', message: parsed.message }, 400);
    }

    const results = await deps.lookup(parsed.registrationNumbers, { userKey: parsed.userKey });
    return c.json({ results });
  });
}
