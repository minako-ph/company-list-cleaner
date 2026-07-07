import { describe, expect, it } from 'vitest';
import {
  GovHttpClient,
  HttpStatusError,
  RateLimitAbortError,
  type FetchLike,
} from '../src/http.js';

function fakeFetchFactory(responses: Array<{ status: number; body: string }>) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (!next) throw new Error('応答スタブが枯渇');
    return { status: next.status, text: async () => next.body };
  };
  return { calls, fetchFn };
}

function makeClient(fetchFn: FetchLike, slept: number[]) {
  let now = 0;
  return new GovHttpClient({
    intervalMs: 1000,
    fetchFn,
    sleepFn: async (ms) => {
      slept.push(ms);
      now += ms;
    },
    nowFn: () => now,
  });
}

describe('GovHttpClient', () => {
  it('成功応答を返し、リクエスト間に源別間隔を挟む', async () => {
    const { calls, fetchFn } = fakeFetchFactory([
      { status: 200, body: 'one' },
      { status: 200, body: 'two' },
    ]);
    const slept: number[] = [];
    const client = makeClient(fetchFn, slept);

    const r1 = await client.get('https://example.test/1');
    const r2 = await client.get('https://example.test/2');
    expect(r1.body).toBe('one');
    expect(r2.body).toBe('two');
    expect(calls).toHaveLength(2);
    // 2回目の前に間隔スリープが入る
    expect(slept).toContain(1000);
  });

  it('429は指数バックオフ（1s→4s→16s）で再試行し、成功すれば返す', async () => {
    const { fetchFn } = fakeFetchFactory([
      { status: 429, body: '' },
      { status: 429, body: '' },
      { status: 200, body: 'ok' },
    ]);
    const slept: number[] = [];
    const client = makeClient(fetchFn, slept);

    const result = await client.get('https://example.test/retry');
    expect(result.body).toBe('ok');
    expect(slept).toEqual(expect.arrayContaining([1000, 4000]));
    expect(client.getStats().retries).toBe(2);
    expect(client.getStats().rateLimitHits).toBe(2);
  });

  it('429/403が4回続いたら RateLimitAbortError で中断（3回のバックオフ後）', async () => {
    const { fetchFn } = fakeFetchFactory([
      { status: 429, body: '' },
      { status: 429, body: '' },
      { status: 403, body: '' },
      { status: 429, body: '' },
    ]);
    const slept: number[] = [];
    const client = makeClient(fetchFn, slept);

    await expect(client.get('https://example.test/limit')).rejects.toThrow(RateLimitAbortError);
    expect(slept).toEqual(expect.arrayContaining([1000, 4000, 16000]));
  });

  it('その他の4xx/5xxは HttpStatusError（バックオフ対象外）', async () => {
    const { fetchFn } = fakeFetchFactory([{ status: 500, body: 'boom' }]);
    const client = makeClient(fetchFn, []);
    await expect(client.get('https://example.test/err')).rejects.toThrow(HttpStatusError);
    expect(client.getStats().failures).toBe(1);
  });
});
