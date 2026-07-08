import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GoldenMismatchError,
  GoldenMissingError,
  expectGolden,
  loadJsonFixture,
} from '../src/index.js';

const savedEnv = { GOLDEN_UPDATE: process.env.GOLDEN_UPDATE, CI: process.env.CI };

afterEach(() => {
  if (savedEnv.GOLDEN_UPDATE === undefined) delete process.env.GOLDEN_UPDATE;
  else process.env.GOLDEN_UPDATE = savedEnv.GOLDEN_UPDATE;
  if (savedEnv.CI === undefined) delete process.env.CI;
  else process.env.CI = savedEnv.CI;
});

describe('loadJsonFixture', () => {
  it('JSON fixtureを読み込む', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
    writeFileSync(join(dir, 'sample.json'), '{"a":1}');
    expect(loadJsonFixture(dir, 'sample.json')).toEqual({ a: 1 });
  });
});

describe('expectGolden', () => {
  it('golden未生成なら GoldenMissingError', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-'));
    delete process.env.GOLDEN_UPDATE;
    expect(() => expectGolden(dir, 'missing.json', { a: 1 })).toThrow(GoldenMissingError);
  });

  it('GOLDEN_UPDATE=1 で候補を書き出し、以後の通常実行で一致する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-'));
    process.env.GOLDEN_UPDATE = '1';
    delete process.env.CI;
    expectGolden(dir, 'out.json', { a: 1, b: '文字列' });

    delete process.env.GOLDEN_UPDATE;
    expect(() => expectGolden(dir, 'out.json', { a: 1, b: '文字列' })).not.toThrow();
    expect(() => expectGolden(dir, 'out.json', { a: 2, b: '文字列' })).toThrow(GoldenMismatchError);
  });

  it('CI上ではgolden自動更新を拒否する（自動上書き禁止）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-'));
    process.env.GOLDEN_UPDATE = '1';
    process.env.CI = 'true';
    expect(() => expectGolden(dir, 'out.json', { a: 1 })).toThrow(/CI上では禁止/);
  });
});
