/**
 * サイドバー初期化 API（GAS 依存）。UI 起動時に一括で必要情報を返す。
 *
 * - アクティブシート名・ヘッダー行・データ範囲・ヘッダー名
 * - 列マッピングの自動推定（FR-1）
 * - 使用量（FR-9）・ライセンス状態（FR-10）
 * - インボイス機能の有効/無効（backend /health の invoiceEnabled に連動。無効時は UI で
 *   disabled ＋ 準備中表示。GAS 側に独立フラグを持たない＝承認状態とUIの自動整合）
 *
 * 各サブ取得は try/catch で分離し、一部の失敗（バックエンド障害）で UI 全体を壊さない（N-4）。
 */

import { guessColumnMapping, type ColumnMapping } from './columns';
import { getHeaderRowValues } from './sheet';
import { getUsage } from './usage';
import { getLicenseStatus, type LicenseStatus } from './license';
import * as backendClient from './backendClient';
import type { BackendHealth, Usage } from './backendDto';

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

  // インボイス機能フラグは backend /health の invoiceEnabled に連動（envのINVOICE_ENABLEDが真実源）。
  // /health 不達・フィールド未対応の旧バックエンドは true 扱い（有効側フォールバック）:
  // UIの事前ゲートは補助であり、権威ゲートはバックエンドの503（processBatch が「準備中」を
  // 書き込む既存経路）。誤って「準備中」を出し続ける方が承認済み状態との不整合として有害なため。
  const invoiceEnabled = apiHealth === null ? true : (apiHealth.invoiceEnabled ?? true);

  return {
    sheetName,
    headerRow,
    startRow,
    endRow,
    headers,
    mapping,
    invoiceEnabled,
    usage,
    usageError,
    license,
    apiHealth,
  };
}
