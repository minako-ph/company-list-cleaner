import type { DriftReport } from '@jp-opendata/schema-buffer';
import { HOUJIN_CSV_COLUMNS, type HoujinCorporation, type HoujinParseResult } from './schema.js';

/**
 * 法人番号Web-API Ver.4 のCSV(type=01 Shift_JIS/type=02 Unicode)応答をパースする。
 * デコード（Shift_JIS→UTF-8等）は呼び出し側（client）の責務。ここは decoded text を受ける。
 *
 * 形式（docs/research/houjin-webapi-v4.md）:
 * - 1行目: ヘッダー4項目「最終更新年月日,総件数,分割番号,分割数」
 * - 2行目以降: 法人データ30項目（項目名行なし・`"`囲み・`""`エスケープ）
 */

const HEADER_COLUMN_COUNT = 4;
const DATA_COLUMN_COUNT = HOUJIN_CSV_COLUMNS.length; // 30

/**
 * RFC4180風のCSV1行パース。`"`で囲まれたフィールド内のカンマ・`""`（エスケープされた"）を扱う。
 * 改行はclient側で行分割済みの前提（フィールド内改行は法人番号CSVでは発生しない）。
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++; // エスケープされた " を1文字消費
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function buildCorporation(cells: string[]): HoujinCorporation {
  // 位置対応で30項目を組み立てる（欠損セルは ""）。列数ドリフトは呼び出し側で検知する。
  const at = (idx: number): string => cells[idx] ?? '';
  return {
    sequenceNumber: at(0),
    corporateNumber: at(1),
    process: at(2),
    correct: at(3),
    updateDate: at(4),
    changeDate: at(5),
    name: at(6),
    nameImageId: at(7),
    kind: at(8),
    prefectureName: at(9),
    cityName: at(10),
    streetNumber: at(11),
    addressImageId: at(12),
    prefectureCode: at(13),
    cityCode: at(14),
    postCode: at(15),
    addressOutside: at(16),
    addressOutsideImageId: at(17),
    closeDate: at(18),
    closeCause: at(19),
    successorCorporateNumber: at(20),
    changeCause: at(21),
    assignmentDate: at(22),
    latest: at(23),
    enName: at(24),
    enPrefectureName: at(25),
    enCityName: at(26),
    enAddressOutside: at(27),
    furigana: at(28),
    hihyoji: at(29),
  };
}

export function parseHoujinCsv(text: string): HoujinParseResult {
  // BOM除去＋空行除外（末尾の空行や\r\nを吸収）
  const withoutBom = text.replace(/^\uFEFF/, '');
  const lines = withoutBom.split(/\r?\n/).filter((line) => line !== '');

  const unknownFields: string[] = [];
  const missingFields: string[] = [];

  const headerLine = lines[0];
  const headerCells = headerLine === undefined ? [] : parseCsvLine(headerLine);
  if (headerCells.length > HEADER_COLUMN_COUNT) unknownFields.push('header[column>4]');
  if (headerCells.length < HEADER_COLUMN_COUNT) missingFields.push('header[column<4]');

  const header = {
    lastUpdateDate: headerCells[0] ?? '',
    count: Number(headerCells[1] ?? '0'),
    divideNumber: Number(headerCells[2] ?? '0'),
    divideSize: Number(headerCells[3] ?? '0'),
  };

  const corporations: HoujinCorporation[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (cells.length > DATA_COLUMN_COUNT) unknownFields.push('corporation[column>30]');
    if (cells.length < DATA_COLUMN_COUNT) missingFields.push('corporation[column<30]');
    corporations.push(buildCorporation(cells));
  }

  const drift: DriftReport = {
    unknownFields,
    missingFields,
    hasDrift: unknownFields.length > 0 || missingFields.length > 0,
  };

  return { header, corporations, drift };
}
