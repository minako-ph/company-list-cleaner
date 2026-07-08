import { Hono } from 'hono';
import { registerRoutes } from './routes/index.js';

/**
 * Hono アプリを生成する。
 *
 * `GET /health` のみ本ファイルで定義し、業務ルートは routes/ 配下へ分離する
 * （後続 Step で registerRoutes に追加）。
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  registerRoutes(app);

  return app;
}
