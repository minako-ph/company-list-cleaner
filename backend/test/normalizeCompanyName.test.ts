import { describe, expect, it } from 'vitest';
import { normalizeCompanyName } from '../src/services/normalizeCompanyName.js';

/**
 * FR-2 表記正規化（ルールベース・純関数）のユニットテスト。
 * 決定的・副作用なし（同じ入力→同じ出力）・文字の追加推測をしないことを確認する。
 */
describe('normalizeCompanyName', () => {
  it('前株: （株）（全角括弧）を株式会社へ展開し先頭位置を保つ', () => {
    expect(normalizeCompanyName('（株）テスト商事')).toBe('株式会社テスト商事');
  });

  it('後株: 末尾の (株) を株式会社へ展開し末尾位置を保つ', () => {
    expect(normalizeCompanyName('テスト商事(株)')).toBe('テスト商事株式会社');
  });

  it('合字 ㈱ を株式会社へ展開する', () => {
    expect(normalizeCompanyName('㈱国税商事')).toBe('株式会社国税商事');
  });

  it('(有)/㈲ を有限会社へ展開する', () => {
    expect(normalizeCompanyName('（有）山田')).toBe('有限会社山田');
    expect(normalizeCompanyName('㈲山田')).toBe('有限会社山田');
  });

  it('全角英数字・全角スペースを半角へ統一する', () => {
    expect(normalizeCompanyName('ＡＢＣ　商事')).toBe('ABC 商事');
  });

  it('連続空白を単一化し前後を trim する', () => {
    expect(normalizeCompanyName('  テスト   商事  ')).toBe('テスト 商事');
  });

  it('空文字・空白のみは空文字を返す', () => {
    expect(normalizeCompanyName('')).toBe('');
    expect(normalizeCompanyName('　　 ')).toBe('');
  });

  it('曖昧な略記 (合) は変換しない（合同/合名/合資の推測禁止）', () => {
    expect(normalizeCompanyName('（合）テスト')).toBe('(合)テスト');
  });

  it('冪等: 正規化済みの文字列を再度通しても不変', () => {
    const once = normalizeCompanyName('（株）テスト　商事');
    expect(normalizeCompanyName(once)).toBe(once);
  });
});
