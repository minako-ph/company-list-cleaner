import { afterEach, describe, expect, it, vi } from 'vitest';
import { logAccess } from '../src/log/accessLog.js';

/**
 * CR-5 アクセスログのスキーマ固定テスト。
 *
 * 出力 JSON のキー集合が `['registration_number','timestamp','user_key']` と
 * 完全一致することを固定し、社名・応答ボディ等の公表情報フィールドが
 * ログに存在しないことを保証する（CR-3/CR-5）。
 */

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

describe('logAccess（CR-5）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('出力キー集合は registration_number / timestamp / user_key の3点に完全一致し、社名・応答ボディ相当のフィールドは存在しない', () => {
    const out = captureStdout(() => {
      logAccess({ userKey: 'user-abc', registrationNumber: 'T1234567890123' });
    });

    // 1行の JSON であること。
    expect(out.endsWith('\n')).toBe(true);
    const line = out.trimEnd();
    expect(line.includes('\n')).toBe(false);

    const parsedUnknown: unknown = JSON.parse(line);
    if (typeof parsedUnknown !== 'object' || parsedUnknown === null) {
      throw new Error('log line is not a JSON object');
    }
    const keys = Object.keys(parsedUnknown).sort();

    // キー集合の完全一致（過不足を許さない）。
    expect(keys).toEqual(['registration_number', 'timestamp', 'user_key']);

    // 公表情報に相当するフィールドが混入していないことを明示的に確認する。
    expect(keys).not.toContain('company_name');
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('address');
    expect(keys).not.toContain('response');
    expect(keys).not.toContain('body');
    expect(keys).not.toContain('result');
  });

  it('値が正しくマッピングされ timestamp は ISO 8601 である', () => {
    const out = captureStdout(() => {
      logAccess({ userKey: 'u1', registrationNumber: 'T9999999999999' });
    });
    const parsed: unknown = JSON.parse(out.trimEnd());
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not an object');
    }
    // 型アサーションを使わず Reflect.get で取り出す。
    expect(Reflect.get(parsed, 'user_key')).toBe('u1');
    expect(Reflect.get(parsed, 'registration_number')).toBe('T9999999999999');
    const ts: unknown = Reflect.get(parsed, 'timestamp');
    expect(typeof ts).toBe('string');
    // ISO 8601 として再パースできること。
    expect(typeof ts === 'string' && !Number.isNaN(Date.parse(ts))).toBe(true);
  });
});
