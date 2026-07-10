import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBinaryFixture } from '@jp-opendata/testing';
import { HoujinClient } from '../src/houjin/index.js';
import { GovHttpClient, HttpStatusError, type FetchLike } from '../src/http.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'houjin');
const APP_ID = '1234567890123';

/** 応答バイト列（fixtureそのまま）を返すHoujinClientを組み立てる。SJIS/UTF-8をバイトで扱う。 */
function clientWithBytes(bytes: Uint8Array, status = 200) {
  const urls: string[] = [];
  const copy = new Uint8Array(bytes);
  const fetchFn: FetchLike = async (url) => {
    urls.push(url);
    return {
      status,
      text: async () => new TextDecoder().decode(copy),
      arrayBuffer: async () => copy.buffer,
    };
  };
  const http = new GovHttpClient({ intervalMs: 0, fetchFn });
  return { client: new HoujinClient({ id: APP_ID, http }), urls };
}

function bytesFromString(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('HoujinClient /4/num（番号指定）', () => {
  it('XML(type=12) 単一法人（履歴なし）をパースし、count・publicUrl(idなし)・drift無しを返す', async () => {
    const bytes = loadBinaryFixture(fixturesDir, 'num_0_ver4_x4.xml');
    const { client, urls } = clientWithBytes(bytes);

    const result = await client.findByNumbers(['5111101000006'], { type: '12', history: 0 });
    expect(result.header.count).toBe(1);
    expect(result.corporations).toHaveLength(1);
    expect(result.corporations[0]?.corporateNumber).toBe('5111101000006');
    expect(result.corporations[0]?.name).toBe('株式会社検索対象除外');
    expect(result.corporations[0]?.hihyoji).toBe('1');
    expect(result.drift.hasDrift).toBe(false);
    // リクエストURLにはidを含み、publicUrlには含めない（F-1）
    expect(urls[0]).toContain(`id=${APP_ID}`);
    expect(urls[0]).toContain('number=5111101000006');
    expect(urls[0]).toContain('type=12');
    expect(result.publicUrl).not.toContain(APP_ID);
    expect(result.publicUrl).not.toContain('id=');
  });

  it('XML(type=12) 複数法人（履歴あり history=1）を配列で返す', async () => {
    const bytes = loadBinaryFixture(fixturesDir, 'num_1_ver4_x4.xml');
    const { client, urls } = clientWithBytes(bytes);

    const result = await client.findByNumbers(['4111101000007'], { history: 1 });
    expect(result.header.count).toBe(2);
    expect(result.corporations).toHaveLength(2);
    expect(result.corporations.map((c) => c.process)).toEqual(['01', '12']);
    expect(result.corporations.map((c) => c.latest)).toEqual(['0', '1']);
    expect(urls[0]).toContain('history=1');
  });

  it('CSV(type=02 Unicode) をパースする', async () => {
    const bytes = loadBinaryFixture(fixturesDir, 'num_0_ver4_c4.csv');
    const { client } = clientWithBytes(bytes);

    const result = await client.findByNumbers(['5111101000006'], { type: '02' });
    expect(result.header.count).toBe(1);
    expect(result.corporations).toHaveLength(1);
    expect(result.corporations[0]?.name).toBe('株式会社検索対象除外');
    expect(result.corporations[0]?.prefectureName).toBe('東京都');
    expect(result.corporations[0]?.postCode).toBe('1000000');
    expect(result.drift.hasDrift).toBe(false);
  });

  it('CSV(type=01 Shift_JIS) を iconv-lite でデコードしてパースする', async () => {
    const bytes = loadBinaryFixture(fixturesDir, 'num_0_ver4_c2.csv');
    const { client } = clientWithBytes(bytes);

    const result = await client.findByNumbers(['5111101000006'], { type: '01' });
    expect(result.corporations).toHaveLength(1);
    // SJISが正しくデコードされ、UTF-8のc4と同じ値になる（文字化けしない）
    expect(result.corporations[0]?.name).toBe('株式会社検索対象除外');
    expect(result.corporations[0]?.cityName).toBe('千代田区');
  });

  it('0件応答（corporation要素なし）を空配列・count=0で返す', async () => {
    const zeroXml =
      '<?xml version="1.0" encoding="UTF-8"?><corporations><lastUpdateDate>2019-04-05</lastUpdateDate><count>0</count><divideNumber>1</divideNumber><divideSize>0</divideSize></corporations>';
    const { client } = clientWithBytes(bytesFromString(zeroXml));

    const result = await client.findByNumbers(['5111101000006']);
    expect(result.header.count).toBe(0);
    expect(result.corporations).toEqual([]);
    expect(result.drift.hasDrift).toBe(false);
  });

  it('番号が10件超・0件・13桁でない場合はリクエストせずエラー', async () => {
    const { client, urls } = clientWithBytes(bytesFromString('<corporations/>'));
    const eleven = Array.from({ length: 11 }, () => '5111101000006');
    await expect(client.findByNumbers(eleven)).rejects.toThrow(/最大10件/);
    await expect(client.findByNumbers([])).rejects.toThrow(/1件以上/);
    await expect(client.findByNumbers(['123'])).rejects.toThrow(/13桁/);
    expect(urls).toHaveLength(0);
  });

  it('未知フィールドを含むXMLはドリフト報告しつつ値を保全する', async () => {
    const original = new TextDecoder().decode(loadBinaryFixture(fixturesDir, 'num_0_ver4_x4.xml'));
    const withUnknown = original.replace(
      '</corporation>',
      '<brandNewField>x</brandNewField></corporation>',
    );
    const { client } = clientWithBytes(bytesFromString(withUnknown));

    const result = await client.findByNumbers(['5111101000006']);
    expect(result.drift.hasDrift).toBe(true);
    expect(result.drift.unknownFields).toContain('corporations.corporation[].brandNewField');
    expect(result.corporations[0]).toMatchObject({ brandNewField: 'x' });
  });

  it('HTTP 400 は HttpStatusError（メッセージにidを含まない＝F-1）', async () => {
    const { client } = clientWithBytes(bytesFromString('error'), 400);
    const err = await client.findByNumbers(['5111101000006']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpStatusError);
    expect(err instanceof Error ? err.message : '').not.toContain(APP_ID);
  });
});

describe('HoujinClient /4/name（名称検索）', () => {
  it('XML(type=12) 名称検索の複数件をパースし、nameをURLエンコードして送出する', async () => {
    const bytes = loadBinaryFixture(fixturesDir, 'name_ver4_x4.xml');
    const { client, urls } = clientWithBytes(bytes);

    const result = await client.searchByName('株式会社国税商事', {
      type: '12',
      mode: 2,
      target: 1,
    });
    expect(result.header.count).toBe(10);
    expect(result.corporations).toHaveLength(10);
    expect(result.corporations[0]?.name).toBe('株式会社国税商事あ');
    expect(urls[0]).toContain(`name=${encodeURIComponent('株式会社国税商事')}`);
    expect(urls[0]).toContain('mode=2');
    expect(urls[0]).toContain('target=1');
    expect(result.publicUrl).not.toContain('id=');
  });

  it('CSV(type=02) 名称検索の複数件をパースする', async () => {
    const bytes = loadBinaryFixture(fixturesDir, 'name_ver4_c4.csv');
    const { client } = clientWithBytes(bytes);

    const result = await client.searchByName('株式会社国税商事', { type: '02' });
    expect(result.corporations).toHaveLength(10);
    expect(result.corporations[9]?.name).toBe('株式会社国税商事Ａ');
    expect(result.drift.hasDrift).toBe(false);
  });

  it('空のnameはリクエストせずエラー', async () => {
    const { client, urls } = clientWithBytes(bytesFromString('<corporations/>'));
    await expect(client.searchByName('')).rejects.toThrow(/空/);
    expect(urls).toHaveLength(0);
  });
});

describe('HoujinClient コンストラクタ', () => {
  it('アプリケーションIDが英数字13桁でなければエラー', () => {
    expect(() => new HoujinClient({ id: 'abc' })).toThrow(/13桁/);
    expect(() => new HoujinClient({ id: 'KMzABCdef0123!' })).toThrow(/13桁/);
  });

  it('英字混在13桁のIDを受け付ける（実IDの形式・2026-07-10確認）', () => {
    expect(() => new HoujinClient({ id: 'KMzAbCdEf0123' })).not.toThrow();
  });
});
