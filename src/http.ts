/**
 * 源別共通HTTP層（N-1・引継書§9）:
 * - 直列実行＋源別の既定リクエスト間隔（並列リクエスト禁止）
 * - 429/403は指数バックオフ（1s→4s→16s）、3回で当該実行を中断（RateLimitAbortError）
 * - 実行終端の監視集計（N-4）に使う統計を保持する
 */

export interface HttpStats {
  requests: number;
  failures: number;
  rateLimitHits: number;
  retries: number;
}

export class RateLimitAbortError extends Error {
  constructor(url: string, status: number) {
    super(`レート制限/拒否が継続（${status}）: バックオフ3回で中断 url=${url}`);
    this.name = 'RateLimitAbortError';
  }
}

export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpStatusError';
  }
}

export interface GovHttpResponse {
  status: number;
  body: string;
}

/** fetch互換の最小注入面（テストでアサーションなしにスタブ可能にするため構造的に定義） */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface GovHttpClientOptions {
  /** リクエスト間の最小間隔（源別既定。EDINET/不動産/法人番号/法令=1000ms、gBizINFO=500ms） */
  intervalMs: number;
  headers?: Record<string, string>;
  /** 429/403時のバックオフ間隔。既定 1s→4s→16s、尽きたら中断 */
  backoffMs?: readonly number[];
  fetchFn?: FetchLike;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
}

const DEFAULT_BACKOFF_MS = [1_000, 4_000, 16_000] as const;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GovHttpClient {
  private readonly intervalMs: number;
  private readonly headers: Record<string, string>;
  private readonly backoffMs: readonly number[];
  private readonly fetchFn: FetchLike;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly nowFn: () => number;
  private lastRequestAt = -Infinity;
  /** 直列化のためのキュー。全リクエストはこのPromiseチェーンに連結される */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly stats: HttpStats = {
    requests: 0,
    failures: 0,
    rateLimitHits: 0,
    retries: 0,
  };

  constructor(options: GovHttpClientOptions) {
    this.intervalMs = options.intervalMs;
    this.headers = options.headers ?? {};
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn = options.sleepFn ?? defaultSleep;
    this.nowFn = options.nowFn ?? Date.now;
  }

  getStats(): Readonly<HttpStats> {
    return { ...this.stats };
  }

  /** 直列＋間隔＋バックオフ付きGET。4xx/5xxはHttpStatusErrorで返す（404の0件扱い等は呼び出し側の責務） */
  async get(url: string): Promise<GovHttpResponse> {
    const run = this.queue.then(() => this.executeWithBackoff(url));
    // キューはエラーでも途切れさせない（部分失敗の許容 FR-C8）
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async executeWithBackoff(url: string): Promise<GovHttpResponse> {
    for (let attempt = 0; ; attempt++) {
      await this.waitInterval();
      this.stats.requests++;
      let response: { status: number; text(): Promise<string> };
      try {
        response = await this.fetchFn(url, { headers: this.headers });
      } catch (error) {
        this.stats.failures++;
        throw error;
      }
      this.lastRequestAt = this.nowFn();

      if (response.status === 429 || response.status === 403) {
        this.stats.rateLimitHits++;
        const backoff = this.backoffMs[attempt];
        if (backoff === undefined) {
          this.stats.failures++;
          throw new RateLimitAbortError(url, response.status);
        }
        this.stats.retries++;
        await this.sleepFn(backoff);
        continue;
      }

      const body = await response.text();
      if (response.status >= 400) {
        this.stats.failures++;
        throw new HttpStatusError(response.status, url);
      }
      return { status: response.status, body };
    }
  }

  private async waitInterval(): Promise<void> {
    const elapsed = this.nowFn() - this.lastRequestAt;
    const waitMs = this.intervalMs - elapsed;
    if (waitMs > 0) {
      await this.sleepFn(waitMs);
    }
  }
}
