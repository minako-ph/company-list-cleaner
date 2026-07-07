import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBinaryFixture } from '@jp-opendata/testing';
import { parseEdinetCsvZip } from '../src/edinet/csv.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'edinet');

describe('parseEdinetCsvZip', () => {
  it('type=5のzipからjpcrp CSVの行を取り出す（監査報告jpaudは無視）', () => {
    const zip = loadBinaryFixture(fixturesDir, 'document.S100XXA1.csv.spec-based.zip');
    const rows = parseEdinetCsvZip(zip);
    expect(rows.length).toBe(10);

    const netSales = rows.filter(
      (r) =>
        r.elementId === 'jpcrp_cor:NetSalesSummaryOfBusinessResults' &&
        r.relativeFiscalYear === '当期' &&
        r.consolidatedOrNot === '連結',
    );
    expect(netSales).toHaveLength(1);
    expect(netSales[0]?.value).toBe('1234000000');
    expect(netSales[0]?.unit).toBe('円');

    // 監査報告ファイルの行は含まれない
    expect(rows.every((r) => r.elementId.startsWith('jpcrp_cor:'))).toBe(true);
  });

  it('該当CSVが無いzipは空配列', () => {
    // fflateで作った最小zip（空）は用意しづらいので、jpaudのみのケースはfixture zipのフィルタで担保済み。
    // ここでは中身が空のCSVを直接パースする境界を確認する。
    expect(
      parseEdinetCsvZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])),
    ).toEqual([]);
  });
});
