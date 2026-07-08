/**
 * ライセンス関連ルート（FR-10 / R3-2）。
 *
 * - `POST /license/claim`   body `{ sessionId }` → Checkout Session を検証してキー発行（thanks ページが使用）。
 * - `POST /license/recover` body `{ email }`     → 有効な購読を持つ顧客のキーを再表示（「キーを忘れた方」フォーム）。
 *   悪用（email 総当たり）抑制のため **IP 単位の軽いクールダウン（既定60秒）** を掛ける（RATE_RPS とは別）。
 * - `POST /license/verify`  body `{ licenseKey }` → 検証結果 `{ valid, plan, periodEnd }`（GAS の解錠判定）。
 *
 * 上流（Stripe）エラーは握りつぶさず 503 で明示する（無言で失敗しない・N-4）。
 * 存在有無を推測されにくいよう recover の応答文言は最小化する。
 */

import type { Hono } from 'hono';
import type { IssueOutcome, LicenseVerification } from '../services/license.js';

/** recover の既定クールダウン（ミリ秒）＝60秒。 */
export const RECOVER_COOLDOWN_MS = 60 * 1000;

export interface LicenseRouteDeps {
  /** Checkout Session からキー発行（/license/claim）。 */
  claimFromSession(sessionId: string): Promise<IssueOutcome>;
  /** email から有効購読を照合してキー再発行（/license/recover）。 */
  recoverByEmail(email: string): Promise<IssueOutcome>;
  /** ライセンス検証（/license/verify）。 */
  verify(licenseKey: string): Promise<LicenseVerification>;
  /** 現在時刻（ミリ秒。クールダウン用。テストで注入可能。既定 Date.now）。 */
  readonly now?: () => number;
  /** recover のクールダウン（ミリ秒。既定 60秒）。 */
  readonly recoverCooldownMs?: number;
}

/** ボディから指定キーの非空文字列を安全に取り出す（型アサーション不使用）。 */
function readNonEmptyString(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = Reflect.get(body, key);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** リクエストのクライアントIP（x-forwarded-for 先頭）を取り出す。無ければ 'unknown'。 */
function clientIpOf(header: string | undefined): string {
  if (header === undefined || header === '') return 'unknown';
  const first = header.split(',')[0]?.trim();
  return first !== undefined && first !== '' ? first : 'unknown';
}

export function registerLicenseRoutes(app: Hono, deps: LicenseRouteDeps): void {
  const now = deps.now ?? (() => Date.now());
  const cooldownMs = deps.recoverCooldownMs ?? RECOVER_COOLDOWN_MS;
  // IP → 直近に処理を許可した時刻（ミリ秒）。連投抑制のためだけの軽量状態。
  const lastAllowedAt = new Map<string, number>();

  app.post('/license/claim', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request', message: 'JSON ボディを解析できません' }, 400);
    }
    const sessionId = readNonEmptyString(raw, 'sessionId');
    if (sessionId === undefined) {
      return c.json({ error: 'invalid_request', message: 'sessionId は必須です' }, 400);
    }

    let outcome: IssueOutcome;
    try {
      outcome = await deps.claimFromSession(sessionId);
    } catch {
      // 上流（Stripe）エラー。詳細はログ・応答に出さない（§9）。
      return c.json({ error: 'upstream_error', message: '決済情報の確認に失敗しました' }, 503);
    }

    if (!outcome.ok) {
      if (outcome.reason === 'unpaid') {
        return c.json({ error: 'unpaid', message: 'お支払いが確認できませんでした' }, 402);
      }
      return c.json({ error: 'not_found', message: '注文が見つかりませんでした' }, 404);
    }
    return c.json({ licenseKey: outcome.licenseKey });
  });

  app.post('/license/recover', async (c) => {
    const ip = clientIpOf(c.req.header('x-forwarded-for'));
    const last = lastAllowedAt.get(ip);
    if (last !== undefined && now() - last < cooldownMs) {
      return c.json(
        { error: 'too_many_requests', message: '短時間に連続で試行されています。しばらく待って再度お試しください' },
        429,
      );
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request', message: 'JSON ボディを解析できません' }, 400);
    }
    const email = readNonEmptyString(raw, 'email');
    if (email === undefined) {
      return c.json({ error: 'invalid_request', message: 'メールアドレスは必須です' }, 400);
    }

    // 実処理に入る時点でクールダウンを記録する（1IP あたり cooldownMs に1回）。
    lastAllowedAt.set(ip, now());

    let outcome: IssueOutcome;
    try {
      outcome = await deps.recoverByEmail(email);
    } catch {
      return c.json({ error: 'upstream_error', message: '照合に失敗しました' }, 503);
    }

    if (!outcome.ok) {
      // 存在有無を推測されにくいよう一律の文言で 404 を返す。
      return c.json(
        { error: 'not_found', message: '有効なライセンスが見つかりませんでした' },
        404,
      );
    }
    return c.json({ licenseKey: outcome.licenseKey });
  });

  app.post('/license/verify', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request', message: 'JSON ボディを解析できません' }, 400);
    }
    const licenseKey = readNonEmptyString(raw, 'licenseKey');
    if (licenseKey === undefined) {
      return c.json({ error: 'invalid_request', message: 'licenseKey は必須です' }, 400);
    }

    let verification: LicenseVerification;
    try {
      verification = await deps.verify(licenseKey);
    } catch {
      return c.json({ error: 'upstream_error', message: 'ライセンス確認に失敗しました' }, 503);
    }
    return c.json(verification);
  });
}
