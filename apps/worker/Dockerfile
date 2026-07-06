# Worker de génération : Node + FFmpeg + Chromium (Playwright) + Python/faster-whisper.
# Multi-stage : deps → build → runtime minimal.

FROM node:22-bookworm AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/design/package.json packages/design/
RUN pnpm install --frozen-lockfile --filter @sallycourse/worker...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm --filter @sallycourse/worker build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 python3-pip python3-venv \
      fonts-liberation fonts-noto-core fonts-noto-naskh-arabic \
      ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*
# faster-whisper dans un venv isolé
RUN python3 -m venv /opt/whisper && /opt/whisper/bin/pip install --no-cache-dir faster-whisper
ENV WHISPER_BIN=/opt/whisper/bin/python
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/packages ./packages
# Chromium pour Playwright (dépendances système incluses)
RUN npx playwright install --with-deps chromium
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/worker/dist/index.js"]
