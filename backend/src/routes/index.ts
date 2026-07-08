import type { Hono } from 'hono';
import { loadConfig } from '../config.js';
import { createSerialQueue } from '../queue.js';
import { createInvoiceClient } from '../clients/invoice.js';
import { logAccess } from '../log/accessLog.js';
import { registerInvoiceRoute } from './invoice.js';

/**
 * ルート登録の集約点。
 *
 * 現状は `/invoice`（FR-5）を登録する。残りの実ルート（/resolve・/enrich・/license・
 * /usage・/stripe/webhook）は後続 Step で本ディレクトリ配下にモジュールを追加し、ここで登録する。
 *
 * 公的API呼び出しは全て同一プロセス内の直列キュー（N-1）を通す。
 */
export function registerRoutes(app: Hono): void {
  const config = loadConfig();
  const queue = createSerialQueue(config.rateRps);

  const invoiceClient = createInvoiceClient({
    apiBase: config.invoiceApiBase,
    appId: config.houjinAppId,
    queue,
    // global fetch を最小注入面 InvoiceFetch に合わせて包む。
    fetchFn: (url) => fetch(url),
    logAccess,
  });

  registerInvoiceRoute(app, {
    invoiceEnabled: config.invoiceEnabled,
    lookup: (numbers, context) => invoiceClient.lookupByRegistrationNumbers(numbers, context),
  });
}
