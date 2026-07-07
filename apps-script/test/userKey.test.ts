import { describe, it, expect } from 'vitest';
import { bytesToHex, normalizeEmail, selectKeySource } from '../src/server/userKey';

describe('bytesToHex', () => {
  it('空配列は空文字を返す（境界: 空）', () => {
    expect(bytesToHex([])).toBe('');
  });

  it('0 は "00" になる（境界: 0）', () => {
    expect(bytesToHex([0])).toBe('00');
  });

  it('255 は "ff" になる（境界: 255・unsigned 入力）', () => {
    expect(bytesToHex([255])).toBe('ff');
  });

  it('負値を 0-255 に正規化する（signed byte: -27→229→e5, -1→255→ff, -128→128→80）', () => {
    expect(bytesToHex([-27])).toBe('e5');
    expect(bytesToHex([-1])).toBe('ff');
    expect(bytesToHex([-128])).toBe('80');
  });

  it('負値・0・正値の混在を正しく変換する（[-27, 0, 127] → "e5007f"）', () => {
    expect(bytesToHex([-27, 0, 127])).toBe('e5007f');
  });

  it('各バイトは必ず2桁 0 埋めになる（[1, 15] → "010f"）', () => {
    expect(bytesToHex([1, 15])).toBe('010f');
  });
});

describe('normalizeEmail', () => {
  it('前後の空白を除去する', () => {
    expect(normalizeEmail('  foo@example.com  ')).toBe('foo@example.com');
  });

  it('大文字を小文字化する', () => {
    expect(normalizeEmail('Foo.Bar@Example.COM')).toBe('foo.bar@example.com');
  });

  it('trim と小文字化を同時に行う', () => {
    expect(normalizeEmail('\t USER@Example.Com \n')).toBe('user@example.com');
  });

  it('空文字はそのまま空文字', () => {
    expect(normalizeEmail('')).toBe('');
  });
});

describe('selectKeySource', () => {
  it('null は userProperties 経路', () => {
    expect(selectKeySource(null)).toBe('userProperties');
  });

  it('undefined は userProperties 経路', () => {
    expect(selectKeySource(undefined)).toBe('userProperties');
  });

  it('空文字は userProperties 経路', () => {
    expect(selectKeySource('')).toBe('userProperties');
  });

  it('空白のみは userProperties 経路（trim 後に空）', () => {
    expect(selectKeySource('   ')).toBe('userProperties');
  });

  it('通常の email は email 経路', () => {
    expect(selectKeySource('foo@example.com')).toBe('email');
  });

  it('前後に空白があっても中身があれば email 経路', () => {
    expect(selectKeySource('  foo@example.com  ')).toBe('email');
  });
});
