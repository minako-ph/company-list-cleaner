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
import { registerUsageRoute } from './usage.js';
import { registerLicenseRoutes } from './license.js';
import { registerStripeWebhookRoute } from './stripeWebhook.js';
import {
  InMemoryQuotaStore,
  createQuotaService,
  type Plan,
  type PlanResolver,
  type QuotaStore,
} from '../services/quota.js';
import { createFirestoreQuotaStore } from '../services/firestore.js';
import { createLicenseService, type LicenseService } from '../services/license.js';
import { createStripeGateway, type StripeGateway } from '../services/stripeGateway.js';
import { resolveNames, type NameSearcher } from '../services/resolve.js';
import {
  enrichCorporations,
  type EnrichDeps,
  type GbizDep,
  type HoujinBasicDep,
} from '../services/enrich.js';
import {
  createApiHealthTracker,
  type ApiHealthTracker,
  type ApiSource,
} from '../services/apiHealth.js';
import type { InvoiceFetch } from '../clients/invoice.js';

/**
 * 国税庁アプリケーションIDの形式（英数字13桁）。
 * 実IDは英字混在（柱2 Step A・2026-07-10実ID確認）。jp-corp-core houjin/client.ts の検証と同一に保つ。
 */
const HOUJIN_APP_ID_PATTERN = /^[0-9A-Za-z]{13}$/;

/**
 * ルート登録の集約点。
 *
 * `/invoice`（FR-5）・`/resolve`（FR-2/3）・`/enrich`（FR-4/6）・`/usage`（FR-9）・
 * `/license/*`・`/stripe/webhook`（FR-10）を登録する。
 *
 * 公的API呼び出しは全て同一プロセス内の**単一**直列キュー（N-1）を通す
 * （invoice・houjin・gbizinfo で共有＝全ユーザー・全API横断で 1req/秒を担保）。
 * houjin/gbizinfo クライアント内部の GovHttpClient は二重待機を避けるため間隔 0 とし、
 * レート制御はこの単一キューに一元化する（decisions.md 参照）。
 * Stripe 呼び出しはこの公的APIキューとは無関係（レート制約の対象外）。
 */
export function registerRoutes(app: Hono): void {
  const config = loadConfig();
  const queue = createSerialQueue(config.rateRps);

  // N-4 監視: 公的API連続失敗の検知器（メモリ内。max-instances=1 前提＝R3-5）。
  const health = createApiHealthTracker({
    threshold: config.alertConsecutiveFailures,
    webhookUrl: config.alertWebhookUrl,
  });

  // /health はサイドバー障害表示用に各ソースの degraded 状態を返す（N-4）。
  app.get('/health', (c) => c.json({ ok: true, apis: health.getStatus() }));

  registerInvoiceRouteFromConfig(app, config, queue, health);
  registerResolveRouteFromConfig(app, config, queue, health);
  registerEnrichRouteFromConfig(app, config, queue, health);

  // ライセンス（FR-10）。Stripe/署名鍵が未設定なら license サービスは生成しない
  // （ルートは配線しつつ 503 で明示する）。usage の Pro 判定にも同じサービスを使う。
  // Stripe ゲートウェイは 1 回だけ生成し、license と webhook で共有する。
  const configured = config.stripeSecretKey !== '' && config.licenseSigningKey !== '';
  const gateway = configured ? createStripeGateway(config.stripeSecretKey) : undefined;
  const license =
    gateway !== undefined
      ? createLicenseService({ signingKeyPem: config.licenseSigningKey, gateway })
      : undefined;

  registerLicenseAndWebhookFromConfig(app, config, license, gateway);
  registerUsageRouteFromConfig(app, config, license);
}

type LoadedConfig = ReturnType<typeof loadConfig>;

/**
 * 公的API呼び出しを health tracker へ記録するラッパ。
 * 成功で recordSuccess・失敗（reject）で recordFailure を呼び、エラーは呼び出し元へ再送出する
 * （記録は副作用のみで、既存の部分失敗ハンドリング＝FR-8 の挙動を変えない）。
 */
function trackApi<T>(
  health: ApiHealthTracker,
  source: ApiSource,
  fn: () => Promise<T>,
): Promise<T> {
  return fn().then(
    (value) => {
      health.recordSuccess(source);
      return value;
    },
    (error: unknown) => {
      health.recordFailure(source);
      throw error;
    },
  );
}

function registerInvoiceRouteFromConfig(
  app: Hono,
  config: LoadedConfig,
  queue: SerialQueue,
  health: ApiHealthTracker,
): void {
  // インボイスクライアントの公開面（lookupByRegistrationNumbers）を変えず、
  // 注入する fetchFn を HTTP 境界でラップして成功/失敗を記録する（CRテストに触れない）。
  const fetchFn: InvoiceFetch = async (url) => {
    try {
      const response = await fetch(url);
      if (response.status >= 400) {
        health.recordFailure('invoice');
      } else {
        health.recordSuccess('invoice');
      }
      return response;
    } catch (error) {
      health.recordFailure('invoice');
      throw error;
    }
  };

  const invoiceClient = createInvoiceClient({
    apiBase: config.invoiceApiBase,
    appId: config.houjinAppId,
    queue,
    fetchFn,
    logAccess,
  });

  registerInvoiceRoute(app, {
    invoiceEnabled: config.invoiceEnabled,
    lookup: (numbers, context) => invoiceClient.lookupByRegistrationNumbers(numbers, context),
  });
}

function registerResolveRouteFromConfig(
  app: Hono,
  config: LoadedConfig,
  queue: SerialQueue,
  health: ApiHealthTracker,
): void {
  // HoujinClient のコンストラクタは英数字13桁の id を要求するため、未設定時は生成しない。
  // 実IDは英字混在13桁（柱2 Step A・2026-07-10実ID確認。数字のみの旧仮定は誤り）。
  const houjinConfigured = HOUJIN_APP_ID_PATTERN.test(config.houjinAppId);
  const houjinClient = houjinConfigured
    ? new HoujinClient({ id: config.houjinAppId, http: new GovHttpClient({ intervalMs: 0 }) })
    : undefined;

  // 名称検索は resolveCompanyName が指定する options（法人格除去クエリ・前方一致×あいまい）で
  // 送出する。target/mode はここで固定せず委譲側に委ねる（type 未指定時は XML=12 が既定）。
  // 実送信は単一キュー経由（N-1）。API 呼び出しの成否を health tracker へ記録（N-4）。
  // 捕捉クロージャは resolveNames（resolveOne）側が per-行で生成するため、この searcher は
  // ステートレスに共有してよい（並行リクエスト安全）。
  const searcher: NameSearcher = houjinClient
    ? {
        searchByName: (name, options) =>
          queue.enqueue(() =>
            trackApi(health, 'houjin', () => houjinClient.searchByName(name, options)),
          ),
      }
    : { searchByName: () => Promise.reject(new Error('houjin not configured')) };

  registerResolveRoute(app, {
    houjinConfigured,
    resolve: (names) => resolveNames(names, searcher),
  });
}

function registerEnrichRouteFromConfig(
  app: Hono,
  config: LoadedConfig,
  queue: SerialQueue,
  health: ApiHealthTracker,
): void {
  const houjinClient = HOUJIN_APP_ID_PATTERN.test(config.houjinAppId)
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
          queue.enqueue(() =>
            trackApi(health, 'houjin', async () => {
              const result = await houjinClient.findByNumbers(numbers, { type: '12' });
              return result.corporations;
            }),
          ),
      }
    : undefined;

  const gbizDep: GbizDep | undefined = gbizClient
    ? {
        getBasic: (n) =>
          queue.enqueue(() =>
            trackApi(health, 'gbizinfo', async () => (await gbizClient.getBasicInfo(n)).hojinInfos[0]),
          ),
        getSubsidy: (n) =>
          queue.enqueue(() =>
            trackApi(health, 'gbizinfo', async () => (await gbizClient.getSubsidies(n)).hojinInfos[0]),
          ),
        getProcurement: (n) =>
          queue.enqueue(() =>
            trackApi(
              health,
              'gbizinfo',
              async () => (await gbizClient.getProcurements(n)).hojinInfos[0],
            ),
          ),
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

/**
 * `/license/*` と `/stripe/webhook`（FR-10）を配線する。
 * license/gateway 未生成（Stripe/署名鍵 未設定）の場合は各ルートで 503 を明示する（無言で失敗しない）。
 */
function registerLicenseAndWebhookFromConfig(
  app: Hono,
  config: LoadedConfig,
  license: LicenseService | undefined,
  gateway: StripeGateway | undefined,
): void {
  if (license === undefined || gateway === undefined) {
    const unavailable = { error: 'not_configured', message: 'ライセンス機能は現在利用できません' };
    for (const path of ['/license/claim', '/license/recover', '/license/verify']) {
      app.post(path, (c) => c.json(unavailable, 503));
    }
    app.post('/stripe/webhook', (c) => c.json(unavailable, 503));
    return;
  }

  registerLicenseRoutes(app, {
    claimFromSession: (sessionId) => license.claimFromSession(sessionId),
    recoverByEmail: (email) => license.recoverByEmail(email),
    verify: (licenseKey) => license.verifyLicenseKey(licenseKey),
  });

  registerStripeWebhookRoute(app, {
    webhookSecret: config.stripeWebhookSecret,
    constructEvent: (rawBody, signature, secret) =>
      gateway.constructWebhookEvent(rawBody, signature, secret),
  });
}

/**
 * FR-9 無料枠カウント（/usage）。
 *
 * Firestore プロジェクトが未設定（`FIRESTORE_PROJECT_ID`/`GOOGLE_CLOUD_PROJECT` とも空）の
 * ローカル開発では InMemory にフォールバックする。Cloud Run 本番は ADC で Firestore に自動接続する。
 * plan は licenseKey（任意）を /license/verify で解決し、valid な Pro キーなら PRO_ROWS_PER_MONTH 上限。
 */
function registerUsageRouteFromConfig(
  app: Hono,
  config: LoadedConfig,
  license: LicenseService | undefined,
): void {
  const store: QuotaStore =
    config.firestoreProjectId === ''
      ? new InMemoryQuotaStore()
      : createFirestoreQuotaStore(config.firestoreProjectId);

  // licenseKey→plan 解決。license 未生成なら常に free。
  // Stripe 障害時は fail-closed で 'free' 扱い（無料枠保護を優先。Pro ユーザーが一時的に
  // 無料上限になるのは短TTLキャッシュで自己回復する稀なケース。decisions.md 参照）。
  const resolvePlan: PlanResolver = async (licenseKey) => {
    if (license === undefined || licenseKey === undefined) return 'free';
    try {
      const verification = await license.verifyLicenseKey(licenseKey);
      return verification.valid && verification.plan === 'pro' ? 'pro' : 'free';
    } catch {
      const fallback: Plan = 'free';
      return fallback;
    }
  };

  const service = createQuotaService({
    store,
    freeLimit: config.freeRowsPerMonth,
    proLimit: config.proRowsPerMonth,
    resolvePlan,
  });

  registerUsageRoute(app, {
    getUsage: (userKey, licenseKey) => service.getUsage(userKey, licenseKey),
    consume: (userKey, rows, licenseKey) => service.consume(userKey, rows, licenseKey),
  });
}
