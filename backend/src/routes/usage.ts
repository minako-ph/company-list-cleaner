/**
 * /usage（FR-9 無料枠と使用量表示）。
 *
 * - `GET /usage?userKey=...` → 当月の使用量（サイドバー常時表示用）。
 * - `POST /usage/consume` — body `{ userKey, rows }` → 消費結果（GAS processBatch が行数消費に使用）。
 *   rows は 1〜50 の整数（バッチ上限に一致）。範囲外・非整数は 400。
 * - CR-3: ここで扱うのは利用量データのみ。公表情報・社名は受け取らず保存もしない。
 */

import type { Hono } from 'hono';
import type { ConsumeResult, Usage } from '../services/quota.js';

/** 1回の consume で受け付ける行数の上限（サイドバーの50行バッチに対応）。 */
export const USAGE_CONSUME_MAX_ROWS = 50;
/** 1回の consume で受け付ける行数の下限。 */
export const USAGE_CONSUME_MIN_ROWS = 1;

export interface UsageRouteDeps {
  /** 当月の使用量を返す（FR-9）。 */
  getUsage(userKey: string): Promise<Usage>;
  /** 行数を消費する（超過時は消費せず allowed=false）。 */
  consume(userKey: string, rows: number): Promise<ConsumeResult>;
  /** consume の行数上限（既定 50）。 */
  readonly maxRows?: number;
}

type ConsumeParseResult =
  | { readonly ok: true; readonly userKey: string; readonly rows: number }
  | { readonly ok: false; readonly message: string };

/** consume ボディ（unknown）を検証・narrowする（型アサーション不使用）。 */
function parseConsumeBody(body: unknown, minRows: number, maxRows: number): ConsumeParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'リクエストボディが不正です' };
  }
  const userKey = Reflect.get(body, 'userKey');
  const rows = Reflect.get(body, 'rows');
  if (typeof userKey !== 'string' || userKey === '') {
    return { ok: false, message: 'userKey は必須です' };
  }
  if (typeof rows !== 'number' || !Number.isInteger(rows)) {
    return { ok: false, message: 'rows は整数で指定してください' };
  }
  if (rows < minRows || rows > maxRows) {
    return { ok: false, message: `rows は ${minRows}〜${maxRows} の範囲で指定してください` };
  }
  return { ok: true, userKey, rows };
}

export function registerUsageRoute(app: Hono, deps: UsageRouteDeps): void {
  const maxRows = deps.maxRows ?? USAGE_CONSUME_MAX_ROWS;

  app.get('/usage', async (c) => {
    const userKey = c.req.query('userKey');
    if (userKey === undefined || userKey === '') {
      return c.json({ error: 'invalid_request', message: 'userKey は必須です' }, 400);
    }
    const usage = await deps.getUsage(userKey);
    return c.json(usage);
  });

  app.post('/usage/consume', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request', message: 'JSON ボディを解析できません' }, 400);
    }

    const parsed = parseConsumeBody(raw, USAGE_CONSUME_MIN_ROWS, maxRows);
    if (!parsed.ok) {
      return c.json({ error: 'invalid_request', message: parsed.message }, 400);
    }

    const result = await deps.consume(parsed.userKey, parsed.rows);
    return c.json(result);
  });
}
