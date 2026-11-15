# syntax=docker/dockerfile:1.7
#
# Production images (docs/09 §2, tier 0), one file, three targets:
#   api       REST API + background jobs; also runs migrations (`node dist/migrate.mjs`)
#   realtime  Colyseus rooms
#   web       Caddy serving the game at / and the admin at /admin/, proxying /api and /rt
#
#   docker build --target api -t campus-api .
#
# Behind a TLS-inspecting proxy, hand its CA to the build (never baked into an image):
#   docker build --secret id=ca,src=/path/to/ca.crt ...

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
# The package store lives in the image layers, not in a cache mount: a CI runner can restore the
# layer that filled it while starting with an empty cache mount, and offline steps would then fail.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Dependencies first, from the lockfile alone, so source changes reuse this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    corepack install && pnpm fetch
COPY . .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --offline \
    && pnpm turbo run build --filter=@campus/api --filter=@campus/realtime --filter=@campus/web --filter=@campus/admin \
    # Each server with only its production npm dependencies, as locked (workspace code is in
    # the bundle). Injected workspace packages are what `deploy` needs; only for this step.
    && pnpm --filter @campus/api --config.inject-workspace-packages=true deploy --prod --offline /out/api \
    && pnpm --filter @campus/realtime --config.inject-workspace-packages=true deploy --prod --offline /out/realtime \
    && rm -rf /out/api/dist /out/realtime/dist \
    && cp -r apps/api/dist /out/api/dist \
    && cp -r apps/realtime/dist /out/realtime/dist

FROM node:${NODE_VERSION}-alpine AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3001/api/health > /dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

FROM node:${NODE_VERSION}-alpine AS realtime
ENV NODE_ENV=production REALTIME_HOST=0.0.0.0 REALTIME_PORT=2567
WORKDIR /app
COPY --from=build --chown=node:node /out/realtime ./
USER node
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:2567/health > /dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

FROM caddy:2-alpine AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv/web
COPY --from=build /repo/apps/admin/dist /srv/admin
