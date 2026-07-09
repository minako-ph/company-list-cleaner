import { z } from '@jp-opendata/schema-buffer';

/**
 * 不動産情報ライブラリ XIT001/XIT002 の境界スキーマ（引継書§4.3）。
 * 実応答（2026-07-09採取・千代田区2024）で確認: 全29フィールドが常に存在し、
 * 値はすべて文字列（該当なしは空文字）。language=ja/enでフィールド名は不変・値のみ翻訳。
 */

export const reinfolibTransactionSchema = z
  .object({
    PriceCategory: z.string(),
    Type: z.string(),
    Region: z.string(),
    MunicipalityCode: z.string(),
    Prefecture: z.string(),
    Municipality: z.string(),
    DistrictName: z.string(),
    TradePrice: z.string(),
    PricePerUnit: z.string(),
    FloorPlan: z.string(),
    Area: z.string(),
    UnitPrice: z.string(),
    LandShape: z.string(),
    Frontage: z.string(),
    TotalFloorArea: z.string(),
    BuildingYear: z.string(),
    Structure: z.string(),
    Use: z.string(),
    Purpose: z.string(),
    Direction: z.string(),
    Classification: z.string(),
    Breadth: z.string(),
    CityPlanning: z.string(),
    CoverageRatio: z.string(),
    FloorAreaRatio: z.string(),
    Period: z.string(),
    Renovation: z.string(),
    Remarks: z.string(),
    DistrictCode: z.string(),
  })
  .passthrough();

export const xit001ResponseSchema = z
  .object({
    status: z.string(),
    data: z.array(reinfolibTransactionSchema).optional(),
  })
  .passthrough();

export const reinfolibMunicipalitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .passthrough();

export const xit002ResponseSchema = z
  .object({
    status: z.string(),
    data: z.array(reinfolibMunicipalitySchema).optional(),
  })
  .passthrough();

export type ReinfolibTransaction = z.infer<typeof reinfolibTransactionSchema>;
export type ReinfolibMunicipality = z.infer<typeof reinfolibMunicipalitySchema>;
