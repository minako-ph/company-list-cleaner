/**
 * ライセンスキー（JWT）発行・検証サービス（FR-10 / R3-2 / F3-3）。
 *
 * 設計（引継書 §7.3 の見直し・decisions.md 参照）:
 * - ライセンスキーは **Ed25519（EdDSA）署名の JWT**。`sub` に Stripe 顧客ID を入れる。
 *   iss/aud は固定・exp は長め（2年）。**キー全体を DB に保存しない**——検証は「署名 ＋ Stripe 購読照会」で
 *   成立するため、`key_id⇄customer_id` の対応表は不要（本Stepでは何も保存しない）。
 * - 秘密鍵 PEM（PKCS8）を `LICENSE_SIGNING_KEY` から受け取り、対になる公開鍵は秘密鍵から導出する
 *   （backend 側の検証用）。GAS 側は Script Properties `LICENSE_PUBKEY`（openssl 導出。README 参照）で検証する。
 * - 検証は購読状態を照合する。`active`/`trialing` は有効。**`cancel_at_period_end=true` でも
 *   `current_period_end` が未来なら有効（F3-3。特商法「解約後も当該課金期間の満了まで Pro 機能を利用できます」と一致）**。
 * - 検証結果は **短TTL（5分）のメモリキャッシュ**に載せる（Stripe 照会の連打を避ける）。
 *
 * 絶対制約: 署名鍵・Stripe キーをログ・エラーへ出さない。公表情報を保存しない（本Stepは何も保存しない）。
 */

import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { StripeGateway, SubscriptionInfo } from './stripeGateway.js';

/** JWT の発行者（固定）。 */
export const LICENSE_ISSUER = 'company-list-cleaner';
/** JWT の受信者（固定）。 */
export const LICENSE_AUDIENCE = 'company-list-cleaner-license';
/** 署名アルゴリズム（Ed25519）。 */
const LICENSE_ALG = 'EdDSA';
/** ライセンスキーの有効期限（2年）。 */
const LICENSE_EXPIRATION = '730d';
/** 契約プラン（有料は 'pro' のみ）。 */
const LICENSE_PLAN = 'pro' as const;

/** 検証結果のメモリキャッシュ TTL（ミリ秒）＝5分。 */
export const VERIFY_CACHE_TTL_MS = 5 * 60 * 1000;

/** ライセンス検証結果（/license/verify・使用量プラン判定が使用）。 */
export interface LicenseVerification {
  /** 有効なライセンスか。 */
  readonly valid: boolean;
  /** 有効時のプラン（'pro'）。無効時は省略。 */
  readonly plan?: typeof LICENSE_PLAN;
  /** 有効時の課金期間末（Unix 秒）。無効時は省略。 */
  readonly periodEnd?: number;
}

/** claim / recover の結果。 */
export type IssueOutcome =
  | { readonly ok: true; readonly licenseKey: string }
  | { readonly ok: false; readonly reason: 'not_found' | 'unpaid' };

export interface LicenseService {
  /** 顧客IDから署名付きライセンスキー（JWT）を発行する。 */
  issueLicenseKey(customerId: string): Promise<string>;
  /** ライセンスキーを検証する（署名・exp・購読状態。結果は短TTLでキャッシュ）。 */
  verifyLicenseKey(key: string): Promise<LicenseVerification>;
  /** Checkout Session（session_id）から支払いを確認してキーを発行する（/license/claim）。 */
  claimFromSession(sessionId: string): Promise<IssueOutcome>;
  /** email から有効な購読を持つ顧客を照合してキーを再発行する（/license/recover）。 */
  recoverByEmail(email: string): Promise<IssueOutcome>;
}

export interface LicenseServiceDeps {
  /** 秘密鍵 PEM（PKCS8。`LICENSE_SIGNING_KEY`）。 */
  readonly signingKeyPem: string;
  /** Stripe ゲートウェイ（購読照会・Session 取得・顧客検索）。 */
  readonly gateway: StripeGateway;
  /** 現在時刻の供給（テストで固定するため注入可能。既定は実時計）。 */
  readonly now?: () => Date;
  /** 検証キャッシュ TTL（ミリ秒。既定 5分）。 */
  readonly cacheTtlMs?: number;
}

interface CacheEntry {
  readonly result: LicenseVerification;
  readonly expiresAt: number;
}

/**
 * 購読が「現時点で有効」か判定する（純関数）。
 * - `active` / `trialing` は有効。
 * - **F3-3**: それ以外の状態でも `cancel_at_period_end=true` かつ `current_period_end` が未来なら有効
 *   （解約予約済みでも当該課金期間の満了までは Pro を利用できる、という特商法表記との一致）。
 *
 * @param nowSec 現在時刻（Unix 秒）。境界（ちょうど）は「未来ではない」＝無効側に倒す（`>` 判定）。
 */
export function isSubscriptionValid(sub: SubscriptionInfo, nowSec: number): boolean {
  if (sub.status === 'active' || sub.status === 'trialing') return true;
  if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd > nowSec) return true;
  return false;
}

export function createLicenseService(deps: LicenseServiceDeps): LicenseService {
  // 秘密鍵は生成時に一度だけ読み込み、検証用の公開鍵を導出する（秘密鍵はログへ出さない）。
  const privateKey: KeyObject = createPrivateKey(deps.signingKeyPem);
  const publicKey: KeyObject = createPublicKey(privateKey);
  const now = deps.now ?? (() => new Date());
  const cacheTtlMs = deps.cacheTtlMs ?? VERIFY_CACHE_TTL_MS;
  const cache = new Map<string, CacheEntry>();

  async function issueLicenseKey(customerId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: LICENSE_ALG })
      .setSubject(customerId)
      .setIssuer(LICENSE_ISSUER)
      .setAudience(LICENSE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(LICENSE_EXPIRATION)
      .sign(privateKey);
  }

  /** 顧客IDの購読から検証結果を組み立てる（有効な購読があれば periodEnd は最遠の期間末）。 */
  async function verifyByCustomerId(customerId: string): Promise<LicenseVerification> {
    const nowSec = Math.floor(now().getTime() / 1000);
    const subs = await deps.gateway.listSubscriptions(customerId);
    const validEnds = subs
      .filter((sub) => isSubscriptionValid(sub, nowSec))
      .map((sub) => sub.currentPeriodEnd);
    if (validEnds.length === 0) return { valid: false };
    return { valid: true, plan: LICENSE_PLAN, periodEnd: Math.max(...validEnds) };
  }

  async function verifyLicenseKey(key: string): Promise<LicenseVerification> {
    const cached = cache.get(key);
    if (cached !== undefined && cached.expiresAt > now().getTime()) {
      return cached.result;
    }

    // 署名・exp・iss・aud の検証。失敗（改竄・期限切れ・不正 iss/aud）は無効として扱う。
    let customerId: string | undefined;
    try {
      const { payload } = await jwtVerify(key, publicKey, {
        issuer: LICENSE_ISSUER,
        audience: LICENSE_AUDIENCE,
      });
      customerId = payload.sub;
    } catch {
      // 署名検証系の失敗のみここに来る（Stripe 照会エラーは下の try 外＝伝播させる）。
      const result: LicenseVerification = { valid: false };
      cache.set(key, { result, expiresAt: now().getTime() + cacheTtlMs });
      return result;
    }

    if (customerId === undefined || customerId === '') {
      const result: LicenseVerification = { valid: false };
      cache.set(key, { result, expiresAt: now().getTime() + cacheTtlMs });
      return result;
    }

    // Stripe 照会の失敗はここで握りつぶさず伝播させる（C1。呼び出し元が 503 等へ写像）。
    const result = await verifyByCustomerId(customerId);
    cache.set(key, { result, expiresAt: now().getTime() + cacheTtlMs });
    return result;
  }

  async function claimFromSession(sessionId: string): Promise<IssueOutcome> {
    const session = await deps.gateway.retrieveCheckoutSession(sessionId);
    if (session === undefined || session.customerId === undefined) {
      return { ok: false, reason: 'not_found' };
    }
    if (session.paymentStatus !== 'paid') {
      return { ok: false, reason: 'unpaid' };
    }
    // 何度呼んでも同じ sub のキーを発行できる＝再表示可能・冪等（保存はしない）。
    const licenseKey = await issueLicenseKey(session.customerId);
    return { ok: true, licenseKey };
  }

  async function recoverByEmail(email: string): Promise<IssueOutcome> {
    const nowSec = Math.floor(now().getTime() / 1000);
    const customerIds = await deps.gateway.findCustomerIdsByEmail(email);
    for (const customerId of customerIds) {
      const subs = await deps.gateway.listSubscriptions(customerId);
      // 有効な購読を持つ顧客のみキーを再発行する（存在有無の応答差を最小化）。
      if (subs.some((sub) => isSubscriptionValid(sub, nowSec))) {
        const licenseKey = await issueLicenseKey(customerId);
        return { ok: true, licenseKey };
      }
    }
    return { ok: false, reason: 'not_found' };
  }

  return { issueLicenseKey, verifyLicenseKey, claimFromSession, recoverByEmail };
}
