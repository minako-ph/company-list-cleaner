# backend（オペレーターバックエンド / Cloud Run）

Hono + TypeScript（ESM）。GAS アドオンからの HTTPS を受け、公的API（法人番号 / インボイス / gBizINFO）と Stripe を仲介する（引継書 §3・§7）。

## 責務（現状 = P1 Step1 骨格）

- `GET /health` → `{ ok: true }`（疎通確認）
- 直列キュー（`src/queue.ts`）: 全公的API呼び出しを **プロセス内で直列・最低 1/RATE_RPS 秒間隔**に制御（N-1）
- CR-5 アクセスログ（`src/log/accessLog.ts`）: `{ user_key, timestamp, registration_number }` の **3点のみ** を stdout に構造化出力
- 環境変数の読み取り（`src/config.ts`。値はログしない = §9）
- `POST /invoice`（FR-5・`src/routes/invoice.ts` + `src/clients/invoice.ts`）: 登録番号（`T＋13桁`）のみで
  インボイス登録状況を照会（CR-1/2）。`INVOICE_ENABLED=false` のときは 503 `{ error: 'invoice_disabled' }`
  で明示応答（縮退公開）。応答は保存・ログせず呼び出し元へ返す（CR-3）。照会番号ごとに CR-5 の3点ログのみ。
- `GET /usage?userKey=...` / `POST /usage/consume`（FR-9・`src/routes/usage.ts` + `src/services/quota.ts`）:
  無料枠カウント。Firestore に保存するのは利用量データ（`rows_used`）のみで、公表情報・社名は
  一切保存しない（CR-3）。月次リセットはドキュメントキー `{user_key}:{YYYY-MM}`（JST基準）で実現。
  consume の `rows` は 1〜50 の整数、超過時は消費せず `allowed: false` を返す。plan は本 Step では
  `'free'` 固定（Pro 判定は Step5）。

  **Firestore フォールバック**: `FIRESTORE_PROJECT_ID`（無ければ `GOOGLE_CLOUD_PROJECT`）が空の
  ローカル開発では、Firestore に接続せず **InMemory ストア**（プロセス内・再起動で消える）に
  自動フォールバックする。Cloud Run 本番はこのいずれかを設定し、認証は ADC で自動接続する
  （キーはコード・環境変数に埋めない = §9）。

残りの業務ルート（`/resolve` `/enrich` `/license` `/stripe/webhook`）のうち `/resolve` `/enrich` は実装済み、
`/license` `/stripe/webhook` は後続 Step で `src/routes/` 配下に追加する。

## スクリプト

```
pnpm --filter backend typecheck   # tsc --noEmit
pnpm --filter backend test        # vitest run
pnpm --filter backend build       # tsc -p tsconfig.build.json → dist/
pnpm --filter backend dev         # node --env-file=.env --experimental-strip-types --watch src/index.ts
```

`dev` は Node 22 ネイティブ機能のみを使う（`--env-file` で .env 読込 = dotenv 不使用、
`--experimental-strip-types` で .ts を直接実行 = tsx 等の追加依存不使用）。

## 環境変数

`../backend/.env.example` を正とする（`cp .env.example .env` して値を埋める。`.env` は gitignore 済み）。
本番は Cloud Run の env / Secret Manager で設定し、**値をコード・リポジトリ・ログに含めない**（§9）。

主なもの: `HOUJIN_APP_ID` / `INVOICE_API_BASE` / `INVOICE_ENABLED`(既定 false) / `GBIZINFO_API_TOKEN` /
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `LICENSE_SIGNING_KEY` /
`RATE_RPS`(既定 1) / `FREE_ROWS_PER_MONTH`(既定 50) / `PRO_ROWS_PER_MONTH`(既定 10000) /
`ALERT_WEBHOOK_URL` / `FIRESTORE_PROJECT_ID`（無料枠カウンタの Firestore プロジェクト。空なら InMemory・
`GOOGLE_CLOUD_PROJECT` を代替参照） / `PORT`(既定 8080)。

## Docker ビルド

**workspace ルートをビルドコンテキスト**にする（`packages/*` の workspace 依存を後続 Step で使うため。
`backend/Dockerfile` 冒頭コメント参照）。

```
docker build -f backend/Dockerfile -t company-list-cleaner-backend .
```

## Cloud Run デプロイ（R3-5 の固定値）

region・インスタンス数は追補 R3-5 で確定。**全ユーザー横断の直列性**を `max-instances=1` で担保し、
コスト優先で `min-instances=0`（コールドスタートはサイドバー側「接続中…」表示で吸収 = N-4 の思想）。

```
gcloud run deploy company-list-cleaner-backend \
  --source . \
  --region=asia-northeast1 \
  --max-instances=1 \
  --min-instances=0 \
  --allow-unauthenticated
```

（`--source .` の代わりに上記 `docker build` → Artifact Registry push → `--image` 指定でも可。）

### env / Secret 設定

- 非機密（`INVOICE_ENABLED` `RATE_RPS` `FREE_ROWS_PER_MONTH` `PRO_ROWS_PER_MONTH` `INVOICE_API_BASE` など）
  は `--set-env-vars`。
- 機密（`HOUJIN_APP_ID` `GBIZINFO_API_TOKEN` `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET`
  `LICENSE_SIGNING_KEY`）は **Secret Manager** に格納し `--set-secrets` で注入する（値をコマンド履歴・ログに残さない）。

```
gcloud run deploy company-list-cleaner-backend \
  --region=asia-northeast1 --max-instances=1 --min-instances=0 \
  --set-env-vars=INVOICE_ENABLED=false,RATE_RPS=1,FREE_ROWS_PER_MONTH=50,PRO_ROWS_PER_MONTH=10000 \
  --set-secrets=HOUJIN_APP_ID=houjin-app-id:latest,GBIZINFO_API_TOKEN=gbizinfo-token:latest,STRIPE_SECRET_KEY=stripe-secret:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest,LICENSE_SIGNING_KEY=license-signing-key:latest
```

> コールドスタート設計メモ: `min-instances=0` のため初回リクエストは数秒かかる。
> サイドバーは待機中に「接続中…」を表示して無言のフリーズを避ける（追補 R3-5 / N-4）。
