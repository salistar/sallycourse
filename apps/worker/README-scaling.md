# Scaling du worker par type de charge (P71)

## Contexte

Historiquement `src/index.ts` démarre **tous** les processors dans un seul
process Node (`pnpm dev` / `pnpm start`). Cela reste le comportement par
défaut (rien ne casse). Pour scaler indépendamment selon le profil de charge,
trois entrypoints dédiés existent dans `src/entrypoints/` :

| Entrypoint              | Queues                                              | Profil            | Concurrency par défaut |
|--------------------------|------------------------------------------------------|-------------------|------------------------|
| `worker-cpu.ts`          | `video-render`, `packaging`, `screenshot-capture`     | CPU-bound (ffmpeg, archive ZIP, capture Playwright de slides) | 1 / 1 / 1 |
| `worker-api.ts`          | `outline-generation`, `content-generation`, `tts-generation`, `subtitle-generation` | API-bound (Claude, ElevenLabs/OpenAI TTS) | 2 / 3 / 2 / 1 |
| `worker-browser.ts`      | `deployment`                                          | Playwright (1 session navigateur par compte plateforme) | 1 |

Chaque entrypoint réutilise `registerWorker`/`createQueue` (`src/queues/index.ts`)
via les fonctions `registerCpuQueues()` / `registerApiQueues()` /
`registerBrowserQueues()` extraites dans `src/entrypoints/register-groups.ts`.
`index.ts` appelle désormais ces trois mêmes fonctions — comportement
"tout-en-un" strictement identique à avant, juste dé-dupliqué.

## Variables de concurrence

Lues directement depuis `process.env` (valeur par défaut si absente/invalide) :

```
# Groupe CPU
WORKER_CPU_VIDEORENDER_CONCURRENCY=1
WORKER_CPU_PACKAGING_CONCURRENCY=1
WORKER_CPU_SCREENSHOT_CONCURRENCY=1

# Groupe API
WORKER_API_OUTLINE_CONCURRENCY=2
WORKER_API_CONTENT_CONCURRENCY=3
WORKER_API_TTS_CONCURRENCY=2
WORKER_API_SUBTITLE_CONCURRENCY=1

# Groupe Browser
WORKER_BROWSER_DEPLOYMENT_CONCURRENCY=1
```

## Scripts npm

```
pnpm --filter @sallycourse/worker start:cpu       # tsx src/entrypoints/worker-cpu.ts
pnpm --filter @sallycourse/worker start:api       # tsx src/entrypoints/worker-api.ts
pnpm --filter @sallycourse/worker start:browser   # tsx src/entrypoints/worker-browser.ts
pnpm --filter @sallycourse/worker dev             # inchangé : tout-en-un (src/index.ts)
```

## Ce qui n'est PAS dupliqué dans les entrypoints dédiés

- `startFeedbackWorker` / `startAnalyticsScheduler` : restent uniquement dans
  `index.ts` (le prompt ne demandait pas de les répartir ; ils tournent sur
  le process "tout-en-un" historique). À répartir plus tard si besoin
  (candidats naturels : `worker-api` pour l'analyse LLM des retours, un cron
  séparé pour les analytics).
- `startReviewScheduler` est démarré dans `worker-browser.ts` car il dépend
  directement de l'état des `Deployment` (polling du statut de revue Udemy/YouTube).
- Le reaper de conteneurs TP (`killTpContainersOlderThan`) tourne dans
  `worker-cpu.ts` (le rendu vidéo dépend des environnements TP Docker).

## Passage à k3s (exemple, non appliqué)

Pas de manifests réels créés ici (hors scope du prompt) — juste le schéma
cible pour un futur déploiement, en commentaire :

```yaml
# apps/worker/k8s/worker-cpu.deployment.yaml (EXEMPLE — à créer plus tard)
# apiVersion: apps/v1
# kind: Deployment
# metadata:
#   name: sallycourse-worker-cpu
# spec:
#   replicas: 2  # scale horizontal selon la file video-render
#   template:
#     spec:
#       containers:
#         - name: worker-cpu
#           image: sallycourse/worker:latest
#           command: ["pnpm", "--filter", "@sallycourse/worker", "start:cpu"]
#           resources:
#             requests: { cpu: "2", memory: "2Gi" }   # ffmpeg = CPU-hungry
#             limits:   { cpu: "4", memory: "4Gi" }
#           env:
#             - { name: WORKER_CPU_VIDEORENDER_CONCURRENCY, value: "1" }
#             - { name: MONGO_URI, valueFrom: { secretKeyRef: { name: sallycourse-secrets, key: mongo-uri } } }
#             - { name: REDIS_URL, valueFrom: { secretKeyRef: { name: sallycourse-secrets, key: redis-url } } }
#
# ---
# apiVersion: apps/v1
# kind: Deployment
# metadata:
#   name: sallycourse-worker-api
# spec:
#   replicas: 4  # scale horizontal agressif : I/O-bound, peu de CPU/mémoire
#   template:
#     spec:
#       containers:
#         - name: worker-api
#           image: sallycourse/worker:latest
#           command: ["pnpm", "--filter", "@sallycourse/worker", "start:api"]
#           resources:
#             requests: { cpu: "250m", memory: "512Mi" }
#             limits:   { cpu: "1", memory: "1Gi" }
#           env:
#             - { name: WORKER_API_CONTENT_CONCURRENCY, value: "3" }
#             - { name: ANTHROPIC_API_KEY, valueFrom: { secretKeyRef: { name: sallycourse-secrets, key: anthropic-api-key } } }
#
# ---
# apiVersion: apps/v1
# kind: Deployment
# metadata:
#   name: sallycourse-worker-browser
# spec:
#   # Playwright = 1 session par compte plateforme : PAS de scale horizontal
#   # naïf (risque de sessions concurrentes sur le même compte Udemy/YouTube).
#   # Scaler par sharding de credentialId (un pod par groupe de comptes) plutôt
#   # que par replicas génériques.
#   replicas: 1
#   template:
#     spec:
#       containers:
#         - name: worker-browser
#           image: sallycourse/worker-playwright:latest  # image avec deps Playwright (chromium)
#           command: ["pnpm", "--filter", "@sallycourse/worker", "start:browser"]
#           resources:
#             requests: { cpu: "1", memory: "1Gi" }   # Chromium headless
#             limits:   { cpu: "2", memory: "2Gi" }
#           env:
#             - { name: WORKER_BROWSER_DEPLOYMENT_CONCURRENCY, value: "1" }
#
# ---
# apiVersion: autoscaling/v2
# kind: HorizontalPodAutoscaler
# metadata:
#   name: sallycourse-worker-api-hpa
# spec:
#   scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: sallycourse-worker-api }
#   minReplicas: 2
#   maxReplicas: 10
#   # Idéalement basé sur une métrique custom BullMQ (taille de la queue
#   # content-generation via un exporter Prometheus), pas seulement le CPU.
#   metrics:
#     - type: Resource
#       resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
```

### Notes de migration

- Chaque entrypoint se connecte indépendamment à Mongo/Redis (`connectDb`,
  `getRedisConnection` partagé via `src/queues/connection.ts`) — aucun état
  partagé en mémoire entre pods, donc le passage à plusieurs replicas est
  sûr par construction (BullMQ gère la distribution des jobs entre workers
  connectés à la même queue Redis).
- Le groupe Browser reste volontairement mono-session par défaut
  (`WORKER_BROWSER_DEPLOYMENT_CONCURRENCY=1`) : augmenter la concurrency ou
  les replicas nécessite d'abord un mécanisme de verrouillage par
  `credentialId` (éviter deux sessions Playwright simultanées sur le même
  compte plateforme).
- `index.ts` (tout-en-un) reste adapté au développement local / petit volume ;
  au-delà, préférer les trois entrypoints séparés pour isoler les pannes
  (un crash ffmpeg ne doit pas interrompre la génération de contenu Claude).
