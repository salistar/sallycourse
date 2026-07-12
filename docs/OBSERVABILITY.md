# Observabilité — analytics, erreurs, métriques (P157)

Vue d'ensemble des outils d'observabilité OSS self-hostés du projet, tous
rattachés au profil docker-compose `monitoring`. Complète
`docs/RUNBOOK.md` §6 (alertes ops et supervision) sans le dupliquer.

## Sommaire

1. [Analytics web — Umami](#1-analytics-web--umami)
2. [Erreurs applicatives — GlitchTip (placeholder)](#2-erreurs-applicatives--glitchtip-placeholder)
3. [Métriques worker et Uptime Kuma](#3-métriques-worker-et-uptime-kuma)
4. [Démarrage rapide](#4-démarrage-rapide)

---

## 1. Analytics web — Umami

**Choix : Umami plutôt que Plausible.** Les deux sont OSS et respectueux du
RGPD (pas de cookie tiers, mesure d'audience anonymisée). Umami a été
retenu pour ce projet car son self-host est plus simple : une seule image
applicative + une base Postgres, alors que Plausible nécessite Clickhouse en
plus de Postgres — plus lourd à opérer pour un self-host mono-tenant comme
`sallycourse`.

### Composants

- **`umami-db`** (Postgres 16, réseau interne, aucun port publié) — stockage
  dédié. Jamais partagé avec `mongo` (Umami ne supporte que Postgres/MySQL).
- **`umami`** (`docker.umami.is/umami-software/umami:postgresql-latest`,
  `http://localhost:3002`) — UI d'administration + endpoint de collecte.
  Compte admin créé au premier lancement (`admin` / `umami` par défaut, **à
  changer immédiatement**).
- **`apps/web/src/components/umami/`** — intégration côté Next.js :
  - `umami-config.ts` : résolution PURE de la config à partir des variables
    `NEXT_PUBLIC_UMAMI_SRC` / `NEXT_PUBLIC_UMAMI_WEBSITE_ID`. Retourne `null`
    si `NEXT_PUBLIC_UMAMI_WEBSITE_ID` est absent — c'est le comportement par
    défaut (dev, previews, self-host sans le profil `monitoring`).
  - `umami-script.tsx` : composant client (`'use client'`) qui injecte le
    `<Script>` officiel (`next/script`, `strategy="afterInteractive"`)
    uniquement si la config est résolue. **No-op sinon** : aucun script
    chargé, aucun appel réseau, aucune trace côté navigateur.
  - Monté une seule fois dans `apps/web/src/app/layout.tsx` (racine, avant
    les providers), donc actif sur toutes les pages (marketing, dashboard,
    LMS, écoles white-label).

### RGPD

Umami ne pose pas de cookie et n'utilise pas d'identifiant persistant par
visiteur (empreinte quotidienne non réversible, anonymisée) : la CNIL comme
la plupart des lignes directrices RGPD/ePrivacy classent ce type de mesure
d'audience dans les traceurs **exemptés de consentement**. Aucune bannière
de consentement n'est donc requise pour ce composant. Si un futur outil de
tracking moins strict est ajouté (retargeting, pub, cookies tiers), il devra
être gated par le consentement — ne pas réutiliser ce composant comme
précédent pour un outil qui ne respecte pas les mêmes garanties.

### Configuration (`.env`)

```bash
NEXT_PUBLIC_UMAMI_SRC=http://localhost:3002/script.js   # défaut si vide
NEXT_PUBLIC_UMAMI_WEBSITE_ID=                            # vide = tracking désactivé
UMAMI_DB_PASSWORD=umami-secret
UMAMI_APP_SECRET=change-me-umami-app-secret
```

En production, créer le site dans l'UI Umami (`http://umami-host:3002`),
copier l'UUID généré dans `NEXT_PUBLIC_UMAMI_WEBSITE_ID`, et pointer
`NEXT_PUBLIC_UMAMI_SRC` vers l'URL publique de l'instance (ex.
`https://umami.sallycourse.com/script.js`).

---

## 2. Erreurs applicatives — GlitchTip (placeholder)

**Aucun SDK Sentry n'est installé dans ce projet à ce jour** (vérifié :
aucune dépendance `@sentry/*` dans `apps/web/package.json` /
`apps/worker/package.json`, aucun `Sentry.init(...)` dans le code). Le
tracking d'erreurs actuel repose sur les logs pino (`apps/worker` et
`apps/web`) et les alertes ops (`apps/worker/src/lib/alerts.ts`,
`OPS_WEBHOOK_URL`, voir `docs/RUNBOOK.md` §6).

**GlitchTip** est documenté ici comme alternative OSS **au cas où un SDK
Sentry serait ajouté un jour** : GlitchTip expose une API compatible avec le
protocole Sentry (même format de DSN, mêmes SDKs officiels `@sentry/node`,
`@sentry/nextjs`, etc. fonctionnent sans modification), tout en restant
self-hostable et open source (contrairement à Sentry SaaS).

Le service `glitchtip-web` est déclaré en **commentaire** dans
`docker-compose.yml` (profil `monitoring`), avec les variables
d'environnement nécessaires en exemple. Il n'est jamais démarré par défaut
(`docker compose --profile monitoring up -d` ne le lance pas tant qu'il
reste commenté).

### Si un SDK Sentry est ajouté un jour

1. Décommenter le bloc `glitchtip-web` dans `docker-compose.yml`, et ajouter
   les services `glitchtip-db` (Postgres) et `glitchtip-redis` (Redis) requis
   par GlitchTip (non déclarés tant que le service principal reste inactif,
   pour ne pas alourdir `docker compose config` pour rien).
2. Installer le SDK Sentry adapté (`@sentry/nextjs` pour `apps/web`,
   `@sentry/node` pour `apps/worker`) — cela ajoute une dépendance, à
   signaler explicitement (règle du projet : pas de `pnpm install` silencieux).
3. Pointer `SENTRY_DSN` vers l'URL du projet GlitchTip (format identique à un
   DSN Sentry classique : `http://<key>@<host>:8000/<project_id>`).
4. Aucune autre modification de code applicatif n'est nécessaire — c'est
   tout l'intérêt de la compatibilité API GlitchTip/Sentry.

---

## 3. Métriques worker et Uptime Kuma

Déjà en place (P75, non modifié ici) :

- **`GET /metrics`** (`apps/worker/src/lib/metrics-server.ts`, port `9090`
  par défaut via `METRICS_PORT`) — format texte maison inspiré du format
  Prometheus (`nom{labels} valeur`), sans dépendance à une lib Prometheus.
  Expose compteurs de jobs complétés/échoués par queue, durée moyenne
  glissante, taux d'échec par étape, coût moyen par cours.
- **Uptime Kuma** (`http://localhost:3001`, profil `monitoring`) — supervise
  `GET /api/health` (web) et le heartbeat Redis du worker. Peut aussi
  scruter `/metrics` via un moniteur type **"HTTP Keyword"** (chercher une
  chaîne connue comme `sallycourse_jobs_completed_total` dans la réponse
  pour confirmer que l'endpoint répond), ou un moniteur **"HTTP(s) - Json
  Query"** n'est pas applicable ici (format texte, pas JSON) — le mode
  "Keyword" est le plus adapté pour ce format.
- Uptime Kuma ne fait **pas** de scraping façon Prometheus (pas de
  time-series stockées, pas de requêtes PromQL) : c'est un simple
  superviseur d'endpoints avec historique de disponibilité et alerting
  (webhook, email, etc.). Pour un vrai stockage de time-series et des
  dashboards de métriques, il faudrait ajouter un Prometheus + Grafana — hors
  scope de ce prompt (le format texte de `/metrics` a été conçu pour rester
  compatible avec un futur exporter Prometheus si ce besoin apparaît).

### Cohérence entre les 3 piliers

| Pilier | Outil | Sert à | Statut |
|---|---|---|---|
| Analytics produit/web | Umami | Visites, pages vues, sources de trafic | Actif (profil `monitoring`) |
| Erreurs applicatives | GlitchTip | Exceptions, stack traces | Placeholder (aucun SDK Sentry à ce jour) |
| Disponibilité + métriques jobs | Uptime Kuma + `/metrics` | Uptime, heartbeat, compteurs jobs | Actif (P75, inchangé) |

---

## 4. Démarrage rapide

```bash
docker compose --profile monitoring up -d
# → uptime-kuma   http://localhost:3001
# → umami         http://localhost:3002  (admin / umami au 1er login, à changer)
```

Puis dans `.env` (web) :

```bash
NEXT_PUBLIC_UMAMI_WEBSITE_ID=<uuid généré dans l'UI Umami>
```

Redémarrer `web` pour que le script soit injecté. Sans cette variable, le
composant `UmamiScript` reste no-op — comportement par défaut sûr pour le
développement local et les previews.
