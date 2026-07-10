import { describe, it, expect } from 'vitest';
import {
  parseResolveResults,
  parseEnrichResults,
  parseInvoiceResults,
  parseUsage,
  parseConsumeResult,
  parseLicenseVerification,
  parseHealth,
} from '../src/server/backendDto';

describe('parseResolveResults（防御的パース）', () => {
  it('exact / ambiguous / not_found / error を narrow する', () => {
    const body = {
      results: [
        { input: '（株）A', normalized: '株式会社A', confidence: 'exact', candidates: [{ corporateNumber: '1234567890123', name: '株式会社A', address: '東京都' }] },
        { input: 'B', normalized: 'B', confidence: 'ambiguous', candidates: [{ corporateNumber: '1', name: 'B1', address: 'x' }, { corporateNumber: '2', name: 'B2', address: 'y' }] },
        { input: 'C', normalized: 'C', confidence: 'not_found', candidates: [] },
        { input: 'D', normalized: 'D', error: { code: 'http_error', message: 'x' } },
      ],
    };
    const rows = parseResolveResults(body);
    expect(rows).toHaveLength(4);
    expect(rows[0].confidence).toBe('exact');
    expect(rows[0].candidates?.[0].corporateNumber).toBe('1234567890123');
    expect(rows[1].confidence).toBe('ambiguous');
    expect(rows[2].confidence).toBe('not_found');
    expect(rows[3].error?.code).toBe('http_error');
  });

  it('results 欠落・非配列は空配列', () => {
    expect(parseResolveResults(null)).toEqual([]);
    expect(parseResolveResults({})).toEqual([]);
    expect(parseResolveResults({ results: 'x' })).toEqual([]);
  });

  it('selected（完全一致なし・候補1社を自動採用）を narrow する', () => {
    const body = {
      results: [
        {
          input: '国税商事',
          normalized: '国税商事',
          confidence: 'selected',
          candidates: [{ corporateNumber: '2040001999902', name: '株式会社国税商事あ', address: '千葉県千葉市中央区' }],
        },
      ],
    };
    const rows = parseResolveResults(body);
    expect(rows[0].confidence).toBe('selected');
    expect(rows[0].candidates?.[0].corporateNumber).toBe('2040001999902');
  });

  it('不正な confidence は undefined に落とす', () => {
    const rows = parseResolveResults({ results: [{ input: 'a', normalized: 'a', confidence: 'weird' }] });
    expect(rows[0].confidence).toBeUndefined();
  });
});

describe('parseEnrichResults', () => {
  it('FieldOutcome（ok/not_found/error）と notices を narrow する', () => {
    const body = {
      results: [
        {
          corporateNumber: '1234567890123',
          basic: { status: 'ok', data: { name: 'A', address: '東京都', kind: '301' } },
          gbizBasic: { status: 'not_found' },
          subsidy: { status: 'ok', data: { has: true, recentCount: 2 } },
          procurement: { status: 'error', error: { code: 'http_error', message: 'x' } },
          notices: ['gBizINFOトークンが未設定'],
        },
        { corporateNumber: 'bad', error: { code: 'invalid_format', message: 'y' } },
      ],
    };
    const rows = parseEnrichResults(body);
    expect(rows[0].basic).toEqual({ status: 'ok', data: { name: 'A', address: '東京都', kind: '301' } });
    expect(rows[0].gbizBasic).toEqual({ status: 'not_found' });
    expect(rows[0].subsidy).toEqual({ status: 'ok', data: { has: true, recentCount: 2 } });
    expect(rows[0].procurement?.status).toBe('error');
    expect(rows[0].notices).toEqual(['gBizINFOトークンが未設定']);
    expect(rows[1].error?.code).toBe('invalid_format');
  });

  it('status=ok だが data 欠落は not_found に落とす', () => {
    const rows = parseEnrichResults({ results: [{ corporateNumber: '1', basic: { status: 'ok' } }] });
    expect(rows[0].basic).toEqual({ status: 'not_found' });
  });
});

describe('parseInvoiceResults', () => {
  it('found/registered と各日付を narrow する', () => {
    const body = {
      results: [
        { registrationNumber: 'T1234567890123', found: true, registered: true, registrationDate: '2023-10-01' },
        { registrationNumber: 'T9', found: false, registered: false },
      ],
    };
    const rows = parseInvoiceResults(body);
    expect(rows[0]).toEqual({ registrationNumber: 'T1234567890123', found: true, registered: true, registrationDate: '2023-10-01' });
    expect(rows[1]).toEqual({ registrationNumber: 'T9', found: false, registered: false });
  });
});

describe('parseUsage / parseConsumeResult / parseLicenseVerification', () => {
  it('Usage を既定値付きで narrow', () => {
    expect(parseUsage({ month: '2026-07', rowsUsed: 12, limit: 50, remaining: 38, plan: 'free' })).toEqual({
      month: '2026-07',
      rowsUsed: 12,
      limit: 50,
      remaining: 38,
      plan: 'free',
    });
    // 欠落は既定値。
    expect(parseUsage({})).toEqual({ month: '', rowsUsed: 0, limit: 0, remaining: 0, plan: 'free' });
  });

  it('ConsumeResult の allowed=false（quota_exceeded 判定源）', () => {
    const r = parseConsumeResult({ allowed: false, month: '2026-07', rowsUsed: 50, limit: 50, remaining: 0, plan: 'free' });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('LicenseVerification は valid=false 既定・plan は pro のみ許容', () => {
    expect(parseLicenseVerification({ valid: true, plan: 'pro', periodEnd: 123 })).toEqual({ valid: true, plan: 'pro', periodEnd: 123 });
    expect(parseLicenseVerification({})).toEqual({ valid: false });
    expect(parseLicenseVerification({ valid: true, plan: 'weird' })).toEqual({ valid: true });
  });
});

describe('parseHealth（N-4 障害表示）', () => {
  it('degraded のみ degraded、それ以外は ok に落とす', () => {
    expect(
      parseHealth({ ok: true, apis: { houjin: 'ok', gbizinfo: 'degraded', invoice: 'ok' } }),
    ).toEqual({ ok: true, apis: { houjin: 'ok', gbizinfo: 'degraded', invoice: 'ok' } });
  });

  it('apis 欠落・不正値は全て ok に落とし、ok は既定 false', () => {
    expect(parseHealth({})).toEqual({
      ok: false,
      apis: { houjin: 'ok', gbizinfo: 'ok', invoice: 'ok' },
    });
    expect(parseHealth({ ok: true, apis: { houjin: 'weird' } })).toEqual({
      ok: true,
      apis: { houjin: 'ok', gbizinfo: 'ok', invoice: 'ok' },
    });
    expect(parseHealth(null)).toEqual({
      ok: false,
      apis: { houjin: 'ok', gbizinfo: 'ok', invoice: 'ok' },
    });
  });
});
