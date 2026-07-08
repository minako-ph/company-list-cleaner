import { describe, it, expect } from 'vitest';
import { isValidUuid } from '../src/server/userKey';

describe('isValidUuid', () => {
  it('有効な UUID（Utilities.getUuid() 形式）は true', () => {
    expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('大文字 hex も許容する（大文字小文字問わず）', () => {
    expect(isValidUuid('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
  });

  it('桁数が違うと false（第1ブロックが7桁）', () => {
    expect(isValidUuid('123e456-e89b-12d3-a456-426614174000')).toBe(false);
  });

  it('ハイフン位置が違うと false（8-4-4-4-12 でない）', () => {
    expect(isValidUuid('123e4567e-89b-12d3-a456-426614174000')).toBe(false);
  });

  it('空文字は false', () => {
    expect(isValidUuid('')).toBe(false);
  });

  it('UUID でない文字列は false', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
  });

  it('hex 以外の文字（g）を含むと false', () => {
    expect(isValidUuid('123e4567-e89b-12d3-a456-42661417400g')).toBe(false);
  });
});
