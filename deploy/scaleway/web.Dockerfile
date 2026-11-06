FROM node:26.8.1-bookworm-slim AS build
RUN npm install --global pnpm@11.24.0
WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml server/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY server /app/server
COPY utils /app/utils
COPY web /app/web
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG VITE_SITE_URL
RUN pnpm build:node

FROM node:26.8.1-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app/web/.output ./.output
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
