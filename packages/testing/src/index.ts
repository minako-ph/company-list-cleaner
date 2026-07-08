import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * golden運用の規約（引継書§8）:
 * - fixture: 実API応答のサニタイズ済みスナップショット（キー除去・小サイズ・取得日付をファイル名に）
 * - golden: パース・変換後の期待出力。`pnpm golden:update` で候補生成 →
 *   人間（事業主）が git diff をレビューしてコミット。CI上での自動更新は禁止。
 */

/** fixtureディレクトリからJSONを読む（シークレット混入禁止はfixture作成側の責務） */
export function loadJsonFixture<T = unknown>(fixturesDir: string, name: string): T {
  const raw = readFileSync(join(fixturesDir, name), 'utf-8');
  return JSON.parse(raw);
}

/** fixtureディレクトリからテキスト（XML/CSV等）を読む */
export function loadTextFixture(fixturesDir: string, name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

/** fixtureディレクトリからバイナリ（zip/Shift_JIS CSV等）を読む */
export function loadBinaryFixture(fixturesDir: string, name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

export class GoldenMismatchError extends Error {}
export class GoldenMissingError extends Error {}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * goldenランナー本体。
 * - 通常実行: golden ファイルと actual を厳密比較し、不一致なら throw（CIでのfail点）
 * - GOLDEN_UPDATE=1: golden 候補をファイルに書き出す（人間が diff レビューしてコミットする前提）。
 *   CI 上（process.env.CI）では自動上書き禁止のため常にエラー。
 */
export function expectGolden(goldenDir: string, name: string, actual: unknown): void {
  const goldenPath = join(goldenDir, name);
  const actualText = stableStringify(actual);

  if (process.env.GOLDEN_UPDATE === '1') {
    if (process.env.CI) {
      throw new Error(
        'golden自動更新はCI上では禁止（引継書§8）。ローカルで pnpm golden:update を実行すること。',
      );
    }
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, actualText, 'utf-8');
    return;
  }

  if (!existsSync(goldenPath)) {
    throw new GoldenMissingError(
      `golden未生成: ${goldenPath}\nローカルで \`pnpm golden:update\` を実行し、diffをレビューしてコミットすること。`,
    );
  }

  const expected = readFileSync(goldenPath, 'utf-8');
  if (expected !== actualText) {
    throw new GoldenMismatchError(
      `golden不一致: ${goldenPath}\n--- expected ---\n${expected}\n--- actual ---\n${actualText}`,
    );
  }
}
