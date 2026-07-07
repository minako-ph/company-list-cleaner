import { describe, expect, it } from 'vitest';
import {
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
