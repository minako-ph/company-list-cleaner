/**
 * 源別クライアントの公開面（引継書§3.1）。
 * houjin・gbizinfoは柱3リポジトリから参照される前提のため、
 * 副作用なし・依存最小のピュアなパッケージ面をここで維持する（引継書§14）。
 */
export * from './http.js';
export * from './edinet/index.js';

// TODO(Phase 2): gbizinfo クライアント（v2仕様は docs/research/gbizinfo-v2.md 参照）
// TODO(Phase 2): reinfolib クライアント（キー到着後）
// TODO(Phase 3): houjin クライアント（検証環境はアプリID必須。fixtures/houjin/ に公式サンプル採取済み）
// TODO(Phase 4): laws クライアント（JSON＋XMLフォールバック）
