import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp();

// 起動ログはポートのみ（シークレットや環境変数値は出さない。§9）。
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`backend listening on port ${info.port}`);
});

/**
 * Graceful shutdown。Cloud Run は停止時に SIGTERM を送るため、
 * 進行中の接続を閉じてから終了する。
 */
function shutdown(signal: string): void {
  console.log(`received ${signal}, shutting down`);
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
