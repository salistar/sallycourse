# Dimensionnement matériel & GPU à la demande (Prompt 162)

Ce document complète `docs/PROVIDERS.md` (stratégie OSS-first, P151) et
`packages/shared/src/pricing-table.ts` (comparateur de coût OSS vs cloud,
P160) : il documente **sur quelle machine physique** faire tourner les
services OSS du profil docker-compose `ai` (Ollama, Piper, Kokoro, ComfyUI,
SadTalker), et comment absorber les pics de charge GPU sans payer un GPU dédié
à l'année.

Deux régimes de charge coexistent :

- **CPU-only** : Piper (TTS) + Ollama petit modèle (8B quantisé) + FFmpeg
  (rendu vidéo) — suffit pour le plan Free en volume modéré.
- **GPU** : Kokoro (clonage de voix), ComfyUI (illustrations), SadTalker
  (avatar vidéo), Ollama gros modèle (70B, qualité premium plan business) —
  nécessite un GPU pour un temps de rendu exploitable en pipeline (cf.
  `SADTALKER_HAS_GPU`, `OLLAMA_HAS_GPU` dans `packages/shared/src/config.ts` :
  sans GPU détecté, ces providers ne sont même pas tentés, repli mock direct).

## 1. Configuration CPU-only (serveur permanent)

Sert le profil `core`/`full` (app + DB + queues) **et** le sous-ensemble OSS
qui tourne correctement sans GPU :

| Service | Modèle/config | RAM | vCPU | Notes |
|---|---|---|---|---|
| Ollama | `llama3.2:8b-instruct-q4` (quantisé Q4_K_M) | ~6 Go résident | 4+ | Repli léger documenté dans `ollama-provider.ts` — pas les modèles 70B/72B (voir §2). |
| Piper | `fr_FR-siwis-medium` | ~300 Mo | 1-2 | Synthèse quasi temps réel sur CPU, aucun besoin GPU. |
| FFmpeg | H.264 1080p | — | 2-4 (pics courts) | Encodage vidéo, déjà comptabilisé dans `RENDER_USD_PER_SECOND`. |
| App (Next.js + worker + Mongo + Redis + MinIO) | profil `core` | ~2 Go | 2 | Charge légère hors pics de génération. |

**Recommandation Hetzner : CPX41** (8 vCPU AMD, 16 Go RAM, ~200 Go NVMe,
~24-28 €/mois selon zone, tarif 2026-07) pour un usage mono-tenant/petite
équipe. Marge confortable pour faire tourner Ollama 8B + Piper + FFmpeg +
l'app en simultané sans contention mémoire.

Pour un volume plus soutenu (plusieurs générations concurrentes, plan
Business avec plusieurs clients) : **CPX51** (16 vCPU, 32 Go RAM,
~48-55 €/mois) — donne de la marge pour faire tourner 2-3 workers Ollama en
parallèle (`OLLAMA_MODEL_SIMPLE`) sans faire attendre la queue `content`.

### Estimation de débit (CPU-only, CPX41)

Hypothèses (cf. `OSS_COMPUTE_SECONDS_PER_UNIT` dans `pricing-table.ts`,
ordres de grandeur ajustés pour un vrai CPX41 vs l'approximation générique
0,1 USD/h utilisée dans la table de coût) :

- Un cours moyen ≈ 8 leçons × (1 200 tokens de script + 1 800 caractères de
  narration TTS) + rendu vidéo ≈ 8 × 90 s.
- LLM (Ollama 8B, CPU) : ~20 s de calcul / 1000 tokens ⇒ ~1200 tokens × 8
  leçons ≈ 9 600 tokens ⇒ ~192 s de compute LLM par cours.
- TTS (Piper, CPU, quasi temps réel) : ~0,15 s/caractère ⇒ 1800 × 8 = 14 400
  caractères ⇒ ~2160 s (mais Piper tourne en parallèle du rendu, pas
  bloquant sur le CPU du LLM si un cœur dédié).
- Rendu FFmpeg : 8 × 90 s de vidéo produite, encodage plus rapide que le
  temps réel sur 1080p simple (slides statiques + narration) ⇒ ~15-20 min
  cumulées.
- **Total séquentiel approximatif par cours : 20-30 min de compute CPU**
  (LLM + TTS + rendu), en supposant 4 vCPU dédiés à la génération et le reste
  à l'app.

⇒ Un CPX41 dédié peut traiter de l'ordre de **25-35 cours/jour** en séquentiel
strict, ou davantage en parallélisant 2 générations (CPX51 : ~50-60 cours/jour)
grâce aux vCPU supplémentaires. Chiffres volontairement prudents (pas de
benchmark réel) — à recaler avec la télémétrie `averageStepDurationMs`
(`apps/web/src/lib/queue-estimate.ts`) une fois en production.

## 2. Configuration GPU (dédiée)

Nécessaire pour :

- **Kokoro** (clonage de voix, plan payant) — inférence bien plus rapide sur
  GPU, CPU reste utilisable mais dégrade la latence perçue.
- **ComfyUI** (FLUX.1-schnell / Stable Diffusion) — quasiment inutilisable en
  pipeline sur CPU (plusieurs minutes par image vs quelques secondes sur GPU).
- **SadTalker** (avatar vidéo) — `SADTALKER_HAS_GPU` conditionne l'appel
  précisément parce que le rendu CPU est trop lent pour un pipeline
  automatisé (cf. commentaire dans `packages/shared/src/config.ts`).
- **Ollama 70B/72B** (`llama3.3:70b`, `qwen2.5:72b`) — qualité premium plan
  business (cf. commentaires `docker-compose.yml`), nécessite une VRAM
  suffisante pour charger le modèle quantisé (~40-45 Go en Q4 pour un 70B).

**Recommandation Hetzner : GEX44** (dédié, 1× NVIDIA RTX 4000 SFF Ada 20 Go
VRAM, 8 cœurs / 16 threads, 64 Go RAM, ~210-250 €/mois, tarif 2026-07) pour
ComfyUI + SadTalker + Kokoro simultanément (20 Go VRAM suffit pour ces trois
modèles chargés à tour de rôle, pas simultanément en usage réel).

Pour Ollama 70B en continu (charge simultanée avec ComfyUI/SadTalker), viser
plutôt **GEX130** (2× RTX 4000 Ada ou équivalent ≥ 40-48 Go VRAM cumulée,
~400-450 €/mois) — sinon accepter que le 70B et l'avatar/image ne tournent
pas en même temps sur le même GEX44 (file d'attente applicative naturelle,
acceptable en volume modéré).

## 3. Comparatif GPU dédié vs location à la demande

| Critère | Hetzner GEX44 (dédié) | RunPod / Vast.ai (à la demande) |
|---|---|---|
| Coût | ~210-250 €/mois fixe, quel que soit l'usage | Facturation horaire — ex. RTX 4090 24 Go ≈ 0,30-0,50 USD/h sur Vast.ai (marché spot, variable), RunPod Community/Secure Cloud ≈ 0,40-0,80 USD/h pour une RTX 4090/A5000 (tarifs 2026-07, fluctuent selon disponibilité) |
| Seuil de rentabilité | Rentable dès ~500-700 h d'usage GPU/mois (charge quasi continue) | Rentable pour un usage **ponctuel/pic** — en dessous de ~400-500 h/mois cumulées, la location horaire reste moins chère que le fixe |
| Latence de démarrage | Aucune — service déjà démarré (docker-compose profil `ai`/`full` toujours up) | RunPod : 30 s à quelques minutes (pull d'image + boot du pod, plus long si l'image contient les poids du modèle non mis en cache) ; Vast.ai : variable selon l'hôte (30 s à plusieurs minutes), certains hôtes plus lents que d'autres (marché décentralisé, moins de garantie SLA) |
| Disponibilité garantie | Oui (matériel réservé) | Non garantie sur le marché spot (un pod peut être préempté sur Vast.ai) ; RunPod Secure Cloud plus fiable que Community Cloud mais plus cher |
| Cas d'usage recommandé | Volume soutenu et prévisible (plan Business avec plusieurs clients actifs, génération d'avatar/image en continu) | Pics ponctuels (lancement marketing, rattrapage de backlog après une panne, tests de charge) — complète un GEX44 déjà en place plutôt que de le remplacer |

**Stratégie recommandée** : démarrer avec le CPX41/CPX51 CPU-only (§1) tant
que le volume de jobs GPU-dépendants (avatar/image/Kokoro) reste faible et
que `PROVIDER_MODE=auto` retombe majoritairement sur le mock ou le cloud
(HeyGen/ElevenLabs, cf. `isHeyGenAllowedForPlan`/`isElevenLabsAllowedForPlan`).
Provisionner un GEX44 dédié seulement quand la profondeur de queue GPU
dépasse durablement le seuil documenté ci-dessous ; en attendant ce palier,
absorber les pics avec un worker GPU éphémère loué à l'heure (RunPod/Vast) —
voir `apps/worker/src/lib/gpu-autoscale.ts`.

## 4. Autoscaling GPU éphémère (`gpu-autoscale.ts`)

Module : `apps/worker/src/lib/gpu-autoscale.ts`.

- `shouldScaleUp(queueDepth, threshold)` / `shouldScaleDown(...)` : décision
  PURE à partir de la profondeur cumulée des queues GPU-dépendantes
  (`tts`, `screenshot`, `videoRender` — proxys des jobs Kokoro/SadTalker/
  ComfyUI, réutilise le calcul de `queue-estimate.ts`, P73/P134) comparée à
  un seuil configurable (`GPU_AUTOSCALE_QUEUE_THRESHOLD`, défaut 5 jobs en
  attente).
- `provisionGpuWorker(opts)` : appelle l'API REST RunPod (`RUNPOD_API_KEY`)
  ou Vast.ai (`VASTAI_API_KEY`) selon `GPU_AUTOSCALE_PROVIDER`. **Sans
  credentials configurés, ne fait AUCUN appel réseau** — retourne un
  `GpuWorkerHandle` de type `mock` (mock-friendly, comme tous les providers
  du projet).
- `destroyGpuWorker(handle)` : arrête/détruit le pod loué.
- `reapIdleGpuWorkers(handles, maxIdleMs)` : reprend le pattern reaper de
  `media/tp-environments.ts::killTpContainersOlderThan` (P22) — détruit tout
  worker GPU inactif depuis plus de `maxIdleMs` (défaut 15 min), best-effort,
  ne jette jamais.
- `hourlyRateUsd(provider, gpuType)` / `isRentalCheaperThanFixed(...)` :
  calcul PUR du coût horaire loué vs l'amortissement d'un GEX44 fixe, pour
  aider la décision "louer maintenant" vs "un dédié serait déjà rentable" —
  réutilise le même style de constantes éditables que `pricing-table.ts`.

### Variables d'environnement (à ajouter si le provisioning réel est activé)

Ces variables sont **optionnelles** — absentes, `provisionGpuWorker` reste en
mode mock (aucun blocage du pipeline) :

| Variable | Rôle |
|---|---|
| `GPU_AUTOSCALE_PROVIDER` | `runpod` \| `vast` \| absent (mock) |
| `RUNPOD_API_KEY` | Clé API RunPod (console RunPod → Settings → API Keys) |
| `VASTAI_API_KEY` | Clé API Vast.ai (console Vast → Account → API Key) |
| `GPU_AUTOSCALE_QUEUE_THRESHOLD` | Nombre de jobs en attente déclenchant un scale-up (défaut 5) |
| `GPU_AUTOSCALE_MAX_IDLE_MINUTES` | Minutes d'inactivité avant destruction du worker loué (défaut 15) |

Ces clés ne sont volontairement PAS ajoutées à `envSchema`
(`packages/shared/src/config.ts`) tant que le provisioning réel n'est pas
câblé en production — `gpu-autoscale.ts` les lit directement via
`process.env` avec repli mock, pour ne pas complexifier le schéma global
d'une fonctionnalité encore optionnelle (cohérent avec l'esprit MOCK-FRIENDLY
du projet : une variable absente ne doit jamais faire échouer `getConfig()`).
