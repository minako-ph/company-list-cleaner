/**
 * 公的API連続失敗の検知と通知（N-4 / N-7）。
 *
 * ソース別（houjin / gbizinfo / invoice）に成功・失敗を記録し、**連続失敗**が閾値
 * （既定3・`ALERT_CONSECUTIVE_FAILURES`）に達したら `ALERT_WEBHOOK_URL` へ通知する
 * （Slack互換の `{ text }`。未設定なら console.error のみ）。回復（成功）時にも1回通知する。
 *
 * 状態はプロセス内メモリで保持する。Cloud Run は `max-instances=1`（R3-5）のため
 * 全ユーザー横断の連続失敗をこの単一インスタンスで正しく数えられる。
 *
 * 通知の抑制（要件どおり）:
 * - 同一ソースにつき一度失敗通知したら、**回復するまで**再通知しない。
 * - 加えて失敗通知には**最低クールダウン（既定30分）**を課す（回復→再失敗を繰り返す
 *   フラッピングで通知が連投されるのを防ぐ）。回復通知はクールダウン対象外（失敗通知と対で1回）。
 *
 * 絶対制約（§9 / CR-3・CR-5）:
 * - 通知本文・ログに社名・登録番号・応答本文・シークレットを一切含めない。
 *   含めてよいのは「ソース名・連続失敗回数・時刻」のみ。
 * - 通知先への送信自体が失敗してもアプリ動作に影響させない（握りつぶし＋console.error）。
 */

/** 監視対象の公的APIソース。 */
export type ApiSource = 'houjin' | 'gbizinfo' | 'invoice';

/** /health に返す各ソースの状態（degraded=現在連続失敗が閾値以上）。 */
export type ApiHealthState = 'ok' | 'degraded';

export type ApiHealthStatus = Record<ApiSource, ApiHealthState>;

const API_SOURCES: readonly ApiSource[] = ['houjin', 'gbizinfo', 'invoice'];

/** 通知本文用の表示ラベル（固定文字列。値・機微情報は含めない）。 */
const SOURCE_LABEL: Record<ApiSource, string> = {
  houjin: '法人番号API',
  gbizinfo: 'gBizINFO',
  invoice: 'インボイスAPI',
};

/** 既定の連続失敗閾値。 */
const DEFAULT_THRESHOLD = 3;
/** 既定のクールダウン（30分）。 */
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

/** ソース別の内部状態。 */
interface SourceState {
  /** 現在の連続失敗回数（成功でリセット）。 */
  consecutiveFailures: number;
  /** 失敗通知済みで未回復か（true の間は再失敗通知しない）。 */
  notified: boolean;
  /** 直近の失敗通知時刻（クールダウン判定用）。未通知は undefined。 */
  lastFailureNotifiedAt: number | undefined;
}

/** Webhook 送信の最小注入面（テストでスタブ可能に）。 */
export type PostWebhook = (url: string, payload: { text: string }) => Promise<void>;

export interface ApiHealthTrackerDeps {
  /** 連続失敗閾値（既定3）。1未満は既定に丸める。 */
  readonly threshold?: number;
  /** 失敗通知のクールダウン（ms・既定30分）。 */
  readonly cooldownMs?: number;
  /** 通知先 Webhook URL。空文字なら console.error のみ。 */
  readonly webhookUrl?: string;
  /** 現在時刻（ms）。テスト用に注入可能。既定は Date.now。 */
  readonly now?: () => number;
  /** Webhook 送信実装。既定は global fetch の POST。 */
  readonly postWebhook?: PostWebhook;
  /** エラー出力（既定 console.error）。値・機微情報は渡さない。 */
  readonly logError?: (message: string) => void;
}

export interface ApiHealthTracker {
  /** 公的API呼び出しの成功を記録する（連続失敗をリセット・必要なら回復通知）。 */
  recordSuccess(source: ApiSource): void;
  /** 公的API呼び出しの失敗を記録する（閾値到達で抑制付き通知）。 */
  recordFailure(source: ApiSource): void;
  /** /health 用の現在状態（degraded=連続失敗が閾値以上）。 */
  getStatus(): ApiHealthStatus;
}

/** 既定の Webhook 送信（global fetch）。応答本文は読まない（機微情報を扱わない）。 */
const defaultPostWebhook: PostWebhook = async (url, payload) => {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export function createApiHealthTracker(deps: ApiHealthTrackerDeps = {}): ApiHealthTracker {
  const rawThreshold = deps.threshold ?? DEFAULT_THRESHOLD;
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold >= 1 ? Math.floor(rawThreshold) : DEFAULT_THRESHOLD;
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const webhookUrl = deps.webhookUrl ?? '';
  const now = deps.now ?? (() => Date.now());
  const postWebhook = deps.postWebhook ?? defaultPostWebhook;
  const logError = deps.logError ?? ((message: string) => console.error(message));

  const states = new Map<ApiSource, SourceState>();
  for (const source of API_SOURCES) {
    states.set(source, { consecutiveFailures: 0, notified: false, lastFailureNotifiedAt: undefined });
  }

  function stateOf(source: ApiSource): SourceState {
    const existing = states.get(source);
    if (existing !== undefined) return existing;
    // 型上到達しないが防御的に初期化する。
    const created: SourceState = {
      consecutiveFailures: 0,
      notified: false,
      lastFailureNotifiedAt: undefined,
    };
    states.set(source, created);
    return created;
  }

  /** 通知を送る。送信失敗はアプリに波及させない（握りつぶし＋console.error）。 */
  function dispatch(text: string): void {
    if (webhookUrl === '') {
      // Webhook 未設定時は console.error のみ（無言で失敗しない）。
      logError(text);
      return;
    }
    // 同期throw・非同期rejectの双方を握りつぶす。record系は決して throw しない。
    Promise.resolve()
      .then(() => postWebhook(webhookUrl, { text }))
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        logError(`アラート通知の送信に失敗しました: ${reason}`);
      });
  }

  function failureText(source: ApiSource, failures: number, at: number): string {
    return `[会社リストクリーナー] ${SOURCE_LABEL[source]}が連続${failures}回失敗しました（${new Date(at).toISOString()}）`;
  }

  function recoveryText(source: ApiSource, at: number): string {
    return `[会社リストクリーナー] ${SOURCE_LABEL[source]}が回復しました（${new Date(at).toISOString()}）`;
  }

  function recordFailure(source: ApiSource): void {
    const state = stateOf(source);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures < threshold) return;
    if (state.notified) return; // 回復まで再通知しない。

    const at = now();
    const cooldownPassed =
      state.lastFailureNotifiedAt === undefined || at - state.lastFailureNotifiedAt >= cooldownMs;
    if (!cooldownPassed) return; // クールダウン中は通知を保留（次の失敗で再判定）。

    state.notified = true;
    state.lastFailureNotifiedAt = at;
    dispatch(failureText(source, state.consecutiveFailures, at));
  }

  function recordSuccess(source: ApiSource): void {
    const state = stateOf(source);
    state.consecutiveFailures = 0;
    if (!state.notified) return; // 失敗通知していなければ回復通知も出さない。
    state.notified = false;
    dispatch(recoveryText(source, now()));
  }

  function getStatus(): ApiHealthStatus {
    const status = {} as ApiHealthStatus;
    for (const source of API_SOURCES) {
      status[source] = stateOf(source).consecutiveFailures >= threshold ? 'degraded' : 'ok';
    }
    return status;
  }

  return { recordSuccess, recordFailure, getStatus };
}
