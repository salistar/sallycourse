# SallyCourse

SaaS SALISTAR de génération automatique de cours : **titre + niveau → vidéos ordonnées, articles, TPs avec captures, quiz avec solutions**, déployables sur Udemy, YouTube, Teachable et 15+ plateformes.

## Architecture (monorepo pnpm)

```
apps/
  web/       Next.js 15 (App Router) — dashboard, formulaire, API, SSE
  worker/    Node BullMQ — génération (Claude), TTS, captures Playwright, rendu FFmpeg, déploiement
packages/
  shared/    Types + schémas Zod (source de vérité), constantes métier, storage S3
  db/        Modèles Mongoose
  design/    Design system SALISTAR : tokens (3 formats) + templates de rendu (slides/PDF/miniatures)
```

## Démarrage rapide

```bash
cp .env.example .env
pnpm install
docker compose --profile core up -d   # mongo, redis, minio
pnpm dev
```

Roadmap complète : `SALLYCOURSE_250_PROMPTS.md` (250 prompts ordonnés, D1–D12 puis phases 1–14).
