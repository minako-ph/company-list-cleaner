/**
 * POST /stripe/webhook（FR-10）。
 *
 * - **署名検証必須**: `stripe-signature` ヘッダと生ボディ（raw body）を `STRIPE_WEBHOOK_SECRET` で検証する。
 *   Hono では `c.req.text()` で生ボディを取得する（JSON パース前の生文字列が署名検証に必要）。
 * - 署名不正・秘密不一致・改竄は **400**。
 * - `checkout.session.completed` のみ処理対象だが、**処理内容は検証のみ**（キーは claim 時に発行するため
 *   保存処理を行わない＝冪等。何も永続化しない＝CR-3 と両立）。他イベントは 200 で無視する。
 * - `STRIPE_WEBHOOK_SECRET` 未設定時は 503 で明示（無言で受理しない）。
 */

import type { Hono } from 'hono';
import type { WebhookEvent } from '../services/stripeGateway.js';

export interface StripeWebhookRouteDeps {
  /** Webhook 署名シークレット（未設定＝空なら 503）。 */
  readonly webhookSecret: string;
  /** 署名検証してイベント種別を返す（不正時は throw）。 */
  constructEvent(rawBody: string, signature: string, secret: string): WebhookEvent;
}

export function registerStripeWebhookRoute(app: Hono, deps: StripeWebhookRouteDeps): void {
  app.post('/stripe/webhook', async (c) => {
    if (deps.webhookSecret === '') {
      return c.json({ error: 'not_configured', message: 'webhook は現在利用できません' }, 503);
    }

    const signature = c.req.header('stripe-signature');
    if (signature === undefined || signature === '') {
      return c.json({ error: 'invalid_signature', message: '署名がありません' }, 400);
    }

    // 生ボディ（署名対象）を取得する。パース済みボディでは署名検証が通らない。
    const rawBody = await c.req.text();

    let event: WebhookEvent;
    try {
      event = deps.constructEvent(rawBody, signature, deps.webhookSecret);
    } catch {
      // 署名不正・改竄など。詳細は応答・ログに出さない（§9）。
      return c.json({ error: 'invalid_signature', message: '署名検証に失敗しました' }, 400);
    }

    // checkout.session.completed のみ処理対象。処理内容は検証のみ（保存なし・冪等）。
    // 他イベントは 200 で無視する（Stripe の再送を招かないため 2xx を返す）。
    if (event.type === 'checkout.session.completed') {
      return c.json({ received: true, handled: true });
    }
    return c.json({ received: true, handled: false });
  });
}
