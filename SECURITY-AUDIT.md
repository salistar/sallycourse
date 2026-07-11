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
