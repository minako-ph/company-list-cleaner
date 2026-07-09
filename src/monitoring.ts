/**
 * 実行終端の監視・通知の共通部品（N-4・引継書§15「N-1・N-4→gov-clients共通HTTP層＋監視」）。
 * Actor #1/#3のmainから共用する（Phase 2 Step 5の共通化）。
 */

export interface AlertLogger {
  warning(message: string): void;
  error(message: string): void;
}

export interface WebhookAlertOptions {
  /** 未設定ならログのみの運用（N-4） */
  url: string | undefined;
  actor: string;
  summary: unknown;
  log: AlertLogger;
  fetchFn?: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<unknown>;
}

/** ALERT_WEBHOOK_URLへ実行サマリをPOSTする。送信失敗はエラーログのみ（実行は落とさない） */
export async function postWebhookAlert(options: WebhookAlertOptions): Promise<void> {
  const { url, actor, summary, log } = options;
  if (!url) {
    log.warning(`ALERT_WEBHOOK_URL is not set; alert is logged only. ${JSON.stringify(summary)}`);
    return;
  }
  const fetchFn = options.fetchFn ?? fetch;
  try {
    await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor, summary }),
    });
  } catch (error) {
    log.error(`Failed to send alert: ${String(error)}`);
  }
}
