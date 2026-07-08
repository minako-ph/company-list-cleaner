# backend (Cloud Run) イメージ。
#
# 重要: **workspace ルートをビルドコンテキスト**にしてビルドすること。
#   docker build -f backend/Dockerfile -t company-list-cleaner-backend .
# 後続 Step で backend は packages/jp-corp-core などの workspace 依存（workspace:*）を
# 使うため、ルートの pnpm-lock.yaml / pnpm-workspace.yaml を含めて解決する必要がある。
# node_modules / dist / .env はコンテキストから除外する（.dockerignore 参照）。

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- build: workspace 全体を取り込み backend とその依存のみ install→build ----
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter backend...
RUN pnpm --filter backend build

# ---- runtime: dist と node_modules のみを載せる ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/package.json
WORKDIR /app/backend
# Cloud Run は PORT 環境変数を注入する（既定 8080。config.ts が解釈）。
EXPOSE 8080
CMD ["node", "dist/index.js"]
