# gBizINFO REST API v2 fixtures

実応答スナップショット（2026-07-10採取）と、実応答が未採取のエンドポイントの **spec-based フィクスチャ**（公式OpenAPI定義に基づく合成データ）の混成。

出所:

- 実応答: `https://api.info.gbiz.go.jp/hojin/v2/...`（2026-07-10・トークンはヘッダ送出のためURL・ボディに含まれない。値の改変なし）
- 公式OpenAPI定義: `https://api.info.gbiz.go.jp/hojin/v3/api-docs/v2`
  （Swagger UI: `https://api.info.gbiz.go.jp/hojin/swagger-ui/index.html?urls.primaryName=v2`）
- 仕様の正: `docs/research/gbizinfo-v2.md` / `docs/research/gbizinfo-subsidy.md`

| ファイル | 内容 |
|---|---|
| `subsidy.7010001008844.2026-07-10.json` | 【実応答】補助金 `GET /v2/hojin/{corporate_number}/subsidy?metadata_flg=true`（株式会社日立製作所・5件・資源エネルギー庁×2＋厚生労働省×3）。**amountは文字列・targetは真のnull・meta-dataはオブジェクト**という実挙動を含む |
| `subsidy.1180301018771.empty.2026-07-10.json` | 【実応答】補助金0件の法人（トヨタ自動車）。200＋`subsidy: []` |
| `search.7010001008844.2026-07-10.json` | 【実応答】法人検索 `GET /v2/hojin?corporate_number=`（`name_en`を含むプロフィール・**`id`が真のnull**） |
| `search.source4-ministry26.2026-07-10.json` | 【実応答】法人検索 `GET /v2/hojin?source=4&ministry=26&limit=5&page=1`（補助金保有×資源エネルギー庁の法人5件） |
| `basic.spec-based.json` | 【spec-based】法人基本情報 `GET /v2/hojin/{corporate_number}` の応答形。`"Null"` 文字列（close_date/close_cause/company_url/qualification_grade）を含む |
| `procurement.spec-based.json` | 【spec-based】調達 `GET /v2/hojin/{corporate_number}/procurement`。2件目に `amount`、1件目に `joint_signatures` の `"Null"` を含む |

注意:

- gBizINFO v2 は値なし項目を **文字列 `"Null"`** と **真の null** の両方で返す（実応答で確認）。
  クライアントは `stripNullStrings` で両方を undefined に正規化する。
- 補助金の `amount` は文字列、調達の `amount` は数値（エンドポイント間で型が揺れる）。スキーマは両受け。
- 検索で0件は **404**（エラーでなく0件扱い）。
- 認証トークン（ヘッダ `X-hojinInfo-api-token`）はフィクスチャに含めない。

## 残りのspec-basedを実応答へ差し替える手順

1. `GBIZINFO_API_TOKEN` を設定し、
   `curl -H 'X-hojinInfo-api-token: <token>' 'https://api.info.gbiz.go.jp/hojin/v2/hojin/<法人番号>'`
   （**URL末尾にスラッシュを付けない**＝500エラー）で実応答を採取する。
2. `*.spec-based.json` を実応答スナップショットへ差し替え、本README表を実採取（採取日・法人番号）に更新する。値の改変はしない。
