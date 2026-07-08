/**
 * 環境変数の読み取りと型付け（引継書 §9）。
 *
 * 絶対規則: 環境変数の**値**をログ・エラーメッセージに含めない（§9）。
 * バリデーションエラーは変数名のみを示し、値は出力しない。
 */

export interface Config {
  /** 国税庁アプリケーションID（法人番号・インボイス共通）。未発行の間は空。 */
  readonly houjinAppId: string;
  /** インボイスWeb-APIの接続先ベースURL。ID到着まで検証環境。 */
  readonly invoiceApiBase: string;
  /** インボイス機能フラグ（FR-5）。既定 false（縮退公開）。 */
  readonly invoiceEnabled: boolean;
  /** gBizINFO v2 APIトークン。 */
  readonly gbizinfoApiToken: string;
  /** Stripe シークレットキー（FR-10）。 */
  readonly stripeSecretKey: string;
  /** Stripe Webhook 署名シークレット。 */
  readonly stripeWebhookSecret: string;
  /** ライセンスキー署名鍵（JWT）。 */
  readonly licenseSigningKey: string;
  /** 公的API直列送信レート（req/秒）。既定 1（N-1）。 */
  readonly rateRps: number;
  /** 無料枠の月間行数上限。既定 50。 */
  readonly freeRowsPerMonth: number;
  /** Pro枠の月間行数上限。既定 10000。 */
  readonly proRowsPerMonth: number;
  /** N-4 通知先 Webhook URL。未設定ならログ出力のみ。 */
  readonly alertWebhookUrl: string;
  /** listen ポート。既定 8080。 */
  readonly port: number;
}

/**
 * 文字列環境変数を取り出す。未設定・空文字は既定値。
 * 値そのものは返すが、ここでログしない（呼び出し側もログ禁止）。
 */
function readString(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw === '') return fallback;
  return raw;
}

/**
 * 正の数値環境変数を取り出す。不正値は変数名のみを示して throw（値は出力しない）。
 * @param name 変数名（エラーメッセージ用。値は含めない）
 */
function readPositiveNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    // 値は含めない（§9）。
    throw new Error(`Invalid value for ${name}: expected a positive number`);
  }
  return parsed;
}

/**
 * 真偽値環境変数を取り出す。'true'/'false'（大文字小文字不問）のみ許容。
 * 不正値は変数名のみを示して throw（値は出力しない）。
 */
function readBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Invalid value for ${name}: expected "true" or "false"`);
}

/**
 * 環境変数から Config を構築する。テスト容易性のため env を注入可能にする。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    houjinAppId: readString(env.HOUJIN_APP_ID, ''),
    invoiceApiBase: readString(env.INVOICE_API_BASE, ''),
    invoiceEnabled: readBoolean('INVOICE_ENABLED', env.INVOICE_ENABLED, false),
    gbizinfoApiToken: readString(env.GBIZINFO_API_TOKEN, ''),
    stripeSecretKey: readString(env.STRIPE_SECRET_KEY, ''),
    stripeWebhookSecret: readString(env.STRIPE_WEBHOOK_SECRET, ''),
    licenseSigningKey: readString(env.LICENSE_SIGNING_KEY, ''),
    rateRps: readPositiveNumber('RATE_RPS', env.RATE_RPS, 1),
    freeRowsPerMonth: readPositiveNumber('FREE_ROWS_PER_MONTH', env.FREE_ROWS_PER_MONTH, 50),
    proRowsPerMonth: readPositiveNumber('PRO_ROWS_PER_MONTH', env.PRO_ROWS_PER_MONTH, 10000),
    alertWebhookUrl: readString(env.ALERT_WEBHOOK_URL, ''),
    port: readPositiveNumber('PORT', env.PORT, 8080),
  };
}
