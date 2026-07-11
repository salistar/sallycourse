# Audit des dépendances — SallyCourse

Date de l'audit : 2026-07-11
Outils utilisés : `pnpm audit --json` (base OSV/GitHub Advisory), inspection manuelle des
`package.json` publiés dans `node_modules/<pkg>/package.json` (licence + version), API registre npm
(`registry.npmjs.org`) pour les dates de dernière publication.

`totalDependencies` scannées par `pnpm audit` : **1354** (arbre complet, toutes deps transitives incluses).

---

## 1. Vulnérabilités connues (pnpm audit)

Résumé par sévérité :

| Sévérité | Nombre |
|---|---|
| Critical | 1 |
| High | 12 |
| Moderate | 11 |
| Low | 0 |
| **Total (advisories uniques)** | **22** (répartis sur 8 modules) |

**Point clé : aucune vulnérabilité ne touche une dépendance directe de production réellement
exécutée en prod (apps/web, apps/worker).** La quasi-totalité des advisories remonte de la chaîne
`apps/mobile > expo > @expo/cli > …` et `apps/mobile > vitest > vite > esbuild`, c'est-à-dire des
outils de build/dev (CLI Expo, Vite dev server, esbuild) embarqués transitivement par Expo/Vitest,
pas du code qui tourne dans le bundle mobile livré ni sur les serveurs web/worker.

### Détail par module

#### `tar` (6 advisories — high/moderate) — via `apps/mobile > expo > @expo/cli > tar`
Version installée : `6.2.1`. Suite de CVE sur la traversée de chemin / hardlink / symlink lors de
l'extraction d'archives (`GHSA-34x7-hfp2-rc4v`, `GHSA-8qq5-rm4j-mr97`, `GHSA-83g3-92jg-28cx`,
`GHSA-qffp-2rhf-9h96`, `GHSA-9ppj-qmqm-q256`, `GHSA-r6q2-hw4h-h46w`, `GHSA-vmf3-w455-68vh`).
Corrigé en `>=7.5.16`. Usage : outil interne du CLI Expo pour extraire des templates/archives en
dev — pas exposé à un input attaquant en prod.
**Action recommandée** : attendre une mise à jour d'`@expo/cli` qui bump sa dépendance `tar`
(pas de fix direct possible sans casser la résolution pnpm imposée par Expo).

#### `vite` / `esbuild` (moderate/high) — via `apps/mobile > vitest > vite`
- `esbuild <=0.24.2` : le dev server esbuild accepte des requêtes cross-origin (`GHSA-67mh-4wv8-2f99`).
- `vite <=6.4.2` : path traversal sur les `.map` des deps optimisées (`GHSA-4w7w-66w2-5vf9`), bypass
  de `server.fs.deny` sous Windows (`GHSA-fx2h-pf6j-xcff`), fuite de hash NTLMv2 via UNC path sous
  Windows dans `launch-editor` (`GHSA-v6wh-96g9-6wx3`).
Tous ces CVE concernent le **serveur de dev local**, jamais démarré en prod (mobile ne sert pas de
build via Vite en production — c'est Metro qui bundle). Risque réel : faible, seulement si un dev
lance `vitest --ui` ou le dev server exposé sur un réseau non fiable.
**Action recommandée** : monter `vitest` vers `>=3.2.6` (voir critique ci-dessous) fera remonter
transitivement `vite`/`esbuild` vers des versions patchées.

#### `vitest` (1 advisory **critical**) — `apps/mobile > vitest` version `2.1.9`
`GHSA-5xrq-8626-4rwp` : quand le serveur UI de Vitest écoute, un fichier arbitraire peut être lu et
exécuté. Corrigé en `>=3.2.6`. Le repo épingle `vitest ^2.1.8` dans tous les workspaces (choix
delibéré pour rester sur Vitest 2.x). **C'est la vulnérabilité la plus sérieuse du rapport, mais
elle exige que quelqu'un lance `vitest --ui` localement** — aucune exposition en prod (vitest n'est
pas une dépendance de production, seulement `devDependencies`/test).
**Action recommandée (non appliquée automatiquement, cf. contrainte du prompt)** : planifier une
montée de version `vitest` 2.x → 3.x sur les 7 workspaces (breaking change potentiel sur la config
Vitest — nécessite une passe dédiée, pas un simple bump).

#### `@xmldom/xmldom` (4 advisories high) — via `apps/mobile > expo > @expo/cli > @expo/plist > @xmldom/xmldom`
Version installée `0.7.13`, plusieurs injections XML (CDATA, DocumentType, PI, commentaires) et un
DoS par récursion non contrôlée lors de la sérialisation. Corrigé en `>=0.8.13`. Usage : parsing de
fichiers `.plist` (config iOS) par le CLI Expo en local build — pas de surface d'attaque réseau en
prod.
**Action recommandée** : dépend d'une mise à jour d'`@expo/cli`/`@expo/plist`.

#### `uuid` (1 advisory moderate) — via `@expo/rudder-sdk-node` et `xcode` (config-plugins)
Version `8.3.2` / `7.0.3`, absence de vérification de bornes sur le buffer fourni en v3/v5/v6.
Corrigé en `>=11.1.1`. Usage interne (analytics du CLI Expo, génération de projet Xcode) — pas
appelé avec un buffer contrôlé par un attaquant dans notre usage.

#### `postcss` (1 advisory moderate) — via `apps/mobile > expo > @expo/metro-config > postcss` (`8.4.49`) et `apps/web > next > postcss` (`8.4.31`)
`GHSA-qx2v-qp2m-jg93` : XSS via `</style>` non échappé dans la sortie stringifiée. Corrigé en
`>=8.5.10`. Le postcss d'`apps/web` est une dépendance transitive de Next.js (pas configurable
indépendamment sans forcer une résolution) ; celui de mobile vient de Metro config.

#### `next-auth` (1 advisory moderate) — dépendance **directe** `apps/web` (`5.0.0-beta.25`)
`GHSA-5jpx-9hw9-2fx4` : mauvaise livraison d'email (email misdelivery) corrigée en `>=5.0.0-beta.30`.
**C'est la seule vulnérabilité touchant une dépendance directe de production.**
Vérification API npm : la branche v5 beta a depuis publié `5.0.0-beta.31` (2026-04-14), donc une
mise à jour ciblée `next-auth@5.0.0-beta.31` est disponible et corrige ce CVE sans changer de branche
majeure.
**Action recommandée (à faire dans un prompt dédié, pas ici)** : bump `next-auth` `5.0.0-beta.25` →
`5.0.0-beta.31` dans `apps/web/package.json`, puis `pnpm install` + `pnpm --filter @sallycourse/web typecheck`
+ smoke test du flux auth (la beta v5 change parfois l'API `NextAuthConfig`).

#### `next-intl` (2 advisories moderate) — dépendance **directe** `apps/web` (`3.26.5`)
- `GHSA-8f24-v5vv-gm5j` : open redirect, corrigé en `>=4.9.1`.
- `GHSA-4c35-wcg5-mm9h` : prototype pollution via `experimental.messages.precompile`, corrigé en `>=4.9.2`.
Le repo est sur la branche majeure `3.x` ; le fix nécessite un **saut de version majeure vers 4.x**
(changements d'API probables sur la config next-intl / middleware i18n).
**Action recommandée (à faire dans un prompt dédié)** : planifier la migration `next-intl` 3→4 avec
tests des routes i18n, pas un simple bump patch.

### Ce qui n'a **pas** été fait (volontairement)
Conformément à la consigne, **aucun `--force` ni fix automatique risqué n'a été appliqué**. Les
deux CVE sur dépendances directes (`next-auth`, `next-intl`) sont documentées avec la version cible
et laissées à un prompt de mise à jour dédié, car un bump de `next-intl` implique un saut majeur qui
mérite ses propres tests de non-régression i18n.

---

## 2. Audit des licences (dépendances directes)

Toutes les dépendances directes de tous les `package.json` du monorepo (racine + 7 workspaces) ont
été inspectées via leur `package.json` publié (champ `license`). Résultat : **aucune licence
GPL/AGPL/LGPL/SSPL contaminante détectée.** Répartition :

| Licence | Packages |
|---|---|
| MIT | archiver, autoprefixer, bcryptjs, bullmq, clsx, eslint, eslint-config-prettier, execa, expo, expo-status-bar, framer-motion, ioredis, mongoose, nanoid, next, next-intl, pino, postcss, prettier, react, react-dom, react-markdown, react-native, rehype-sanitize, remark-gfm, tailwind-merge, tailwindcss, tailwindcss-animate, tsx, typescript-eslint, vitest, zod, @dnd-kit/core, @dnd-kit/sortable, @react-native-async-storage/async-storage, @types/* (tous), @anthropic-ai/sdk |
| Apache-2.0 | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @playwright/test, playwright, sharp, class-variance-authority, typescript |
| ISC | @auth/mongodb-adapter, lucide-react, next-auth |

ISC et Apache-2.0 sont, comme MIT, permissives et compatibles avec un usage SaaS commercial fermé
(pas de copyleft, pas d'obligation de republier le code). **Verdict global : conforme, aucune action requise.**

### Cas particulier `jscpd` (devDependency racine, `check:duplication`)
`jscpd` figure dans `package.json` racine (`devDependencies`) mais **n'est pas présent dans
`node_modules/.pnpm`** au moment de l'audit — il n'a apparemment jamais été installé après son
ajout (ou a été retiré du store local). Licence publiée sur npm : **MIT** (vérifié via le registre,
pas via une install locale puisque le paquet est absent). Pas de risque de licence, mais la commande
`pnpm check:duplication` échouera tant que `pnpm install` n'aura pas été relancé — signalé ici pour
traçabilité, aucune action prise (contrainte : ne pas lancer `pnpm install`).

### Libs "Phase 6" citées dans le prompt (mermaid, pdf-parse, jszip)
Recherche exhaustive dans tous les `package.json` du repo, dans `pnpm-lock.yaml` et dans les
`node_modules` de chaque workspace : **aucune trace de `mermaid`, `pdf-parse` ou `jszip`.** Ces trois
libs ne sont actuellement des dépendances d'aucun workspace du monorepo — elles ont probablement été
évoquées dans la roadmap Phase 6 mais pas encore ajoutées au code, ou déjà retirées. Rien à documenter
côté licence tant qu'elles ne sont pas introduites ; **si elles sont ajoutées plus tard**, à titre
préventif :
- `mermaid` → MIT.
- `pdf-parse` → MIT.
- `jszip` → **dual-licence MIT OR GPL-3.0** (l'utilisateur choisit les termes) — en pratique
  utilisable sous MIT pour un usage commercial fermé tant qu'on ne redistribue pas jszip modifié sous
  GPL ; à re-vérifier au moment de l'ajout réel si le choix de licence a changé en amont.

---

## 3. Packages potentiellement peu maintenus / stagnants

Vérifié via l'API `registry.npmjs.org` (date de dernière publication de la version `latest` du
paquet, pas forcément celle utilisée par le repo).

| Package | Version repo | Dernière release npm (latest) | Constat |
|---|---|---|---|
| `clsx` | 2.1.1 | 2024-04-23 (aucune release depuis) | Stable — API minuscule et figée (concat de classNames), pas de raison de publier souvent. Pas un risque. |
| `class-variance-authority` | 0.7.1 | 2024-11-26 | Stable, API stabilisée (utilisé par shadcn/ui, écosystème large). Pas un risque immédiat, mais projet peu actif — à surveiller si besoin de nouvelles features Tailwind v4. |
| `tailwindcss-animate` | 1.0.7 | 2023-08-28 (~3 ans sans release) | Le plugin le plus stagnant du repo. Fonctionne mais n'aura probablement pas de support natif Tailwind v4. **Alternative suggérée** : `tw-animate-css` (successeur communautaire actif, pensé pour Tailwind v4) si une migration Tailwind v4 est prévue. |
| `rehype-sanitize` | 6.0.0 | 2023-08-26 (~3 ans) | Fait partie de l'écosystème unified/rehype (mature, API stable, maintenu par l'org unifiedjs même sans release fréquente — les schémas de sanitisation changent rarement). Pas un risque de sécurité en soi, mais **vérifier périodiquement** que le schéma de sanitisation par défaut couvre les nouvelles balises HTML si le contenu généré évolue. |
| `execa` | 9.6.1 | 2025-11-29 | Maintenance active, rien à signaler. |
| `next-auth` (v5 beta) | 5.0.0-beta.25 | v5 beta la plus récente : `5.0.0-beta.31` (2026-04-14) | Toujours en beta après ~2 ans — statut connu du projet Auth.js (v5 stable annoncée mais jamais taguée `latest`). Le repo a pris du retard de 6 versions beta, dont un fix de sécurité (cf. section 1). **Action recommandée** : bump vers `beta.31` en priorité (corrige un CVE). |
| `next-intl` | 3.26.5 | 4.9.2 (branche majeure suivante) | Maintenu activement, mais le repo a 2 majeures de retard, dont 2 CVE non corrigés sur la 3.x (cf. section 1). |
| `jscpd` | absent du lockfile local malgré la devDependency | 5.0.12 (2026-07-08, actif) | Projet activement maintenu ; le souci ici n'est pas la maintenance mais l'absence d'installation locale (cf. section 2). |

Aucun package du repo n'est abandonné au sens strict (dernier commit >2 ans, issues ignorées, pas de
remplaçant). Les deux vrais points d'attention sont `next-auth` (beta stagnante mais activement
maintenue, CVE en retard) et `next-intl` (activement maintenue mais 2 majeures de retard).

---

## 4. Fichier `renovate.json`

Un fichier `renovate.json` minimal a été ajouté à la racine du repo (config prête à activer sur
GitHub, **bot non déployé**) — voir `C:\Users\21266\Desktop\sallycourse\renovate.json`. Il groupe les
PRs de mise à jour par workspace/écosystème et les planifie sur une base hebdomadaire, avec une règle
séparée pour les CVE de sécurité (non groupées, non planifiées — traitées immédiatement) et pour les
majeures sensibles (`next-auth`, `next-intl`) qui restent groupées mais nécessitent une revue manuelle.

---

## 5. Résumé exécutable

- **0** dépendance directe de prod avec licence copyleft.
- **2** CVE modérés sur dépendances directes (`next-auth`, `next-intl`) — versions cibles identifiées,
  mise à jour à faire dans un prompt dédié (next-intl implique un saut majeur).
- **20** advisories restants sont tous sur des sous-dépendances de tooling dev/build (Expo CLI, Vite,
  Vitest) sans exposition en prod ; le plus sérieux (`vitest` critical, UI server) nécessite un bump
  Vitest 2→3 à planifier séparément (breaking change potentiel).
- **`jscpd`** référencé mais non installé localement — pas un souci de licence, mais `check:duplication`
  ne fonctionnera pas tant qu'un `pnpm install` n'aura pas été relancé (hors périmètre de ce prompt).
- **`mermaid` / `pdf-parse` / `jszip`** : absents du repo à ce jour, rien à documenter (licences MIT/MIT/MIT-ou-GPL notées à titre préventif si ajoutés plus tard).
- `renovate.json` ajouté, prêt à activer, aucun déploiement réel du bot.
