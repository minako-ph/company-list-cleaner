import { Hono } from 'hono';
import { registerRoutes } from './routes/index.js';

/**
 * Hono アプリを生成する。
 *
 * 業務ルート・`GET /health` はすべて registerRoutes（routes/index.ts）へ集約する。
 * `/health` は N-4 監視の health tracker を参照して各公的APIの degraded 状態を返すため、
 * tracker を生成する registerRoutes 側で登録する。
 */
export function createApp(): Hono {
  const app = new Hono();

  registerRoutes(app);

  return app;
}
