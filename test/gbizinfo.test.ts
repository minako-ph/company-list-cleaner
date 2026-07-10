import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTextFixture } from '@jp-opendata/testing';
import { GbizinfoClient, resolveMinistry } from '../src/gbizinfo/index.js';
import { HttpStatusError, type FetchLike } from '../src/http.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'gbizinfo');
const TOKEN = 'test-token';
const CORP = '5000012090001';

function clientWithBody(body: string, status = 200, baseUrl?: string) {
  const urls: string[] = [];
  const headersSeen: Record<string, string>[] = [];
  const bytes = new TextEncoder().encode(body);
  const fetchFn: FetchLike = async (url, init) => {
    urls.push(url);
    if (init?.headers) headersSeen.push({ ...init.headers });
    return {
      status,
      text: async () => body,
      arrayBuffer: async () => bytes.buffer,
    };
  };
  const options =
    baseUrl === undefined ? { token: TOKEN, fetchFn } : { token: TOKEN, fetchFn, baseUrl };
  return { client: new GbizinfoClient(options), urls, headersSeen };
}

describe('GbizinfoClient.getBasicInfo', () => {
  it('法人基本情報をパースし、"Null"をundefinedに正規化する', async () => {
    const body = loadTextFixture(fixturesDir, 'basic.spec-based.json');
    const { client, urls, headersSeen } = clientWithBody(body);

    const result = await client.getBasicInfo(CORP);
    expect(result.hojinInfos).toHaveLength(1);
    const info = result.hojinInfos[0];
    expect(info?.name).toBe('サンプル株式会社');
    expect(info?.capital_stock).toBe(100000000);
    expect(info?.employee_number).toBe(250);
    // "Null" 文字列は undefined へ正規化
    expect(info?.close_date).toBeUndefined();
    expect(info?.close_cause).toBeUndefined();
    expect(info?.company_url).toBeUndefined();
    expect(info?.qualification_grade).toBeUndefined();
    // 実値・0でない値は保全
    expect(info?.status).toBe('-');
    expect(info?.business_items).toEqual(['情報通信業']);
    expect(result.drift.hasDrift).toBe(false);
    // トークンはヘッダ送出・URL末尾スラッシュなし
    expect(headersSeen[0]?.['X-hojinInfo-api-token']).toBe(TOKEN);
    expect(urls[0]).toBe('https://api.info.gbiz.go.jp/hojin/v2/hojin/5000012090001');
    expect(result.publicUrl).toBe(urls[0]);
  });

  it('corporate_numberが13桁でなければリクエストせずエラー', async () => {
    const { client, urls } = clientWithBody('{}');
    await expect(client.getBasicInfo('123')).rejects.toThrow(/13桁/);
    expect(urls).toHaveLength(0);
  });

  it('baseUrl末尾スラッシュは除去され二重スラッシュにならない', async () => {
    const body = loadTextFixture(fixturesDir, 'basic.spec-based.json');
    const { client, urls } = clientWithBody(body, 200, 'https://api.info.gbiz.go.jp/hojin/');
    await client.getBasicInfo(CORP);
    expect(urls[0]).toBe('https://api.info.gbiz.go.jp/hojin/v2/hojin/5000012090001');
  });

  it('未知フィールドはドリフトとして報告する', async () => {
    const original = JSON.parse(loadTextFixture(fixturesDir, 'basic.spec-based.json'));
    original['hojin-infos'][0].brandNewField = 'x';
    const { client } = clientWithBody(JSON.stringify(original));
    const result = await client.getBasicInfo(CORP);
    expect(result.drift.hasDrift).toBe(true);
    expect(result.drift.unknownFields).toContain('hojin-infos[].brandNewField');
  });

  it('HTTP 401/404 は HttpStatusError', async () => {
    const c401 = clientWithBody('unauthorized', 401);
    await expect(c401.client.getBasicInfo(CORP)).rejects.toThrow(HttpStatusError);
    const c404 = clientWithBody('not found', 404);
    await expect(c404.client.getBasicInfo(CORP)).rejects.toThrow(HttpStatusError);
  });
});

describe('GbizinfoClient.getSubsidies', () => {
  it('実応答（日立製作所）をパースし、文字列amount・真のnull target・meta-dataオブジェクトを受ける', async () => {
    const body = loadTextFixture(fixturesDir, 'subsidy.7010001008844.2026-07-10.json');
    const { client, urls } = clientWithBody(body);

    const result = await client.getSubsidies('7010001008844');
    const subsidies = result.hojinInfos[0]?.subsidy ?? [];
    expect(subsidies).toHaveLength(5);
    // amountは実応答では文字列（docs/research/gbizinfo-subsidy.md）
    expect(subsidies[0]?.amount).toBe('76846429');
    expect(subsidies[0]?.government_departments).toBe('資源エネルギー庁');
    // 真のnull（target）はstripNullStringsでundefinedへ
    expect(subsidies[0]?.target).toBeUndefined();
    expect(result.drift.hasDrift).toBe(false);
    expect(urls[0]).toBe('https://api.info.gbiz.go.jp/hojin/v2/hojin/7010001008844/subsidy');
  });

  it('補助金0件の法人は200＋空配列で返る', async () => {
    const body = loadTextFixture(fixturesDir, 'subsidy.1180301018771.empty.2026-07-10.json');
    const { client } = clientWithBody(body);
    const result = await client.getSubsidies('1180301018771');
    expect(result.hojinInfos[0]?.subsidy).toEqual([]);
    expect(result.drift.hasDrift).toBe(false);
  });
});

describe('GbizinfoClient.searchHojin', () => {
  it('法人検索（corporate_number指定）でname_en付きプロフィールを返し、id:nullを受ける', async () => {
    const body = loadTextFixture(fixturesDir, 'search.7010001008844.2026-07-10.json');
    const { client, urls } = clientWithBody(body);
    const result = await client.searchHojin({ corporateNumber: '7010001008844' });
    expect(result.hojinInfos[0]?.name_en).toBe('Hitachi, Ltd.');
    expect(result.hojinInfos[0]?.name).toBe('株式会社日立製作所');
    expect(result.drift.hasDrift).toBe(false);
    expect(urls[0]).toBe(
      'https://api.info.gbiz.go.jp/hojin/v2/hojin?corporate_number=7010001008844',
    );
  });

  it('source=4×ministryの横断検索応答をパースする', async () => {
    const body = loadTextFixture(fixturesDir, 'search.source4-ministry26.2026-07-10.json');
    const { client, urls } = clientWithBody(body);
    const result = await client.searchHojin({ source: '4', ministry: '26', limit: 5, page: 1 });
    expect(result.hojinInfos).toHaveLength(5);
    expect(result.hojinInfos[0]?.corporate_number).toMatch(/^\d{13}$/);
    expect(urls[0]).toBe(
      'https://api.info.gbiz.go.jp/hojin/v2/hojin?ministry=26&source=4&page=1&limit=5',
    );
  });

  it('0件は404で返るため空結果に写像する（エラーにしない）', async () => {
    const { client } = clientWithBody('{"id":null,"message":"404 - Not Found.","errors":[]}', 404);
    const result = await client.searchHojin({ source: '4', ministry: '26' });
    expect(result.hojinInfos).toEqual([]);
  });

  it('pageは1〜10のみ（APIが11以上を400で拒否するため事前検証）', async () => {
    const { client, urls } = clientWithBody('{}');
    await expect(client.searchHojin({ page: 11 })).rejects.toThrow(/page/);
    expect(urls).toHaveLength(0);
  });
});

describe('GbizinfoClient.getProcurements', () => {
  it('調達をパースし、amount/joint_signaturesの"Null"を正規化する', async () => {
    const body = loadTextFixture(fixturesDir, 'procurement.spec-based.json');
    const { client, urls } = clientWithBody(body);

    const result = await client.getProcurements(CORP);
    const procurements = result.hojinInfos[0]?.procurement ?? [];
    expect(procurements).toHaveLength(2);
    expect(procurements[0]?.title).toBe('システム開発業務一式');
    expect(procurements[0]?.amount).toBe(5000000);
    // 1件目 joint_signatures="Null" → undefined、2件目は実値
    expect(procurements[0]?.joint_signatures).toBeUndefined();
    expect(procurements[1]?.amount).toBeUndefined();
    expect(procurements[1]?.joint_signatures).toBe('株式会社共同企業体');
    expect(result.drift.hasDrift).toBe(false);
    expect(urls[0]).toBe('https://api.info.gbiz.go.jp/hojin/v2/hojin/5000012090001/procurement');
  });
});

describe('GbizinfoClient コンストラクタ', () => {
  it('トークンが空ならエラー', () => {
    expect(() => new GbizinfoClient({ token: '' })).toThrow(/トークン/);
  });
});

describe('resolveMinistry', () => {
  it('内部コード・日本語名・英語公式名のいずれでも解決できる', () => {
    expect(resolveMinistry('17')).toMatchObject({ code: '17', ja: '経済産業省' });
    expect(resolveMinistry('経済産業省')).toMatchObject({
      code: '17',
      en: 'Ministry of Economy, Trade and Industry',
    });
    expect(resolveMinistry('ministry of economy, trade and industry')).toMatchObject({
      code: '17',
    });
    expect(resolveMinistry('中小企業庁')).toMatchObject({ code: '27' });
  });

  it('解決できない入力はnull', () => {
    expect(resolveMinistry('存在しない省')).toBeNull();
    expect(resolveMinistry('99')).toBeNull();
    expect(resolveMinistry('')).toBeNull();
  });
});
