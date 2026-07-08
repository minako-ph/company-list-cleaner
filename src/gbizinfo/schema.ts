import { z } from '@jp-opendata/schema-buffer';

/**
 * gBizINFO REST API v2 の境界スキーマ（docs/research/gbizinfo-v2.md）。
 *
 * 共通ラッパー `{ id, message, errors, "hojin-infos": [...] }` を受ける。
 * 値なし項目は文字列 `"Null"` で来るため、パース前に stripNullStrings で除去してから
 * このスキーマに通す（＝スキーマ上の任意項目は原則 optional）。未知フィールドはドリフトとして
 * N-4通知対象（edinet/houjin と同じ parseWithBuffer 構成）。
 *
 * 子API（subsidy/procurement）は法人基本属性が約20項目削除され、法人番号・法人名・所在地＋
 * 対象情報のみが残る（research）。そのため基本情報と子APIで hojin-info スキーマを分ける。
 */

/** 補助金レコード SubsidyInfoV2（v1のnote/joint_signatures/subsidy_resourceは削除済み）。 */
export const gbizSubsidySchema = z
  .object({
    title: z.string().optional(),
    amount: z.number().optional(),
    date_of_approval: z.string().optional(),
    government_departments: z.string().optional(),
    target: z.string().optional(),
    'meta-data': z.array(z.unknown()).optional(),
  })
  .passthrough();

/** 調達レコード ProcurementInfo（subsidyと同型。joint_signaturesは調達では有効）。 */
export const gbizProcurementSchema = z
  .object({
    title: z.string().optional(),
    amount: z.number().optional(),
    date_of_order: z.string().optional(),
    government_departments: z.string().optional(),
    joint_signatures: z.string().optional(),
    target: z.string().optional(),
    'meta-data': z.array(z.unknown()).optional(),
  })
  .passthrough();

/** 法人基本情報 `/v2/hojin/{corporate_number}` の hojin-info。 */
export const gbizBasicInfoSchema = z
  .object({
    corporate_number: z.string(),
    name: z.string(),
    kana: z.string().optional(),
    location: z.string().optional(),
    postal_code: z.string().optional(),
    status: z.string().optional(),
    close_date: z.string().optional(),
    close_cause: z.string().optional(),
    update_date: z.string().optional(),
    company_url: z.string().optional(),
    representative_name: z.string().optional(),
    representative_position: z.string().optional(),
    capital_stock: z.number().optional(),
    employee_number: z.number().optional(),
    date_of_establishment: z.string().optional(),
    business_summary: z.string().optional(),
    company_size_male: z.number().optional(),
    company_size_female: z.number().optional(),
    business_items: z.array(z.string()).optional(),
    qualification_grade: z.string().optional(),
  })
  .passthrough();

/** 補助金API `/subsidy` の hojin-info（識別属性＋subsidy配列）。 */
export const gbizSubsidyHojinSchema = z
  .object({
    corporate_number: z.string(),
    name: z.string(),
    location: z.string().optional(),
    subsidy: z.array(gbizSubsidySchema).optional(),
  })
  .passthrough();

/** 調達API `/procurement` の hojin-info（識別属性＋procurement配列）。 */
export const gbizProcurementHojinSchema = z
  .object({
    corporate_number: z.string(),
    name: z.string(),
    location: z.string().optional(),
    procurement: z.array(gbizProcurementSchema).optional(),
  })
  .passthrough();

/** 共通ラッパーを hojin-info スキーマから組み立てる。 */
export function gbizEnvelopeSchema<S extends z.ZodTypeAny>(info: S) {
  return z
    .object({
      id: z.string(),
      message: z.string(),
      errors: z.array(z.unknown()).optional(),
      'hojin-infos': z.array(info),
    })
    .passthrough();
}

export type GbizSubsidy = z.infer<typeof gbizSubsidySchema>;
export type GbizProcurement = z.infer<typeof gbizProcurementSchema>;
export type GbizBasicInfo = z.infer<typeof gbizBasicInfoSchema>;
export type GbizSubsidyHojin = z.infer<typeof gbizSubsidyHojinSchema>;
export type GbizProcurementHojin = z.infer<typeof gbizProcurementHojinSchema>;
