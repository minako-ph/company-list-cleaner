import type { Hono } from 'hono';

/**
 * ルート登録の集約点。
 *
 * 実ルート（/resolve・/enrich・/invoice・/license・/usage・/stripe/webhook）は
 * 後続 Step で本ディレクトリ配下にモジュールを追加し、ここで登録する。
 * 現状はモジュール構造の器のみ（health は app.ts 側で定義）。
 */
export function registerRoutes(app: Hono): void {
  // 後続 Step でルートモジュールを app に登録する。
  void app;
}
