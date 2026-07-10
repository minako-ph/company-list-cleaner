import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTextFixture } from '@jp-opendata/testing';
import { ReinfolibClient } from '../src/reinfolib/index.js';
import { GovHttpClient, HttpStatusError, type FetchLike } from '../src/http.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'reinfolib');

function clientWith(responses: Array<{ status: number; body: string }>) {
  const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const next = responses.shift();
    if (!next) throw new Error('応答スタブが枯渇');
    const bytes = new TextEncoder().encode(next.body);
    return {
      status: next.status,
      text: async () => next.body,
      arrayBuffer: async () => bytes.buffer,
    };
  };
  const http = new GovHttpClient({
    intervalMs: 0,
    headers: { 'Ocp-Apim-Subscription-Key': 'test-key' },
    fetchFn,
  });
  return { client: new ReinfolibClient({ apiKey: 'test-key', http }), calls };
}

describe('ReinfolibClient.listTransactions', () => {
  it('実採取fixture（千代田区2024・en）をパースし、ドリフトなし・キーはヘッダのみ（URLに含めない）', async () => {
    const body = loadTextFixture(fixturesDir, 'XIT001.13101-2024.en.json');
    const { client, calls } = clientWith([{ status: 200, body }]);

    const result = await client.listTransactions({
      year: 2024,
      area: '13',
      city: '13101',
      language: 'en',
    });
    expect(result.records).toHaveLength(4);
    expect(result.records[0]?.PriceCategory).toBe('Contract Price Information');
    expect(result.drift.hasDrift).toBe(false);
    // 認証はヘッダ。URL（publicUrl含む）にキーを含めない（F-1維持）
    expect(calls[0]?.headers?.['Ocp-Apim-Subscription-Key']).toBe('test-key');
    expect(calls[0]?.url).not.toContain('test-key');
    expect(result.publicUrl).not.toContain('test-key');
    expect(result.publicUrl).toContain('language=en');
  });

  it('priceClassificationとquarter・stationをクエリに反映する', async () => {
    const empty = JSON.stringify({ status: 'OK', data: [] });
    const { client, calls } = clientWith([{ status: 200, body: empty }]);
    await client.listTransactions({
      year: 2024,
      quarter: 1,
      station: '003785',
      priceClassification: '02',
      language: 'ja',
    });
    expect(calls[0]?.url).toContain('quarter=1');
    expect(calls[0]?.url).toContain('station=003785');
    expect(calls[0]?.url).toContain('priceClassification=02');
  });

  it('404は「該当なし・0件」として空配列（エラーにしない）', async () => {
    const { client } = clientWith([{ status: 404, body: '' }]);
    const result = await client.listTransactions({ year: 1990, area: '13', language: 'en' });
    expect(result.records).toEqual([]);
    expect(result.drift.hasDrift).toBe(false);
  });

  it('401は認証エラー（HttpStatusError）としてthrow', async () => {
    const { client } = clientWith([{ status: 401, body: '' }]);
    await expect(
      client.listTransactions({ year: 2024, area: '13', language: 'en' }),
    ).rejects.toThrow(HttpStatusError);
  });

  it('未知フィールドはドリフト報告しつつ値を保全する', async () => {
    const parsed = JSON.parse(loadTextFixture(fixturesDir, 'XIT001.13101-2024.en.json'));
    parsed.data[0].BrandNewField = 'x';
    const { client } = clientWith([{ status: 200, body: JSON.stringify(parsed) }]);
    const result = await client.listTransactions({ year: 2024, area: '13', language: 'en' });
    expect(result.drift.hasDrift).toBe(true);
    expect(result.drift.unknownFields).toContain('data[].BrandNewField');
    expect(result.records[0]).toMatchObject({ BrandNewField: 'x' });
  });
});

describe('ReinfolibClient.listMunicipalities', () => {
  it('市区町村一覧をja/enで取得できる（実採取fixture）', async () => {
    const en = loadTextFixture(fixturesDir, 'XIT002.13.en.json');
    const { client } = clientWith([{ status: 200, body: en }]);
    const result = await client.listMunicipalities('13', 'en');
    expect(result.municipalities[0]).toEqual({ id: '13101', name: 'Chiyoda Ward' });
    expect(result.drift.hasDrift).toBe(false);
  });

  it('404は空配列', async () => {
    const { client } = clientWith([{ status: 404, body: '' }]);
    const result = await client.listMunicipalities('99', 'ja');
    expect(result.municipalities).toEqual([]);
  });
});
