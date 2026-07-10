import { describe, expect, it } from 'vitest';
import {
  convertKanjiNumerals,
  kanjiToNumber,
  ministryToEnglish,
  normalizeForVerbatimMatch,
  normalizeWaveDash,
  parseJpNumber,
  toHalfWidth,
  warekiToIso,
} from '../src/index.js';

describe('warekiToIso', () => {
  it.each([
    ['令和6年3月31日', '2024-03-31'],
    ['令和元年5月1日', '2019-05-01'],
    ['平成30年12月31日', '2018-12-31'],
    ['昭和64年1月7日', '1989-01-07'],
    ['令和６年３月３１日', '2024-03-31'],
  ])('%s → %s', (input, expected) => {
    expect(warekiToIso(input)).toBe(expected);
  });

  it('変換不能な入力は null（推測禁止）', () => {
    expect(warekiToIso('2024-03-31')).toBeNull();
    expect(warekiToIso('令和6年13月1日')).toBeNull();
    expect(warekiToIso('')).toBeNull();
  });
});

describe('toHalfWidth / normalizeWaveDash', () => {
  it('全角英数字を半角へ', () => {
    expect(toHalfWidth('ＡＢＣ１２３　ｘ')).toBe('ABC123 x');
  });
  it('全角チルダを波ダッシュへ統一', () => {
    expect(normalizeWaveDash('1０～２0')).toBe('1０〜２0');
  });
});

describe('parseJpNumber', () => {
  it.each([
    ['1,234', 1234],
    ['１２３', 123],
    ['1，234，567', 1234567],
    ['-42', -42],
    ['3.14', 3.14],
  ])('%s → %d', (input, expected) => {
    expect(parseJpNumber(input)).toBe(expected);
  });
  it('数値でない文字列は null', () => {
    expect(parseJpNumber('約100')).toBeNull();
    expect(parseJpNumber('')).toBeNull();
  });
});

describe('normalizeForVerbatimMatch', () => {
  it('全半角・波ダッシュ・カンマ・空白差を吸収する', () => {
    expect(normalizeForVerbatimMatch('売上高 １，２３４百万円（２０２３～）')).toBe(
      normalizeForVerbatimMatch('売上高1,234百万円(2023〜)'),
    );
  });
});

describe('ministryToEnglish', () => {
  it('府省・機関名を英語公式名へ（辞書）', () => {
    expect(ministryToEnglish('経済産業省')).toBe('Ministry of Economy, Trade and Industry');
    expect(ministryToEnglish('中小企業庁')).toBe('Small and Medium Enterprise Agency');
    expect(ministryToEnglish('資源エネルギー庁')).toBe('Agency for Natural Resources and Energy');
  });
  it('法人格プレフィックスを除いた本体名でも引ける（ルール）', () => {
    expect(ministryToEnglish('独立行政法人情報処理推進機構')).toBe(
      'Information-technology Promotion Agency, Japan (IPA)',
    );
  });
  it('辞書に無い機関はnull（推測禁止）', () => {
    expect(ministryToEnglish('公益財団法人食品等流通合理化促進機構')).toBeNull();
    expect(ministryToEnglish('未知の庁')).toBeNull();
  });
});

describe('kanjiToNumber', () => {
  it.each([
    ['五', 5],
    ['十', 10],
    ['十五', 15],
    ['二十五', 25],
    ['九十九', 99],
    ['百', 100],
    ['百十二', 112],
    ['三百二十一', 321],
    ['千', 1000],
    ['五千三百', 5300],
    ['一万', 10000],
    ['十万', 100000],
    ['一万五千二百十一', 15211],
    ['一〇五', 105],
  ])('%s → %d', (input, expected) => {
    expect(kanjiToNumber(input)).toBe(expected);
  });
  it('解釈できない並びはnull（推測禁止）', () => {
    expect(kanjiToNumber('二三十')).toBeNull();
    expect(kanjiToNumber('数十')).toBeNull();
    expect(kanjiToNumber('')).toBeNull();
  });
});

describe('convertKanjiNumerals', () => {
  it('文中の漢数字列を算用数字へ置換する（照合の前処理）', () => {
    expect(convertKanjiNumerals('第百十二条')).toBe('第112条');
    expect(convertKanjiNumerals('十万円以下の罰金')).toBe('100000円以下の罰金');
    expect(convertKanjiNumerals('第二条の三第一項')).toBe('第2条の3第1項');
  });
});
