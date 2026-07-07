import { unzipSync } from 'fflate';

/**
 * EDINET 書類取得API type=5（CSV）のパーサ。
 * 応答はzipで、中身は「XBRL_TO_CSV/jpcrp*.csv」等のUTF-16LE・タブ区切りファイル。
 * 列: 要素ID / 項目名 / コンテキストID / 相対年度 / 連結・個別 / 期間・時点 / ユニットID / 単位 / 値
 */

export interface EdinetCsvRow {
  elementId: string;
  itemName: string;
  contextId: string;
  relativeFiscalYear: string;
  consolidatedOrNot: string;
  periodOrInstant: string;
  unitId: string;
  unit: string;
  value: string;
}

const COLUMN_COUNT = 9;

function stripQuotes(cell: string): string {
  const trimmed = cell.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

/** 単一CSVファイルの中身（デコード済みテキスト）を行配列へ。1行目はヘッダ行として捨てる */
export function parseEdinetCsvContent(content: string): EdinetCsvRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  const rows: EdinetCsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t').map(stripQuotes);
    if (cells.length < COLUMN_COUNT) continue;
    rows.push({
      elementId: cells[0] ?? '',
      itemName: cells[1] ?? '',
      contextId: cells[2] ?? '',
      relativeFiscalYear: cells[3] ?? '',
      consolidatedOrNot: cells[4] ?? '',
      periodOrInstant: cells[5] ?? '',
      unitId: cells[6] ?? '',
      unit: cells[7] ?? '',
      value: cells[8] ?? '',
    });
  }
  return rows;
}

/**
 * type=5応答のzipから有報本体（jpcrp*.csv）の全行を取り出す。
 * 監査報告（jpaud*）等は対象外。該当ファイルが無ければ空配列。
 */
export function parseEdinetCsvZip(zip: Uint8Array): EdinetCsvRow[] {
  const files = unzipSync(zip);
  const decoder = new TextDecoder('utf-16le');
  const rows: EdinetCsvRow[] = [];
  for (const [name, data] of Object.entries(files)) {
    const basename = name.split('/').pop() ?? name;
    if (!/^jpcrp.*\.csv$/i.test(basename)) continue;
    rows.push(...parseEdinetCsvContent(decoder.decode(data)));
  }
  return rows;
}
