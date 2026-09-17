# Dhan Drishti — single self-hosted container (API + built web SPA on one port).
# Node 22 LTS: libsql and @node-rs/argon2 ship prebuilt N-API binaries (no compiler needed).

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Install workspace deps (cached on manifest changes).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile

# Build the web SPA.
COPY . .
RUN pnpm --filter @dhan-drishti/web build

FROM node:22-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATABASE_URL=/data/dhan-drishti.sqlite

# Bring over installed deps, source (run via tsx) and the built web dist.
COPY --from=build /app /app

# Persist the SQLite database outside the image.
VOLUME ["/data"]
EXPOSE 4000

# The server auto-serves ../../web/dist and runs migrations on boot.
CMD ["pnpm", "--filter", "@dhan-drishti/server", "run", "serve"]
