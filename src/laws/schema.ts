import { z } from '@jp-opendata/schema-buffer';

/**
 * 法令API v2 の境界スキーマ（docs/research/laws-api-v2.md）。
 * law_full_text は法令標準XMLの直訳ツリー {tag, attr, children} で法令ごとに構造が
 * 大きく異なるため、ドリフト検知対象にせず opaque（z.unknown()）として受け、
 * 構造の解釈はActor側のパーサが防御的に行う。
 */

/** law_info（法令の不変属性） */
export const lawInfoSchema = z
  .object({
    law_type: z.string().optional(),
    law_id: z.string(),
    law_num: z.string().optional(),
    law_num_era: z.string().optional(),
    law_num_year: z.number().optional(),
    law_num_type: z.string().optional(),
    law_num_num: z.string().optional(),
    promulgation_date: z.string().optional(),
  })
  .passthrough();

/** revision_info（版の属性。検索・本文の両方に現れる） */
export const lawRevisionInfoSchema = z
  .object({
    law_revision_id: z.string(),
    law_type: z.string().optional(),
    law_title: z.string(),
    law_title_kana: z.string().nullish(),
    abbrev: z.string().nullish(),
    category: z.string().nullish(),
    updated: z.string().optional(),
    amendment_promulgate_date: z.string().nullish(),
    amendment_enforcement_date: z.string().nullish(),
    amendment_enforcement_comment: z.string().nullish(),
    amendment_scheduled_enforcement_date: z.string().nullish(),
    amendment_law_id: z.string().nullish(),
    amendment_law_title: z.string().nullish(),
    amendment_law_title_kana: z.string().nullish(),
    amendment_law_num: z.string().nullish(),
    amendment_type: z.string().nullish(),
    repeal_status: z.string().nullish(),
    repeal_date: z.string().nullish(),
    remain_in_force: z.boolean().nullish(),
    mission: z.string().nullish(),
    current_revision_status: z.string().nullish(),
  })
  .passthrough();

/** `GET /laws` の1件 */
export const lawsSearchEntrySchema = z
  .object({
    law_info: lawInfoSchema,
    revision_info: lawRevisionInfoSchema,
    current_revision_info: lawRevisionInfoSchema.optional(),
  })
  .passthrough();

/** `GET /laws` の応答 */
export const lawsSearchResponseSchema = z
  .object({
    total_count: z.number(),
    count: z.number(),
    laws: z.array(lawsSearchEntrySchema).optional(),
  })
  .passthrough();

/** `GET /law_data/{law_id|law_num}` の応答 */
export const lawDataResponseSchema = z
  .object({
    law_info: lawInfoSchema,
    revision_info: lawRevisionInfoSchema,
    law_full_text: z.unknown(),
    attached_files_info: z.unknown().optional(),
  })
  .passthrough();

/** 法令標準XML直訳ツリーのノード（テキストは文字列としてchildrenに混在） */
export interface LawTextNode {
  tag: string;
  attr?: Record<string, string>;
  children?: Array<LawTextNode | string>;
}

export type LawInfo = z.infer<typeof lawInfoSchema>;
export type LawRevisionInfo = z.infer<typeof lawRevisionInfoSchema>;
export type LawsSearchEntry = z.infer<typeof lawsSearchEntrySchema>;
export type LawsSearchResponse = z.infer<typeof lawsSearchResponseSchema>;
export type LawDataResponse = z.infer<typeof lawDataResponseSchema>;
