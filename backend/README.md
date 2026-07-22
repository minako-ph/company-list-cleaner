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

- `POST /license/claim` / `POST /license/recover` / `POST /license/verify`（FR-10・R3-2・
  `src/routes/license.ts` + `src/services/license.ts` + `src/services/stripeGateway.ts`）:
  ライセンスキー（Ed25519 署名 JWT）の発行・再表示・検証。**キーは保存しない**（検証は署名 ＋ Stripe 購読照会で
  成立。CR-3 と両立）。`cancel_at_period_end=true` でも `current_period_end` が未来なら valid（F3-3）。
  検証結果は短TTL（5分）メモリキャッシュ。`STRIPE_SECRET_KEY`/`LICENSE_SIGNING_KEY` 未設定時は 503 で明示。
- `POST /stripe/webhook`（FR-10・`src/routes/stripeWebhook.ts`）: **署名検証必須**
  （`STRIPE_WEBHOOK_SECRET` ＋生ボディ）。`checkout.session.completed` のみ処理対象だが検証のみ・保存なし・冪等。
  署名不正は 400、secret 未設定は 503。

`/resolve` `/enrich` `/license/*` `/stripe/webhook` はいずれも実装済み。

## スクリプト

```
pnpm --filter backend typecheck   # tsc --noEmit
pnpm --filter backend test        # vitest run
pnpm --filter backend build       # node build.mjs = esbuild 依存込み単一バンドル → dist/index.js（型検査は typecheck が担当）
pnpm --filter backend smoke       # dist/index.js を Secret 未設定で起動し /health 200+JSON を確認（CI にも組込み済み）
pnpm --filter backend dev         # node --env-file=.env --experimental-strip-types --watch src/index.ts
```

`dev` は Node 22 ネイティブ機能のみを使う（`--env-file` で .env 読込 = dotenv 不使用、
`--experimental-strip-types` で .ts を直接実行 = tsx 等の追加依存不使用）。

`build` は esbuild による**依存込み単一バンドル**（external なし・ESM・sourcemap 同梱・minify なし）。
`node dist/index.js` がそのまま起動でき、Docker runtime ステージは node_modules を持たない
（docs/tasks-bundling.md）。

## 環境変数

`../backend/.env.example` を正とする（`cp .env.example .env` して値を埋める。`.env` は gitignore 済み）。
本番は Cloud Run の env / Secret Manager で設定し、**値をコード・リポジトリ・ログに含めない**（§9）。

主なもの: `HOUJIN_APP_ID` / `INVOICE_API_BASE` / `INVOICE_ENABLED`(既定 false) / `GBIZINFO_API_TOKEN` /
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `LICENSE_SIGNING_KEY` /
`RATE_RPS`(既定 1) / `FREE_ROWS_PER_MONTH`(既定 50) / `PRO_ROWS_PER_MONTH`(既定 10000) /
`ALERT_WEBHOOK_URL` / `FIRESTORE_PROJECT_ID`（無料枠カウンタの Firestore プロジェクト。空なら InMemory・
`GOOGLE_CLOUD_PROJECT` を代替参照） / `PORT`(既定 8080)。

## ライセンス署名鍵（FR-10 / Ed25519）

ライセンスキーは **Ed25519（EdDSA）署名の JWT**。バックエンドが秘密鍵で発行・検証し、
GAS 側は公開鍵（Script Properties `LICENSE_PUBKEY`）で検証する。鍵は openssl で生成する:

```
# 秘密鍵（PKCS8 PEM）を生成 → backend の LICENSE_SIGNING_KEY に設定（Secret Manager 推奨）
openssl genpkey -algorithm ed25519 -out license_private.pem

# 対応する公開鍵（SPKI PEM）を導出 → GAS Script Properties の LICENSE_PUBKEY に設定
openssl pkey -in license_private.pem -pubout -out license_public.pem
```

- `LICENSE_SIGNING_KEY` には `license_private.pem` の**中身（PEM 文字列全体）**をそのまま入れる
  （改行を含む。Secret Manager では複数行のまま保存できる）。
- `license_private.pem` はリポジトリにコミットしない（`.gitignore` 対象・§9）。
- 鍵をローテーションすると発行済みライセンスキーは無効化される（顧客は thanks ページ／キー再表示で再取得できる）。

## Stripe 設定（人間タスク — Dashboard 操作）

コード側は実装済み。以下は Stripe Dashboard での設定（自動化不可の人間タスク）:

1. **商品・価格**: Pro プランを **¥1,480 / 月・税込単価**で作成（Stripe Tax は v1 では使わない＝追補 R3-7）。
   LP／特商法表記と価格・解約条件の文言を同一に保つ（三者不一致は審査差し戻しの典型原因）。
2. **Checkout / Payment Link の成功リダイレクト先**を
   `https://<LPドメイン>/thanks.html?session_id={CHECKOUT_SESSION_ID}` に設定する（R3-2）。
   `{CHECKOUT_SESSION_ID}` は Stripe が実 session_id に置換するプレースホルダ（そのまま記述する）。
3. **Webhook エンドポイント**を `https://<Cloud Run URL>/stripe/webhook` に登録し、
   イベント `checkout.session.completed` を購読する。表示される **署名シークレット**を
   `STRIPE_WEBHOOK_SECRET`（Secret Manager）に設定する。
4. **カスタマーポータル**を有効化する（解約導線。特商法表記と一致）。
5. `web/thanks.html` と `web/license-recover.html` の `BACKEND_URL`（プレースホルダ定数）を
   Cloud Run のデプロイ URL に差し替える（未設定時は「準備中」を表示し無言で失敗しない）。

## 監視（N-4）

障害を「無言で失敗させない」ための2層構成（要件書 N-4 / 引継書 §10）。

### 1. 公的API連続失敗の検知（コード側＝実装済み）

- `src/services/apiHealth.ts` の `ApiHealthTracker` が、法人番号API / gBizINFO / インボイスAPI の
  呼び出しごとに成功・失敗を記録する（`routes/index.ts` で生成し DI）。**連続失敗**が
  `ALERT_CONSECUTIVE_FAILURES`（既定3）に達したら `ALERT_WEBHOOK_URL`（Slack互換 `{ text }`）へ通知する。
- 抑制: 同一ソースは**一度通知したら回復（成功）まで再通知しない**＋失敗通知に**最低30分のクールダウン**。
  回復時にも1回だけ通知する。`ALERT_WEBHOOK_URL` 未設定時は `console.error` のみ（Cloud Logging に残る）。
- 通知本文・ログには**ソース名・連続失敗回数・時刻のみ**を載せる（社名・登録番号・応答本文・
  シークレットは一切含めない＝CR-3/CR-5・§9）。通知先への送信失敗はアプリ動作に波及させない（握りつぶし）。
- `GET /health` は `{ ok: true, apis: { houjin, gbizinfo, invoice } }`（各 `'ok' | 'degraded'`）を返す。
  サイドバーはこの `degraded` を初期化時に読み、赤帯で「現在、○○APIが応答していません」を表示する。

### 2. Cloud Run エラー率アラート（人間タスク＝GCPコンソール設定）

コードでは設定できない。**Cloud Monitoring で以下を人間が設定する**（GCPコンソール操作）:

- **メトリック**: Cloud Run の `request_count`（`monitoring.googleapis.com/...run.googleapis.com/request_count`）を
  `response_code_class` でフィルタし、`5xx` の比率（5xx 件数 ÷ 全件数）を算出する条件を作る。
- **アラートポリシー**: 上記 5xx 比率が一定閾値（例: 直近5分で 20% 超）を一定時間継続したら発火する条件にする。
  対象は本サービスの Cloud Run revision（`service_name = company-list-cleaner-backend`）。
- **通知チャネル**: メール／Slack（Incoming Webhook）等の通知チャネルを作成し、ポリシーに紐付ける
  （`ALERT_WEBHOOK_URL` の Webhook とは別系統。片方が落ちても他方で気づける冗長化）。
- **補助**: `console.error` で出す連続失敗ログ（上記1）を Cloud Logging のログベース指標にしても良い。
- これらは Marketplace 公開前の運用準備タスク（Notion「人間のやる事リスト」で管理）。

## Docker ビルド

Dockerfile は**リポジトリルート**にある（`gcloud run deploy --source .` がルートの Dockerfile のみを
参照するため。詳細は下記デプロイ節）。ビルドコンテキストも **workspace ルート**にする（build ステージが
`packages/*` の workspace 依存を解決するため。ルートの `Dockerfile` 冒頭コメント参照）。runtime ステージは
esbuild バンドル（`dist/index.js`＋sourcemap）のみで動き、node_modules・packages・package.json をコピーしない。

```
docker build -t company-list-cleaner-backend .
```

## Cloud Run デプロイ（R3-5 の固定値）

region・インスタンス数は追補 R3-5 で確定。**全ユーザー横断の直列性**を `max-instances=1` で担保し、
コスト優先で `min-instances=0`（コールドスタートはサイドバー側「接続中…」表示で吸収 = N-4 の思想）。

`--source .` はリポジトリ**ルートの `Dockerfile`** を使ってイメージをビルドする（Dockerfile が無いと
Buildpacks にフォールバックし、pnpm workspace を解決できず `ERR_PNPM_NO_SCRIPT_OR_SERVER` で起動失敗する）。
コマンドはリポジトリルートで実行すること。

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
