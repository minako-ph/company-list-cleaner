/**
 * 源別クライアントの公開面（引継書§3.1）。
 * houjin・gbizinfoは柱3リポジトリから参照される前提のため、
 * 副作用なし・依存最小のピュアなパッケージ面をここで維持する（引継書§14）。
 */
export * from './http.js';
export * from './monitoring.js';
export * from './edinet/index.js';
export * from './gbizinfo/index.js';
export * from './houjin/index.js';
export * from './reinfolib/index.js';

// TODO(Phase 4): laws クライアント（JSON＋XMLフォールバック）
