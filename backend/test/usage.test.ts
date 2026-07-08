import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerUsageRoute } from '../src/routes/usage.js';
import { InMemoryQuotaStore, createQuotaService } from '../src/services/quota.js';

/**
 * /usage・/usage/consume（FR-9）のルートテスト。
 * - 実 QuotaService + InMemoryQuotaStore の結合（実 Firestore・実ネットワークは使わない）。
 * - バリデーション: userKey 必須、rows は 1〜50 の整数（0/51/非整数/負/欠落は 400）。
 */

const LIMIT = 50;

/** InMemory ストアで配線した /usage アプリを作る。 */
function makeApp() {
  const store = new InMemoryQuotaStore();
  const service = createQuotaService({ store, limit: LIMIT });
  const app = new Hono();
  registerUsageRoute(app, {
    getUsage: (userKey) => service.getUsage(userKey),
    consume: (userKey, rows) => service.consume(userKey, rows),
  });
  return app;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /usage', () => {
  it('userKey 指定で当月使用量の形状を返す（200）', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'));
    const app = makeApp();
    const res = await app.request('/usage?userKey=u1');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual({
      month: '2026-07',
      rowsUsed: 0,
      limit: 50,
      remaining: 50,
      plan: 'free',
    });
  });

  it('userKey 欠落は 400', async () => {
    const res = await makeApp().request('/usage');
    expect(res.status).toBe(400);
  });

  it('userKey が空文字は 400', async () => {
    const res = await makeApp().request('/usage?userKey=');
    expect(res.status).toBe(400);
  });
});

describe('POST /usage/consume', () => {
  async function post(app: Hono, body: unknown): Promise<Response> {
    return app.request('/usage/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('正常に消費し allowed=true と残数を返す', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'));
    const app = makeApp();
    const res = await post(app, { userKey: 'u1', rows: 10 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      allowed: true,
      month: '2026-07',
      rowsUsed: 10,
      limit: 50,
      remaining: 40,
      plan: 'free',
    });
  });

  it('上限超過は allowed=false で消費されない', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'));
    const app = makeApp();
    await post(app, { userKey: 'u1', rows: 48 });
    const res = await post(app, { userKey: 'u1', rows: 5 }); // 48+5=53 > 50
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ allowed: false, rowsUsed: 48, remaining: 2 });
  });

  it('rows=0 は 400', async () => {
    const res = await post(makeApp(), { userKey: 'u1', rows: 0 });
    expect(res.status).toBe(400);
  });

  it('rows=51（上限超え）は 400', async () => {
    const res = await post(makeApp(), { userKey: 'u1', rows: 51 });
    expect(res.status).toBe(400);
  });

  it('rows が非整数（1.5）は 400', async () => {
    const res = await post(makeApp(), { userKey: 'u1', rows: 1.5 });
    expect(res.status).toBe(400);
  });

  it('rows が負数は 400', async () => {
    const res = await post(makeApp(), { userKey: 'u1', rows: -1 });
    expect(res.status).toBe(400);
  });

  it('rows が文字列は 400', async () => {
    const res = await post(makeApp(), { userKey: 'u1', rows: '5' });
    expect(res.status).toBe(400);
  });

  it('rows 欠落は 400', async () => {
    const res = await post(makeApp(), { userKey: 'u1' });
    expect(res.status).toBe(400);
  });

  it('userKey 欠落は 400', async () => {
    const res = await post(makeApp(), { rows: 5 });
    expect(res.status).toBe(400);
  });

  it('JSON でないボディは 400', async () => {
    const app = makeApp();
    const res = await app.request('/usage/consume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });
});
