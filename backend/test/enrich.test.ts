import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { HoujinCorporation } from '@jp-opendata/gov-clients/houjin';
import { HoujinClient } from '@jp-opendata/gov-clients/houjin';
import type { GbizBasicInfo } from '@jp-opendata/gov-clients/gbizinfo';
import { GbizinfoClient } from '@jp-opendata/gov-clients/gbizinfo';
import { GovHttpClient, type FetchLike } from '@jp-opendata/gov-clients/http';
import {
  enrichCorporations,
  type EnrichRow,
  type GbizDep,
  type HoujinBasicDep,
} from '../src/services/enrich.js';
import { registerEnrichRoute } from '../src/routes/enrich.js';
import { createSerialQueue } from '../src/queue.js';

/**
 * /enrich（FR-4＋FR-6）のテスト。
 * - basic/gbizBasic/subsidy/procurement の選択付与、トークン未設定スキップ（N-7）、片系障害の継続。
 * - fixture ベースの結合テスト（実クライアント／fetch モック）。実ネットワークは行わない。
 */

function corp(overrides: Partial<HoujinCorporation>): HoujinCorporation {
  const base: HoujinCorporation = {
    sequenceNumber: '', corporateNumber: '', process: '', correct: '', updateDate: '',
    changeDate: '', name: '', nameImageId: '', kind: '', prefectureName: '', cityName: '',
    streetNumber: '', addressImageId: '', prefectureCode: '', cityCode: '', postCode: '',
    addressOutside: '', addressOutsideImageId: '', closeDate: '', closeCause: '',
    successorCorporateNumber: '', changeCause: '', assignmentDate: '', latest: '', enName: '',
    enPrefectureName: '', enCityName: '', enAddressOutside: '', furigana: '', hihyoji: '',
  };
  return { ...base, ...overrides };
}

/** 指定番号ぶんの基本情報を返す houjin モック。 */
function houjinDepReturningAll(): HoujinBasicDep {
  return {
    findByNumbers: async (nums) =>
      nums.map((n) =>
        corp({
          corporateNumber: n,
          name: `テスト社${n}`,
          kind: '301',
          prefectureName: '東京都',
          cityName: '港区',
          streetNumber: '1-1-1',
        }),
      ),
  };
}

const N1 = '1000000000001';
const N2 = '2000000000002';

describe('enrichCorporations（サービス層）', () => {
  it('basic: 商号・所在地・法人種別を付与する', async () => {
    const rows = await enrichCorporations([N1], { basic: true }, { houjin: houjinDepReturningAll() });
    expect(rows[0]?.basic).toEqual({
      status: 'ok',
      data: { name: `テスト社${N1}`, address: '東京都港区1-1-1', kind: '301' },
    });
  });

  it('basic: findByNumbers に現れない番号は not_found', async () => {
    const houjin: HoujinBasicDep = { findByNumbers: async () => [] };
    const rows = await enrichCorporations([N1], { basic: true }, { houjin });
    expect(rows[0]?.basic).toEqual({ status: 'not_found' });
  });

  it('gbizBasic/subsidy/procurement を選択付与する（有無＋直近件数）', async () => {
    const gbiz: GbizDep = {
      getBasic: async (n) => ({
        corporate_number: n,
        name: 'サンプル株式会社',
        location: '東京都千代田区',
        employee_number: 250,
        capital_stock: 100000000,
        date_of_establishment: '2001-04-01',
        business_items: ['情報通信業'],
      }),
      getSubsidy: async (n) => ({
        corporate_number: n,
        name: 'サンプル株式会社',
        subsidy: [{ title: 'A' }, { title: 'B' }],
      }),
      getProcurement: async (n) => ({
        corporate_number: n,
        name: 'サンプル株式会社',
        procurement: [],
      }),
    };
    const rows = await enrichCorporations(
      [N1],
      { gbizBasic: true, subsidy: true, procurement: true },
      { gbiz },
    );
    const row = rows[0];
    expect(row?.gbizBasic).toEqual({
      status: 'ok',
      data: {
        name: 'サンプル株式会社',
        location: '東京都千代田区',
        employeeNumber: 250,
        capitalStock: 100000000,
        dateOfEstablishment: '2001-04-01',
        businessItems: ['情報通信業'],
      },
    });
    expect(row?.subsidy).toEqual({ status: 'ok', data: { has: true, recentCount: 2 } });
    expect(row?.procurement).toEqual({ status: 'ok', data: { has: false, recentCount: 0 } });
  });

  it('gBizINFO トークン未設定（gbiz なし）は該当フィールドをスキップし notice を付ける（N-7）', async () => {
    const rows = await enrichCorporations(
      [N1],
      { gbizBasic: true, subsidy: true, procurement: true },
      { houjin: houjinDepReturningAll() }, // gbiz 無し
    );
    const row = rows[0];
    expect(row?.gbizBasic).toBeUndefined();
    expect(row?.subsidy).toBeUndefined();
    expect(row?.procurement).toBeUndefined();
    expect(row?.notices).toHaveLength(3);
    expect(row?.notices?.some((m) => m.includes('gBizINFO'))).toBe(true);
  });

  it('法人番号API 未設定（houjin なし）は basic をスキップし notice を付ける（N-7）', async () => {
    const gbiz: GbizDep = {
      getBasic: async () => undefined,
      getSubsidy: async (n) => ({ corporate_number: n, name: 'x', subsidy: [{ title: 'A' }] }),
      getProcurement: async () => undefined,
    };
    const rows = await enrichCorporations([N1], { basic: true, subsidy: true }, { gbiz });
    const row = rows[0];
    expect(row?.basic).toBeUndefined();
    expect(row?.notices?.some((m) => m.includes('法人番号API'))).toBe(true);
    // gbiz 系は継続して返る。
    expect(row?.subsidy).toEqual({ status: 'ok', data: { has: true, recentCount: 1 } });
  });

  it('片系障害（FR-8/N-7）: houjin 障害でも gbiz は返る', async () => {
    const houjin: HoujinBasicDep = {
      findByNumbers: async () => {
        throw new Error('houjin down');
      },
    };
    const gbiz: GbizDep = {
      getBasic: async () => undefined,
      getSubsidy: async (n) => ({ corporate_number: n, name: 'x', subsidy: [{ title: 'A' }] }),
      getProcurement: async () => undefined,
    };
    const rows = await enrichCorporations([N1], { basic: true, subsidy: true }, { houjin, gbiz });
    const row = rows[0];
    expect(row?.basic).toEqual({
      status: 'error',
      error: { code: 'request_failed', message: '法人番号APIへのリクエストに失敗しました' },
    });
    expect(row?.subsidy).toEqual({ status: 'ok', data: { has: true, recentCount: 1 } });
  });

  it('gbiz の1フィールド障害は当該フィールドのみ error、他フィールドは継続', async () => {
    const gbiz: GbizDep = {
      getBasic: async () => {
        throw new Error('boom');
      },
      getSubsidy: async (n) => ({ corporate_number: n, name: 'x', subsidy: [] }),
      getProcurement: async () => undefined,
    };
    const rows = await enrichCorporations([N1], { gbizBasic: true, subsidy: true }, { gbiz });
    expect(rows[0]?.gbizBasic?.status).toBe('error');
    expect(rows[0]?.subsidy).toEqual({ status: 'ok', data: { has: false, recentCount: 0 } });
  });

  it('法人番号の形式不正は行単位 error にしフィールド付与を行わない', async () => {
    const rows = await enrichCorporations(
      ['not-a-number', N1],
      { basic: true },
      { houjin: houjinDepReturningAll() },
    );
    expect(rows[0]?.error?.code).toBe('invalid_format');
    expect(rows[0]?.basic).toBeUndefined();
    // 妥当な番号は通常どおり付与される（部分失敗で全体を止めない）。
    expect(rows[1]?.basic?.status).toBe('ok');
  });

  it('basic は10件ずつバッチ照会する（findByNumbers を 10/5 で2回）', async () => {
    const calls: string[][] = [];
    const houjin: HoujinBasicDep = {
      findByNumbers: async (nums) => {
        calls.push(nums);
        return nums.map((n) => corp({ corporateNumber: n, name: n }));
      },
    };
    const numbers = Array.from({ length: 15 }, (_, i) => String(i).padStart(13, '0'));
    const rows = await enrichCorporations(numbers, { basic: true }, { houjin });
    expect(calls.map((c) => c.length)).toEqual([10, 5]);
    expect(rows).toHaveLength(15);
    expect(rows.every((r) => r.basic?.status === 'ok')).toBe(true);
  });

  it('選択されていないフィールドは出力に含めない', async () => {
    const rows = await enrichCorporations([N1], { basic: true }, { houjin: houjinDepReturningAll() });
    const row = rows[0];
    expect(row?.basic).toBeDefined();
    expect(row?.gbizBasic).toBeUndefined();
    expect(row?.subsidy).toBeUndefined();
    expect(row?.procurement).toBeUndefined();
    expect(row?.notices).toBeUndefined();
  });

  it('入力順を保持する', async () => {
    const rows = await enrichCorporations([N1, N2], { basic: true }, { houjin: houjinDepReturningAll() });
    expect(rows.map((r) => r.corporateNumber)).toEqual([N1, N2]);
  });
});

describe('enrichCorporations（fixture ベース結合・実クライアント / fetch モック）', () => {
  const fixturesRoot = new URL('../../packages/jp-corp-core/fixtures/', import.meta.url);

  function readFixture(rel: string): string {
    return readFileSync(fileURLToPath(new URL(rel, fixturesRoot)), 'utf8');
  }

  /** 常に指定バイト列/テキストを返す GovHttpClient を作る。 */
  function httpReturning(text: string): GovHttpClient {
    const bytes = new TextEncoder().encode(text);
    const fetchFn: FetchLike = async () => ({
      status: 200,
      text: async () => text,
      arrayBuffer: async () => bytes.buffer,
    });
    return new GovHttpClient({ intervalMs: 0, fetchFn });
  }

  it('houjin num_0_ver4_x4.xml で basic を付与する', async () => {
    const client = new HoujinClient({
      id: '1234567890123',
      http: httpReturning(readFixture('houjin/num_0_ver4_x4.xml')),
    });
    const queue = createSerialQueue(1000);
    const houjin: HoujinBasicDep = {
      findByNumbers: (nums) =>
        queue.enqueue(async () => (await client.findByNumbers(nums, { type: '12' })).corporations),
    };
    const rows = await enrichCorporations(['5111101000006'], { basic: true }, { houjin });
    expect(rows[0]?.basic).toEqual({
      status: 'ok',
      data: {
        name: '株式会社検索対象除外',
        address: '東京都千代田区（東京市神田区小川町一丁目１０番地）',
        kind: '301',
      },
    });
  });

  it('gBizINFO subsidy 実応答 fixture（amount が文字列）で補助金フラグ（有・件数5）を付与する', async () => {
    // 実応答（2026-07-10採取・柱2で実データ検証済み）は amount が数値でなく文字列で返る。
    // gbizinfo スキーマの z.union([number, string]) 対応（柱2 2026-07-10修正）を FR-6 経路で固定する。
    const fixtureText = readFixture('gbizinfo/subsidy.7010001008844.2026-07-10.json');
    // fixture 自体が「文字列 amount」を含むことを担保（数値のみの fixture に差し替わったら本テストの意味が失われるため）
    expect(fixtureText).toMatch(/"amount":\s*"\d+"/);
    const client = new GbizinfoClient({
      token: 'test-token',
      http: httpReturning(fixtureText),
    });
    const queue = createSerialQueue(1000);
    const gbiz: GbizDep = {
      getBasic: async () => undefined,
      getSubsidy: (n) => queue.enqueue(async () => (await client.getSubsidies(n)).hojinInfos[0]),
      getProcurement: async () => undefined,
    };
    const rows = await enrichCorporations(['7010001008844'], { subsidy: true }, { gbiz });
    expect(rows[0]?.subsidy).toEqual({ status: 'ok', data: { has: true, recentCount: 5 } });
  });

  it('gBizINFO procurement 実応答 fixture で調達フラグを付与する（FR-6）', async () => {
    const client = new GbizinfoClient({
      token: 'test-token',
      http: httpReturning(readFixture('gbizinfo/procurement.7010001008844.trimmed.2026-07-10.json')),
    });
    const queue = createSerialQueue(1000);
    const gbiz: GbizDep = {
      getBasic: async () => undefined,
      getSubsidy: async () => undefined,
      getProcurement: (n) =>
        queue.enqueue(async () => (await client.getProcurements(n)).hojinInfos[0]),
    };
    const rows = await enrichCorporations(['7010001008844'], { procurement: true }, { gbiz });
    const procurement = rows[0]?.procurement;
    if (procurement?.status !== 'ok') {
      throw new Error(`procurement が ok でない: ${JSON.stringify(procurement)}`);
    }
    expect(procurement.data.has).toBe(true);
    expect(procurement.data.recentCount).toBeGreaterThan(0);
  });
});

describe('POST /enrich ルート', () => {
  async function postEnrich(app: Hono, body: unknown): Promise<Response> {
    return app.request('/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('enrich 結果を { results } で返し、fields を渡す', async () => {
    const rows: EnrichRow[] = [{ corporateNumber: N1, basic: { status: 'not_found' } }];
    const app = new Hono();
    const enrich = vi.fn(() => Promise.resolve(rows));
    registerEnrichRoute(app, { enrich });

    const res = await postEnrich(app, {
      userKey: 'u',
      corporateNumbers: [N1],
      fields: { basic: true },
    });
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    expect(json).toEqual({ results: rows });
    expect(enrich).toHaveBeenCalledWith(
      [N1],
      { basic: true, gbizBasic: false, subsidy: false, procurement: false },
      { userKey: 'u' },
    );
  });

  it('userKey 欠落 / corporateNumbers 非配列は 400', async () => {
    const app = new Hono();
    registerEnrichRoute(app, { enrich: () => Promise.resolve<EnrichRow[]>([]) });
    expect((await postEnrich(app, { corporateNumbers: [N1], fields: {} })).status).toBe(400);
    expect((await postEnrich(app, { userKey: 'u', corporateNumbers: N1, fields: {} })).status).toBe(400);
  });

  it('corporateNumbers が上限（50件）超で 400', async () => {
    const app = new Hono();
    registerEnrichRoute(app, { enrich: () => Promise.resolve<EnrichRow[]>([]) });
    const numbers = Array.from({ length: 51 }, (_, i) => String(i).padStart(13, '0'));
    expect((await postEnrich(app, { userKey: 'u', corporateNumbers: numbers, fields: {} })).status).toBe(400);
  });

  it('fields 省略は全 false 扱いで 200（付与フィールドなし）', async () => {
    const app = new Hono();
    const enrich = vi.fn(() => Promise.resolve<EnrichRow[]>([{ corporateNumber: N1 }]));
    registerEnrichRoute(app, { enrich });
    const res = await postEnrich(app, { userKey: 'u', corporateNumbers: [N1] });
    expect(res.status).toBe(200);
    expect(enrich).toHaveBeenCalledWith(
      [N1],
      { basic: false, gbizBasic: false, subsidy: false, procurement: false },
      { userKey: 'u' },
    );
  });
});
