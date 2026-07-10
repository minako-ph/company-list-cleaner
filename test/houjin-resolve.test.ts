import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTextFixture } from '@jp-opendata/testing';
import { parseHoujinXml } from '../src/houjin/xml.js';
import {
  normalizeCompanyNameForMatch,
  resolveCompanyName,
  type HoujinNameSearcher,
} from '../src/houjin/resolve.js';
import type { HoujinResult } from '../src/houjin/client.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'houjin');

/** 公式サンプル（10社・株式会社国税商事あ〜）のパース結果を返すスタブ */
function fixtureSearcher(): HoujinNameSearcher & { calls: string[] } {
  const parsed = parseHoujinXml(loadTextFixture(fixturesDir, 'name_ver4_x4.xml'));
  const calls: string[] = [];
  return {
    calls,
    searchByName: async (name) => {
      calls.push(name);
      return {
        header: parsed.header,
        corporations: parsed.corporations,
        drift: parsed.drift,
        publicUrl: 'https://api.houjin-bangou.nta.go.jp/4/name?name=x&type=12',
        responseType: '12',
      };
    },
  };
}

function searcherWith(corporations: HoujinResult['corporations']): HoujinNameSearcher {
  return {
    searchByName: async () => ({
      header: {
        lastUpdateDate: '2026-07-10',
        count: corporations.length,
        divideNumber: 1,
        divideSize: 1,
      },
      corporations,
      drift: { unknownFields: [], missingFields: [], hasDrift: false },
      publicUrl: 'https://api.houjin-bangou.nta.go.jp/4/name?name=x&type=12',
      responseType: '12',
    }),
  };
}

function corporation(overrides: Record<string, string>): HoujinResult['corporations'][number] {
  return {
    sequenceNumber: '1',
    corporateNumber: '2040001999902',
    process: '01',
    correct: '0',
    updateDate: '2015-12-01',
    changeDate: '2015-10-05',
    name: '株式会社国税商事あ',
    nameImageId: '',
    kind: '301',
    prefectureName: '千葉県',
    cityName: '千葉市中央区',
    streetNumber: '中央４丁目５番８号',
    addressImageId: '',
    prefectureCode: '12',
    cityCode: '101',
    postCode: '2600013',
    addressOutside: '',
    addressOutsideImageId: '',
    closeDate: '',
    closeCause: '',
    successorCorporateNumber: '',
    changeCause: '',
    assignmentDate: '2015-10-05',
    latest: '1',
    enName: '',
    enPrefectureName: '',
    enCityName: '',
    enAddressOutside: '',
    furigana: '',
    hihyoji: '0',
    ...overrides,
  };
}

describe('normalizeCompanyNameForMatch', () => {
  it('全半角・大文字化・中点/スペース除去・ひらがな→カタカナで揃える', () => {
    expect(normalizeCompanyNameForMatch('ｱｲｳ株式会社')).toBe(
      normalizeCompanyNameForMatch('アイウ株式会社'),
    );
    expect(normalizeCompanyNameForMatch('あいう商事')).toBe('アイウ商事');
    expect(normalizeCompanyNameForMatch('日立・製作所　')).toBe('日立製作所');
    expect(normalizeCompanyNameForMatch('ａｂｃ Inc')).toBe('ABCINC');
  });
});

describe('resolveCompanyName', () => {
  it('exact: 正規化名の完全一致が1社', async () => {
    const searcher = fixtureSearcher();
    const result = await resolveCompanyName(searcher, '株式会社国税商事あ');
    expect(result.confidence).toBe('exact');
    expect(result.corporateNumber).toBe('2040001999902');
    expect(result.resolvedName).toBe('株式会社国税商事あ');
    expect(result.candidateCount).toBe(10);
  });

  it('ambiguous: 完全一致なし・候補多数は採用しない', async () => {
    const searcher = fixtureSearcher();
    const result = await resolveCompanyName(searcher, '株式会社国税商事');
    expect(result.confidence).toBe('ambiguous');
    expect(result.corporateNumber).toBeNull();
    expect(result.candidateCount).toBe(10);
  });

  it('selected: 完全一致なしだが候補1社のみ', async () => {
    const searcher = searcherWith([corporation({ name: '株式会社国税商事あ' })]);
    const result = await resolveCompanyName(searcher, '国税商事');
    expect(result.confidence).toBe('selected');
    expect(result.corporateNumber).toBe('2040001999902');
  });

  it('not_found: 候補0・空入力', async () => {
    const searcher = searcherWith([]);
    expect((await resolveCompanyName(searcher, '存在しない会社')).confidence).toBe('not_found');
    expect((await resolveCompanyName(searcher, '   ')).confidence).toBe('not_found');
  });

  it('ambiguous: 同名法人が複数（完全一致が2社以上）', async () => {
    const searcher = searcherWith([
      corporation({ corporateNumber: '2040001999902' }),
      corporation({ corporateNumber: '2040001999910' }),
    ]);
    const result = await resolveCompanyName(searcher, '株式会社国税商事あ');
    expect(result.confidence).toBe('ambiguous');
    expect(result.corporateNumber).toBeNull();
  });

  it('閉鎖済み・非表示レコードは候補から除外する', async () => {
    const searcher = searcherWith([
      corporation({ closeDate: '2020-01-01' }),
      corporation({ corporateNumber: '2040001999910', hihyoji: '1' }),
    ]);
    const result = await resolveCompanyName(searcher, '株式会社国税商事あ');
    expect(result.confidence).toBe('not_found');
  });
});
