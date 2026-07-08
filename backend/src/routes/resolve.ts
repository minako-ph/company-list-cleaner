/**
 * POST /resolve（FR-2＋FR-3）。
 *
 * - body: `{ userKey: string, names: string[] }`（names は最大 50 件）
 * - HOUJIN_APP_ID 未設定時は 503 で明示エラー応答（無言で失敗しない・N-4）。
 * - 有効時は各社名を正規化（FR-2）→ 名称検索で解決（FR-3）し、行単位で結果配列を返す。
 * - 行単位部分失敗（FR-8）はサービス層で各行に error を付けて継続する。
 * - CR-3/CR-5: 応答は保存・ログしない。logAccess も呼ばない（インボイス照会専用のため）。
 */

import type { Hono } from 'hono';
import type { ResolveRow } from '../services/resolve.js';

/** 1リクエストで受け付ける社名の上限（サイドバーの50行バッチに対応）。 */
export const RESOLVE_MAX_NAMES_PER_REQUEST = 50;

export interface ResolveRouteDeps {
  /** 法人番号API が利用可能か（HOUJIN_APP_ID 設定済み）。false のとき 503。 */
  readonly houjinConfigured: boolean;
  /** 1リクエストの社名上限（既定 50）。 */
  readonly maxNames?: number;
  /** 社名配列を解決する（正規化・キュー・クライアントは実体側の責務）。 */
  resolve(names: string[], context: { userKey: string }): Promise<ResolveRow[]>;
}

type ParseResult =
  | { readonly ok: true; readonly userKey: string; readonly names: string[] }
  | { readonly ok: false; readonly message: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** リクエストボディ（unknown）を検証・narrowする（型アサーション不使用）。 */
function parseBody(body: unknown, maxNames: number): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'リクエストボディが不正です' };
  }
  const userKey = Reflect.get(body, 'userKey');
  const names = Reflect.get(body, 'names');
  if (typeof userKey !== 'string' || userKey === '') {
    return { ok: false, message: 'userKey は必須です' };
  }
  if (!isStringArray(names)) {
    return { ok: false, message: 'names は文字列配列で指定してください' };
  }
  if (names.length > maxNames) {
    return { ok: false, message: `names は最大 ${maxNames} 件です` };
  }
  return { ok: true, userKey, names };
}

export function registerResolveRoute(app: Hono, deps: ResolveRouteDeps): void {
  const maxNames = deps.maxNames ?? RESOLVE_MAX_NAMES_PER_REQUEST;

  app.post('/resolve', async (c) => {
    // 未設定時は明示的に 503（無言で失敗させない）。
    if (!deps.houjinConfigured) {
      return c.json({ error: 'houjin_not_configured', message: '法人番号照会は現在利用できません' }, 503);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request', message: 'JSON ボディを解析できません' }, 400);
    }

    const parsed = parseBody(raw, maxNames);
    if (!parsed.ok) {
      return c.json({ error: 'invalid_request', message: parsed.message }, 400);
    }

    const results = await deps.resolve(parsed.names, { userKey: parsed.userKey });
    return c.json({ results });
  });
}
