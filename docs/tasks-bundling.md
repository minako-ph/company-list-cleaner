# tasks-bundling.md — backendバンドル化（Cloud Runデプロイ前の最後のコード作業）

保存先: `docs/tasks-bundling.md` ／ 実施者: **Claude Code** ／ 作成: 2026-07-12（チャット指示の揮発を確認したため指示書ファイルとして再投入）

**目的**: `node dist/index.js` が workspaceパッケージのTSソース参照で起動不可（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`、decisions.md 2026-07-10「発見TODO」）。esbuildで**依存込み単一バンドル**にし、Dockerイメージを node_modules なしで起動可能にする。これが柱3最後のコード作業（合格後は人間の滑走路のみ）。

**参照順**: 本書 → docs/handover.md §4 → docs/requirements.md（N-1直列・§9シークレット非漏洩）。矛盾時は本書が最新・優先。特に引継書に「runner=node:20-slim」とある箇所は**本書が上書き**: runnerは **node:22-slim**（`.node-version`=22.17.0・CIのnode 22.17.0と一致させるため。根拠つき確定）。

---

## Step 0 — 前提確認（着手前に必ず）

- [ ] `git status` がクリーンで HEAD が `b516718` であること。**もしバンドル関連の未コミット差分が既にあれば、実装せず差分の要約だけ報告して停止**（過去セッションの残骸と本書の重複適用を防ぐ）。
- [ ] 現行スイートが緑であることを着手前に確認: `pnpm install --frozen-lockfile && node scripts/check-oauth-scopes.mjs && pnpm typecheck && pnpm test && pnpm build && node scripts/check-oauth-scopes.mjs`（322テスト想定）。
- [ ] 再現確認（任意・1分）: `cd backend && node dist/index.js` が `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`（packages/jp-corp-core/src/http.ts）で落ちること。

## Step 1 — esbuildバンドル（backend/build.mjs）

- [ ] `backend/devDependencies` に `esbuild@^0.25.0` を追加（apps-scriptと同メジャーで統一）。`pnpm-workspace.yaml` の `allowBuilds: esbuild` は設定済み＝追加作業なし。
- [ ] `backend/build.mjs` を新規作成。要件:
  - entry `src/index.ts` → outfile `dist/index.js`、`bundle: true`（**依存を全て内包・external指定なし**。@google-cloud/firestore・stripe・jose・hono・workspaceパッケージ全部入り）、`platform: 'node'`、`target: 'node22'`、`format: 'esm'`、`sourcemap: true`、`minify: false`（Cloud Runログのスタックトレース可読性を優先）。
  - **バナー（第一候補・最小構成）**: `banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }` — CJS依存の `Dynamic require of "x" is not supported` 対策。
  - `__dirname is not defined` 系が出た場合のみ、バナーに `fileURLToPath` ベースの `__dirname`/`__filename` shim を**追加**する（最初から入れない。esbuild自身のCJS変換shimと衝突しうるため、Step 2のスモークを判定器にして段階的に足す）。
  - **CJSフォールバック（ESMで解消不能な場合のみ）**: `format: 'cjs'`・outfile `dist/index.cjs`・バナー不要。採用時は Step 2/3 の起動コマンドを `node dist/index.cjs` に揃え、decisions.md にフォールバック理由を残す。`backend/package.json` の `"type": "module"` は `.cjs` 拡張子なら共存可＝変更しない。
- [ ] `backend/package.json` の `build` を `node build.mjs` に差替え。`typecheck`（`tsc --noEmit`）は現状維持＝型検査は引き続きtscが担う。
- [ ] `backend/tsconfig.build.json` を**削除**（dist出力の唯一の役目がesbuildへ移るため。二重の真実を残さない）。参照している記述があれば同時に掃除。

## Step 2 — 起動スモーク（backend/scripts/smoke.mjs）

- [ ] `backend/scripts/smoke.mjs` を新規作成。仕様:
  - `node dist/index.js` を `spawn`（env: `PORT=8790`・`NODE_ENV=production`・**Secret系は一切未設定のまま**＝InMemoryQuotaStore／license系503の正規縮退経路を通す）。
  - `http://127.0.0.1:8790/health` を 250ms間隔・最大10秒ポーリング（Node 22同梱の `fetch` 使用）。**HTTP 200かつJSONボディ**で成功（degraded内容は問わない）。
  - 成否にかかわらず必ず `child.kill('SIGTERM')`。成功 exit 0／タイムアウト・非200・プロセス早期死は子プロセスのstderr要約つきで exit 1。
  - 判定価値の根拠（変更不要・理解用）: `routes/index.ts` は `services/firestore.js` を **static import** しているため、このスモーク1本でFirestore SDK含む全依存のバンドル成立とモジュールロードが検証できる。
- [ ] `backend/package.json` に `"smoke": "node scripts/smoke.mjs"` を追加。ローカル手順として backend/README.md の起動節に1行追記。

## Step 3 — Dockerfile刷新（node_modulesなしランタイム）

- [ ] `backend/Dockerfile` を刷新。要件:
  - buildステージ: `node:22-slim` + corepack/pnpm（現行踏襲）→ `pnpm install --frozen-lockfile --filter backend...` → `pnpm --filter backend build`（＝esbuildバンドル）。
  - runtimeステージ: `node:22-slim`。**コピーするのは `backend/dist/index.js`（＋`.map`）のみ**。node_modules・packages・package.json のコピーを全廃。`ENV NODE_ENV=production`・`EXPOSE 8080`・`CMD ["node", "dist/index.js"]`（配置に合わせWORKDIR調整。CJSフォールバック時は `.cjs`）。
  - 冒頭コメントの「workspaceルートをコンテキストに」注記は維持（buildステージが必要とするため）。
- [ ] `.dockerignore` は現行のままで要件充足（`**/node_modules`・`**/dist`・`**/.env`・`.git` 除外済み）を確認のみ。

## Step 4 — CIステップ追加

- [ ] `.github/workflows/ci.yml` の `Build` の直後に追加:
  ```yaml
  - name: Backend bundle startup smoke (/health)
    run: pnpm --filter backend smoke
  ```
  （`Check OAuth scopes (built dist)` はその後ろのまま維持）

## Step 5 — 確認のみ（新規実装なし）

- [ ] ⑤resolveラッパの直列前提コメント: **b516718で実装済みの見込み**。`backend/src/services/resolve.ts` L21・L128-129・L153 に「注入側が直列キューにくるむ／resolveOne毎に独立生成で並行安全／送信は直列（N-1）」が既述であることを確認。不足があればその箇所のみ追記（大きな書き換え禁止）。
- [ ] `backend/README.md` のデプロイ・起動節を新ビルド（バンドル）前提に整合（`node dist/index.js` がそのまま動く旨・smokeコマンド）。

## 完了条件

- [ ] `pnpm install --frozen-lockfile` → scope(source) → `pnpm typecheck` → `pnpm test`（**322以上**・既存テストを1本も落とさない） → `pnpm build` → **`pnpm --filter backend smoke` 緑** → scope(dist) が全て通る。
- [ ] `docker build -f backend/Dockerfile -t clc-backend .` が成功する（daemon不可の環境ならスキップし、その旨を完了報告に明記。ローカルスモークが代替ゲート）。
- [ ] `docs/decisions.md` に1行（新しいものを上）: バンドル方式（ESM+createRequireバナー or CJSフォールバックと理由）・runner=node:22-slim確定（引継書のnode:20記載を上書き）・tsconfig.build.json削除・スモークがFirestore SDK込みロードを検証する根拠。
- [ ] コミットメッセージ例: `build(backend): esbuild単一バンドル化＋node_modulesなしDockerfile＋/health起動スモーク（CI組込み・decisions.md 2026-07-10発見TODOの解消）`
- [ ] 完了報告に含める: 変更ファイル一覧／バンドルサイズ（dist/index.jsのKB）／スモーク出力の要約／**残り（人間タスク）**節＝「§5 Cloud Runデプロイ（gcloud・Secret投入）はNotionリストの人間作業。packages/ 改変なしのため柱2への再sync通知は不要」。

## やらないこと（絶対規則の再掲）

- `packages/` 配下の改変（柱2が正典・再sync受領のみ）。
- OAuthスコープ3点の変更・追加（CR-7）。`INVOICE_ENABLED` に触れない（既定falseのまま）。
- 確定値（¥1,480税込・50行・10,000行・cancel_at_period_end仕様）とweb/文言の変更。
- Docker runtimeステージへの node_modules コピー復活。依存の大規模差替え・バージョン一括更新。
- golden/fixtureの自動上書き。Store/Marketplace・GCP・Stripe等コンソール操作（人間の作業）。
- テストの削除・skip化によるグリーン偽装。
