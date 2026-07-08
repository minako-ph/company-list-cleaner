/**
 * Stripe への問い合わせを抽象化するゲートウェイ（FR-10 / R3-2）。
 *
 * 目的:
 * - ライセンスサービス・ルートが Stripe SDK の巨大な型に直接依存しないよう、
 *   必要な操作だけを最小のドメイン型（`CheckoutSessionInfo`・`SubscriptionInfo`・`WebhookEvent`）で公開する。
 * - テストは `StripeGateway` のフェイクを注入する（実 Stripe・実ネットワークは叩かない＝絶対制約）。
 *
 * 実 Stripe SDK の**値** import は本ファイルにだけ置く（services/firestore.ts と同じ隔離方針）。
 * これにより license.ts / routes は SDK を読み込まずに単体テストできる。
 */

import Stripe from 'stripe';

/** Checkout Session の要点（`/license/claim` が支払い確認と顧客特定に使う）。 */
export interface CheckoutSessionInfo {
  /** 'paid' | 'unpaid' | 'no_payment_required'。paid のみキー発行対象。 */
  readonly paymentStatus: string;
  /** 紐づく Stripe 顧客ID（未確定なら undefined）。 */
  readonly customerId: string | undefined;
}

/** 購読の要点（購読状態の照合に使う。SDK 型に依存しないドメイン表現）。 */
export interface SubscriptionInfo {
  /** 'active' | 'trialing' | 'canceled' | 'past_due' 等。 */
  readonly status: string;
  /** 期間末に解約予約されているか（F3-3 の判定に使う）。 */
  readonly cancelAtPeriodEnd: boolean;
  /** 現在の課金期間の終了時刻（Unix 秒）。items が無ければ 0（＝過去扱い）。 */
  readonly currentPeriodEnd: number;
}

/** Webhook イベントの要点（署名検証済みのイベント種別のみ公開）。 */
export interface WebhookEvent {
  /** 例: 'checkout.session.completed'。 */
  readonly type: string;
}

/**
 * Stripe への必要最小限の操作。実装は本番用（createStripeGateway）とテスト用フェイクの2つ。
 * ネットワーク I/O を伴うメソッドの失敗は例外として呼び出し元へ伝播する（握りつぶさない＝C1）。
 */
export interface StripeGateway {
  /** Checkout Session を取得する。存在しなければ undefined。 */
  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo | undefined>;
  /** 顧客の全購読（status=all）を返す。 */
  listSubscriptions(customerId: string): Promise<SubscriptionInfo[]>;
  /** email に一致する顧客IDの一覧を返す（再表示フロー用）。 */
  findCustomerIdsByEmail(email: string): Promise<string[]>;
  /**
   * Webhook 署名を検証し、イベント種別を返す。
   * 署名不正・秘密不一致・改竄時は例外を投げる（呼び出し元が 400 に写像する）。
   */
  constructWebhookEvent(rawBody: string, signature: string, secret: string): WebhookEvent;
}

/** Checkout Session の customer フィールド（string | オブジェクト | null）から顧客IDを取り出す。 */
function customerIdOf(customer: string | { readonly id: string } | null): string | undefined {
  if (customer === null) return undefined;
  if (typeof customer === 'string') return customer;
  return customer.id;
}

/** 購読の items から現在期間末（Unix 秒）を求める。複数 item は最大値を採る。 */
function periodEndOf(subscription: Stripe.Subscription): number {
  let max = 0;
  for (const item of subscription.items.data) {
    const end = item.current_period_end;
    if (typeof end === 'number' && end > max) max = end;
  }
  return max;
}

/**
 * 本番用 StripeGateway を生成する。
 * `secretKey` は Secret Manager 由来（§9。コード・ログに埋めない）。
 */
export function createStripeGateway(secretKey: string): StripeGateway {
  const stripe = new Stripe(secretKey);

  return {
    async retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo | undefined> {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return {
        paymentStatus: session.payment_status,
        customerId: customerIdOf(session.customer),
      };
    },

    async listSubscriptions(customerId: string): Promise<SubscriptionInfo[]> {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
      });
      return list.data.map((sub) => ({
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: periodEndOf(sub),
      }));
    },

    async findCustomerIdsByEmail(email: string): Promise<string[]> {
      const list = await stripe.customers.list({ email, limit: 100 });
      return list.data.map((customer) => customer.id);
    },

    constructWebhookEvent(rawBody: string, signature: string, secret: string): WebhookEvent {
      const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
      return { type: event.type };
    },
  };
}
