/**
 * サイドバー初期化 API（GAS 依存）。UI 起動時に一括で必要情報を返す。
 *
 * - アクティブシート名・ヘッダー行・データ範囲・ヘッダー名
 * - 列マッピングの自動推定（FR-1）
 * - 使用量（FR-9）・ライセンス状態（FR-10）
 * - インボイス機能の有効/無効（INVOICE_ENABLED。無効時は UI で disabled ＋ 準備中表示）
 *
 * 各サブ取得は try/catch で分離し、一部の失敗（バックエンド障害）で UI 全体を壊さない（N-4）。
 */

import { guessColumnMapping, type ColumnMapping } from './columns';
import { getHeaderRowValues } from './sheet';
import { getUsage } from './usage';
import { getLicenseStatus, type LicenseStatus } from './license';
import * as backendClient from './backendClient';
import type { BackendHealth, Usage } from './backendDto';

/** Script Property のキー名（インボイス機能フラグ）。 */
const INVOICE_ENABLED_PROP = 'INVOICE_ENABLED';

/** サイドバー初期化情報。 */
export interface SidebarInit {
  readonly sheetName: string;
  readonly headerRow: number;
  readonly startRow: number;
  readonly endRow: number;
  readonly headers: string[];
  readonly mapping: ColumnMapping;
  readonly invoiceEnabled: boolean;
  readonly usage: Usage | null;
  readonly usageError: string | null;
  readonly license: LicenseStatus;
  /**
   * 公的APIの健全性（N-4）。degraded のAPIがあればサイドバーが赤帯で告知する。
   * /health 自体が取得できない（バックエンド未接続等）場合は null とし、
   * バックエンド障害の告知は usageError 側の既存導線に委ねる。
   */
  readonly apiHealth: BackendHealth | null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** INVOICE_ENABLED（Script Property）が 'true' かどうか。既定は false（縮退公開）。 */
function getInvoiceEnabled(): boolean {
  const value = PropertiesService.getScriptProperties().getProperty(INVOICE_ENABLED_PROP);
  return value !== null && value.trim().toLowerCase() === 'true';
}

/** サイドバー初期化情報を返す。 */
export function getSidebarInit(): SidebarInit {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const sheetName = sheet.getName();
  const lastRow = sheet.getLastRow();
  const headerRow = 1;
  const headers = getHeaderRowValues(sheet, headerRow);
  const mapping = guessColumnMapping(headers);
  // 1行目をヘッダーとみなし、2行目以降をデータとする。データが無ければ空範囲（endRow<startRow）。
  const startRow = 2;
  const endRow = lastRow >= startRow ? lastRow : startRow - 1;

  let usage: Usage | null = null;
  let usageError: string | null = null;
  try {
    usage = getUsage();
  } catch (e) {
    usageError = errorMessage(e);
  }

  let license: LicenseStatus;
  try {
    license = getLicenseStatus();
  } catch (e) {
    license = { configured: false, valid: false, error: errorMessage(e) };
  }

  // 公的APIの degraded 状態（N-4）。取得失敗（バックエンド未接続・未設定）は null にし、
  // バックエンド障害告知は usageError 側の既存導線へ委ねる（無言で失敗しない）。
  let apiHealth: BackendHealth | null = null;
  try {
    const result = backendClient.getHealth();
    apiHealth = result.ok ? result.data : null;
  } catch {
    apiHealth = null;
  }

  return {
    sheetName,
    headerRow,
    startRow,
    endRow,
    headers,
    mapping,
    invoiceEnabled: getInvoiceEnabled(),
    usage,
    usageError,
    license,
    apiHealth,
  };
}
