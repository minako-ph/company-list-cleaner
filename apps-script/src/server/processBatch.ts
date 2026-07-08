/**
 * バッチ処理本体（FR-2〜FR-9・N-2・N-3）。GAS 依存。
 *
 * サイドバーが対象行を50行以下に分割して逐次呼ぶ（N-2）。1呼び出しの流れ:
 *   ① 対象行の指定列だけ読む（N-3）
 *   ② /usage/consume（対象行数。不足なら quotaExceeded を返し処理しない）
 *   ③ /resolve（社名→法人番号。exact 自動採用・ambiguous は候補選択待ち）
 *   ④ /enrich（選択フィールド）
 *   ⑤ doInvoice のとき /invoice（登録番号は T＋法人番号を機械生成 or 既存登録番号列）
 *   ⑥ 結果を新規列へ一括書き込み・ステータス更新（FR-7）
 *   ⑦ { processed, errors, ambiguous, usage } を返す
 *
 * 部分失敗は行単位で継続（FR-8）。障害は notices で可視化（N-4）。
 */

import * as backendClient from './backendClient';
import {
  ensureOutputColumns,
  readColumnValues,
  getSheetByNameOrThrow,
  writeRowOutputs,
  findExistingOutputColumn,
  type RowOutput,
} from './sheet';
import {
  STATUS,
  statusError,
  isReprocessTarget,
  type ColumnMapping,
  type OutputColumnId,
} from './columns';
import {
  extractDigits,
  isCorporateNumber,
  isRegistrationNumber,
  registrationNumberFromCorporateNumber,
  basicAddressText,
  basicKindText,
  gbizIndustryText,
  gbizEstablishedText,
  gbizEmployeesText,
  subsidyText,
  procurementText,
  formatInvoiceStatus,
} from './format';
import { getStableUserKey } from './userKey';
import { getStoredLicenseKey } from './license';
import type { EnrichRow, ResolveRow, Usage } from './backendDto';

/** サイドバーから受け取る付与オプション。 */
export interface ProcessOptions {
  readonly doNormalize: boolean;
  readonly doResolve: boolean;
  readonly enrichFields: {
    readonly basic: boolean;
    readonly gbizBasic: boolean;
    readonly subsidy: boolean;
    readonly procurement: boolean;
  };
  readonly doInvoice: boolean;
}

/** processBatch のリクエスト。 */
export interface ProcessBatchRequest {
  readonly sheetName: string;
  readonly headerRow: number;
  readonly rows: number[];
  readonly mapping: ColumnMapping;
  readonly options: ProcessOptions;
}

/** ambiguous（候補選択待ち）の行情報（FR-3）。 */
export interface AmbiguousItem {
  readonly row: number;
  readonly input: string;
  readonly candidates: { corporateNumber: string; name: string; address: string }[];
}

/** processBatch の戻り値。 */
export interface ProcessBatchResult {
  readonly processed: number;
  readonly errors: number;
  readonly ambiguous: AmbiguousItem[];
  readonly usage: Usage | null;
  readonly quotaExceeded?: boolean;
  readonly notices: string[];
}

/** 1回のバッチで受け付ける最大行数（サイドバーのチャンクと一致・N-2）。 */
const MAX_BATCH_ROWS = 50;

// ---------------------------------------------------------------------------
// リクエスト検証（google.script.run 経由の unknown を narrow する）
// ---------------------------------------------------------------------------

function asObject(v: unknown): object {
  if (typeof v !== 'object' || v === null) {
    throw new Error('リクエストが不正です。');
  }
  return v;
}

function asPositiveInt(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error(`${label} が不正です。`);
  }
  return v;
}

function optionalColumn(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined;
}

function parseMapping(v: unknown): ColumnMapping {
  const o = typeof v === 'object' && v !== null ? v : {};
  const nameCol = optionalColumn(Reflect.get(o, 'nameCol'));
  const corpNumCol = optionalColumn(Reflect.get(o, 'corpNumCol'));
  const regNumCol = optionalColumn(Reflect.get(o, 'regNumCol'));
  return {
    ...(nameCol !== undefined ? { nameCol } : {}),
    ...(corpNumCol !== undefined ? { corpNumCol } : {}),
    ...(regNumCol !== undefined ? { regNumCol } : {}),
  };
}

function parseOptions(v: unknown): ProcessOptions {
  const o = typeof v === 'object' && v !== null ? v : {};
  const ef = Reflect.get(o, 'enrichFields');
  const efo = typeof ef === 'object' && ef !== null ? ef : {};
  const flag = (obj: object, key: string): boolean => Reflect.get(obj, key) === true;
  return {
    doNormalize: flag(o, 'doNormalize'),
    doResolve: flag(o, 'doResolve'),
    doInvoice: flag(o, 'doInvoice'),
    enrichFields: {
      basic: flag(efo, 'basic'),
      gbizBasic: flag(efo, 'gbizBasic'),
      subsidy: flag(efo, 'subsidy'),
      procurement: flag(efo, 'procurement'),
    },
  };
}

function parseRows(v: unknown): number[] {
  if (!Array.isArray(v)) throw new Error('対象行が指定されていません。');
  const rows: number[] = [];
  for (const item of v) {
    if (typeof item === 'number' && Number.isInteger(item) && item >= 1) rows.push(item);
  }
  if (rows.length === 0) throw new Error('対象行が指定されていません。');
  if (rows.length > MAX_BATCH_ROWS) {
    throw new Error(`1回の処理は最大 ${MAX_BATCH_ROWS} 行です。`);
  }
  return rows;
}

function parseRequest(raw: unknown): ProcessBatchRequest {
  const o = asObject(raw);
  const sheetName = Reflect.get(o, 'sheetName');
  if (typeof sheetName !== 'string' || sheetName === '') {
    throw new Error('対象シートが指定されていません。');
  }
  return {
    sheetName,
    headerRow: asPositiveInt(Reflect.get(o, 'headerRow'), 'ヘッダー行'),
    rows: parseRows(Reflect.get(o, 'rows')),
    mapping: parseMapping(Reflect.get(o, 'mapping')),
    options: parseOptions(Reflect.get(o, 'options')),
  };
}

// ---------------------------------------------------------------------------
// 行の入力読み取り（N-3: 対象列のみ）
// ---------------------------------------------------------------------------

interface RowInput {
  readonly row: number;
  /** 社名（trim 済み）。 */
  readonly name: string;
  /** ユーザー指定 or 既存出力から得た有効な法人番号（13桁）。無ければ ''。 */
  effectiveCorpNumber: string;
  /** ユーザー指定の登録番号（T+13桁）。無ければ ''。 */
  readonly givenRegNumber: string;
  /** 入力が空（社名・番号すべて無し）か。 */
  readonly empty: boolean;
}

function pickByRow(values: unknown[], row: number, minRow: number): unknown {
  return values[row - minRow];
}

function readInputs(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rows: number[],
  mapping: ColumnMapping,
  corpOutputCol: number | undefined,
): RowInput[] {
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);

  const nameValues = mapping.nameCol !== undefined ? readColumnValues(sheet, mapping.nameCol, minRow, maxRow) : null;
  const corpValues = mapping.corpNumCol !== undefined ? readColumnValues(sheet, mapping.corpNumCol, minRow, maxRow) : null;
  const regValues = mapping.regNumCol !== undefined ? readColumnValues(sheet, mapping.regNumCol, minRow, maxRow) : null;
  // 既存出力の法人番号列（候補選択済み・前回解決済み）を再利用する。
  const outCorpValues = corpOutputCol !== undefined ? readColumnValues(sheet, corpOutputCol, minRow, maxRow) : null;

  return rows.map((row) => {
    const name = nameValues !== null ? String(pickByRow(nameValues, row, minRow) ?? '').trim() : '';
    const givenCorp = corpValues !== null ? extractDigits(pickByRow(corpValues, row, minRow)) : '';
    const reusedCorp = outCorpValues !== null ? extractDigits(pickByRow(outCorpValues, row, minRow)) : '';
    const effectiveCorpNumber = isCorporateNumber(givenCorp)
      ? givenCorp
      : isCorporateNumber(reusedCorp)
        ? reusedCorp
        : '';
    const rawReg = regValues !== null ? String(pickByRow(regValues, row, minRow) ?? '').trim().toUpperCase() : '';
    const givenRegNumber = isRegistrationNumber(rawReg) ? rawReg : '';
    const empty = name === '' && effectiveCorpNumber === '' && givenRegNumber === '';
    return { row, name, effectiveCorpNumber, givenRegNumber, empty };
  });
}

// ---------------------------------------------------------------------------
// 出力列の必要集合
// ---------------------------------------------------------------------------

function neededOutputColumns(options: ProcessOptions): OutputColumnId[] {
  const ids: OutputColumnId[] = ['status'];
  if (options.doNormalize) ids.push('normalizedName');
  // 法人番号列は解決・付与・インボイスのいずれかで必要（結果保持・再利用のため）。
  const anyEnrich =
    options.enrichFields.basic ||
    options.enrichFields.gbizBasic ||
    options.enrichFields.subsidy ||
    options.enrichFields.procurement;
  if (options.doResolve || anyEnrich || options.doInvoice) ids.push('corporateNumber');
  if (options.enrichFields.basic) ids.push('address', 'kind');
  if (options.enrichFields.gbizBasic) ids.push('gbizIndustry', 'gbizEstablished', 'gbizEmployees');
  if (options.enrichFields.subsidy) ids.push('subsidy');
  if (options.enrichFields.procurement) ids.push('procurement');
  if (options.doInvoice) ids.push('invoice');
  return ids;
}

// ---------------------------------------------------------------------------
// 行アキュムレータ
// ---------------------------------------------------------------------------

interface RowAccumulator {
  readonly input: RowInput;
  readonly cells: Partial<Record<OutputColumnId, string>>;
  /** 一時的エラーがあったか（再実行対象にする）。 */
  hadError: boolean;
  /** 候補選択待ちか（FR-3）。 */
  pending: boolean;
  /** 最初のエラー理由（ステータス表示用）。 */
  firstError: string;
}

function setError(acc: RowAccumulator, reason: string): void {
  acc.hadError = true;
  if (acc.firstError === '') acc.firstError = reason;
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/**
 * バッチ処理エントリポイント（N-2: サイドバーが50行ずつ逐次呼ぶ）。
 * @param raw サイドバーからの ProcessBatchRequest（unknown として検証）
 */
export function processBatch(raw: unknown): ProcessBatchResult {
  const request = parseRequest(raw);
  const { options } = request;
  const sheet = getSheetByNameOrThrow(request.sheetName);
  const userKey = getStableUserKey();
  const licenseKey = getStoredLicenseKey();
  const licenseKeyArg = licenseKey === '' ? undefined : licenseKey;
  const notices: string[] = [];

  // 出力列を確保（再実行で既存列を再利用）。
  const neededIds = neededOutputColumns(options);
  const outCols = ensureOutputColumns(sheet, request.headerRow, neededIds);

  // ① 対象列だけ読む（N-3）。
  const inputs = readInputs(sheet, request.rows, request.mapping, outCols.corporateNumber);
  const activeInputs = inputs.filter((i) => !i.empty);

  // 空行しかない場合は消費も処理もしない。
  if (activeInputs.length === 0) {
    const usageResult = backendClient.getUsage(userKey, licenseKeyArg);
    return {
      processed: 0,
      errors: 0,
      ambiguous: [],
      usage: usageResult.ok ? usageResult.data : null,
      notices,
    };
  }

  // ② 無料枠を消費（対象行数）。不足なら処理せず quotaExceeded。
  const consume = backendClient.consumeUsage(userKey, activeInputs.length, licenseKeyArg);
  if (!consume.ok) {
    // BACKEND 障害・未設定は全体エラーとして投げる（無言にしない・N-4）。
    throw new Error(consume.message);
  }
  if (!consume.data.allowed) {
    return {
      processed: 0,
      errors: 0,
      ambiguous: [],
      usage: consume.data,
      quotaExceeded: true,
      notices,
    };
  }

  const accs: RowAccumulator[] = activeInputs.map((input) => ({
    input,
    cells: {},
    hadError: false,
    pending: false,
    firstError: '',
  }));

  const ambiguous: AmbiguousItem[] = [];

  // ③ /resolve（正規化＋法人番号解決）。
  const callResolve = options.doNormalize || options.doResolve;
  if (callResolve) {
    runResolve(accs, options, userKey, ambiguous, notices);
  }

  // ④ /enrich（選択フィールド）。
  const anyEnrich =
    options.enrichFields.basic ||
    options.enrichFields.gbizBasic ||
    options.enrichFields.subsidy ||
    options.enrichFields.procurement;
  if (anyEnrich) {
    runEnrich(accs, options, userKey, notices);
  }

  // ⑤ /invoice（登録番号のみ・CR-1）。
  if (options.doInvoice) {
    runInvoice(accs, userKey, notices);
  }

  // ⑥ ステータス確定 + 書き込み（FR-7）。
  const rowOutputs: RowOutput[] = accs.map((acc) => {
    const status = acc.pending
      ? STATUS.pending
      : acc.hadError
        ? statusError(acc.firstError)
        : STATUS.success;
    acc.cells.status = status;
    return { row: acc.input.row, cells: acc.cells };
  });
  writeRowOutputs(sheet, outCols, rowOutputs);

  // ⑦ 集計。
  const errors = accs.filter((a) => a.hadError).length;
  const processed = accs.filter((a) => !a.hadError && !a.pending).length;

  return {
    processed,
    errors,
    ambiguous,
    usage: consume.data,
    notices,
  };
}

// ---------------------------------------------------------------------------
// 各ステージ
// ---------------------------------------------------------------------------

function runResolve(
  accs: RowAccumulator[],
  options: ProcessOptions,
  userKey: string,
  ambiguous: AmbiguousItem[],
  notices: string[],
): void {
  // 社名がある行だけ照会する。
  const targets = accs.filter((a) => a.input.name !== '');
  if (targets.length === 0) return;
  const names = targets.map((a) => a.input.name);
  const result = backendClient.resolve(userKey, names);
  if (!result.ok) {
    // 系統的失敗（例: houjin_not_configured 503）。全対象行にエラーを立て、notice で可視化。
    if (!notices.includes(result.message)) notices.push(result.message);
    for (const acc of targets) setError(acc, result.message);
    return;
  }
  result.data.forEach((row: ResolveRow, index: number) => {
    const acc = targets[index];
    if (acc === undefined) return;
    if (options.doNormalize) acc.cells.normalizedName = row.normalized;
    if (row.error !== undefined) {
      setError(acc, row.error.message);
      return;
    }
    if (!options.doResolve) return;
    // 既にユーザー指定の法人番号がある行は解決結果で上書きしない。
    if (acc.input.effectiveCorpNumber !== '') return;

    if (row.confidence === 'exact' && row.candidates !== undefined && row.candidates.length === 1) {
      const corp = row.candidates[0].corporateNumber;
      acc.input.effectiveCorpNumber = corp;
      acc.cells.corporateNumber = corp;
    } else if (row.confidence === 'ambiguous' && row.candidates !== undefined) {
      acc.pending = true;
      acc.cells.corporateNumber = '候補選択待ち';
      ambiguous.push({
        row: acc.input.row,
        input: acc.input.name,
        candidates: row.candidates.map((c) => ({
          corporateNumber: c.corporateNumber,
          name: c.name,
          address: c.address,
        })),
      });
    } else {
      // not_found。
      acc.cells.corporateNumber = '該当なし';
    }
  });
}

function runEnrich(
  accs: RowAccumulator[],
  options: ProcessOptions,
  userKey: string,
  notices: string[],
): void {
  // 有効な法人番号がある行だけ付与する（候補選択待ちは対象外）。
  const targets = accs.filter((a) => !a.pending && isCorporateNumber(a.input.effectiveCorpNumber));
  if (targets.length === 0) return;
  const numbers = targets.map((a) => a.input.effectiveCorpNumber);
  const result = backendClient.enrich(userKey, numbers, options.enrichFields);
  if (!result.ok) {
    if (!notices.includes(result.message)) notices.push(result.message);
    for (const acc of targets) setError(acc, result.message);
    return;
  }
  result.data.forEach((row: EnrichRow, index: number) => {
    const acc = targets[index];
    if (acc === undefined) return;
    if (row.error !== undefined) {
      setError(acc, row.error.message);
      return;
    }
    applyEnrichRow(acc, row);
    if (row.notices !== undefined) {
      for (const n of row.notices) if (!notices.includes(n)) notices.push(n);
    }
  });
}

function applyEnrichRow(acc: RowAccumulator, row: EnrichRow): void {
  const address = basicAddressText(row.basic);
  if (address !== undefined) acc.cells.address = address;
  const kind = basicKindText(row.basic);
  if (kind !== undefined) acc.cells.kind = kind;
  const industry = gbizIndustryText(row.gbizBasic);
  if (industry !== undefined) acc.cells.gbizIndustry = industry;
  const established = gbizEstablishedText(row.gbizBasic);
  if (established !== undefined) acc.cells.gbizEstablished = established;
  const employees = gbizEmployeesText(row.gbizBasic);
  if (employees !== undefined) acc.cells.gbizEmployees = employees;
  const subsidy = subsidyText(row.subsidy);
  if (subsidy !== undefined) acc.cells.subsidy = subsidy;
  const procurement = procurementText(row.procurement);
  if (procurement !== undefined) acc.cells.procurement = procurement;

  // フィールド単位のエラーは再実行対象にする（FR-8。not_found はエラーにしない）。
  for (const outcome of [row.basic, row.gbizBasic, row.subsidy, row.procurement]) {
    if (outcome !== undefined && outcome.status === 'error') {
      setError(acc, outcome.error.message);
    }
  }
}

function runInvoice(accs: RowAccumulator[], userKey: string, notices: string[]): void {
  // 登録番号: ユーザー指定を優先、無ければ法人番号から機械生成（CR-1）。
  const targets: { acc: RowAccumulator; reg: string }[] = [];
  for (const acc of accs) {
    if (acc.pending) continue;
    const reg =
      acc.input.givenRegNumber !== ''
        ? acc.input.givenRegNumber
        : registrationNumberFromCorporateNumber(acc.input.effectiveCorpNumber);
    if (reg !== '') targets.push({ acc, reg });
  }
  if (targets.length === 0) return;

  const result = backendClient.invoice(userKey, targets.map((t) => t.reg));
  if (!result.ok) {
    if (result.code === 'invoice_disabled') {
      // 準備中（縮退公開・503）。エラーにはせず「準備中」を書いて可視化（無言にしない）。
      const notice = 'インボイス登録確認は準備中です（インボイス機能の提供開始までお待ちください）。';
      if (!notices.includes(notice)) notices.push(notice);
      for (const t of targets) t.acc.cells.invoice = '準備中';
      return;
    }
    if (!notices.includes(result.message)) notices.push(result.message);
    for (const t of targets) setError(t.acc, result.message);
    return;
  }
  result.data.forEach((status, index) => {
    const target = targets[index];
    if (target === undefined) return;
    target.acc.cells.invoice = formatInvoiceStatus(status);
    if (status.error !== undefined) setError(target.acc, status.error.message);
  });
}

// ---------------------------------------------------------------------------
// 再実行対象行の取得（FR-8）
// ---------------------------------------------------------------------------

/**
 * ステータス列が '成功' 以外の行番号を返す（FR-8「未処理・エラー行のみ再実行」）。
 * ステータス列が未生成（初回未実行）なら範囲内の全行を返す。
 */
export function getReprocessRows(
  sheetName: unknown,
  headerRow: unknown,
  startRow: unknown,
  endRow: unknown,
): number[] {
  const name = typeof sheetName === 'string' ? sheetName : '';
  if (name === '') throw new Error('対象シートが指定されていません。');
  const hRow = asPositiveInt(headerRow, 'ヘッダー行');
  const start = asPositiveInt(startRow, '開始行');
  const end = asPositiveInt(endRow, '終了行');
  if (end < start) return [];

  const sheet = getSheetByNameOrThrow(name);
  const statusCol = findExistingOutputColumn(sheet, hRow, 'status');
  const rows: number[] = [];
  if (statusCol === null) {
    for (let r = start; r <= end; r++) rows.push(r);
    return rows;
  }
  const values = readColumnValues(sheet, statusCol, start, end);
  for (let i = 0; i < values.length; i++) {
    const status = values[i] === null || values[i] === undefined ? '' : String(values[i]);
    if (isReprocessTarget(status)) rows.push(start + i);
  }
  return rows;
}
