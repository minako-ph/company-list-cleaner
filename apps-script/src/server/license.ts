/**
 * ライセンスキーの保存・検証（FR-10）。GAS 依存: PropertiesService（UserProperties）。
 *
 * キーは端末でなく Google アカウントに紐づく＝UserProperties に保存する（要件書 FR-10）。
 * 検証はバックエンド `/license/verify`（署名＋Stripe購読照合）へ委譲する。
 * 解約済みでも当該課金期間の満了までは valid（F3-3。判定は backend 側）。
 */

import * as backendClient from './backendClient';

/** UserProperties のキー名。 */
const LICENSE_KEY_PROP = 'LICENSE_KEY';

/** サイドバーへ返すライセンス状態。 */
export interface LicenseStatus {
  /** キーが保存されているか。 */
  readonly configured: boolean;
  /** 現在有効か（Pro 解錠可否）。 */
  readonly valid: boolean;
  /** 有効時のプラン。 */
  readonly plan?: 'pro';
  /** 課金期間末（Unix 秒）。 */
  readonly periodEnd?: number;
  /** 検証時のエラー（バックエンド障害など。N-4 で表示）。 */
  readonly error?: string;
}

/** unknown なエラーから安全にメッセージを取り出す。 */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 保存済みライセンスキーを返す（無ければ空文字）。 */
export function getStoredLicenseKey(): string {
  const value = PropertiesService.getUserProperties().getProperty(LICENSE_KEY_PROP);
  return value === null ? '' : value;
}

/** ライセンスキーを保存し、検証結果を返す（FR-10）。空キーは明示エラー。 */
export function saveLicenseKey(key: unknown): LicenseStatus {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (trimmed === '') {
    throw new Error('ライセンスキーを入力してください。');
  }
  PropertiesService.getUserProperties().setProperty(LICENSE_KEY_PROP, trimmed);
  return getLicenseStatus();
}

/** 保存済みライセンスキーを削除する（解約後の後始末など）。 */
export function clearLicenseKey(): LicenseStatus {
  PropertiesService.getUserProperties().deleteProperty(LICENSE_KEY_PROP);
  return { configured: false, valid: false };
}

/** 現在のライセンス状態を取得する（保存済みキーを /license/verify で検証）。 */
export function getLicenseStatus(): LicenseStatus {
  const key = getStoredLicenseKey();
  if (key === '') {
    return { configured: false, valid: false };
  }
  let result: backendClient.BackendResult<{ valid: boolean; plan?: 'pro'; periodEnd?: number }>;
  try {
    result = backendClient.verifyLicense(key);
  } catch (e) {
    // BACKEND_URL 未設定などの明示エラー。無言にしない（N-4）。
    return { configured: true, valid: false, error: errorMessage(e) };
  }
  if (!result.ok) {
    return { configured: true, valid: false, error: result.message };
  }
  return {
    configured: true,
    valid: result.data.valid,
    ...(result.data.plan !== undefined ? { plan: result.data.plan } : {}),
    ...(result.data.periodEnd !== undefined ? { periodEnd: result.data.periodEnd } : {}),
  };
}
