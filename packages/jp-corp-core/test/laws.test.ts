import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTextFixture } from '@jp-opendata/testing';
import { LawsClient } from '../src/laws/index.js';
import type { FetchLike } from '../src/http.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'laws');

function clientWithBody(body: string, status = 200) {
  const urls: string[] = [];
  const bytes = new TextEncoder().encode(body);
  const fetchFn: FetchLike = async (url) => {
    urls.push(url);
    return { status, text: async () => body, arrayBuffer: async () => bytes.buffer };
  };
  return { client: new LawsClient({ fetchFn }), urls };
}

describe('LawsClient.searchLaws', () => {
  it('法令名で検索し、law_info/revision_infoをパースする', async () => {
    const body = loadTextFixture(fixturesDir, 'laws.kojin-joho.2026-07-10.json');
    const { client, urls } = clientWithBody(body);
    const result = await client.searchLaws({ lawTitle: '個人情報の保護' });
    expect(result.totalCount).toBe(18);
    expect(result.laws).toHaveLength(3);
    expect(result.laws[0]?.law_info.law_id).toBe('415AC0000000057');
    expect(result.laws[0]?.revision_info.law_title).toBe('個人情報の保護に関する法律');
    expect(result.drift.hasDrift).toBe(false);
    expect(urls[0]).toContain('/api/2/laws?law_title=');
    expect(urls[0]).toContain('response_format=json');
  });

  it('無条件検索は拒否する（全法令ループ禁止の第1層）', async () => {
    const { client, urls } = clientWithBody('{}');
    await expect(client.searchLaws({})).rejects.toThrow(/禁止/);
    expect(urls).toHaveLength(0);
  });

  it('0件（404）は空結果に写像する', async () => {
    const { client } = clientWithBody('{"code":"404001","message":"not found"}', 404);
    const result = await client.searchLaws({ lawTitle: '存在しない法' });
    expect(result.laws).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});

describe('LawsClient.getLawData', () => {
  it('law_idで本文を取得し、asofをクエリに付ける', async () => {
    const body = loadTextFixture(fixturesDir, 'law_data.415AC0000000057.trimmed.2026-07-10.json');
    const { client, urls } = clientWithBody(body);
    const result = await client.getLawData('415AC0000000057', '2020-01-01');
    expect(result.found).toBe(true);
    expect(result.data.law_info.law_id).toBe('415AC0000000057');
    expect(result.data.revision_info.law_title).toBe('個人情報の保護に関する法律');
    expect(urls[0]).toContain('/api/2/law_data/415AC0000000057?asof=2020-01-01');
  });

  it('不存在（404）はfound:false（エラーにしない）', async () => {
    const { client } = clientWithBody(
      '{"code":"404004","message":"指定のパラメータで取得できる法令本文ファイルは存在しません。"}',
      404,
    );
    const result = await client.getLawData('999XX9999999999');
    expect(result.found).toBe(false);
  });

  it('空のlaw_idは拒否する', async () => {
    const { client, urls } = clientWithBody('{}');
    await expect(client.getLawData('  ')).rejects.toThrow(/空/);
    expect(urls).toHaveLength(0);
  });
});
