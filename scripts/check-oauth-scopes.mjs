#!/usr/bin/env node
// CR-7 スコープ差分チェック。
// apps-script/appsscript.json の oauthScopes が固定3点と完全一致（過不足・順序違いも不可）
// でなければ exit 1 し差分を表示する。ビルド成果物 dist/appsscript.json が存在する場合も検査。

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED = [
  'https://www.googleapis.com/auth/spreadsheets.currentonly',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.container.ui',
];

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** 検査対象。required=true のファイルが無ければエラー扱い。 */
const targets = [
  { path: join(repoRoot, 'apps-script/appsscript.json'), required: true },
  { path: join(repoRoot, 'apps-script/dist/appsscript.json'), required: false },
];

/**
 * unknown から oauthScopes（string配列）を安全に取り出す。型アサーションは使わない。
 * @returns {string[] | null}
 */
function extractScopes(parsed) {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const scopes = Reflect.get(parsed, 'oauthScopes');
  if (!Array.isArray(scopes)) return null;
  if (!scopes.every((s) => typeof s === 'string')) return null;
  return scopes;
}

/** EXPECTED と完全一致（順序込み）かを判定。 */
function isExactMatch(scopes) {
  if (scopes.length !== EXPECTED.length) return false;
  return scopes.every((s, i) => s === EXPECTED[i]);
}

function checkFile({ path, required }) {
  if (!existsSync(path)) {
    if (required) {
      return { ok: false, message: `[NG] 必須ファイルが見つかりません: ${path}` };
    }
    return { ok: true, skipped: true, message: `[skip] 未生成: ${path}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    return { ok: false, message: `[NG] JSONの解析に失敗: ${path}\n  ${e.message}` };
  }

  const scopes = extractScopes(parsed);
  if (scopes === null) {
    return {
      ok: false,
      message: `[NG] oauthScopes が文字列配列として存在しません: ${path}`,
    };
  }

  if (!isExactMatch(scopes)) {
    const missing = EXPECTED.filter((s) => !scopes.includes(s));
    const extra = scopes.filter((s) => !EXPECTED.includes(s));
    const lines = [`[NG] oauthScopes が固定3点と一致しません: ${path}`];
    lines.push(`  期待(順序込み):\n    ${EXPECTED.join('\n    ')}`);
    lines.push(`  実際:\n    ${scopes.join('\n    ') || '(空)'}`);
    if (missing.length) lines.push(`  不足: ${missing.join(', ')}`);
    if (extra.length) lines.push(`  余分: ${extra.join(', ')}`);
    if (!missing.length && !extra.length) lines.push('  → 内容は同じだが順序が異なります');
    return { ok: false, message: lines.join('\n') };
  }

  return { ok: true, message: `[OK] スコープ3点一致: ${path}` };
}

let failed = false;
for (const target of targets) {
  const result = checkFile(target);
  console.log(result.message);
  if (!result.ok) failed = true;
}

if (failed) {
  console.error('\nCR-7違反: oauthScopes は固定3点のみ・順序厳守。差分を修正してください。');
  process.exit(1);
}

console.log('\nCR-7: oauthScopes チェック通過。');
