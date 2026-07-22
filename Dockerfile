# backend (Cloud Run) イメージ。
#
# 配置: **リポジトリルート**。`gcloud run deploy --source .` はルートの Dockerfile のみを参照する
# （backend/ 配下に置くと見つけられず Buildpacks にフォールバックして起動失敗する = ERR_PNPM_NO_SCRIPT_OR_SERVER）。
# ローカルビルドも同ファイルを使う: `docker build -t company-list-cleaner-backend .`
#
# 重要: ビルドコンテキストは **workspace ルート**（= このファイルのあるディレクトリ）。
# build ステージが packages/jp-corp-core などの workspace 依存（workspace:*）を解決するため、
# ルートの pnpm-lock.yaml / pnpm-workspace.yaml を含む必要がある。
# node_modules / dist / .env はコンテキストから除外する（.dockerignore 参照）。
#
# runtime は esbuild の依存込み単一バンドル（backend/build.mjs）だけで動く——
# node_modules・packages・package.json は一切コピーしない（docs/tasks-bundling.md Step 3）。

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- build: workspace 全体を取り込み backend とその依存のみ install→bundle ----
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter backend...
RUN pnpm --filter backend build

# ---- runtime: 単一バンドル（＋sourcemap）のみを載せる ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/backend/dist/index.js ./dist/index.js
COPY --from=build /app/backend/dist/index.js.map ./dist/index.js.map
# Cloud Run は PORT 環境変数を注入する（既定 8080。config.ts が解釈）。
EXPOSE 8080
CMD ["node", "dist/index.js"]
