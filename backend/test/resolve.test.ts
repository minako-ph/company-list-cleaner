import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { HoujinCorporation, HoujinResult } from '@jp-opendata/gov-clients/houjin';
import { HoujinClient } from '@jp-opendata/gov-clients/houjin';
import { GovHttpClient, type FetchLike } from '@jp-opendata/gov-clients/http';
import {
  resolveNames,
  type ResolveRow,
  type NameSearcher,
} from '../src/services/resolve.js';
import { registerResolveRoute } from '../src/routes/resolve.js';
import { createSerialQueue } from '../src/queue.js';

/**
 * /resolve（FR-2＋FR-3）のテスト。
 * 解決ロジックは jp-corp-core `resolveCompanyName` に委譲済み（柱2 Step A追従）。本テストは
 * backend 側の責務—FR-2 表示正規化の維持・confidence 4値の透過・候補リストの捕捉整形
 * （exact/selected=1件・ambiguous=活性候補・閉鎖/非表示除外）・行単位失敗（FR-8）・
 * 並行リクエストでの候補捕捉の独立性—を検証する。実ネットワークなし（searcher スタブ/fetch モック）。
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

/** 与えた法人配列を1回の検索結果（HoujinResult）に包む。 */
function resultOf(corporations: HoujinCorporation[]): HoujinResult {
  return {
    header: { lastUpdateDate: '2026-07-10', count: corporations.length, divideNumber: 1, divideSize: 1 },
    corporations,
    drift: { unknownFields: [], missingFields: [], hasDrift: false },
    publicUrl: 'https://api.houjin-bangou.nta.go.jp/4/name?name=x&type=12',
    responseType: '12',
  };
}

/** 常に固定の法人配列を返す searcher（呼び出し名を記録）。 */
function searcherReturning(corporations: HoujinCorporation[]): NameSearcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    searchByName: async (name) => {
      calls.push(name);
      return resultOf(corporations);
    },
  };
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('resolveNames（サービス層・resolveCompanyName 委譲）', () => {
  it('exact: 法人格なし入力が法人格付き登記名と一致 → 解決1社を候補に、所在地を連結', async () => {
    const searcher = searcherReturning([
      corp({
        corporateNumber: '7010001008844',
        name: '株式会社日立製作所',
        prefectureName: '東京都',
        cityName: '千代田区',
        streetNumber: '丸の内一丁目６番６号',
      }),
      corp({ corporateNumber: '1010605001151', name: '日立製作所労働組合' }),
    ]);

    const [row] = await resolveNames(['日立製作所'], searcher);

    expect(row).toEqual<ResolveRow>({
      input: '日立製作所',
      normalized: '日立製作所',
      confidence: 'exact',
      candidates: [
        {
          corporateNumber: '7010001008844',
          name: '株式会社日立製作所',
          address: '東京都千代田区丸の内一丁目６番６号',
        },
      ],
    });
  });

  it('FR-2 表示正規化を維持: (株) 略記は normalized で展開し、その正規化名で解決へ渡す', async () => {
    const searcher = searcherReturning([
      corp({ corporateNumber: '2040001999902', name: '株式会社テスト', prefectureName: '千葉県' }),
    ]);

    const [row] = await resolveNames(['（株）テスト'], searcher);

    expect(row?.normalized).toBe('株式会社テスト');
    expect(row?.confidence).toBe('exact');
    expect(row?.candidates?.[0]?.corporateNumber).toBe('2040001999902');
  });

  it('selected: 完全一致なしだが活性候補が1社のみ → その1社を自動採用（候補1件）', async () => {
    const searcher = searcherReturning([
      corp({
        corporateNumber: '2040001999902',
        name: '株式会社国税商事あ',
        prefectureName: '千葉県',
        cityName: '千葉市中央区',
        streetNumber: '中央４丁目５番８号',
      }),
    ]);

    const [row] = await resolveNames(['国税商事'], searcher);

    expect(row?.confidence).toBe('selected');
    expect(row?.candidates).toEqual([
      {
        corporateNumber: '2040001999902',
        name: '株式会社国税商事あ',
        address: '千葉県千葉市中央区中央４丁目５番８号',
      },
    ]);
  });

  it('ambiguous: 完全一致なし・候補複数 → 自動確定せず候補リスト（名称・所在地入り）', async () => {
    const searcher = searcherReturning([
      corp({
        corporateNumber: '1111111111111',
        name: 'テスト商事株式会社',
        prefectureName: '東京都',
        cityName: '港区',
      }),
      corp({
        corporateNumber: '2222222222222',
        name: 'テスト工業株式会社',
        prefectureName: '大阪府',
        cityName: '大阪市北区',
      }),
    ]);

    const [row] = await resolveNames(['テスト'], searcher);

    expect(row?.confidence).toBe('ambiguous');
    expect(row?.candidates).toEqual([
      { corporateNumber: '1111111111111', name: 'テスト商事株式会社', address: '東京都港区' },
      { corporateNumber: '2222222222222', name: 'テスト工業株式会社', address: '大阪府大阪市北区' },
    ]);
  });

  it('not_found: 候補0 → confidence not_found・候補は空配列', async () => {
    const searcher = searcherReturning([]);
    const [row] = await resolveNames(['存在しない会社'], searcher);
    expect(row?.confidence).toBe('not_found');
    expect(row?.candidates).toEqual([]);
  });

  it('正規化後に空になる入力は照会せず not_found（searchByName を呼ばない）', async () => {
    const searcher = searcherReturning([corp({ corporateNumber: '9999999999999', name: 'x' })]);
    const [row] = await resolveNames(['　　'], searcher);
    expect(row?.confidence).toBe('not_found');
    expect(row?.normalized).toBe('');
    expect(searcher.calls).toHaveLength(0);
  });

  it('ambiguous 候補リストから閉鎖済み・非表示レコードを除外する（isActiveCandidate 同条件）', async () => {
    const searcher = searcherReturning([
      corp({ corporateNumber: '1111111111111', name: '甲商事株式会社' }),
      corp({ corporateNumber: '2222222222222', name: '乙商事株式会社' }),
      corp({ corporateNumber: '3333333333333', name: '丙商事株式会社', closeDate: '2020-01-01' }),
      corp({ corporateNumber: '4444444444444', name: '丁商事株式会社', hihyoji: '1' }),
    ]);

    const [row] = await resolveNames(['商事'], searcher);

    expect(row?.confidence).toBe('ambiguous');
    expect(row?.candidates?.map((cand) => cand.corporateNumber)).toEqual([
      '1111111111111',
      '2222222222222',
    ]);
  });

  it('閉鎖済み・非表示のみで活性候補0 → not_found', async () => {
    const searcher = searcherReturning([
      corp({ corporateNumber: '3333333333333', name: '丙商事株式会社', closeDate: '2020-01-01' }),
      corp({ corporateNumber: '4444444444444', name: '丁商事株式会社', hihyoji: '1' }),
    ]);
    const [row] = await resolveNames(['商事'], searcher);
    expect(row?.confidence).toBe('not_found');
    expect(row?.candidates).toEqual([]);
  });

  it('行単位部分失敗（FR-8）: 1件の照会失敗は error 行にし、他行は継続する', async () => {
    const searcher: NameSearcher = {
      // 検索名（法人格除去・全角化後のクエリ）にエラー印を含むときだけ失敗させる。
      searchByName: async (name) => {
        if (name.includes('エラー')) throw new Error('network down');
        return resultOf([corp({ corporateNumber: '5555555555555', name })]);
      },
    };

    const rows = await resolveNames(['正常社', 'エラー社', '別の正常社'], searcher);

    expect(rows[0]?.confidence).toBe('exact');
    expect(rows[1]?.error?.code).toBe('request_failed');
    // error 行には confidence/candidates を付けない。
    expect(rows[1]?.confidence).toBeUndefined();
    expect(rows[1]?.candidates).toBeUndefined();
    expect(rows[2]?.confidence).toBe('exact');
  });

  it('入力順を保持する', async () => {
    const searcher: NameSearcher = {
      searchByName: async (name) => resultOf([corp({ corporateNumber: '6666666666666', name })]),
    };
    const rows = await resolveNames(['A社', 'B社', 'C社'], searcher);
    expect(rows.map((r) => r.input)).toEqual(['A社', 'B社', 'C社']);
  });

  it('並行リクエストでの候補捕捉が行ごとに独立する（捕捉クロージャの取り違えがない）', async () => {
    // 先に起動した行ほど遅延を長くし、解決順を入れ替える。捕捉が共有されていれば
    // 所在地（HoujinResult 由来）が後着の結果に汚染されるため、それを検出する。
    const searcher: NameSearcher = {
      searchByName: async (name) => {
        const isAlpha = name.includes('アルファ');
        await delay(isAlpha ? 20 : 5);
        return resultOf([
          corp({
            corporateNumber: isAlpha ? '1111111111111' : '2222222222222',
            name,
            prefectureName: isAlpha ? '北海道' : '沖縄県',
          }),
        ]);
      },
    };

    const rows = await resolveNames(['アルファ商事株式会社', 'ベータ商事株式会社'], searcher);

    expect(rows[0]?.candidates?.[0]?.corporateNumber).toBe('1111111111111');
    expect(rows[0]?.candidates?.[0]?.address).toBe('北海道');
    expect(rows[1]?.candidates?.[0]?.corporateNumber).toBe('2222222222222');
    expect(rows[1]?.candidates?.[0]?.address).toBe('沖縄県');
  });
});

describe('resolveNames（fixture ベース結合・実 HoujinClient / fetch モック）', () => {
  const fixturePath = fileURLToPath(
    new URL('../../packages/jp-corp-core/fixtures/houjin/name_ver4_x4.xml', import.meta.url),
  );
  const nameFixtureXml = readFileSync(fixturePath, 'utf8');

  /** 常に指定 XML を返す実 HoujinClient を searcher に包む（＋呼び出しURL記録）。 */
  function clientReturning(xml: string): { searcher: NameSearcher; urls: string[] } {
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
    const searcher: NameSearcher = {
      searchByName: (name, options) => queue.enqueue(() => client.searchByName(name, options)),
    };
    return { searcher, urls };
  }

  it('name_ver4_x4.xml（10法人）: 完全一致なし → ambiguous で10候補、所在地を連結する', async () => {
    const { searcher, urls } = clientReturning(nameFixtureXml);
    const [row] = await resolveNames(['株式会社国税商事'], searcher);

    expect(row?.confidence).toBe('ambiguous');
    expect(row?.candidates).toHaveLength(10);
    expect(row?.candidates?.[0]).toEqual({
      corporateNumber: '2040001999902',
      name: '株式会社国税商事あ',
      address: '千葉県千葉市中央区中央４丁目５番８号',
    });
    // 法人格除去クエリ（'国税商事'）で名称検索エンドポイントを叩く。
    expect(urls[0]).toContain('/4/name');
  });

  it('完全一致1社 → exact（株式会社国税商事あ）', async () => {
    const { searcher } = clientReturning(nameFixtureXml);
    const [row] = await resolveNames(['株式会社国税商事あ'], searcher);
    expect(row?.confidence).toBe('exact');
    expect(row?.candidates).toEqual([
      {
        corporateNumber: '2040001999902',
        name: '株式会社国税商事あ',
        address: '千葉県千葉市中央区中央４丁目５番８号',
      },
    ]);
  });

  it('0法人の XML → not_found', async () => {
    const emptyXml =
      '<?xml version="1.0" encoding="UTF-8"?><corporations><lastUpdateDate>2017-05-10</lastUpdateDate><count>0</count><divideNumber>1</divideNumber><divideSize>0</divideSize></corporations>';
    const { searcher } = clientReturning(emptyXml);
    const [row] = await resolveNames(['存在しない株式会社'], searcher);
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
