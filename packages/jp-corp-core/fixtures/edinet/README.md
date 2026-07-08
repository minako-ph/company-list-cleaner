# EDINET fixtures

すべて**実応答のサニタイズ済みスナップショット**（2026-07-08採取、Subscription-Keyは含まれない）。

| ファイル | 内容 |
|---|---|
| `documents.2026-06-30.json` | 書類一覧の実応答。metadataは原本のまま（count=909）、**resultsは代表4件にトリミング**: S100YNCJ(連結・証券コードあり120)／S100YIZC(個別120)／S100YB0U(ファンド120)／S100Y2Q1(ファンド160) |
| `document.S100YIZC.csv.trimmed.zip` | 書類取得type=5の実応答（山口放送・JGAAP個別）。zip内jpcrp CSVを**当期の経営指標等＋jppfs営業利益の行にトリミング**して再zip |
| `document.S100YNCJ.csv.trimmed.zip` | 同（MS&AD・連結/IFRS併記の保険持株）。セグメント別Member付きcontextの従業員数行を含む（完全一致選別の回帰用） |
| `error.auth.2026-07-07.json` | キーなしリクエストへの実応答（HTTP 200＋ボディ内StatusCode=401） |

再採取: `actors/edinet-filings/scripts/live-verify.ts`（要EDINET_API_KEY）。
規約: fixtureにシークレットを含めない（引継書§13）。トリミングは行の削除のみで値の改変はしない。
