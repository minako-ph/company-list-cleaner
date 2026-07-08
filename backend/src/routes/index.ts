import type { Hono } from 'hono';
import { GovHttpClient } from '@jp-opendata/gov-clients/http';
import { HoujinClient } from '@jp-opendata/gov-clients/houjin';
import { GbizinfoClient } from '@jp-opendata/gov-clients/gbizinfo';
import { loadConfig } from '../config.js';
import { createSerialQueue, type SerialQueue } from '../queue.js';
import { createInvoiceClient } from '../clients/invoice.js';
import { logAccess } from '../log/accessLog.js';
import { registerInvoiceRoute } from './invoice.js';
import { registerResolveRoute } from './resolve.js';
import { registerEnrichRoute } from './enrich.js';
import { resolveNames, type SearchByName } from '../services/resolve.js';
import {
  enrichCorporations,
  type EnrichDeps,
  type GbizDep,
  type HoujinBasicDep,
} from '../services/enrich.js';

/**
 * ルート登録の集約点。
 *
 * `/invoice`（FR-5）・`/resolve`（FR-2/3）・`/enrich`（FR-4/6）を登録する。
 * 残りの実ルート（/license・/usage・/stripe/webhook）は後続 Step で追加する。
 *
 * 公的API呼び出しは全て同一プロセス内の**単一**直列キュー（N-1）を通す
 * （invoice・houjin・gbizinfo で共有＝全ユーザー・全API横断で 1req/秒を担保）。
 * houjin/gbizinfo クライアント内部の GovHttpClient は二重待機を避けるため間隔 0 とし、
 * レート制御はこの単一キューに一元化する（decisions.md 参照）。
 */
export function registerRoutes(app: Hono): void {
  const config = loadConfig();
  const queue = createSerialQueue(config.rateRps);

  registerInvoiceRouteFromConfig(app, config, queue);
  registerResolveRouteFromConfig(app, config, queue);
  registerEnrichRouteFromConfig(app, config, queue);
}

type LoadedConfig = ReturnType<typeof loadConfig>;

function registerInvoiceRouteFromConfig(app: Hono, config: LoadedConfig, queue: SerialQueue): void {
  const invoiceClient = createInvoiceClient({
    apiBase: config.invoiceApiBase,
    appId: config.houjinAppId,
    queue,
    fetchFn: (url) => fetch(url),
    logAccess,
  });

  registerInvoiceRoute(app, {
    invoiceEnabled: config.invoiceEnabled,
    lookup: (numbers, context) => invoiceClient.lookupByRegistrationNumbers(numbers, context),
  });
}

function registerResolveRouteFromConfig(app: Hono, config: LoadedConfig, queue: SerialQueue): void {
  // HoujinClient のコンストラクタは 13桁 id を要求するため、未設定時は生成しない。
  const houjinConfigured = /^\d{13}$/.test(config.houjinAppId);
  const houjinClient = houjinConfigured
    ? new HoujinClient({ id: config.houjinAppId, http: new GovHttpClient({ intervalMs: 0 }) })
    : undefined;

  // 名称検索は完全一致（target=2）・XML（type=12）。実送信は単一キュー経由（N-1）。
  const search: SearchByName = houjinClient
    ? (name) =>
        queue.enqueue(async () => {
          const result = await houjinClient.searchByName(name, { type: '12', target: 2 });
          return result.corporations;
        })
    : () => Promise.reject(new Error('houjin not configured'));

  registerResolveRoute(app, {
    houjinConfigured,
    resolve: (names) => resolveNames(names, search),
  });
}

function registerEnrichRouteFromConfig(app: Hono, config: LoadedConfig, queue: SerialQueue): void {
  const houjinClient = /^\d{13}$/.test(config.houjinAppId)
    ? new HoujinClient({ id: config.houjinAppId, http: new GovHttpClient({ intervalMs: 0 }) })
    : undefined;

  // gBizINFO はトークンをヘッダ送出するため http を注入せず既定生成に任せる
  // （http を注入すると token ヘッダが付かないため。間隔はクライアント既定=500ms のまま
  //  上位の単一キューが 1req/秒を支配する）。
  const gbizClient =
    config.gbizinfoApiToken !== ''
      ? new GbizinfoClient({ token: config.gbizinfoApiToken })
      : undefined;

  const houjinDep: HoujinBasicDep | undefined = houjinClient
    ? {
        findByNumbers: (numbers) =>
          queue.enqueue(async () => {
            const result = await houjinClient.findByNumbers(numbers, { type: '12' });
            return result.corporations;
          }),
      }
    : undefined;

  const gbizDep: GbizDep | undefined = gbizClient
    ? {
        getBasic: (n) => queue.enqueue(async () => (await gbizClient.getBasicInfo(n)).hojinInfos[0]),
        getSubsidy: (n) =>
          queue.enqueue(async () => (await gbizClient.getSubsidies(n)).hojinInfos[0]),
        getProcurement: (n) =>
          queue.enqueue(async () => (await gbizClient.getProcurements(n)).hojinInfos[0]),
      }
    : undefined;

  const deps: EnrichDeps = {
    ...(houjinDep ? { houjin: houjinDep } : {}),
    ...(gbizDep ? { gbiz: gbizDep } : {}),
  };

  registerEnrichRoute(app, {
    enrich: (numbers, fields) => enrichCorporations(numbers, fields, deps),
  });
}
