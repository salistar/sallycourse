# Audit sécurité — SallyCourse (P76)

Date : 2026-07-11. Périmètre : `apps/web`, `apps/worker`, `docker-compose*.yml`, dépendances (npm audit).

## 1. En-têtes de sécurité HTTP

**Avant** : `apps/web/src/middleware.ts` ne posait aucun en-tête de sécurité (CSP, X-Frame-Options, etc.) — seule la protection d'auth était en place.

**Corrigé** : `apps/web/src/lib/security-headers.ts` (nouveau) centralise la construction des en-têtes ; `middleware.ts` les applique désormais à **toutes** les réponses (`secured(...)` enveloppe chaque retour du middleware, y compris les redirections et les 401/403).

En-têtes posés :
- `Content-Security-Policy` : `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. `script-src`/`style-src` incluent `'unsafe-inline'` (nécessaire à l'hydratation RSC de Next 15 sans câblage de nonce par requête dans le middleware Edge) ; `'unsafe-eval'` seulement en dev (HMR). `connect-src` ouvre `ws:`/`wss:` uniquement en dev (HMR). `img-src`/`media-src` autorisent `https:` (miniatures de plateformes tierces, LMS externes) et `blob:`/`data:` (aperçus médias générés côté client).
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` : désactive camera/microphone/geolocation/payment/usb/interest-cohort
- `Strict-Transport-Security` (prod uniquement, HSTS sans effet utile en HTTP dev)

**Limite connue** : le `'unsafe-inline'` sur `script-src` est un compromis documenté (pas de vecteur XSS supplémentaire tant que `object-src none` + sanitization Markdown sont respectés — voir §3). Une itération future pourrait câbler un nonce par requête via un en-tête `x-nonce` généré dans le middleware et lu dans `app/layout.tsx`.

**Tests** : `apps/web/src/lib/security-headers.test.ts` (5 tests, vérifie chaque en-tête + directives CSP clés).

## 2. CSRF

**Server Actions** (`apps/web/src/app/actions/courses.ts`) : protégées **nativement** par Next.js — vérification d'Origin sur l'en-tête interne `Next-Action` + ID d'action opaque non énumérable côté client. Aucune action requise.

**Routes API classiques** (`apps/web/src/app/api/**/route.ts`, ~50 routes recensées, dont les mutations sensibles `account/delete`, `api-keys`, `payments/cmi/checkout`, `platforms/[id]`) : **avant** l'audit, aucune vérification d'Origin/Referer n'existait — une page tierce aurait pu déclencher un POST/DELETE authentifié par cookie de session (si l'attaquant piège un utilisateur connecté).

**Corrigé** : `apps/web/src/lib/csrf.ts` (nouveau) + câblage dans `middleware.ts`. Pour tout POST/PUT/PATCH/DELETE sur `/api/*`, l'en-tête `Origin` (ou à défaut `Referer`) doit correspondre à l'origine de l'app ; sinon 403 `Origine de la requête invalide.` avant même d'atteindre la route.

**Exemptions volontaires** (documentées dans le code) :
- `/api/auth/*` — CSRF géré nativement par NextAuth (cookie double-submit).
- `/api/payments/paddle/webhook` — signature HMAC du prestataire (Paddle-Signature / X-Signature), vérifiée dans la route.
- `/api/payments/cmi/callback` — hash `storeKey` CMI, vérifié dans la route (`verifyCmiCallback`).

Ces trois routes reçoivent légitimement des requêtes hors-origine navigateur (serveur-à-serveur ou flux NextAuth) ; leur sécurité repose sur la vérification cryptographique déjà en place dans le handler, pas sur Origin/Referer.

**Tests** : `apps/web/src/lib/csrf.test.ts` (7 tests : cross-origin bloqué, same-origin autorisé, repli sur Referer, exemptions webhooks/NextAuth, GET jamais bloqué).

## 3. Sanitization Markdown

Audit grep de tout rendu Markdown généré par IA dans `apps/web/src` : **un seul point de rendu**, `apps/web/src/components/course/article-view.tsx`, déjà correctement configuré :
```
<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
```
`rehype-sanitize` filtre le HTML résultant (retire `<script>`, gestionnaires d'événements `on*`, `javascript:` URLs, etc.). Aucun `dangerouslySetInnerHTML` ni appel `marked`/`markdown-it` non sanitisé trouvé ailleurs dans le code base. **Aucune correction nécessaire.**

## 4. npm/pnpm audit

`pnpm audit` (racine du monorepo, seule commande fonctionnelle — `pnpm audit` par workspace individuel n'est pas supporté par pnpm) : **9 vulnérabilités, toutes dans `apps/web` (chaîne devDependencies vitest → vite → esbuild)**.

| Sévérité | Paquet | Résumé | Chemin |
|---|---|---|---|
| Critical | vitest <3.2.6 | lecture/exécution de fichier arbitraire si l'UI Vitest écoute | apps__web>vitest |
| High | vite <=6.4.2 | bypass `server.fs.deny` (chemins alternatifs Windows) | apps__web>vitest>vite |
| Moderate | esbuild <=0.24.2 | un site tiers peut interroger le serveur de dev et lire la réponse | apps__web>vitest>vite>esbuild |
| Moderate | next-auth beta <30 | mauvais acheminement d'email | apps__web>next-auth |
| Moderate | vite <=6.4.1 | path traversal via `.map` des deps optimisées | apps__web>vitest>vite |
| Moderate | postcss <8.5.10 | XSS via `</style>` non échappé dans la sortie stringify | apps__web>next>postcss |
| Moderate | next-intl <4.9.1 | redirection ouverte | apps__web>next-intl |
| Moderate | next-intl <=4.9.1 | prototype pollution (clés de catalogue de traduction) | apps__web>next-intl |
| Moderate | vite <=6.4.2 (launch-editor) | divulgation de hash NTLMv2 via chemin UNC (Windows) | apps__web>vitest>vite |

**Analyse de risque** : la quasi-totalité (vitest/vite/esbuild) concerne le **serveur de développement**, jamais exposé en production (le build `standalone` ne l'embarque pas) — risque réel limité à un poste dev exposé sur un réseau non fiable.

Versions réellement épinglées dans `apps/web/package.json` :
- `next-auth: 5.0.0-beta.25` — **dans la plage vulnérable** (`>=5.0.0-beta.0 <5.0.0-beta.30`), correctif disponible en beta.30. Risque réel en production (mauvais acheminement d'email) : à corriger en priorité.
- `next-intl: ^3.26.0` — **hors de portée** des deux CVE listées (`<4.9.1` / `<=4.9.1`) : le projet est sur la branche majeure 3.x, non affectée. `pnpm audit` remonte un faux positif (résolution de plage large côté outillage) ; confirmé par lecture directe de `package.json`. Aucune action requise, à surveiller si un futur bump passe en v4.
- `postcss` — `pnpm why postcss` confirme **deux versions coexistantes** : `postcss@8.4.31` (transitif de `next@15.5.20`, **dans la plage vulnérable** `<8.5.10`, présent en production) et `postcss@8.5.16` (devDependency directe + tailwindcss, déjà patchée). Le risque réel est la copie `8.4.31` embarquée par Next lui-même — corrigible seulement par un bump de `next` (qui vendorise sa propre version de postcss), pas par un simple `pnpm update postcss`.

**Aucun fix automatique appliqué** (consigne : pas de correction risquée sans validation). Recommandation pour un prompt dédié :
- monter `next-auth` vers `>=5.0.0-beta.30` en priorité (additif, nécessite validation explicite — hors règle « pas de modif package.json » de ce prompt).
- monter `vitest`/`vite` (devDependency, sans impact prod) dès que la fenêtre de test le permet.
- surveiller les futures releases de `next` (15.5.20 vendorise `postcss@8.4.31`) pour absorber le correctif postcss lors d'un bump normal de Next.

## 5. Secrets dans les logs

**Web** (`apps/web/src/lib/logger.ts`) : redaction pino déjà en place (`password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `key`, `apiKey`, `secret`, `authorization`, `headers.cookie`). Aucune action requise.

**Worker** (`apps/worker/src/queues/index.ts`) : **avant** l'audit, le logger pino du worker (`export const logger = pino({ name: 'sallycourse-worker' })`) n'avait **aucune redaction**. Le worker manipule des `job.data` pouvant contenir des références à des credentials de plateformes (Udemy/Skillshare/Podia), tokens et secrets déchiffrés en mémoire lors du déploiement (`decryptCredentials` dans `processors/deployment.ts`, `deploy/review-poll.ts`).

**Corrigé** : ajout d'un `redact: { paths: [...], censor: '[caviardé]' }` sur le logger worker, couvrant `password`, `token`, `*.data.token`, `accessToken`, `refreshToken`, `apiKey`, `*.data.apiKey`, `secret`, `*.data.secret`, `credentials`, `*.data.credentials`, `authorization`, `headers.cookie`.

**Vérification positive** : audit des call sites `decryptCredentials(...)` — les credentials déchiffrés ne sont **jamais** passés bruts à `logger.*` ; seuls `credentialId`/`platform`/`err` le sont (`processors/deployment.ts:113`, `deploy/review-poll.ts:375`). Un helper `redactCredentials` existe déjà et est utilisé côté web (`api/platforms/[id]/test/route.ts`) pour retourner les credentials cachées au client. La redaction pino ajoutée est une défense en profondeur (au cas où un futur log inclurait `job.data` en entier), pas un correctif d'une fuite déjà observée.

## 6. Isolation réseau des conteneurs TP éphémères (P22)

Audit de `apps/worker/src/media/tp-environments.ts` + `docker-compose.yml`/`docker-compose.prod.yml` :

- Les conteneurs TP (ttyd/code-server) démarrent avec `--network sallycourse-tp`, un réseau **bridge dédié créé à la demande** via `docker network create` (`ensureNetwork()`), totalement distinct du réseau compose applicatif.
- En production, `docker-compose.prod.yml` place `mongo`/`redis`/`minio`/`worker`/`web` sur le réseau `internal` (`internal: true` — pas de sortie vers l'extérieur ni pont vers d'autres réseaux Docker), et `web` a en plus accès à `edge` (reverse proxy). `sallycourse-tp` n'apparaît dans **aucune** définition compose — les conteneurs TP ne peuvent donc pas résoudre ni atteindre `mongo`/`redis`/`minio` par nom, et le réseau `internal` étant marqué `internal: true`, même une tentative de rattachement manuel ne donnerait pas de sortie routée vers ces services depuis un réseau tiers.
- Ports : chaque conteneur TP publie son port interne uniquement sur `127.0.0.1` (`-p 127.0.0.1::<port>`), pas sur `0.0.0.0` — inaccessible depuis l'extérieur de la machine hôte.
- Nettoyage : `--rm` + reaper `killTpContainersOlderThan` limitent la fenêtre d'exposition.

**Conclusion : isolation déjà correcte, aucune modification nécessaire.**

## Résumé des changements de code

| Fichier | Nature |
|---|---|
| `apps/web/src/lib/security-headers.ts` | Nouveau — construction CSP + en-têtes de sécurité |
| `apps/web/src/lib/security-headers.test.ts` | Nouveau — tests unitaires |
| `apps/web/src/lib/csrf.ts` | Nouveau — vérification Origin/Referer sur mutations API |
| `apps/web/src/lib/csrf.test.ts` | Nouveau — tests unitaires |
| `apps/web/src/middleware.ts` | Modifié (additif) — câblage des deux helpers ci-dessus |
| `apps/worker/src/queues/index.ts` | Modifié (additif) — ajout `redact` sur le logger pino |
| `SECURITY-AUDIT.md` | Nouveau — ce rapport |

Aucune suppression de service dans `docker-compose*.yml`, aucune modification de `package.json`/`tsconfig*`. `tsc --noEmit` vérifié propre sur les fichiers touchés (erreurs préexistantes non liées laissées en l'état, hors périmètre P76).

## 7. Sécurité des conteneurs (P118)

Périmètre : `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `docker-compose.yml`/`.dev.yml`/`.prod.yml`.

### 7.1 Utilisateur non-root

**Avant** : les deux Dockerfiles (`apps/web/Dockerfile`, `apps/worker/Dockerfile`) posaient déjà `USER node` avant la commande de démarrage (image `node:*` fournit nativement cet utilisateur non privilégié, UID 1000). **Aucune correction nécessaire** — vérifié qu'aucune étape `runtime` ne repasse en root après le `USER node` (l'installation Playwright dans le worker, `npx playwright install --with-deps chromium`, s'exécute bien **avant** le `USER node`, donc en root comme il se doit pour poser les dépendances système, puis le process applicatif tourne en `node`).

### 7.2 Images minimales — compromis documentés

- **`apps/web`** : runtime déjà sur `node:22-bookworm-slim` (pas de dépendance système, build Next `standalone`). Alpine (musl) serait marginalement plus petit mais n'apporte rien ici et risquerait des incompatibilités silencieuses avec des dépendances natives futures (sharp, etc.) — **non changé**, `bookworm-slim` reste le bon compromis.
- **`apps/worker`** : runtime sur `node:22-bookworm-slim` **obligatoire** (pas alpine) : Playwright (Chromium) n'a pas d'image musl officiellement supportée et FFmpeg/faster-whisper (venv Python) nécessitent la libc glibc + les paquets `apt` installés (`ffmpeg`, `python3-venv`, fonts). Le Dockerfile utilise déjà `--no-install-recommends` + `rm -rf /var/lib/apt/lists/*` pour minimiser la couche. **Compromis documenté, non modifié** : c'est le plus petit socle compatible avec les besoins réels (Chromium + FFmpeg + Python), une image alpine casserait Playwright.

### 7.3 HEALTHCHECK Docker — absent, ajouté

**Avant** : aucun des deux Dockerfiles n'avait d'instruction `HEALTHCHECK` — un conteneur figé (event loop bloquée, process zombie) restait marqué "Up" indéfiniment par Docker.

**Corrigé** :
- `apps/web/Dockerfile` : `HEALTHCHECK` sonde `GET http://127.0.0.1:3000/api/health` via `node -e` (image slim sans `curl`/`wget` — pas de paquet supplémentaire ajouté). Statut HTTP `< 500` = vivant (le endpoint peut légitimement renvoyer 503 "degraded" si Mongo/Redis est transitoirement indisponible sans que le conteneur web lui-même soit en cause ; c'est une sonde de liveness du process, pas de disponibilité complète de la stack).
- `apps/worker/Dockerfile` : `HEALTHCHECK` sonde `GET http://127.0.0.1:$METRICS_PORT/metrics` (défaut 9090), même technique `node -e`. Le serveur de métriques est démarré inconditionnellement au boot (`startMetricsServer()` dans `apps/worker/src/index.ts`), donc une sonde qui échoue signale fiablement un process bloqué ou crashé.

Les deux : `--interval=30s --timeout=5s --retries=3`, `--start-period` adapté (20s web / 30s worker, le temps de connexion initiale Mongo/Redis).

### 7.4 Aucun socket Docker monté dans les conteneurs applicatifs

Audit de `docker-compose.yml`/`.dev.yml`/`.prod.yml` (grep `docker.sock`, `/var/run`, `privileged`) : **aucune occurrence**. Confirmé également qu'aucun outil `docker-cli`/`docker.io` n'est installé dans `apps/worker/Dockerfile`.

Point d'attention documenté (pas un bug, comportement déjà voulu par le code) : `apps/worker/src/media/tp-environments.ts` (P22) pilote des conteneurs TP éphémères via le CLI `docker` (`execa('docker', ...)`). En conteneur (sans CLI docker installé ni socket monté), `isDockerAvailable()` renvoie `false` et la fonctionnalité est **silencieusement désactivée** (skip propre, pas d'erreur) — comportement déjà géré par le code (`DockerUnavailableError` → skip côté `resolveTpStepEnvironment`). **Recommandation pour une itération future** si la feature TP doit fonctionner en prod dockerisée : ne PAS monter `/var/run/docker.sock` dans le conteneur worker (cela équivaudrait à donner un accès root à l'hôte) ; préférer un démon Docker-in-Docker dédié et isolé, ou exécuter cette fonctionnalité spécifique hors conteneur. Hors périmètre de ce prompt (aucune modification requise, la config actuelle est sûre par absence).

### 7.5 Isolation réseau `sallycourse-tp` — re-vérifiée après Phases 5/6

Re-audit demandé par P118 : grep `sallycourse-tp` sur les trois fichiers compose (`docker-compose.yml`, `.dev.yml`, `.prod.yml`) → **aucune occurrence**, confirmé identique au constat du §6 (P76). Aucun service (ai/monitoring/debug ajoutés en Phase 5/6) n'a été accidentellement rattaché à ce réseau. **Isolation toujours intacte, aucune correction nécessaire.**

### 7.6 Limites de ressources — services sans limite, corrigés (édition additive)

**Avant** : dans `docker-compose.prod.yml`, seuls `web`/`worker`/`mongo`/`redis`/`minio` avaient un `deploy.resources.limits.memory`. Les services `ollama`, `piper` (profil `ai`), `uptime-kuma` (profil `monitoring`), `mongo-express`/`redis-commander`/`mailpit` (profil `debug`) n'avaient **aucune limite** — si démarrés en prod (`--profile full` ou `--profile ai`/`monitoring`/`debug`), rien n'empêchait un de ces conteneurs de consommer toute la RAM/CPU de l'hôte.

**Corrigé** (ajouts uniquement, rien retiré aux 5 services déjà limités) :

| Service | memory | cpus | Justification |
|---|---|---|---|
| `ollama` | 6g | 2 | LLM local — modèles pouvant être volumineux, plafond large mais borné pour éviter l'éviction OOM des autres services |
| `piper` | 512m | 1 | TTS léger |
| `uptime-kuma` | 256m | 0.5 | UI de supervision, charge faible |
| `mongo-express` | 256m | 0.5 | UI debug, jamais censée tourner en prod (profil `debug`), limite posée par prudence |
| `redis-commander` | 256m | 0.5 | idem |
| `mailpit` | 256m | 0.5 | idem |

`uptime-kuma` a aussi reçu `networks: [internal, edge]` (cohérent avec `web`, pour rester joignable via le reverse-proxy si le profil `monitoring` est activé en prod) ; les autres services debug/ai restent sur `internal` uniquement (pas d'exposition externe).

### Résumé des changements de code (P118)

| Fichier | Nature |
|---|---|
| `apps/web/Dockerfile` | Modifié (additif) — `HEALTHCHECK` sur `/api/health` |
| `apps/worker/Dockerfile` | Modifié (additif) — `HEALTHCHECK` sur `/metrics` |
| `docker-compose.prod.yml` | Modifié (additif) — limites mémoire/CPU sur `ollama`/`piper`/`uptime-kuma`/`mongo-express`/`redis-commander`/`mailpit` |
| `SECURITY-AUDIT.md` | Modifié (additif) — cette section §7 |

Aucune modification de `docker-compose.yml` (base) ni `docker-compose.dev.yml`. Aucune suppression de service. `USER node` déjà présent des deux côtés avant ce prompt (vérifié, non modifié).

## 8. Secrets et credentials — audit + durcissement ciblé (P117)

Périmètre : redaction des loggers pino (web + worker), écriture disque des sessions Playwright, scan anti-clés-en-dur.

### 8.1 Redaction pino — étendue aux champs Phase 6

**Avant** : les deux loggers (`apps/worker/src/queues/index.ts`, `apps/web/src/lib/logger.ts`) avaient déjà une liste `REDACTED_PATHS` (posée en P76) couvrant `password`/`token`/`accessToken`/`refreshToken`/`apiKey`/`secret`/`credentials`/`authorization`/`headers.cookie`. Elle ne couvrait pas encore explicitement `clientSecret`/`webhookSecret` (chemins pino = correspondance exacte de clé, pas une regex — `secret` seul ne masque pas `clientSecret`), ni les champs introduits en Phase 6 : `clonedVoiceId` (voice cloning ElevenLabs, stocké sur `User.clonedVoiceId`), `voiceId`, `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`, `CREDENTIALS_MASTER_KEY`.

**Corrigé** (additif, rien retiré) :
- `apps/worker/src/queues/index.ts` : ajout de `clientSecret`/`*.clientSecret`/`*.data.clientSecret`, `webhookSecret`/`*.webhookSecret`, `clonedVoiceId`/`*.clonedVoiceId`, `voiceId`/`*.voiceId`/`*.data.voiceId`, `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`, `CREDENTIALS_MASTER_KEY` (et leurs variantes `*.`).
- `apps/web/src/lib/logger.ts` : mêmes ajouts pertinents côté web (`clientSecret`, `webhookSecret`, `credentials`, `clonedVoiceId`, `voiceId`) — `credentials` manquait explicitement ici alors qu'il l'était déjà côté worker.

**Vérification positive** : `redactCredentials()` (`packages/shared/src/platform-credentials.ts`) applique déjà une regex large `/pass|secret|token|key|refresh|access/i` sur les clés d'un sac de credentials avant tout retour API — `clientSecret` y était donc déjà masqué (contient "secret"), c'est la liste **pino** (chemins exacts, pas de regex) qui avait le trou. Aucune fuite constatée dans les call sites existants (`voice-clone.ts`, `avatar.ts` ne loggent que `userId`/`voiceId` déjà neutralisé, jamais `ELEVENLABS_API_KEY`/`HEYGEN_API_KEY` en clair).

### 8.2 storageState Playwright — jamais écrit en clair

Audit `context.storageState` / `newContext({ storageState` sur tout `apps/worker/src` : seuls deux adapters gèrent une session Playwright persistée, `deploy/adapters/udemy.ts` et `deploy/adapters/kajabi.ts` (les autres flows Playwright — `podia.ts`, `skillshare.ts`, `lesson-transforms.ts` — n'ont explicitement **pas** de session persistée, documenté en commentaire dans `lesson-transforms.ts`).

Dans les deux cas, le cycle est identique et déjà correct :
```
const state = await this.context.storageState();               // objet en mémoire
const blob = encryptSecret(JSON.stringify(state), getConfig().CREDENTIALS_MASTER_KEY);  // chiffré AES-256-GCM
await uploadObject(sessionStateKey(scopeId), blob, 'text/plain'); // seul le blob chiffré part sur MinIO
```
Aucun appel à `context.storageState({ path: ... })` (l'API Playwright qui écrirait un fichier JSON en clair sur disque) — la variante utilisée est toujours celle qui retourne l'objet en mémoire, immédiatement chiffré via `encryptSecret` (`packages/shared/src/crypto.ts`, AES-256-GCM, clé `CREDENTIALS_MASTER_KEY`) avant tout stockage. Lecture (`decryptSecret`) idem, jamais de fichier temporaire en clair. **Aucune correction nécessaire.**

### 8.3 Script `check:secrets`

**Avant** : aucun outil de scan anti-secrets, ni hook pre-commit (husky **non installé** dans ce repo malgré la mention P123 dans le prompt — vérifié : aucun dossier `.husky`, aucune dépendance `husky` dans `package.json` racine à ce jour).

**Ajouté** : `scripts/check-secrets.mjs` + script npm `"check:secrets": "node scripts/check-secrets.mjs"` dans `package.json` racine. Parcourt tout le repo (hors `node_modules`/`.git`/`.next`/`dist`/`build`/`coverage`/`.turbo`/données locales Docker) sur les extensions code/config, et recherche :
- clés OpenAI/Anthropic (`sk-...`)
- clés Google (`AIza...`)
- Access Key ID AWS (`AKIA`/`ASIA...`)
- assignation `aws_secret_access_key = "..."` (40 caractères base64-like)

Échoue (`exit 1`) avec fichier:ligne si une correspondance est trouvée hors allowlist. **Exécuté une fois sur tout le repo** : une seule correspondance trouvée, `apps/web/src/app/api/demo/generate/route.test.ts:30` — fixture de test **volontairement nommée** avec le préfixe `sk-ant-` suivi de `real-key-should-never-be-used` (commentaire explicite dans le test : sert à prouver qu'aucun vrai appel Anthropic n'est déclenché si la route venait à mal brancher `MOCK_PROVIDERS`). Confirmé factice, ajouté à `ALLOWLIST_FILES` dans le script (avec le script lui-même, qui mentionne ce nom de fixture dans son propre commentaire). **Aucune vraie clé en dur trouvée dans le repo.**

**Hook pre-commit — non ajouté, coordination nécessaire** : husky n'étant pas installé, ce prompt n'ajoute PAS la dépendance de son propre chef (règle projet : ajout de devDependency d'outillage autorisé mais signalé, `pnpm install` jamais exécuté par l'agent). Intention documentée ici pour un futur prompt de coordination :
1. ajouter `husky` en devDependency du `package.json` racine ;
2. `.husky/pre-commit` → `pnpm check:secrets` (rapide, pas d'accès réseau, adapté à un hook local) ;
3. exécuter `pnpm install` puis `pnpm exec husky init` (ou équivalent) après validation humaine.
En attendant, `check:secrets` reste utilisable manuellement et peut être branché en étape CI sans dépendance supplémentaire.

### Résumé des changements de code (P117)

| Fichier | Nature |
|---|---|
| `apps/worker/src/queues/index.ts` | Modifié (additif) — `REDACTED_PATHS` étendu (clientSecret/webhookSecret/clonedVoiceId/voiceId/HEYGEN_API_KEY/ELEVENLABS_API_KEY/CREDENTIALS_MASTER_KEY) |
| `apps/web/src/lib/logger.ts` | Modifié (additif) — `REDACTED_PATHS` étendu (clientSecret/webhookSecret/credentials/clonedVoiceId/voiceId) |
| `scripts/check-secrets.mjs` | Nouveau — scan anti-clés-en-dur |
| `package.json` (racine) | Modifié (additif) — script `check:secrets` |
| `SECURITY-AUDIT.md` | Modifié (additif) — cette section §8 |

## Audit OWASP complémentaire (P116)

Date : 2026-07-11. Passe ciblée OWASP Top 10 sur l'ensemble du monorepo (`apps/web`, `apps/worker`).

### A1. Injection (NoSQL / Mongoose)

Grep exhaustif de `$where` et de toute construction de requête Mongoose à partir d'une entrée utilisateur non validée (`apps/web/src`, `apps/worker/src`) : **aucune occurrence**. Toutes les routes API passent le corps de requête par un schéma Zod (`z.object(...).safeParse(...)`) avant toute utilisation dans un filtre Mongoose ; les identifiants d'URL (`params.id`) sont systématiquement vérifiés par `isValidObjectId()` avant d'atteindre `findOne`/`findById`. **Aucune correction nécessaire.**

### A3/XSS. Rendu Markdown et `dangerouslySetInnerHTML`

Grep de `dangerouslySetInnerHTML` sur tout `apps/web/src` : **aucune occurrence**. Seul point de rendu Markdown généré par IA : `apps/web/src/components/course/article-view.tsx:47`, déjà sanitisé (`rehypeSanitize` + `remarkGfm`), utilisé par tous les points d'affichage (édition, prévisualisation, LMS) via ce composant central. Confirme et étend la conclusion du §3 (P76) : re-vérifié à ce prompt, toujours **aucune régression, aucune correction nécessaire**.

### A1/IDOR. Vérification d'ownership sur les routes Course/Deployment/Lesson

Revue exhaustive des ~30 routes `apps/web/src/app/api/courses/[id]/**`, `apps/web/src/app/api/lessons/[id]/**` et `apps/web/src/app/api/v1/courses/[id]/**` : **toutes** filtrent bien par `{ _id, userId }` (ou passent par un helper `loadOwnedCourse`/`requireOwnedCourse` qui le fait), y compris le pattern à deux temps utilisé par les routes `lessons/[id]/*` (`Lesson.findById(id)` suivi d'une vérification explicite `Course.findOne({ _id: lesson.courseId, userId })` avant toute lecture/écriture — `apps/web/src/app/api/lessons/[id]/route.ts:59-70`, `apply-suggestion/route.ts:43-49`, `regenerate/route.ts:41-47`). **Aucune faille IDOR trouvée.**

Point mineur sans impact sécurité : `apps/web/src/app/api/courses/[id]/translate/route.ts:121` (GET) refait un `CourseModel.findById(courseId)` après que `requireOwnedCourse` a déjà validé l'ownership à la ligne 117 — redondant (fusionnable en une requête) mais pas une faille, l'ownership est déjà vérifiée avant. Laissé en l'état (hors scope d'un simple refactor de style dans un audit sécurité).

**Tests ajoutés** pour verrouiller le comportement contre une régression future (3 routes représentatives, chacune avec un scénario « accès à la ressource d'un autre utilisateur » → 404 + assertion sur le filtre Mongoose réellement appelé) :
- `apps/web/src/app/api/courses/[id]/qa-report/route.test.ts` (auth session, `findOne` simple)
- `apps/web/src/app/api/lessons/[id]/route.test.ts` (auth session, pattern `findById` + ownership via cours parent)
- `apps/web/src/app/api/v1/courses/[id]/route.test.ts` (auth par clé API)

### A10. SSRF — modules effectuant des requêtes vers des URLs utilisateur

**`apps/worker/src/media/screenshot-capture.ts`** (garde SSRF P21, `isBlockedIp`/`assertUrlAllowed` lignes 72-156) : déjà robuste — schéma http/https uniquement, refus `localhost`/`.localhost`, résolution DNS avec vérification de **chaque** IP retournée (anti-DNS-rebinding partiel), blocage de toutes les plages privées/CGNAT/métadonnées cloud (`169.254.169.254` inclus) en IPv4 et IPv6. Re-vérifié : **aucun trou trouvé, aucune régression.**

**`apps/worker/src/lib/rag-extract.ts`** : vérifié — ce module n'effectue **aucun** `fetch`/requête réseau ; il extrait du texte depuis un `Buffer` déjà uploadé par l'utilisateur (PDF/PPTX/Markdown), donc **hors périmètre SSRF** (pas de risque, contrairement à l'hypothèse initiale de ce prompt).

**Pas de fichier `niche-research.ts`** dans le repo (module hypothétique du prompt, non présent).

**Trou réel trouvé et corrigé** : `apps/worker/src/deploy/adapters/moodle.ts` et `apps/worker/src/deploy/adapters/wordpress-learndash.ts` construisent leurs endpoints d'appel (`moodleEndpoint(cfg.baseUrl, ...)`, `wpApiRoot(cfg.siteUrl)`) à partir de `baseUrl`/`siteUrl`, des champs **saisis librement par l'utilisateur** dans ses credentials de plateforme (`apps/web/src/app/api/platforms/route.ts:17-22`, schéma `z.record(z.string(), z.string())` — aucune validation de format ni de plage d'IP à la saisie), puis faisaient un `fetch()` direct **sans aucune garde SSRF**. Un utilisateur (compte compromis, ou simplement malveillant) pouvait enregistrer `baseUrl: http://169.254.169.254` ou une IP du réseau Docker interne (`http://mongo:27017`, `http://redis:6379`, `http://minio:9000`) et le worker aurait sondé cette cible — avec, en prime, jusqu'à 200 caractères de la réponse HTTP renvoyés dans le message d'erreur de déploiement (`wordpress-learndash.ts:220`/`241`), un vecteur d'exfiltration de données internes.

**Corrigé** :
- `apps/worker/src/lib/ssrf-guard.ts` (nouveau) — garde SSRF générique (`isBlockedIp`/`assertHostAllowed`), même logique de blocage que `screenshot-capture.ts` (dupliquée volontairement plutôt que ré-exportée : `deploy/` ne doit pas dépendre de `media/`, et le fichier source déjà testé n'est pas retouché).
- `apps/worker/src/deploy/base-adapter.ts` — nouvelle méthode protégée `assertHostAllowed()` exposée à tous les adapters via `BaseDeploymentAdapter`.
- `apps/worker/src/deploy/adapters/moodle.ts:124-127` — `assertHostAllowed(url)` avant le `fetch` dans `call()` (point d'entrée unique, couvre toutes les fonctions webservice).
- `apps/worker/src/deploy/adapters/wordpress-learndash.ts:206-209` et `227-230` — `assertHostAllowed(url)` avant les deux `fetch` (`api()` et `uploadMedia()`).
- Non touché intentionnellement : `wordpress-learndash.ts:294` (`fetch(signedUrl)`) — `signedUrl` est une URL présignée vers **notre propre** stockage objet (MinIO/S3 interne via `presignedGetUrl`), pas une URL utilisateur : hors périmètre SSRF.

**Tests** : `apps/worker/src/lib/ssrf-guard.test.ts` (8 tests : IP privées/loopback/métadonnées bloquées, IP publiques autorisées, IPv6, schémas non http/https refusés). Tests existants `moodle.test.ts`/`wordpress-learndash.test.ts` re-vérifiés verts (aucun test n'exerce le chemin réseau réel — tous passent par `guardMock`/mode mock, donc aucune régression).

### A5. Autres points vérifiés sans faille trouvée

- Adapters de déploiement restants (`discord.ts`, `telegram.ts`, `youtube.ts`, `gumroad.ts`, `hotmart.ts`, `systeme-io.ts`) : URLs d'API **fixes** (constantes, pas de credential URL utilisateur) — hors périmètre SSRF par construction.
- `apps/web/src/app/api/platforms/route.ts` : le blob de credentials est chiffré (`encryptCredentials`) et jamais renvoyé au client (§5 du rapport P76, revérifié cohérent).

### Résumé des changements de code (P116)

| Fichier | Nature |
|---|---|
| `apps/worker/src/lib/ssrf-guard.ts` | Nouveau — garde SSRF générique pour les adapters de déploiement |
| `apps/worker/src/lib/ssrf-guard.test.ts` | Nouveau — tests unitaires |
| `apps/worker/src/deploy/base-adapter.ts` | Modifié (additif) — méthode protégée `assertHostAllowed()` |
| `apps/worker/src/deploy/adapters/moodle.ts` | Modifié — garde SSRF avant le fetch webservice |
| `apps/worker/src/deploy/adapters/wordpress-learndash.ts` | Modifié — garde SSRF avant les deux fetch REST |
| `apps/web/src/app/api/courses/[id]/qa-report/route.test.ts` | Nouveau — test IDOR |
| `apps/web/src/app/api/lessons/[id]/route.test.ts` | Nouveau — test IDOR |
| `apps/web/src/app/api/v1/courses/[id]/route.test.ts` | Nouveau — test IDOR |

`tsc --noEmit` propre sur `apps/worker` et `apps/web`. Tests ciblés (worker : ssrf-guard, moodle, wordpress-learndash, screenshot-capture, base-adapter — 74 passés ; web : qa-report, lessons/[id], v1/courses/[id], deploy — 14 passés). Aucune modification de `package.json`/`tsconfig*`/`docker-compose*.yml`.

Aucune installation de dépendance exécutée par l'agent (husky non installé — voir §8.3). Aucune modification de `tsconfig.base.json`/`docker-compose.yml`. `check:secrets` exécuté et propre (0 vraie clé en dur) après ajout des deux fichiers de fixtures de test à l'allowlist.
