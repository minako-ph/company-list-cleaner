import { describe, expect, it, vi } from 'vitest';
import { createApiHealthTracker, type PostWebhook } from '../src/services/apiHealth.js';

/** マイクロ/マクロタスクを流し切り、fire-and-forget の通知送信を確定させる。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 制御可能な時計と、通知本文を捕捉する postWebhook を組み立てる。 */
function harness(overrides: {
  webhookUrl?: string;
  threshold?: number;
  cooldownMs?: number;
  postWebhook?: PostWebhook;
} = {}) {
  let clock = 0;
  const sent: { text: string }[] = [];
  const errors: string[] = [];
  const postWebhook: PostWebhook =
    overrides.postWebhook ??
    (async (_url, payload) => {
      sent.push(payload);
    });
  const tracker = createApiHealthTracker({
    webhookUrl: overrides.webhookUrl ?? 'https://hook.example/webhook',
    threshold: overrides.threshold ?? 3,
    cooldownMs: overrides.cooldownMs ?? 30 * 60 * 1000,
    now: () => clock,
    postWebhook,
    logError: (m) => errors.push(m),
  });
  return {
    tracker,
    sent,
    errors,
    setClock: (v: number) => {
      clock = v;
    },
  };
}

describe('ApiHealthTracker: 連続失敗の通知', () => {
  it('閾値到達で1回だけ通知し、以降の失敗では再通知しない', async () => {
    const h = harness({ threshold: 3 });
    h.tracker.recordFailure('houjin');
    h.tracker.recordFailure('houjin');
    await flush();
    expect(h.sent).toHaveLength(0); // 閾値未満は通知しない。

    h.tracker.recordFailure('houjin'); // 3回目＝閾値到達。
    await flush();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.text).toContain('法人番号API');
    expect(h.sent[0]?.text).toContain('連続3回失敗');

    h.tracker.recordFailure('houjin');
    h.tracker.recordFailure('houjin');
    await flush();
    expect(h.sent).toHaveLength(1); // 回復まで再通知しない。
  });

  it('回復（成功）で1回だけ回復通知を出し、状態をリセットする', async () => {
    const h = harness({ threshold: 3 });
    for (let i = 0; i < 3; i++) h.tracker.recordFailure('gbizinfo');
    await flush();
    expect(h.sent).toHaveLength(1);

    h.tracker.recordSuccess('gbizinfo');
    await flush();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]?.text).toContain('gBizINFO');
    expect(h.sent[1]?.text).toContain('回復');

    // 追加の成功では回復通知を重複させない。
    h.tracker.recordSuccess('gbizinfo');
    await flush();
    expect(h.sent).toHaveLength(2);
  });

  it('失敗通知なしに成功しても回復通知は出ない', async () => {
    const h = harness({ threshold: 3 });
    h.tracker.recordFailure('houjin'); // 閾値未満。
    h.tracker.recordSuccess('houjin');
    await flush();
    expect(h.sent).toHaveLength(0);
  });

  it('クールダウン中は再失敗通知を抑制し、経過後に通知する', async () => {
    const cooldownMs = 30 * 60 * 1000;
    const h = harness({ threshold: 3, cooldownMs });

    // 1回目の失敗通知（clock=0）。
    for (let i = 0; i < 3; i++) h.tracker.recordFailure('invoice');
    await flush();
    expect(h.sent).toHaveLength(1);

    // 回復（clock=1000）。
    h.setClock(1000);
    h.tracker.recordSuccess('invoice');
    await flush();
    expect(h.sent).toHaveLength(2); // 回復通知。

    // クールダウン内で再度閾値到達（clock=2000）→ 抑制。
    h.setClock(2000);
    for (let i = 0; i < 3; i++) h.tracker.recordFailure('invoice');
    await flush();
    expect(h.sent).toHaveLength(2); // 増えない。

    // クールダウン経過後の失敗 → 通知される。
    h.setClock(cooldownMs + 1);
    h.tracker.recordFailure('invoice');
    await flush();
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]?.text).toContain('インボイスAPI');
  });

  it('Webhook 送信が失敗してもアプリに波及しない（握りつぶし＋logError）', async () => {
    const failing: PostWebhook = () => Promise.reject(new Error('network down'));
    const h = harness({ threshold: 3, postWebhook: failing });

    // record 系は同期 void。throw しないことを確認。
    expect(() => {
      for (let i = 0; i < 3; i++) h.tracker.recordFailure('houjin');
    }).not.toThrow();
    await flush();

    // 送信失敗は logError に落ちる（応答内容は載せない）。
    expect(h.errors.some((m) => m.includes('アラート通知の送信に失敗しました'))).toBe(true);
    // 送信失敗後も状態は degraded として観測でき、後続処理に影響しない。
    expect(h.tracker.getStatus().houjin).toBe('degraded');
  });

  it('通知本文に登録番号・社名・応答内容を含めない（ソース名・回数・時刻のみ）', async () => {
    const h = harness({ threshold: 3 });
    for (let i = 0; i < 3; i++) h.tracker.recordFailure('invoice');
    await flush();
    const text = h.sent[0]?.text ?? '';
    // 含めてよい: ソース名・回数・時刻。
    expect(text).toContain('インボイスAPI');
    expect(text).toContain('連続3回失敗');
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO 時刻。
    // 含めてはいけない: 登録番号形式・社名・応答フィールド。
    expect(text).not.toMatch(/T\d{13}/);
    expect(text).not.toContain('株式会社');
    for (const forbidden of ['registrationNumber', 'registered', 'found', 'address', 'body']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('Webhook 未設定なら console.error のみ（送信しない）', async () => {
    const errors: string[] = [];
    const posted: unknown[] = [];
    const tracker = createApiHealthTracker({
      webhookUrl: '',
      threshold: 3,
      now: () => 0,
      postWebhook: async () => {
        posted.push(1);
      },
      logError: (m) => errors.push(m),
    });
    for (let i = 0; i < 3; i++) tracker.recordFailure('houjin');
    await flush();
    expect(posted).toHaveLength(0); // Webhook は叩かない。
    expect(errors.some((m) => m.includes('法人番号API') && m.includes('連続3回失敗'))).toBe(true);
  });
});

describe('ApiHealthTracker: getStatus', () => {
  it('初期は全て ok、閾値到達で degraded、回復で ok に戻る', () => {
    const h = harness({ threshold: 3 });
    expect(h.tracker.getStatus()).toEqual({ houjin: 'ok', gbizinfo: 'ok', invoice: 'ok' });

    for (let i = 0; i < 3; i++) h.tracker.recordFailure('gbizinfo');
    expect(h.tracker.getStatus()).toEqual({ houjin: 'ok', gbizinfo: 'degraded', invoice: 'ok' });

    h.tracker.recordSuccess('gbizinfo');
    expect(h.tracker.getStatus()).toEqual({ houjin: 'ok', gbizinfo: 'ok', invoice: 'ok' });
  });

  it('閾値未満の失敗では degraded にならない', () => {
    const h = harness({ threshold: 3 });
    h.tracker.recordFailure('houjin');
    h.tracker.recordFailure('houjin');
    expect(h.tracker.getStatus().houjin).toBe('ok');
  });
});
