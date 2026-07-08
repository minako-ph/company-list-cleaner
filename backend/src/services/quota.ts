/**
 * FR-9 無料枠カウント（引継書 §7.3後段・§9、review-2026-07-08 §5-4）。
 *
 * Firestore に保存するのは **利用量データのみ**（`user_key`・`month`＝ドキュメントキー内・`rows_used`）。
 * 公表情報・社名・照会結果は絶対に保存しない（CR-3。cr-compliance.test.ts のソーススキャンで固定）。
 *
 * 月次リセットは「ドキュメントキー `{user_key}:{YYYY-MM}` をJST月ごとに分離」して実現する
 * （＝リセットバッチ不要。翌月は別ドキュメントに 0 から積む）。月は Asia/Tokyo 基準で算出する
 * （「来月1日に50行回復」のUX文言と一致させるため。UTCとの取り違えを monthKeyJst のテストで固定）。
 *
 * ストアは DI 可能に抽象化する（`QuotaStore`）。実装は本番用 `FirestoreQuotaStore` と、
 * エミュレータ不要でテスト・ローカル開発に使う `InMemoryQuotaStore` の2つ。
 */

// 型のみ import（runtime に @google-cloud/firestore を読み込まない＝InMemory 経路や
// 単体テストで重い SDK を load しない）。実 Firestore の生成は services/firestore.ts に隔離する。
import type { DocumentSnapshot, Firestore } from '@google-cloud/firestore';

/** 無料枠カウンタを保存する Firestore コレクション名。 */
export const USAGE_COUNTERS_COLLECTION = 'usage_counters';

/** JST（Asia/Tokyo）は UTC+9（日本は夏時間なし＝固定オフセット）。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 契約プラン。本Stepでは 'free' 固定（ライセンスAPIは P1 Step5）。 */
export type Plan = 'free' | 'pro';

/** サイドバー常時表示用の使用量（FR-9）。 */
export interface Usage {
  /** 当月（JST）を `YYYY-MM` で表す。 */
  readonly month: string;
  /** 当月の消費済み行数。 */
  readonly rowsUsed: number;
  /** 当月の上限行数（plan に対応。free=FREE_ROWS_PER_MONTH）。 */
  readonly limit: number;
  /** 残数（0 未満にはならない）。 */
  readonly remaining: number;
  /** 契約プラン。 */
  readonly plan: Plan;
}

/** consume の結果（超過時は消費せず allowed=false）。 */
export interface ConsumeResult {
  /** 消費できたか。上限超過なら false（rows_used は据え置き）。 */
  readonly allowed: boolean;
  /** 当月（JST）`YYYY-MM`。 */
  readonly month: string;
  /** 適用後（allowed=true）または据え置き（allowed=false）の消費済み行数。 */
  readonly rowsUsed: number;
  /** 当月の上限行数。 */
  readonly limit: number;
  /** 残数（0 未満にはならない）。 */
  readonly remaining: number;
  /** 契約プラン。 */
  readonly plan: Plan;
}

/** ストア層の消費結果（月・プランに依存しない素の値）。 */
export interface ConsumeOutcome {
  /** rows を加算できたか（次値が limit 以内なら true）。 */
  readonly applied: boolean;
  /** 適用後（applied=true）または現状（applied=false）の rows_used。 */
  readonly rowsUsed: number;
}

/**
 * 無料枠カウンタの永続化を抽象化する。
 *
 * `increment` は限度チェックと融合して `consume`（原子的 check-then-increment）に一本化する。
 * これは Firestore 実装でトランザクション内に読み書きを閉じ込め、
 * 読み取り→加算の間の競合（並行 consume による超過）を防ぐため（C5）。
 */
export interface QuotaStore {
  /** ドキュメントの現在の rows_used を返す（存在しなければ 0）。 */
  get(docId: string): Promise<number>;
  /**
   * 原子的に消費する。`現在値 + rows <= limit` なら rows_used を加算して applied=true、
   * 超過するなら加算せず applied=false を返す。
   */
  consume(docId: string, rows: number, limit: number): Promise<ConsumeOutcome>;
}

/**
 * 消費可否の純粋判定（InMemory / Firestore で共有）。
 * 上限「ちょうど」は許可、超過は不許可（`>` で判定）。
 */
export function decideConsume(current: number, rows: number, limit: number): ConsumeOutcome {
  const next = current + rows;
  if (next > limit) return { applied: false, rowsUsed: current };
  return { applied: true, rowsUsed: next };
}

/**
 * ローカル開発・テスト用のインメモリ実装（エミュレータ不要）。
 * 単一プロセス・単一スレッドのため、read→write の間に await を挟まず原子性を担保する。
 */
export class InMemoryQuotaStore implements QuotaStore {
  private readonly rows = new Map<string, number>();

  get(docId: string): Promise<number> {
    return Promise.resolve(this.rows.get(docId) ?? 0);
  }

  consume(docId: string, rows: number, limit: number): Promise<ConsumeOutcome> {
    const current = this.rows.get(docId) ?? 0;
    const outcome = decideConsume(current, rows, limit);
    if (outcome.applied) this.rows.set(docId, outcome.rowsUsed);
    return Promise.resolve(outcome);
  }
}

/** DocumentSnapshot から rows_used を安全に読む（型アサーション不使用）。 */
function readRowsUsed(snap: DocumentSnapshot): number {
  // snap.get(...) は any を返すため unknown に受けてから型ガードする。
  const raw: unknown = snap.exists ? snap.get('rows_used') : 0;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/**
 * 本番用の Firestore 実装。
 * 保存フィールドは `rows_used` のみ（CR-3。公表情報・社名は保存経路を作らない）。
 * consume はトランザクションで read→check→write を原子化する（並行 consume の超過防止）。
 */
export class FirestoreQuotaStore implements QuotaStore {
  constructor(
    private readonly db: Firestore,
    private readonly collection: string = USAGE_COUNTERS_COLLECTION,
  ) {}

  async get(docId: string): Promise<number> {
    const snap = await this.db.collection(this.collection).doc(docId).get();
    return readRowsUsed(snap);
  }

  consume(docId: string, rows: number, limit: number): Promise<ConsumeOutcome> {
    const ref = this.db.collection(this.collection).doc(docId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const outcome = decideConsume(readRowsUsed(snap), rows, limit);
      if (outcome.applied) {
        // rows_used のみを merge 更新する（他フィールド＝公表情報等は一切書かない）。
        tx.set(ref, { rows_used: outcome.rowsUsed }, { merge: true });
      }
      return outcome;
    });
  }
}

/** ドキュメントキー `{user_key}:{YYYY-MM}`。 */
function docIdFor(userKey: string, month: string): string {
  return `${userKey}:${month}`;
}

/**
 * 指定時刻の「JST の年月」を `YYYY-MM` で返す。
 * 例: UTC 2026-06-30T15:00:00Z ＝ JST 2026-07-01T00:00:00 → "2026-07"。
 */
export function monthKeyJst(now: Date): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 使用量サービス（ルートから使う入口）。 */
export interface QuotaService {
  /** 当月の使用量を返す（FR-9 サイドバー表示用）。 */
  getUsage(userKey: string): Promise<Usage>;
  /** 行数を消費する（超過時は消費せず allowed=false）。 */
  consume(userKey: string, rows: number): Promise<ConsumeResult>;
}

export interface QuotaServiceDeps {
  readonly store: QuotaStore;
  /** 当月の上限行数。plan=free 固定のため FREE_ROWS_PER_MONTH を渡す。 */
  readonly limit: number;
  /** 現在時刻の供給（テストで固定するために注入可能。既定は実時計）。 */
  readonly now?: () => Date;
}

/**
 * QuotaService を構築する。
 *
 * TODO(P1 Step5): ライセンスAPI実装後、Pro ユーザーは limit を PRO_ROWS_PER_MONTH に切替え、
 * plan='pro' を返すよう userKey→plan 解決を差し込む。本Stepでは 'free' 固定。
 */
export function createQuotaService(deps: QuotaServiceDeps): QuotaService {
  const now = deps.now ?? (() => new Date());
  const { store, limit } = deps;
  const plan: Plan = 'free';

  const remainingOf = (rowsUsed: number): number => Math.max(0, limit - rowsUsed);

  return {
    async getUsage(userKey: string): Promise<Usage> {
      const month = monthKeyJst(now());
      const rowsUsed = await store.get(docIdFor(userKey, month));
      return { month, rowsUsed, limit, remaining: remainingOf(rowsUsed), plan };
    },
    async consume(userKey: string, rows: number): Promise<ConsumeResult> {
      const month = monthKeyJst(now());
      const outcome = await store.consume(docIdFor(userKey, month), rows, limit);
      return {
        allowed: outcome.applied,
        month,
        rowsUsed: outcome.rowsUsed,
        limit,
        remaining: remainingOf(outcome.rowsUsed),
        plan,
      };
    },
  };
}
