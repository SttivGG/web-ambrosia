# syntax=docker/dockerfile:1
FROM node:24.14.0-alpine AS base
RUN npm install -g pnpm@10.34.5
WORKDIR /app
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --store-dir=/pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm --filter @ambrosia/inventory-service... build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @ambrosia/inventory-service deploy --prod --offline --store-dir=/pnpm/store /out
FROM build AS migrator
CMD ["pnpm", "--filter", "@ambrosia/inventory-service", "exec", "prisma", "migrate", "deploy"]
FROM node:24.14.0-alpine AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

