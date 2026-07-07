import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTextFixture } from '@jp-opendata/testing';
import { EdinetApiError, EdinetClient } from '../src/edinet/index.js';
import { GovHttpClient, type FetchLike } from '../src/http.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'edinet');

function clientWithBody(body: string | Uint8Array) {
  const urls: string[] = [];
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
  const fetchFn: FetchLike = async (url) => {
    urls.push(url);
    return {
      status: 200,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.buffer,
    };
  };
  const http = new GovHttpClient({ intervalMs: 0, fetchFn });
  return { client: new EdinetClient({ apiKey: 'test-key', http }), urls };
}

describe('EdinetClient.listDocuments', () => {
  it('一覧fixtureをパースし、ドリフトなし・キーなしpublicUrlを返す', async () => {
    const body = loadTextFixture(fixturesDir, 'documents.2026-06-30.spec-based.json');
    const { client, urls } = clientWithBody(body);

    const result = await client.listDocuments('2026-06-30');
    expect(result.documents).toHaveLength(3);
    expect(result.documents[0]?.docID).toBe('S100XXA1');
    expect(result.drift.hasDrift).toBe(false);
    // リクエストにはキーを含み、公開URLには含めない
    expect(urls[0]).toContain('Subscription-Key=test-key');
    expect(result.publicUrl).not.toContain('Subscription-Key');
  });

  it('HTTP 200＋ボディ内StatusCode=401の実応答fixtureを EdinetApiError にする', async () => {
    const body = loadTextFixture(fixturesDir, 'error.auth.2026-07-07.json');
    const { client } = clientWithBody(body);
    await expect(client.listDocuments('2026-06-30')).rejects.toThrow(EdinetApiError);
  });

  it('日付形式が不正ならリクエストせずエラー', async () => {
    const { client, urls } = clientWithBody('{}');
    await expect(client.listDocuments('2026/06/30')).rejects.toThrow(/YYYY-MM-DD/);
    expect(urls).toHaveLength(0);
  });

  it('未知フィールドを含む応答はドリフトとして報告しつつ値は保全する', async () => {
    const original = JSON.parse(
      loadTextFixture(fixturesDir, 'documents.2026-06-30.spec-based.json'),
    );
    original.results[0].brandNewField = 'x';
    const { client } = clientWithBody(JSON.stringify(original));

    const result = await client.listDocuments('2026-06-30');
    expect(result.drift.hasDrift).toBe(true);
    expect(result.drift.unknownFields).toContain('results[].brandNewField');
    expect(result.documents[0]).toMatchObject({ brandNewField: 'x' });
  });
});
