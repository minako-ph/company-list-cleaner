/**
 * 使用量の取得（FR-9 サイドバー常時表示）。GAS 依存: getStableUserKey / backendClient。
 *
 * 安定ユーザーキー（getStableUserKey・UserProperties UUID 単独方式）と保存済みライセンスキーで
 * `/usage` を引く。valid な Pro キーなら Pro 上限（backend 側で判定）。
 */

import * as backendClient from './backendClient';
import { getStableUserKey } from './userKey';
import { getStoredLicenseKey } from './license';
import type { Usage } from './backendDto';

/** 当月の使用量を返す（FR-9）。バックエンド障害・未設定時は例外を投げる（呼び出し元が可視化）。 */
export function getUsage(): Usage {
  const userKey = getStableUserKey();
  const licenseKey = getStoredLicenseKey();
  const result = backendClient.getUsage(userKey, licenseKey === '' ? undefined : licenseKey);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data;
}
