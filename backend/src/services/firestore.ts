/**
 * 実 Firestore クライアントの生成を隔離するモジュール（引継書 §7.3・§9）。
 *
 * `@google-cloud/firestore` の**値** import はここにだけ置く。これにより
 * InMemory 経路（ローカル開発）や quota.ts の単体テストで重い SDK を読み込まない。
 * 認証は ADC（Application Default Credentials）— Cloud Run 本番では自動接続、
 * ローカルでは未設定のため呼び出し側で InMemory にフォールバックする（routes/index.ts）。
 */

import { Firestore } from '@google-cloud/firestore';
import { FirestoreQuotaStore } from './quota.js';

/**
 * 指定プロジェクトの Firestore に接続する QuotaStore を生成する。
 * credentials は ADC に委ねる（キーはコード・環境変数に埋めない＝§9）。
 */
export function createFirestoreQuotaStore(projectId: string): FirestoreQuotaStore {
  const db = new Firestore({ projectId });
  return new FirestoreQuotaStore(db);
}
