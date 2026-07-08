import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('createApp', () => {
  it('GET /health は 200 と { ok: true, apis: {...} } を返す（N-4 サイドバー障害表示用）', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    // 起動直後は失敗記録がないため全ソース ok。
    expect(body).toEqual({
      ok: true,
      apis: { houjin: 'ok', gbizinfo: 'ok', invoice: 'ok' },
    });
  });

  it('未定義ルートは 404 を返す（後続 Step で追加するまでルートは health のみ）', async () => {
    const app = createApp();
    const res = await app.request('/resolve');
    expect(res.status).toBe(404);
  });
});
