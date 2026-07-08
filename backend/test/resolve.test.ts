import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { HoujinCorporation } from '@jp-opendata/gov-clients/houjin';
import { HoujinClient } from '@jp-opendata/gov-clients/houjin';
import { GovHttpClient, type FetchLike } from '@jp-opendata/gov-clients/http';
import {
  resolveNames,
  type ResolveRow,
  type SearchByName,
} from '../src/services/resolve.js';
import { registerResolveRoute } from '../src/routes/resolve.js';
import { createSerialQueue } from '../src/queue.js';

/**
 * /resolve（FR-2＋FR-3）のテスト。
 * - 正規化→exact/ambiguous/not_found の3値、重複畳み込み、行単位部分失敗（FR-8）。
 * - fixture ベースの結合テスト（name_ver4_x4.xml を実 HoujinClient で解析。fetch はモック）。
 * 実ネットワークアクセスは行わない（fetch は全てスタブ）。
 */

/** 30項目すべてを空文字で埋め、指定項目だけ上書きした HoujinCorporation を作る。 */
function corp(overrides: Partial<HoujinCorporation>): HoujinCorporation {
  const base: HoujinCorporation = {
    sequenceNumber: '',
    corporateNumber: '',
    process: '',
    correct: '',
    updateDate: '',
    changeDate: '',
    name: '',
    nameImageId: '',
    kind: '',
    prefectureName: '',
    cityName: '',
    streetNumber: '',
    addressImageId: '',
    prefectureCode: '',
    cityCode: '',
    postCode: '',
    addressOutside: '',
    addressOutsideImageId: '',
    closeDate: '',
    closeCause: '',
    successorCorporateNumber: '',
    changeCause: '',
    assignmentDate: '',
    latest: '',
    enName: '',
    enPrefectureName: '',
    enCityName: '',
    enAddressOutside: '',
    furigana: '',
    hihyoji: '',
  };
  return { ...base, ...overrides };
}

describe('resolveNames（サービス層）', () => {
  it('1件ヒット → exact、候補に corporateNumber/name/所在地を含む', async () => {
    const search: SearchByName = vi.fn(async () => [
      corp({
        corporateNumber: '2040001999902',
        name: '株式会社テスト',
        prefectureName: '千葉県',
        cityName: '千葉市中央区',
        streetNumber: '中央４丁目５番８号',
      }),
    ]);

    const [row] = await resolveNames(['（株）テスト'], search);

    expect(row).toEqual<ResolveRow>({
      input: '（株）テスト',
      normalized: '株式会社テスト',
      confidence: 'exact',
      candidates: [
        {
          corporateNumber: '2040001999902',
          name: '株式会社テスト',
          address: '千葉県千葉市中央区中央４丁目５番８号',
        },
      ],
    });
    // 正規化済み名称で検索している（FR-2→FR-3のチェーン）。
    expect(search).toHaveBeenCalledWith('株式会社テスト');
  });

  it('複数ヒット → ambiguous（候補リスト）', async () => {
    const search: SearchByName = async () => [
      corp({ corporateNumber: '1111111111111', name: 'A社' }),
      corp({ corporateNumber: '2222222222222', name: 'B社' }),
    ];
    const [row] = await resolveNames(['テスト'], search);
    expect(row?.confidence).toBe('ambiguous');
    expect(row?.candidates).toHaveLength(2);
  });

  it('0件 → not_found（候補は空配列）', async () => {
    const search: SearchByName = async () => [];
    const [row] = await resolveNames(['存在しない会社'], search);
    expect(row?.confidence).toBe('not_found');
    expect(row?.candidates).toEqual([]);
  });

  it('同一法人番号の重複レコードは1件に畳み込む（誤 ambiguous を防ぐ）', async () => {
    const search: SearchByName = async () => [
      corp({ corporateNumber: '9999999999999', name: '重複社', latest: '0' }),
      corp({ corporateNumber: '9999999999999', name: '重複社', latest: '1' }),
    ];
    const [row] = await resolveNames(['重複社'], search);
    expect(row?.confidence).toBe('exact');
    expect(row?.candidates).toHaveLength(1);
  });

  it('法人番号が空のレコードは候補から除外する', async () => {
    const search: SearchByName = async () => [
      corp({ corporateNumber: '', name: '番号なし' }),
      corp({ corporateNumber: '3333333333333', name: '番号あり' }),
    ];
    const [row] = await resolveNames(['x'], search);
    expect(row?.confidence).toBe('exact');
    expect(row?.candidates?.[0]?.corporateNumber).toBe('3333333333333');
  });

  it('正規化後に空になる入力は照会せず not_found（search を呼ばない）', async () => {
    const search = vi.fn<SearchByName>(async () => []);
    const [row] = await resolveNames(['　　'], search);
    expect(row?.confidence).toBe('not_found');
    expect(row?.normalized).toBe('');
    expect(search).not.toHaveBeenCalled();
  });

  it('行単位部分失敗（FR-8）: 1件の照会失敗は error 行にし、他行は継続する', async () => {
    const search: SearchByName = async (name) => {
      if (name === 'エラー社') throw new Error('network down');
      return [corp({ corporateNumber: '4444444444444', name })];
    };
    const rows = await resolveNames(['正常社', 'エラー社', '別の正常社'], search);

    expect(rows[0]?.confidence).toBe('exact');
    expect(rows[1]?.error?.code).toBe('request_failed');
    // error 行には confidence/candidates を付けない。
    expect(rows[1]?.confidence).toBeUndefined();
    expect(rows[1]?.candidates).toBeUndefined();
    expect(rows[2]?.confidence).toBe('exact');
  });

  it('入力順を保持する', async () => {
    const search: SearchByName = async (name) => [corp({ corporateNumber: '5555555555555', name })];
    const rows = await resolveNames(['A', 'B', 'C'], search);
    expect(rows.map((r) => r.input)).toEqual(['A', 'B', 'C']);
  });
});

describe('resolveNames（fixture ベース結合・実 HoujinClient / fetch モック）', () => {
  const fixturePath = fileURLToPath(
    new URL('../../packages/jp-corp-core/fixtures/houjin/name_ver4_x4.xml', import.meta.url),
  );
  const nameFixtureXml = readFileSync(fixturePath, 'utf8');

  /** 常に指定 XML を返す HoujinClient（＋呼び出しURL記録）を作る。 */
  function clientReturning(xml: string): { search: SearchByName; urls: string[] } {
    const urls: string[] = [];
    const bytes = new TextEncoder().encode(xml);
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      return {
        status: 200,
        text: async () => xml,
        arrayBuffer: async () => bytes.buffer,
      };
    };
    const client = new HoujinClient({
      id: '1234567890123',
      http: new GovHttpClient({ intervalMs: 0, fetchFn }),
    });
    const queue = createSerialQueue(1000);
    const search: SearchByName = (name) =>
      queue.enqueue(async () => {
        const result = await client.searchByName(name, { type: '12', target: 2 });
        return result.corporations;
      });
    return { search, urls };
  }

  it('name_ver4_x4.xml（10法人）→ ambiguous で10候補、所在地を連結する', async () => {
    const { search, urls } = clientReturning(nameFixtureXml);
    const [row] = await resolveNames(['株式会社国税商事'], search);

    expect(row?.confidence).toBe('ambiguous');
    expect(row?.candidates).toHaveLength(10);
    expect(row?.candidates?.[0]).toEqual({
      corporateNumber: '2040001999902',
      name: '株式会社国税商事あ',
      address: '千葉県千葉市中央区中央４丁目５番８号',
    });
    // 名称検索エンドポイントにアプリIDを載せるが publicUrl 由来のログには残さない設計（クライアント責務）。
    expect(urls[0]).toContain('/4/name');
  });

  it('0法人の XML → not_found', async () => {
    const emptyXml =
      '<?xml version="1.0" encoding="UTF-8"?><corporations><lastUpdateDate>2017-05-10</lastUpdateDate><count>0</count><divideNumber>1</divideNumber><divideSize>0</divideSize></corporations>';
    const { search } = clientReturning(emptyXml);
    const [row] = await resolveNames(['存在しない株式会社'], search);
    expect(row?.confidence).toBe('not_found');
    expect(row?.candidates).toEqual([]);
  });
});

describe('POST /resolve ルート', () => {
  async function postResolve(app: Hono, body: unknown): Promise<Response> {
    return app.request('/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('HOUJIN_APP_ID 未設定（houjinConfigured=false）のとき 503 で明示エラー、resolve を呼ばない', async () => {
    const app = new Hono();
    const resolve = vi.fn(() => Promise.resolve<ResolveRow[]>([]));
    registerResolveRoute(app, { houjinConfigured: false, resolve });

    const res = await postResolve(app, { userKey: 'u', names: ['テスト'] });

    expect(res.status).toBe(503);
    const json: unknown = await res.json();
    expect(json).toEqual({ error: 'houjin_not_configured', message: '法人番号照会は現在利用できません' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('有効時は resolve 結果を { results } で返す', async () => {
    const rows: ResolveRow[] = [
      { input: 'テスト', normalized: 'テスト', confidence: 'not_found', candidates: [] },
    ];
    const app = new Hono();
    const resolve = vi.fn(() => Promise.resolve(rows));
    registerResolveRoute(app, { houjinConfigured: true, resolve });

    const res = await postResolve(app, { userKey: 'u', names: ['テスト'] });
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    expect(json).toEqual({ results: rows });
    expect(resolve).toHaveBeenCalledWith(['テスト'], { userKey: 'u' });
  });

  it('userKey 欠落 / names が配列でない場合は 400', async () => {
    const app = new Hono();
    registerResolveRoute(app, {
      houjinConfigured: true,
      resolve: () => Promise.resolve<ResolveRow[]>([]),
    });
    expect((await postResolve(app, { names: ['x'] })).status).toBe(400);
    expect((await postResolve(app, { userKey: 'u', names: 'x' })).status).toBe(400);
  });

  it('names が上限（50件）超で 400', async () => {
    const app = new Hono();
    registerResolveRoute(app, {
      houjinConfigured: true,
      resolve: () => Promise.resolve<ResolveRow[]>([]),
    });
    const names = Array.from({ length: 51 }, (_, i) => `会社${i}`);
    expect((await postResolve(app, { userKey: 'u', names })).status).toBe(400);
  });
});
