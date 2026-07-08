import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBinaryFixture } from '@jp-opendata/testing';
import { parseEdinetCsvZip } from '../src/edinet/csv.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'edinet');

describe('parseEdinetCsvZip', () => {
  it('実採取zip（個別提出者）からjpcrp CSVの行を取り出す', () => {
    const zip = loadBinaryFixture(fixturesDir, 'document.S100YIZC.csv.trimmed.zip');
    const rows = parseEdinetCsvZip(zip);
    expect(rows.length).toBeGreaterThan(10);

    const netSales = rows.find(
      (r) =>
        r.elementId === 'jpcrp_cor:NetSalesSummaryOfBusinessResults' &&
        r.contextId === 'CurrentYearDuration_NonConsolidatedMember',
    );
    expect(netSales?.value).toBe('4928920000');
    expect(netSales?.unit).toBe('円');
    // サマリ行の「連結・個別」列は実データでは「その他」（判定に使えないことの回帰確認）
    expect(netSales?.consolidatedOrNot).toBe('その他');
    // 時点項目の相対年度は「当期末」
    const totalAssets = rows.find(
      (r) => r.elementId === 'jpcrp_cor:TotalAssetsSummaryOfBusinessResults',
    );
    expect(totalAssets?.relativeFiscalYear).toBe('当期末');
  });

  it('実採取zip（連結・IFRS提出者）にはセグメント別Member付きcontextが混在する', () => {
    const zip = loadBinaryFixture(fixturesDir, 'document.S100YNCJ.csv.trimmed.zip');
    const rows = parseEdinetCsvZip(zip);
    const employees = rows.filter((r) => r.elementId === 'jpcrp_cor:NumberOfEmployees');
    // 連結全体・個別・セグメント別が混在 → contextId完全一致で選別する必要がある
    expect(employees.length).toBeGreaterThan(2);
    expect(employees.some((r) => r.contextId === 'CurrentYearInstant')).toBe(true);
    expect(employees.some((r) => r.contextId.includes('ReportableSegmentMember'))).toBe(true);
  });

  it('該当CSVが無いzipは空配列', () => {
    expect(
      parseEdinetCsvZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])),
    ).toEqual([]);
  });
});
