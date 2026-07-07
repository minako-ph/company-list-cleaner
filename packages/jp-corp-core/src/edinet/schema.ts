import { z } from '@jp-opendata/schema-buffer';

/**
 * EDINET API v2 書類一覧（documents.json?type=2）の境界スキーマ。
 * 引継書§4.1。全階層 .passthrough() で未知フィールドを保全し、ドリフトはN-4通知対象。
 * （deepPassthroughヘルパは型推論を失うため、境界スキーマは明示的にpassthroughを付ける）
 */

export const edinetDocumentResultSchema = z
  .object({
    seqNumber: z.number(),
    docID: z.string(),
    edinetCode: z.string().nullable(),
    secCode: z.string().nullable(),
    JCN: z.string().nullable(),
    filerName: z.string().nullable(),
    fundCode: z.string().nullable(),
    ordinanceCode: z.string().nullable(),
    formCode: z.string().nullable(),
    docTypeCode: z.string().nullable(),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
    submitDateTime: z.string().nullable(),
    docDescription: z.string().nullable(),
    issuerEdinetCode: z.string().nullable(),
    subjectEdinetCode: z.string().nullable(),
    subsidiaryEdinetCode: z.string().nullable(),
    currentReportReason: z.string().nullable(),
    parentDocID: z.string().nullable(),
    opeDateTime: z.string().nullable(),
    withdrawalStatus: z.string(),
    docInfoEditStatus: z.string(),
    disclosureStatus: z.string(),
    xbrlFlag: z.string(),
    pdfFlag: z.string(),
    attachDocFlag: z.string(),
    englishDocFlag: z.string(),
    csvFlag: z.string(),
    legalStatus: z.string(),
  })
  .passthrough();

export const edinetDocumentListSchema = z
  .object({
    metadata: z
      .object({
        title: z.string(),
        parameter: z.object({ date: z.string(), type: z.string() }).passthrough(),
        resultset: z.object({ count: z.number() }).passthrough(),
        processDateTime: z.string(),
        status: z.string(),
        message: z.string(),
      })
      .passthrough(),
    // 書類ゼロの日は空配列（引継書§4.1）。認証エラー等の異常応答ではresults自体が無い。
    results: z.array(edinetDocumentResultSchema).optional(),
  })
  .passthrough();

/** EDINETはエラーをHTTP 200＋ボディ内StatusCodeで返すことがある（2026-07-07実測） */
export const edinetErrorSchema = z
  .object({
    StatusCode: z.number(),
    message: z.string(),
  })
  .passthrough();

export type EdinetDocumentResult = z.infer<typeof edinetDocumentResultSchema>;

/** 書類様式コード（引継書§4.1。コード表は実装時に別紙様式コードリストで再確認） */
export const EDINET_DOC_TYPE = {
  ANNUAL_REPORT: '120',
  AMENDED_ANNUAL_REPORT: '130',
  SEMI_ANNUAL_REPORT: '160',
} as const;
