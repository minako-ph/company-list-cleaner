/**
 * POST /enrich（FR-4＋FR-6）。
 *
 * - body: `{ userKey: string, corporateNumbers: string[], fields: { basic?, gbizBasic?, subsidy?, procurement? } }`
 *   corporateNumbers は最大 50 件。fields は選択式（省略・全 false も可）。
 * - houjin 系 / gbizinfo 系の一方が未設定・障害でも他方は返す（N-7。サービス層で縮退＋notice）。
 * - 行単位部分失敗（FR-8）はサービス層で各フィールド/行に error を付けて継続する。
 * - CR-3/CR-5: 応答は保存・ログしない。logAccess も呼ばない（インボイス照会専用のため）。
 * - 出典文言は GAS/LP 側の定数（引継書§8）のため本 API はデータのみ返す。
 */

import type { Hono } from 'hono';
import type { EnrichFields, EnrichRow } from '../services/enrich.js';

/** 1リクエストで受け付ける法人番号の上限（サイドバーの50行バッチに対応）。 */
export const ENRICH_MAX_NUMBERS_PER_REQUEST = 50;

export interface EnrichRouteDeps {
  /** 1リクエストの法人番号上限（既定 50）。 */
  readonly maxNumbers?: number;
  /** 法人番号配列へ選択フィールドを付与する（キュー・クライアントは実体側の責務）。 */
  enrich(
    numbers: string[],
    fields: EnrichFields,
    context: { userKey: string },
  ): Promise<EnrichRow[]>;
}

type ParseResult =
  | {
      readonly ok: true;
      readonly userKey: string;
      readonly corporateNumbers: string[];
      readonly fields: EnrichFields;
    }
  | { readonly ok: false; readonly message: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** fields（unknown）から boolean フラグのみを安全に取り出す。非オブジェクト・省略時は全 false。 */
function parseFields(value: unknown): EnrichFields {
  const isObject = typeof value === 'object' && value !== null;
  const pick = (key: string): boolean => isObject && Reflect.get(value, key) === true;
  return {
    basic: pick('basic'),
    gbizBasic: pick('gbizBasic'),
    subsidy: pick('subsidy'),
    procurement: pick('procurement'),
  };
}

/** リクエストボディ（unknown）を検証・narrowする（型アサーション不使用）。 */
function parseBody(body: unknown, maxNumbers: number): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'リクエストボディが不正です' };
  }
  const userKey = Reflect.get(body, 'userKey');
  const corporateNumbers = Reflect.get(body, 'corporateNumbers');
  const fields = Reflect.get(body, 'fields');
  if (typeof userKey !== 'string' || userKey === '') {
    return { ok: false, message: 'userKey は必須です' };
  }
  if (!isStringArray(corporateNumbers)) {
    return { ok: false, message: 'corporateNumbers は文字列配列で指定してください' };
  }
  if (corporateNumbers.length > maxNumbers) {
    return { ok: false, message: `corporateNumbers は最大 ${maxNumbers} 件です` };
  }
  return { ok: true, userKey, corporateNumbers, fields: parseFields(fields) };
}

export function registerEnrichRoute(app: Hono, deps: EnrichRouteDeps): void {
  const maxNumbers = deps.maxNumbers ?? ENRICH_MAX_NUMBERS_PER_REQUEST;

  app.post('/enrich', async (c) => {
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

    const results = await deps.enrich(parsed.corporateNumbers, parsed.fields, {
      userKey: parsed.userKey,
    });
    return c.json({ results });
  });
}
