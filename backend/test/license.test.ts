import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  LICENSE_AUDIENCE,
  LICENSE_ISSUER,
  createLicenseService,
  isSubscriptionValid,
} from '../src/services/license.js';
import type {
  CheckoutSessionInfo,
  StripeGateway,
  SubscriptionInfo,
  WebhookEvent,
} from '../src/services/stripeGateway.js';

/**
 * ライセンス発行・検証（FR-10 / F3-3）のユニットテスト。
 * - 実 Stripe・実ネットワークは使わず、StripeGateway のフェイクを注入する（絶対制約）。
 * - 鍵ペアはテスト内で Ed25519 を生成し、PEM をサービスへ渡す。
 */

/** テスト用に Ed25519 鍵ペアを生成し、秘密鍵 PEM を返す。 */
function generateSigningKeyPem(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return typeof pem === 'string' ? pem : pem.toString('utf8');
}

/** 別鍵ペアの秘密鍵（署名不正テスト用）。 */
function generateOtherPrivateKey(): KeyObject {
  return generateKeyPairSync('ed25519').privateKey;
}

interface FakeGateway {
  readonly gateway: StripeGateway;
  listCallCount(): number;
}

/** subs: customerId→購読配列、sessions: id→session、byEmail: email→customerId[] を返すフェイク。 */
function makeFakeGateway(opts: {
  subs?: Record<string, SubscriptionInfo[]>;
  sessions?: Record<string, CheckoutSessionInfo | undefined>;
  byEmail?: Record<string, string[]>;
}): FakeGateway {
  let listCalls = 0;
  const gateway: StripeGateway = {
    retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo | undefined> {
      return Promise.resolve(opts.sessions?.[sessionId]);
    },
    listSubscriptions(customerId: string): Promise<SubscriptionInfo[]> {
      listCalls += 1;
      return Promise.resolve(opts.subs?.[customerId] ?? []);
    },
    findCustomerIdsByEmail(email: string): Promise<string[]> {
      return Promise.resolve(opts.byEmail?.[email] ?? []);
    },
    constructWebhookEvent(): WebhookEvent {
      throw new Error('constructWebhookEvent は本テストで使用しない');
    },
  };
  return { gateway, listCallCount: () => listCalls };
}

/** 固定オフセット付きの現在時刻供給。setNow で進められる。 */
function makeClock(startIso: string) {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (deltaMs: number) => (ms += deltaMs) };
}

function sub(partial: Partial<SubscriptionInfo>): SubscriptionInfo {
  return {
    status: partial.status ?? 'active',
    cancelAtPeriodEnd: partial.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: partial.currentPeriodEnd ?? 0,
  };
}

describe('isSubscriptionValid（F3-3 を含む純関数）', () => {
  const nowSec = 1_700_000_000;

  it('active は valid', () => {
    expect(isSubscriptionValid(sub({ status: 'active' }), nowSec)).toBe(true);
  });

  it('trialing は valid', () => {
    expect(isSubscriptionValid(sub({ status: 'trialing' }), nowSec)).toBe(true);
  });

  it('canceled（cancel_at_period_end=false）は invalid', () => {
    expect(isSubscriptionValid(sub({ status: 'canceled' }), nowSec)).toBe(false);
  });

  it('F3-3: cancel_at_period_end=true かつ current_period_end が未来なら（状態が非activeでも）valid', () => {
    const s = sub({ status: 'canceled', cancelAtPeriodEnd: true, currentPeriodEnd: nowSec + 86400 });
    expect(isSubscriptionValid(s, nowSec)).toBe(true);
  });

  it('F3-3: cancel_at_period_end=true でも current_period_end が過去なら invalid', () => {
    const s = sub({ status: 'canceled', cancelAtPeriodEnd: true, currentPeriodEnd: nowSec - 86400 });
    expect(isSubscriptionValid(s, nowSec)).toBe(false);
  });

  it('境界: current_period_end がちょうど現在時刻なら（未来ではない）invalid', () => {
    const s = sub({ status: 'canceled', cancelAtPeriodEnd: true, currentPeriodEnd: nowSec });
    expect(isSubscriptionValid(s, nowSec)).toBe(false);
  });
});

describe('createLicenseService.issue/verify', () => {
  it('発行したキーは verify で valid・plan=pro・periodEnd を返す（active 購読）', async () => {
    const clock = makeClock('2026-07-08T00:00:00Z');
    const periodEnd = Math.floor(clock.now().getTime() / 1000) + 30 * 86400;
    const fake = makeFakeGateway({ subs: { cus_1: [sub({ status: 'active', currentPeriodEnd: periodEnd })] } });
    const service = createLicenseService({
      signingKeyPem: generateSigningKeyPem(),
      gateway: fake.gateway,
      now: clock.now,
    });

    const key = await service.issueLicenseKey('cus_1');
    const result = await service.verifyLicenseKey(key);

    expect(result).toEqual({ valid: true, plan: 'pro', periodEnd });
  });

  it('購読が canceled（期間切れ）なら invalid', async () => {
    const clock = makeClock('2026-07-08T00:00:00Z');
    const past = Math.floor(clock.now().getTime() / 1000) - 86400;
    const fake = makeFakeGateway({ subs: { cus_1: [sub({ status: 'canceled', currentPeriodEnd: past })] } });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway, now: clock.now });

    const key = await service.issueLicenseKey('cus_1');
    expect(await service.verifyLicenseKey(key)).toEqual({ valid: false });
  });

  it('F3-3: cancel_at_period_end=true＋期間内の購読は valid（解約予約済みでも期間末まで）', async () => {
    const clock = makeClock('2026-07-08T00:00:00Z');
    const periodEnd = Math.floor(clock.now().getTime() / 1000) + 10 * 86400;
    const fake = makeFakeGateway({
      subs: { cus_1: [sub({ status: 'canceled', cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd })] },
    });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway, now: clock.now });

    const key = await service.issueLicenseKey('cus_1');
    expect(await service.verifyLicenseKey(key)).toEqual({ valid: true, plan: 'pro', periodEnd });
  });

  it('購読が無い顧客は invalid', async () => {
    const clock = makeClock('2026-07-08T00:00:00Z');
    const fake = makeFakeGateway({ subs: {} });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway, now: clock.now });
    const key = await service.issueLicenseKey('cus_none');
    expect(await service.verifyLicenseKey(key)).toEqual({ valid: false });
  });

  it('exp 切れのキーは invalid（Stripe 照会に到達しない）', async () => {
    const pem = generateSigningKeyPem();
    const fake = makeFakeGateway({ subs: { cus_1: [sub({ status: 'active' })] } });
    const service = createLicenseService({ signingKeyPem: pem, gateway: fake.gateway });

    // pem に対応する秘密鍵で、exp を過去に設定した JWT を手組みする。
    const { createPrivateKey } = await import('node:crypto');
    const signer = createPrivateKey(pem);
    const expiredJwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject('cus_1')
      .setIssuer(LICENSE_ISSUER)
      .setAudience(LICENSE_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(signer);

    expect(await service.verifyLicenseKey(expiredJwt)).toEqual({ valid: false });
    expect(fake.listCallCount()).toBe(0);
  });

  it('署名が別鍵のキーは invalid（Stripe 照会に到達しない）', async () => {
    const fake = makeFakeGateway({ subs: { cus_1: [sub({ status: 'active' })] } });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway });

    const otherKey = generateOtherPrivateKey();
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject('cus_1')
      .setIssuer(LICENSE_ISSUER)
      .setAudience(LICENSE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('730d')
      .sign(otherKey);

    expect(await service.verifyLicenseKey(forged)).toEqual({ valid: false });
    expect(fake.listCallCount()).toBe(0);
  });

  it('改竄されたキー（末尾破壊）は invalid', async () => {
    const fake = makeFakeGateway({ subs: { cus_1: [sub({ status: 'active' })] } });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway });
    const key = await service.issueLicenseKey('cus_1');
    const tampered = `${key.slice(0, -2)}xx`;
    expect(await service.verifyLicenseKey(tampered)).toEqual({ valid: false });
  });

  it('キャッシュヒット: 同一キーの2回目は Stripe 照会を行わない（TTL 内）', async () => {
    const clock = makeClock('2026-07-08T00:00:00Z');
    const periodEnd = Math.floor(clock.now().getTime() / 1000) + 30 * 86400;
    const fake = makeFakeGateway({ subs: { cus_1: [sub({ status: 'active', currentPeriodEnd: periodEnd })] } });
    const service = createLicenseService({
      signingKeyPem: generateSigningKeyPem(),
      gateway: fake.gateway,
      now: clock.now,
      cacheTtlMs: 5 * 60 * 1000,
    });
    const key = await service.issueLicenseKey('cus_1');

    await service.verifyLicenseKey(key);
    await service.verifyLicenseKey(key);
    expect(fake.listCallCount()).toBe(1); // 2回目はキャッシュ

    // TTL 経過後は再照会する。
    clock.advance(5 * 60 * 1000 + 1);
    await service.verifyLicenseKey(key);
    expect(fake.listCallCount()).toBe(2);
  });
});

describe('createLicenseService.claimFromSession', () => {
  it('paid の Session は該当顧客のキーを発行する（冪等: 何度でも同 sub）', async () => {
    const clock = makeClock('2026-07-08T00:00:00Z');
    const fake = makeFakeGateway({
      sessions: { sess_1: { paymentStatus: 'paid', customerId: 'cus_1' } },
      subs: { cus_1: [sub({ status: 'active', currentPeriodEnd: Math.floor(clock.now().getTime() / 1000) + 86400 })] },
    });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway, now: clock.now });

    const first = await service.claimFromSession('sess_1');
    const second = await service.claimFromSession('sess_1');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      // 両キーとも同じ顧客で valid（byte 一致は要求しない＝冪等の意味は「同 sub で解錠可能」）。
      expect(await service.verifyLicenseKey(first.licenseKey)).toMatchObject({ valid: true, plan: 'pro' });
      expect(await service.verifyLicenseKey(second.licenseKey)).toMatchObject({ valid: true, plan: 'pro' });
    }
  });

  it('未払い（payment_status!=paid）の Session は unpaid で拒否', async () => {
    const fake = makeFakeGateway({ sessions: { sess_2: { paymentStatus: 'unpaid', customerId: 'cus_2' } } });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway });
    expect(await service.claimFromSession('sess_2')).toEqual({ ok: false, reason: 'unpaid' });
  });

  it('存在しない Session は not_found', async () => {
    const fake = makeFakeGateway({ sessions: {} });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway });
    expect(await service.claimFromSession('nope')).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('createLicenseService.recoverByEmail', () => {
  it('有効な購読を持つ顧客のみキー再発行する', async () => {
    const clock = makeClock('2026-07-08T00:00:00Z');
    const future = Math.floor(clock.now().getTime() / 1000) + 86400;
    const fake = makeFakeGateway({
      byEmail: { 'ok@example.com': ['cus_ok'] },
      subs: { cus_ok: [sub({ status: 'active', currentPeriodEnd: future })] },
    });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway, now: clock.now });

    const outcome = await service.recoverByEmail('ok@example.com');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(await service.verifyLicenseKey(outcome.licenseKey)).toMatchObject({ valid: true, plan: 'pro' });
    }
  });

  it('顧客はいるが有効購読が無い場合は not_found', async () => {
    const clock = makeClock('2026-07-08T00:00:00Z');
    const past = Math.floor(clock.now().getTime() / 1000) - 86400;
    const fake = makeFakeGateway({
      byEmail: { 'gone@example.com': ['cus_gone'] },
      subs: { cus_gone: [sub({ status: 'canceled', currentPeriodEnd: past })] },
    });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway, now: clock.now });
    expect(await service.recoverByEmail('gone@example.com')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('該当顧客なしは not_found', async () => {
    const fake = makeFakeGateway({ byEmail: {} });
    const service = createLicenseService({ signingKeyPem: generateSigningKeyPem(), gateway: fake.gateway });
    expect(await service.recoverByEmail('unknown@example.com')).toEqual({ ok: false, reason: 'not_found' });
  });
});
