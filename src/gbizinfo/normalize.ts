/**
 * gBizINFO REST API v2 は「値が無い項目も文字列 `"Null"` で出力する」仕様
 * （docs/research/gbizinfo-v2.md「パースで要注意」）。
 * この文字列 `"Null"` を undefined として扱えるよう、パース前に再帰的に除去する。
 *
 * - 文字列 `"Null"` と**真の null** を対象（数値0・空文字はそのまま。0は正当な確定値のため
 *   sentinel 衝突を避ける）。真のnullは実応答で確認（検索系の`id: null`・補助金の`target: null`。
 *   docs/research/gbizinfo-subsidy.md）——v2は両方の欠損表現を混在させるため揃えて落とす。
 * - オブジェクトのキーが `"Null"`/null 値なら、そのキーを落とす（後段の zod optional で吸収）
 * - 配列要素が `"Null"`/null なら取り除く（`business_items` 等の文字列配列を想定）
 */
export function stripNullStrings(value: unknown): unknown {
  if (value === 'Null' || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(stripNullStrings).filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const cleaned = stripNullStrings(v);
      if (cleaned !== undefined) {
        out[key] = cleaned;
      }
    }
    return out;
  }
  return value;
}
