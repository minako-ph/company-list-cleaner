import { describe, expect, it } from 'vitest';
import { deepPassthrough, detectDrift, parseWithBuffer, z } from '../src/index.js';

const base = z.object({
  docID: z.string(),
  filerName: z.string(),
  meta: z.object({ count: z.number() }),
  results: z.array(z.object({ id: z.string(), note: z.string().optional() })),
});
const schema = deepPassthrough(base);

describe('detectDrift', () => {
  it('ドリフトなしの応答では hasDrift=false', () => {
    const data = {
      docID: 'S100TEST',
      filerName: '架空株式会社',
      meta: { count: 1 },
      results: [{ id: '1' }],
    };
    expect(detectDrift(schema, data)).toEqual({
      unknownFields: [],
      missingFields: [],
      hasDrift: false,
    });
  });

  it('未知フィールドの出現を検知する（ネスト・配列要素含む）', () => {
    const data = {
      docID: 'S100TEST',
      filerName: '架空株式会社',
      meta: { count: 1, newField: true },
      results: [{ id: '1', addedLater: 'x' }],
      topLevelNew: 1,
    };
    const report = detectDrift(schema, data);
    expect(report.hasDrift).toBe(true);
    expect(report.unknownFields).toEqual(
      expect.arrayContaining(['meta.newField', 'results[].addedLater', 'topLevelNew']),
    );
    expect(report.missingFields).toEqual([]);
  });

  it('既知必須フィールドの消失を検知する（optionalは対象外）', () => {
    const data = {
      docID: 'S100TEST',
      meta: {},
      results: [{ id: '1' }],
    };
    const report = detectDrift(schema, data);
    expect(report.missingFields).toEqual(expect.arrayContaining(['filerName', 'meta.count']));
    expect(report.missingFields).not.toContain('results[].note');
  });
});

describe('parseWithBuffer', () => {
  it('未知フィールドを保全しつつパースし、ドリフトを併せて返す', () => {
    const data = {
      docID: 'S100TEST',
      filerName: '架空株式会社',
      meta: { count: 1 },
      results: [{ id: '1' }],
      futureField: 'preserved',
    };
    const { value, drift } = parseWithBuffer(schema, data);
    expect(value).toMatchObject({ futureField: 'preserved' });
    expect(drift.unknownFields).toEqual(['futureField']);
  });
});
