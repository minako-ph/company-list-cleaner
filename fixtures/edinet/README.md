# EDINET fixtures

- `documents.2026-06-30.spec-based.json` — **合成fixture**（EDINET API仕様書の応答形式に基づく。実応答ではない）。
  EDINET_API_KEY 未設定のため実採取できず先行作成した。TODO: キー設定後に
  実応答のサニタイズ済みスナップショットへ差し替える（引継書§12-3）。
- `error.auth.2026-07-07.json` — **実採取**。キーなしリクエストへの実応答
  （HTTP 200＋ボディ内StatusCode=401）。2026-07-07取得。

規約: fixtureにシークレット（Subscription-Key等）を含めない（引継書§13）。
