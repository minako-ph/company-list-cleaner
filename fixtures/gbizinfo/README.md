# gBizINFO REST API v2 fixtures

これらは **spec-based フィクスチャ**（公式OpenAPI定義に基づく合成データ）であり、実応答のスナップショットではない。
edinet の `*.spec-based.json` と同じ流儀で、実応答が採取できるまでのクライアント実装・パーステストの
土台として用いる。**架空法人（`5000012090001`）・架空の補助金/調達データ**で構成している。

出所:

- 公式OpenAPI定義: `https://api.info.gbiz.go.jp/hojin/v3/api-docs/v2`
  （Swagger UI: `https://api.info.gbiz.go.jp/hojin/swagger-ui/index.html?urls.primaryName=v2`）
- 作成日: 2026-07-08
- 仕様の正: `docs/research/gbizinfo-v2.md`

| ファイル | 内容 |
|---|---|
| `basic.spec-based.json` | 法人基本情報 `GET /v2/hojin/{corporate_number}` の応答形。`"Null"` 文字列（close_date/close_cause/company_url/qualification_grade）を含む |
| `subsidy.spec-based.json` | 補助金 `GET /v2/hojin/{corporate_number}/subsidy`。2件目に `amount`/`target` の `"Null"` を含む |
| `procurement.spec-based.json` | 調達 `GET /v2/hojin/{corporate_number}/procurement`。2件目に `amount`、1件目に `joint_signatures` の `"Null"` を含む |

注意:

- gBizINFO v2 は **値なし項目を文字列 `"Null"` で返す**（v1は項目省略）。本フィクスチャは必ず `"Null"` を含める。
  クライアントは `stripNullStrings` で `"Null"` → undefined に正規化する。
- 認証トークン（ヘッダ `X-hojinInfo-api-token`）はフィクスチャに含めない（URL・ボディともにシークレットなし）。

## 実応答での差し替え手順

1. 利用申請フォームでトークンを取得し、`GBIZINFO_API_TOKEN` に設定する。
2. `curl -H 'X-hojinInfo-api-token: <token>' 'https://api.info.gbiz.go.jp/hojin/v2/hojin/<法人番号>'`
   （`/subsidy`・`/procurement` も同様。**URL末尾にスラッシュを付けない**＝500エラー）で実応答を採取する。
3. トークン・個社情報の扱いに注意しつつ、`*.spec-based.json` を実応答スナップショットへ差し替え、
   本READMEの「spec-based」表記を実採取（採取日・法人番号）に更新する。値の改変はしない。
