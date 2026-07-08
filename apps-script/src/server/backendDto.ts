/**
 * バックエンド応答の GAS 側 DTO 型と、`unknown`（JSON.parse 結果）からの防御的パーサ（純関数）。
 *
 * バックエンド（backend/src/routes・services）の応答形状に対応する最小の型のみを持つ。
 * 型アサーションを使わず、型ガードで narrow する（CLAUDE.md 準拠・C2 スキーマと実データ乖離対策）。
 * 欠落・型不一致のフィールドは安全な既定値（空文字・空配列・省略）に落とす。
 *
 * GAS 非依存のため vitest でテスト可能。
 */

// ---------------------------------------------------------------------------
// 型（backend の公開応答に対応）
// ---------------------------------------------------------------------------

export type ResolveConfidence = 'exact' | 'ambiguous' | 'not_found';

export interface FieldError {
  readonly code: string;
  readonly message: string;
}

export interface ResolveCandidate {
  readonly corporateNumber: string;
  readonly name: string;
  readonly address: string;
}

export interface ResolveRow {
  readonly input: string;
  readonly normalized: string;
  readonly confidence?: ResolveConfidence;
  readonly candidates?: ResolveCandidate[];
  readonly error?: FieldError;
}

export type FieldOutcome<T> =
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'not_found' }
  | { readonly status: 'error'; readonly error: FieldError };

export interface BasicData {
  readonly name: string;
  readonly address: string;
  readonly kind: string;
}

export interface GbizBasicData {
  readonly name: string;
  readonly businessItems?: string[];
  readonly businessSummary?: string;
  readonly dateOfEstablishment?: string;
  readonly employeeNumber?: number;
}

export interface FlagData {
  readonly has: boolean;
  readonly recentCount: number;
}

export interface EnrichRow {
  readonly corporateNumber: string;
  readonly basic?: FieldOutcome<BasicData>;
  readonly gbizBasic?: FieldOutcome<GbizBasicData>;
  readonly subsidy?: FieldOutcome<FlagData>;
  readonly procurement?: FieldOutcome<FlagData>;
  readonly notices?: string[];
  readonly error?: FieldError;
}

export interface InvoiceStatus {
  readonly registrationNumber: string;
  readonly found: boolean;
  readonly registered: boolean;
  readonly registrationDate?: string;
  readonly disposalDate?: string;
  readonly expireDate?: string;
  readonly error?: FieldError;
}

export type Plan = 'free' | 'pro';

export interface Usage {
  readonly month: string;
  readonly rowsUsed: number;
  readonly limit: number;
  readonly remaining: number;
  readonly plan: Plan;
}

export interface ConsumeResult {
  readonly allowed: boolean;
  readonly month: string;
  readonly rowsUsed: number;
  readonly limit: number;
  readonly remaining: number;
  readonly plan: Plan;
}

export interface LicenseVerification {
  readonly valid: boolean;
  readonly plan?: 'pro';
  readonly periodEnd?: number;
}

/** 公的APIの健全性状態（N-4。degraded=現在連続失敗が閾値以上）。 */
export type ApiHealthState = 'ok' | 'degraded';

/** GET /health の応答（N-4 サイドバー障害表示用）。 */
export interface BackendHealth {
  readonly ok: boolean;
  readonly apis: {
    readonly houjin: ApiHealthState;
    readonly gbizinfo: ApiHealthState;
    readonly invoice: ApiHealthState;
  };
}

// ---------------------------------------------------------------------------
// 汎用ガード
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(o: unknown, key: string): string | undefined {
  if (!isObject(o)) return undefined;
  const v = Reflect.get(o, key);
  return typeof v === 'string' ? v : undefined;
}

function getNumber(o: unknown, key: string): number | undefined {
  if (!isObject(o)) return undefined;
  const v = Reflect.get(o, key);
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function getBoolean(o: unknown, key: string): boolean {
  if (!isObject(o)) return false;
  return Reflect.get(o, key) === true;
}

function getArray(o: unknown, key: string): unknown[] {
  if (!isObject(o)) return [];
  const v = Reflect.get(o, key);
  return Array.isArray(v) ? v : [];
}

function getStringArray(o: unknown, key: string): string[] | undefined {
  if (!isObject(o)) return undefined;
  const v = Reflect.get(o, key);
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out;
}

function parseFieldError(v: unknown): FieldError | undefined {
  if (!isObject(v)) return undefined;
  const code = getString(v, 'code') ?? 'unknown';
  const message = getString(v, 'message') ?? 'エラーが発生しました';
  return { code, message };
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

function parseConfidence(v: string | undefined): ResolveConfidence | undefined {
  return v === 'exact' || v === 'ambiguous' || v === 'not_found' ? v : undefined;
}

function parseCandidate(v: unknown): ResolveCandidate {
  return {
    corporateNumber: getString(v, 'corporateNumber') ?? '',
    name: getString(v, 'name') ?? '',
    address: getString(v, 'address') ?? '',
  };
}

function parseResolveRow(v: unknown): ResolveRow {
  const input = getString(v, 'input') ?? '';
  const normalized = getString(v, 'normalized') ?? '';
  const error = isObject(v) ? parseFieldError(Reflect.get(v, 'error')) : undefined;
  const confidence = parseConfidence(getString(v, 'confidence'));
  const candidatesRaw = isObject(v) ? Reflect.get(v, 'candidates') : undefined;
  const candidates = Array.isArray(candidatesRaw)
    ? candidatesRaw.map(parseCandidate)
    : undefined;
  return {
    input,
    normalized,
    ...(error !== undefined ? { error } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(candidates !== undefined ? { candidates } : {}),
  };
}

/** `{ results: ResolveRow[] }` をパースする。 */
export function parseResolveResults(body: unknown): ResolveRow[] {
  return getArray(body, 'results').map(parseResolveRow);
}

// ---------------------------------------------------------------------------
// enrich
// ---------------------------------------------------------------------------

function parseOutcome<T>(v: unknown, parseData: (d: unknown) => T | undefined): FieldOutcome<T> | undefined {
  if (!isObject(v)) return undefined;
  const status = getString(v, 'status');
  if (status === 'ok') {
    const data = parseData(Reflect.get(v, 'data'));
    return data === undefined ? { status: 'not_found' } : { status: 'ok', data };
  }
  if (status === 'not_found') return { status: 'not_found' };
  if (status === 'error') {
    return { status: 'error', error: parseFieldError(Reflect.get(v, 'error')) ?? { code: 'unknown', message: 'エラーが発生しました' } };
  }
  return undefined;
}

function parseBasicData(v: unknown): BasicData | undefined {
  if (!isObject(v)) return undefined;
  return {
    name: getString(v, 'name') ?? '',
    address: getString(v, 'address') ?? '',
    kind: getString(v, 'kind') ?? '',
  };
}

function parseGbizBasicData(v: unknown): GbizBasicData | undefined {
  if (!isObject(v)) return undefined;
  const businessItems = getStringArray(v, 'businessItems');
  const businessSummary = getString(v, 'businessSummary');
  const dateOfEstablishment = getString(v, 'dateOfEstablishment');
  const employeeNumber = getNumber(v, 'employeeNumber');
  return {
    name: getString(v, 'name') ?? '',
    ...(businessItems !== undefined ? { businessItems } : {}),
    ...(businessSummary !== undefined ? { businessSummary } : {}),
    ...(dateOfEstablishment !== undefined ? { dateOfEstablishment } : {}),
    ...(employeeNumber !== undefined ? { employeeNumber } : {}),
  };
}

function parseFlagData(v: unknown): FlagData | undefined {
  if (!isObject(v)) return undefined;
  return { has: getBoolean(v, 'has'), recentCount: getNumber(v, 'recentCount') ?? 0 };
}

function parseEnrichRow(v: unknown): EnrichRow {
  const corporateNumber = getString(v, 'corporateNumber') ?? '';
  const error = isObject(v) ? parseFieldError(Reflect.get(v, 'error')) : undefined;
  const basic = isObject(v) ? parseOutcome(Reflect.get(v, 'basic'), parseBasicData) : undefined;
  const gbizBasic = isObject(v)
    ? parseOutcome(Reflect.get(v, 'gbizBasic'), parseGbizBasicData)
    : undefined;
  const subsidy = isObject(v) ? parseOutcome(Reflect.get(v, 'subsidy'), parseFlagData) : undefined;
  const procurement = isObject(v)
    ? parseOutcome(Reflect.get(v, 'procurement'), parseFlagData)
    : undefined;
  const notices = getStringArray(v, 'notices');
  return {
    corporateNumber,
    ...(error !== undefined ? { error } : {}),
    ...(basic !== undefined ? { basic } : {}),
    ...(gbizBasic !== undefined ? { gbizBasic } : {}),
    ...(subsidy !== undefined ? { subsidy } : {}),
    ...(procurement !== undefined ? { procurement } : {}),
    ...(notices !== undefined && notices.length > 0 ? { notices } : {}),
  };
}

/** `{ results: EnrichRow[] }` をパースする。 */
export function parseEnrichResults(body: unknown): EnrichRow[] {
  return getArray(body, 'results').map(parseEnrichRow);
}

// ---------------------------------------------------------------------------
// invoice
// ---------------------------------------------------------------------------

function parseInvoiceStatus(v: unknown): InvoiceStatus {
  const registrationNumber = getString(v, 'registrationNumber') ?? '';
  const found = getBoolean(v, 'found');
  const registered = getBoolean(v, 'registered');
  const registrationDate = getString(v, 'registrationDate');
  const disposalDate = getString(v, 'disposalDate');
  const expireDate = getString(v, 'expireDate');
  const error = isObject(v) ? parseFieldError(Reflect.get(v, 'error')) : undefined;
  return {
    registrationNumber,
    found,
    registered,
    ...(registrationDate !== undefined ? { registrationDate } : {}),
    ...(disposalDate !== undefined ? { disposalDate } : {}),
    ...(expireDate !== undefined ? { expireDate } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

/** `{ results: InvoiceStatus[] }` をパースする。 */
export function parseInvoiceResults(body: unknown): InvoiceStatus[] {
  return getArray(body, 'results').map(parseInvoiceStatus);
}

// ---------------------------------------------------------------------------
// usage / consume / license
// ---------------------------------------------------------------------------

function parsePlan(v: string | undefined): Plan {
  return v === 'pro' ? 'pro' : 'free';
}

/** `Usage`（GET /usage）をパースする。 */
export function parseUsage(body: unknown): Usage {
  return {
    month: getString(body, 'month') ?? '',
    rowsUsed: getNumber(body, 'rowsUsed') ?? 0,
    limit: getNumber(body, 'limit') ?? 0,
    remaining: getNumber(body, 'remaining') ?? 0,
    plan: parsePlan(getString(body, 'plan')),
  };
}

/** `ConsumeResult`（POST /usage/consume）をパースする。 */
export function parseConsumeResult(body: unknown): ConsumeResult {
  return {
    allowed: getBoolean(body, 'allowed'),
    month: getString(body, 'month') ?? '',
    rowsUsed: getNumber(body, 'rowsUsed') ?? 0,
    limit: getNumber(body, 'limit') ?? 0,
    remaining: getNumber(body, 'remaining') ?? 0,
    plan: parsePlan(getString(body, 'plan')),
  };
}

// ---------------------------------------------------------------------------
// health（N-4）
// ---------------------------------------------------------------------------

/** 'degraded' のみ degraded とみなし、それ以外（欠落・不正含む）は 'ok' に落とす。 */
function parseApiHealthState(o: unknown, key: string): ApiHealthState {
  return getString(o, key) === 'degraded' ? 'degraded' : 'ok';
}

/** `BackendHealth`（GET /health）をパースする。 */
export function parseHealth(body: unknown): BackendHealth {
  const apis = isObject(body) ? Reflect.get(body, 'apis') : undefined;
  return {
    ok: getBoolean(body, 'ok'),
    apis: {
      houjin: parseApiHealthState(apis, 'houjin'),
      gbizinfo: parseApiHealthState(apis, 'gbizinfo'),
      invoice: parseApiHealthState(apis, 'invoice'),
    },
  };
}

/** `LicenseVerification`（POST /license/verify）をパースする。 */
export function parseLicenseVerification(body: unknown): LicenseVerification {
  const valid = getBoolean(body, 'valid');
  const plan = getString(body, 'plan') === 'pro' ? 'pro' : undefined;
  const periodEnd = getNumber(body, 'periodEnd');
  return {
    valid,
    ...(plan !== undefined ? { plan } : {}),
    ...(periodEnd !== undefined ? { periodEnd } : {}),
  };
}
