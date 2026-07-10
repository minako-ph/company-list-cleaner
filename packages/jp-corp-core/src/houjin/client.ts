import iconv from 'iconv-lite';
import type { DriftReport } from '@jp-opendata/schema-buffer';
import { GovHttpClient } from '../http.js';
import { parseHoujinCsv } from './csv.js';
import { parseHoujinXml } from './xml.js';
import { type HoujinCorporation, type HoujinHeader, type HoujinResponseType } from './schema.js';

/**
 * 国税庁 法人番号Web-API Ver.4 クライアント（docs/research/houjin-webapi-v4.md）。
 * - 対象は `/4/num`（番号指定・最大10件）と `/4/name`（名称検索）のみ（/diffは非対応）。
 * - 認証はクエリ `id=`（アプリケーションID・英数字13桁。実IDで英字混在を確認済み 2026-07-10）。
 *   コンストラクタで受け取り、環境変数は直接読まない。
 *   `id=` はエラーメッセージ（redactUrlForError）・publicUrl のいずれにも含めない。
 * - 応答は XML(type=12)・CSV(type=01 Shift_JIS/type=02 Unicode)。レート既定1req/秒。
 */

const HOUJIN_BASE_URL = 'https://api.houjin-bangou.nta.go.jp';
export const HOUJIN_DEFAULT_INTERVAL_MS = 1_000;
/** `/4/num` の番号指定は最大10件（docs/research/houjin-webapi-v4.md） */
export const HOUJIN_NUM_MAX = 10;

export interface HoujinClientOptions {
  /** アプリケーションID（英数字13桁）。クエリ id= として送出する。 */
  id: string;
  http?: GovHttpClient;
  baseUrl?: string;
}

/** `/4/num`（番号指定）のオプション。 */
export interface HoujinNumOptions {
  /** 応答形式（既定 '12'=XML）。 */
  type?: HoujinResponseType;
  /** 変更履歴を含めるか（0=含めない・既定 / 1=含める）。 */
  history?: 0 | 1;
}

/** `/4/name`（名称検索）のオプション（docs/research/houjin-webapi-v4.md のパラメータ）。 */
export interface HoujinNameOptions {
  /** 応答形式（既定 '12'=XML）。 */
  type?: HoujinResponseType;
  /** 1=前方一致（既定）/ 2=部分一致。 */
  mode?: 1 | 2;
  /** 1=あいまい（既定）/ 2=完全一致 / 3=英語表記。 */
  target?: 1 | 2 | 3;
  /** 所在地（都道府県2桁 or +市区町村5桁）。 */
  address?: string;
  /** 法人種別（01/02/03/04）。 */
  kind?: string;
  /** 変更履歴の有無での絞り込み（0/1）。 */
  change?: 0 | 1;
  /** 登記記録の閉鎖を含めるか（0/1・既定1）。 */
  close?: 0 | 1;
  /** 取得期間の開始（YYYY-MM-DD、from≥2015-10-05）。 */
  from?: string;
  /** 取得期間の終了（YYYY-MM-DD）。 */
  to?: string;
  /** 分割番号（2,000件超の分割取得）。 */
  divide?: number;
}

export interface HoujinResult {
  header: HoujinHeader;
  corporations: HoujinCorporation[];
  drift: DriftReport;
  /** アプリケーションIDを含まない公開可能なリクエストURL（source_url用）。 */
  publicUrl: string;
  responseType: HoujinResponseType;
}

type QueryEntry = readonly [key: string, value: string, encode: boolean];

/** id を含まないクエリ文字列を組み立てる（source_url用）。encode=false は数値・カンマ区切り等URL安全な値。 */
function buildQuery(entries: readonly QueryEntry[]): string {
  return entries
    .map(([key, value, encode]) => `${key}=${encode ? encodeURIComponent(value) : value}`)
    .join('&');
}

export class HoujinClient {
  private readonly id: string;
  private readonly http: GovHttpClient;
  private readonly baseUrl: string;

  constructor(options: HoujinClientOptions) {
    // 実IDは英字混在13桁（2026-07-10到着分で確認。数字のみの旧仮定は誤り）
    if (!/^[0-9A-Za-z]{13}$/.test(options.id)) {
      throw new Error('アプリケーションIDは英数字13桁');
    }
    this.id = options.id;
    this.baseUrl = options.baseUrl ?? HOUJIN_BASE_URL;
    this.http = options.http ?? new GovHttpClient({ intervalMs: HOUJIN_DEFAULT_INTERVAL_MS });
  }

  /** `/4/num`: 法人番号（13桁）を最大10件指定して取得する。 */
  async findByNumbers(
    numbers: readonly string[],
    options: HoujinNumOptions = {},
  ): Promise<HoujinResult> {
    if (numbers.length === 0) {
      throw new Error('numberは1件以上必要');
    }
    if (numbers.length > HOUJIN_NUM_MAX) {
      throw new Error(`numberは最大${HOUJIN_NUM_MAX}件（指定: ${numbers.length}件）`);
    }
    for (const n of numbers) {
      if (!/^\d{13}$/.test(n)) {
        throw new Error(`法人番号は13桁の数字のみ: ${n}`);
      }
    }
    const type = options.type ?? '12';
    const history = options.history ?? 0;
    const entries: QueryEntry[] = [
      ['number', numbers.join(','), false],
      ['type', type, false],
      ['history', String(history), false],
    ];
    return this.request('/4/num', entries, type);
  }

  /** `/4/name`: 名称で検索する（nameは単一・URLエンコードして送出）。 */
  async searchByName(name: string, options: HoujinNameOptions = {}): Promise<HoujinResult> {
    if (name === '') {
      throw new Error('nameは空にできない');
    }
    const type = options.type ?? '12';
    const entries: QueryEntry[] = [
      ['name', name, true],
      ['type', type, false],
    ];
    if (options.mode !== undefined) entries.push(['mode', String(options.mode), false]);
    if (options.target !== undefined) entries.push(['target', String(options.target), false]);
    if (options.address !== undefined) entries.push(['address', options.address, true]);
    if (options.kind !== undefined) entries.push(['kind', options.kind, false]);
    if (options.change !== undefined) entries.push(['change', String(options.change), false]);
    if (options.close !== undefined) entries.push(['close', String(options.close), false]);
    if (options.from !== undefined) entries.push(['from', options.from, false]);
    if (options.to !== undefined) entries.push(['to', options.to, false]);
    if (options.divide !== undefined) entries.push(['divide', String(options.divide), false]);
    return this.request('/4/name', entries, type);
  }

  private async request(
    path: string,
    entries: readonly QueryEntry[],
    type: HoujinResponseType,
  ): Promise<HoujinResult> {
    const publicQuery = buildQuery(entries);
    const publicUrl = `${this.baseUrl}${path}?${publicQuery}`;
    // id は先頭に付与するが publicUrl には含めない（source_url・エラーへ漏らさない）
    const requestUrl = `${this.baseUrl}${path}?id=${this.id}&${publicQuery}`;
    const response = await this.http.getBinary(requestUrl);
    const parsed =
      type === '01'
        ? parseHoujinCsv(iconv.decode(Buffer.from(response.body), 'Shift_JIS'))
        : type === '12'
          ? parseHoujinXml(new TextDecoder('utf-8').decode(response.body))
          : parseHoujinCsv(new TextDecoder('utf-8').decode(response.body));
    return {
      header: parsed.header,
      corporations: parsed.corporations,
      drift: parsed.drift,
      publicUrl,
      responseType: type,
    };
  }

  /** 実行終端の監視集計（N-4）用にHTTP統計を公開する。 */
  getHttpStats(): ReturnType<GovHttpClient['getStats']> {
    return this.http.getStats();
  }
}
