/**
 * 行配列を指定サイズごとに分割する純関数。
 *
 * N-2（サイドバー駆動バッチ）で、対象行を50行単位に分割して
 * `processBatch` を逐次呼び出すために使用する。
 *
 * @param rows 分割対象の配列
 * @param size 1チャンクあたりの要素数（1以上の整数）
 * @returns サイズごとに分割した配列の配列。空配列を渡した場合は空配列を返す。
 * @throws size が1未満、または整数でない場合
 */
export function chunkRows<T>(rows: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunkRows: size must be an integer >= 1, got ${size}`);
  }

  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}
