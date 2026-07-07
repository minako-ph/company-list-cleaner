import { describe, it, expect } from 'vitest';
import { chunkRows } from '../src/server/chunk';

describe('chunkRows', () => {
  it('空配列は空配列を返す（境界: 空）', () => {
    expect(chunkRows([], 50)).toEqual([]);
  });

  it('ちょうど割り切れる場合は均等なチャンクに分割する', () => {
    expect(chunkRows([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('余りがある場合は最後のチャンクが短くなる', () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('size が要素数以上なら単一チャンクになる', () => {
    expect(chunkRows([1, 2], 50)).toEqual([[1, 2]]);
  });

  it('size が 1 なら各要素が個別チャンクになる', () => {
    expect(chunkRows(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
  });

  it('size が 0（1未満）なら例外を投げる（境界: size<1）', () => {
    expect(() => chunkRows([1, 2], 0)).toThrow();
  });

  it('size が負なら例外を投げる', () => {
    expect(() => chunkRows([1, 2], -1)).toThrow();
  });

  it('size が非整数なら例外を投げる', () => {
    expect(() => chunkRows([1, 2], 1.5)).toThrow();
  });

  it('元の配列を破壊しない', () => {
    const rows = [1, 2, 3];
    chunkRows(rows, 2);
    expect(rows).toEqual([1, 2, 3]);
  });
});
