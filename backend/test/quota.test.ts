import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryQuotaStore,
  createQuotaService,
  decideConsume,
  monthKeyJst,
} from '../src/services/quota.js';

/**
 * FR-9 無料枠カウントのテスト（引継書 §7.3・review §5-4）。
 * - InMemoryQuotaStore による consume/getUsage の挙動（実 Firestore・実ネットワークは使わない）。
 * - JST 月境界のドキュメントキー分離（vi.setSystemTime で固定）。
 * - 上限「ちょうど」は許可・超過は消費されない（decideConsume の境界）。
 */

const LIMIT = 50;

afterEach(() => {
  vi.useRealTimers();
});

describe('monthKeyJst（JST基準の YYYY-MM）', () => {
  it('UTC 2026-06-30T15:00:00Z は JST 7/1 00:00 = "2026-07"', () => {
    expect(monthKeyJst(new Date('2026-06-30T15:00:00Z'))).toBe('2026-07');
  });

  it('UTC 2026-06-30T14:59:59Z は JST 6/30 23:59 = "2026-06"（境界の1秒手前）', () => {
    expect(monthKeyJst(new Date('2026-06-30T14:59:59Z'))).toBe('2026-06');
  });

  it('年跨ぎ: UTC 2026-12-31T15:00:00Z は JST 2027/1/1 = "2027-01"', () => {
    expect(monthKeyJst(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01');
  });

  it('月は2桁ゼロ埋め: UTC 2026-01-15T00:00:00Z = "2026-01"', () => {
    expect(monthKeyJst(new Date('2026-01-15T00:00:00Z'))).toBe('2026-01');
  });
});

describe('decideConsume（境界）', () => {
  it('上限ちょうどは許可（45+5=50, limit 50）', () => {
    expect(decideConsume(45, 5, LIMIT)).toEqual({ applied: true, rowsUsed: 50 });
  });

  it('超過は消費しない（46+5=51 > 50、rows_used は据え置き 46）', () => {
    expect(decideConsume(46, 5, LIMIT)).toEqual({ applied: false, rowsUsed: 46 });
  });

  it('初回 0 からの消費', () => {
    expect(decideConsume(0, 1, LIMIT)).toEqual({ applied: true, rowsUsed: 1 });
  });

  it('残0からの追加消費は不許可', () => {
    expect(decideConsume(50, 1, LIMIT)).toEqual({ applied: false, rowsUsed: 50 });
  });
});

describe('InMemoryQuotaStore', () => {
  it('未作成ドキュメントの get は 0', async () => {
    const store = new InMemoryQuotaStore();
    expect(await store.get('u1:2026-07')).toBe(0);
  });

  it('consume 成功で加算・失敗で据え置き（状態が保持される）', async () => {
    const store = new InMemoryQuotaStore();
    expect(await store.consume('u1:2026-07', 40, LIMIT)).toEqual({ applied: true, rowsUsed: 40 });
    expect(await store.get('u1:2026-07')).toBe(40);
    // 40+15=55 > 50 → 消費されない
    expect(await store.consume('u1:2026-07', 15, LIMIT)).toEqual({ applied: false, rowsUsed: 40 });
    expect(await store.get('u1:2026-07')).toBe(40);
    // 40+10=50 ちょうど → 許可
    expect(await store.consume('u1:2026-07', 10, LIMIT)).toEqual({ applied: true, rowsUsed: 50 });
  });

  it('ドキュメントキーが異なれば独立（ユーザー分離）', async () => {
    const store = new InMemoryQuotaStore();
    await store.consume('u1:2026-07', 30, LIMIT);
    expect(await store.get('u2:2026-07')).toBe(0);
  });
});

describe('createQuotaService.getUsage', () => {
  it('初月は rowsUsed=0・remaining=limit・plan=free の形状', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'));
    const service = createQuotaService({ store: new InMemoryQuotaStore(), freeLimit: LIMIT, proLimit: 10000 });
    expect(await service.getUsage('u1')).toEqual({
      month: '2026-07',
      rowsUsed: 0,
      limit: 50,
      remaining: 50,
      plan: 'free',
    });
  });

  it('consume 後は rowsUsed が増え remaining が減る', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'));
    const service = createQuotaService({ store: new InMemoryQuotaStore(), freeLimit: LIMIT, proLimit: 10000 });
    const consumed = await service.consume('u1', 20);
    expect(consumed).toEqual({
      allowed: true,
      month: '2026-07',
      rowsUsed: 20,
      limit: 50,
      remaining: 30,
      plan: 'free',
    });
    const usage = await service.getUsage('u1');
    expect(usage).toMatchObject({ rowsUsed: 20, remaining: 30 });
  });

  it('超過時は allowed=false・remaining は据え置きベースで返す（消費されない）', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'));
    const service = createQuotaService({ store: new InMemoryQuotaStore(), freeLimit: LIMIT, proLimit: 10000 });
    await service.consume('u1', 48);
    const over = await service.consume('u1', 5); // 48+5=53 > 50
    expect(over).toEqual({
      allowed: false,
      month: '2026-07',
      rowsUsed: 48,
      limit: 50,
      remaining: 2,
      plan: 'free',
    });
    // 据え置きの確認
    expect(await service.getUsage('u1')).toMatchObject({ rowsUsed: 48, remaining: 2 });
  });
});

describe('JST 月境界のドキュメント分離（月次リセット＝キー分離）', () => {
  it('JST 6月末に消費した枠は JST 7月には持ち越されない（別ドキュメント・0から）', async () => {
    const store = new InMemoryQuotaStore();
    const service = createQuotaService({ store, freeLimit: LIMIT, proLimit: 10000 });

    // JST 6/30 23:59:59（= UTC 2026-06-30T14:59:59Z）に上限まで消費
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T14:59:59Z'));
    const june = await service.consume('u1', 50);
    expect(june).toMatchObject({ allowed: true, month: '2026-06', rowsUsed: 50, remaining: 0 });

    // JST 7/1 00:00:00（= UTC 2026-06-30T15:00:00Z）に切替わると新ドキュメント（回復）
    vi.setSystemTime(new Date('2026-06-30T15:00:00Z'));
    const julyUsage = await service.getUsage('u1');
    expect(julyUsage).toEqual({
      month: '2026-07',
      rowsUsed: 0,
      limit: 50,
      remaining: 50,
      plan: 'free',
    });

    // 7月に消費しても6月ドキュメントは影響を受けない
    await service.consume('u1', 3);
    vi.setSystemTime(new Date('2026-06-30T14:59:59Z'));
    expect(await service.getUsage('u1')).toMatchObject({ month: '2026-06', rowsUsed: 50 });
  });
});
