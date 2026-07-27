# Worker de génération : Node + FFmpeg + Chromium (Playwright) + Python/faster-whisper.
# IMPORTANT : le worker s'exécute via `tsx` sur les SOURCES TypeScript.
# Les packages workspace (@sallycourse/shared|db|design) exposent du .ts (pas de
# build .js), et le worker résout les alias via les `paths` de tsconfig — c'est
# le mécanisme utilisé par tous les scripts start du worker. Un `node dist/…` ne
# peut pas résoudre ces sources .ts au runtime (ERR_MODULE_NOT_FOUND).

FROM node:22-bookworm AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/design/package.json packages/design/
RUN pnpm install --frozen-lockfile --filter @sallycourse/worker...

FROM deps AS build
# Sources (le worker tourne depuis src/, pas de compilation tsc nécessaire).
COPY packages ./packages
COPY apps/worker ./apps/worker

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 python3-pip python3-venv \
      fonts-liberation fonts-noto-core fonts-noto-unhinted \
      ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*
# faster-whisper dans un venv isolé
RUN python3 -m venv /opt/whisper && /opt/whisper/bin/pip install --no-cache-dir faster-whisper
ENV WHISPER_BIN=/opt/whisper/bin/python
ENV NODE_ENV=production
WORKDIR /app
# Copie complète depuis le build : node_modules (structure pnpm intacte, inclut
# tsx) + sources des packages workspace + source du worker.
COPY --from=build /app ./
# Chromium pour Playwright (deps système incluses), dans un chemin partagé
# lisible par l'utilisateur `node`.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN cd apps/worker && node_modules/.bin/playwright install --with-deps chromium \
    && chmod -R a+rx /opt/pw-browsers
USER node
# Sonde /metrics (serveur HTTP interne du worker, METRICS_PORT défaut 9090).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.METRICS_PORT||9090)+'/metrics',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
WORKDIR /app/apps/worker
ENTRYPOINT ["dumb-init", "--"]
CMD ["node_modules/.bin/tsx", "src/index.ts"]
