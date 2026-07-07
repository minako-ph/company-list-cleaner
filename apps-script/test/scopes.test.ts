import { describe, it, expect } from 'vitest';
import manifest from '../appsscript.json';

// CR-7: OAuthスコープは以下の3点に固定（順序・過不足すべて不可）。
// スコープ差分チェック（scripts/check-oauth-scopes.mjs）と同じ不変条件を
// pnpm test でも常時検証する保険。
const EXPECTED_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.currentonly',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.container.ui',
];

describe('appsscript.json oauthScopes (CR-7)', () => {
  it('スコープが3点と順序まで完全一致する', () => {
    expect(manifest.oauthScopes).toEqual(EXPECTED_SCOPES);
  });

  it('スコープ数はちょうど3点', () => {
    expect(manifest.oauthScopes).toHaveLength(3);
  });
});
