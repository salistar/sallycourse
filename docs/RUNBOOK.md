# Runbook — incidents courants

Guide opérationnel pour diagnostiquer et résoudre les incidents les plus
fréquents en production. Complète `docs/DEPLOYMENT.md` (mise en place) et
`docs/ADDING-A-PLATFORM-ADAPTER.md` (développement).

## Sommaire

1. [Queue bloquée (jobs qui n'avancent plus)](#1-queue-bloquée-jobs-qui-navancent-plus)
2. [Échec de génération répété](#2-échec-de-génération-répété)
3. [Déploiement Udemy en `paused` (captcha)](#3-déploiement-udemy-en-paused-captcha)
4. [Rollback production](#4-rollback-production)
5. [Sauvegarde et restauration Mongo](#5-sauvegarde-et-restauration-mongo)
6. [Alertes ops et supervision](#6-alertes-ops-et-supervision)

---

## 1. Queue bloquée (jobs qui n'avancent plus)

**Symptôme** : jobs en statut `waiting`/`delayed` qui ne progressent plus,
alerte ops "queue potentiellement bloquée" (voir `apps/worker/src/lib/alerts.ts`,
`startQueueBlockedScheduler`), ou dashboard `/admin/jobs` montrant des jobs
`running` sans mise à jour de `progress` depuis longtemps.

### Diagnostic

1. **Vérifier que le worker tourne et est connecté à Redis** :
   ```bash
   docker compose ps worker
   docker compose logs --tail=200 worker
   ```
   Chercher `worker SallyCourse : Mongo connecté` et `heartbeat démarré` dans
   les logs récents (`apps/worker/src/index.ts`).

2. **Vérifier le heartbeat Redis** — le worker publie sur le canal
   `worker:heartbeat` et écrit une clé à TTL toutes les 10 s
   (`apps/worker/src/queues/index.ts`, `startHeartbeat`) :
   ```bash
   docker compose exec redis redis-cli KEYS "worker:heartbeat:*"
   docker compose exec redis redis-cli GET "worker:heartbeat:<host>:<pid>"
   ```
   Si aucune clé n'existe ou qu'elle a expiré (TTL ~30 s = 3× l'intervalle), le
   worker est mort ou déconnecté de Redis → redémarrer le service :
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml restart worker
   ```

3. **Vérifier le contenu de la queue** (nombre de jobs en attente, le plus
   ancien) via redis-commander (profil `debug`, jamais en prod ouvert au
   public) ou directement :
   ```bash
   docker compose exec redis redis-cli LLEN bull:<nom-queue>:wait
   ```
   Noms de queues enregistrées : voir `QUEUES` dans
   `packages/shared/src/index.ts` (outline, content, tts, subtitle,
   screenshot, videoRender, packaging, deployment).

4. **Vérifier `/metrics`** (profil `monitoring`, port interne `9090` du
   worker) pour les compteurs de jobs complétés/échoués par queue :
   ```bash
   docker compose exec worker curl -s http://localhost:9090/metrics
   ```

5. **Vérifier la concurrence** — si une queue nécessitant Playwright
   (screenshot, videoRender, déploiement navigateur) sature les ressources
   (CPU/mémoire), les jobs suivants restent en attente. Vérifier
   `docker stats worker` pour un worker proche de sa limite mémoire
   (`docker-compose.prod.yml` : 4 Go par défaut).

### Résolution

- **Worker down/déconnecté** : `docker compose restart worker` (le heartbeat
  et les workers BullMQ se ré-enregistrent au démarrage, `main()` dans
  `apps/worker/src/index.ts`).
- **Job unique bloqué en `active`** (worker mort en plein traitement, job non
  retourné à `waiting`) : BullMQ le remet automatiquement en attente après le
  `lockDuration` par défaut ; si ce n'est pas le cas, l'inspecter et le
  supprimer manuellement via redis-commander (profil `debug`) puis relancer
  l'étape depuis `/admin/jobs` (voir section 2).
- **Redis lui-même indisponible** : vérifier `docker compose ps redis` et ses
  logs ; un redémarrage de `redis` entraîne la reconnexion automatique des
  clients BullMQ (pas d'action worker nécessaire au-delà de vérifier les logs
  post-redémarrage).

---

## 2. Échec de génération répété

**Symptôme** : un cours reste bloqué en génération, alerte ops "job en échec
répété" à partir de la 3ᵉ tentative (voir `registerWorker` dans
`apps/worker/src/queues/index.ts`), ou entrée visible dans `/admin/jobs`
(filtre "Échoués" par défaut).

### Diagnostic

1. Ouvrir **`/admin/jobs`** (réservé aux comptes `role: admin`, voir
   `apps/web/src/app/(dashboard)/admin/jobs/page.tsx`). Le filtre par défaut
   liste les jobs avec un `error` non vide. La colonne "Erreur" affiche le
   message tronqué ; survoler (`title`) pour le message complet.
2. Croiser avec les logs worker pour la stack trace complète :
   ```bash
   docker compose logs worker | grep "<courseId>"
   ```
   Les logs sont structurés (pino) avec `queue`, `jobId`, `courseId`,
   `attemptsMade`, `definitive`.
3. Vérifier si l'échec est lié à un provider externe (Claude/ElevenLabs/OpenAI)
   — en ce cas, vérifier les clés API (`ANTHROPIC_API_KEY`,
   `ELEVENLABS_API_KEY`, `OPENAI_API_KEY` dans `.env`) et les quotas/limites de
   ces services. Le repo bascule automatiquement ElevenLabs → OpenAI en cas
   d'échec TTS (`apps/worker/src/media/tts.ts`) — un échec malgré ce fallback
   indique que les deux providers sont indisponibles ou mal configurés.

### Résolution

- **Relance unitaire** : bouton "Relancer" sur la ligne du job dans
  `/admin/jobs` (`retryJobAction`, `apps/web/src/app/(dashboard)/admin/jobs/actions.ts`).
- **Relance en masse** : bouton "Relancer tous les échoués" en haut de la page
  (`retryAllFailedAction`) — à utiliser après un correctif de cause racine
  (ex. clé API invalide corrigée), pas en investigation.
- **Cause racine non résolue** : ne pas relancer en boucle — corriger la
  configuration ou le bug, sinon le job repassera en échec après les 3
  tentatives BullMQ par défaut (`defaultJobOptions`, `packages/shared`) et
  redéclenchera l'alerte ops.
- **Job corrompu (données invalides en entrée)** : vérifier le document
  `Course`/`GenerationJob` correspondant en base (via mongo-express, profil
  `debug`) — un champ manquant peut nécessiter une correction manuelle avant
  relance.

---

## 3. Déploiement Udemy en `paused` (captcha)

**Symptôme** : un `Deployment` avec `platform: 'udemy'` passe en statut
`paused`. C'est un comportement **normal et attendu**, pas un bug — Udemy
présente un captcha (login) et l'adapter ne tente jamais de le contourner
(`UdemyCaptchaError`, `apps/worker/src/deploy/adapters/udemy.ts`).

### Diagnostic

1. Consulter les logs du déploiement (`Deployment.logs`, visible dans le
   dashboard de suivi de déploiement du cours, ou en base) — chercher
   `action requise : résoudre le captcha Udemy puis relancer le déploiement`
   ou `action requise : captcha Udemy après soumission`.
2. Le mode `assisted` est le mode recommandé pour Udemy précisément pour ce
   cas (`capabilities.modes = ['assisted', 'auto', 'manual']` —
   `assisted` en premier).

### Résolution manuelle

1. Se connecter manuellement au compte Udemy concerné (celui du
   `PlatformCredential` lié, `ctx.credentialId`) dans un vrai navigateur et
   résoudre le captcha une première fois pour établir une session valide.
2. Si l'adapter réutilise une session persistée (storageState Playwright par
   compte, voir commentaire `credentialId` dans `deploy/types.ts`) et qu'elle
   a expiré, une `UdemySessionExpiredError` peut aussi être levée — dans ce
   cas, une reconnexion complète (nouveau `storageState`) est nécessaire côté
   credentials plateforme.
3. **Relancer le déploiement** depuis le dashboard (ou via `/admin/jobs` si le
   déploiement est piloté par un `GenerationJob` de type `deployment`) — le
   `checkpoint` (`lessonIndex`, `step`) permet une reprise sans ré-uploader
   les leçons déjà envoyées.
4. Si le captcha réapparaît systématiquement (détection anti-bot renforcée
   côté Udemy), envisager d'espacer les tentatives ou de vérifier si l'IP du
   serveur Hetzner est signalée — dans ce cas, une résolution manuelle
   régulière reste la seule option (pas de contournement automatisé prévu par
   design).

---

## 4. Rollback production

Le workflow `deploy.yml` effectue déjà un **rollback automatique** si le
healthcheck post-déploiement échoue (5 tentatives sur `GET /api/health`, 5 s
d'intervalle) — voir le job `deploy` dans `.github/workflows/deploy.yml`. Le
rollback automatique retague localement l'image précédente
(`sallycourse-web:rollback` / `sallycourse-worker:rollback`) tracée juste
avant le `pull`.

### Rollback manuel (hors CI, ou après un incident détecté plus tard)

1. **Identifier le tag/commit précédent stable** :
   ```bash
   git tag --sort=-creatordate | head -5
   ```
2. **Redéclencher un déploiement sur ce tag** — le plus simple est de
   ré-exécuter le workflow existant en visant l'ancien tag :
   ```bash
   git checkout v1.2.0   # tag précédent stable
   git tag -f v1.2.0-rollback
   git push origin v1.2.0-rollback
   ```
   Ou, via GitHub Actions, relancer manuellement (`workflow_dispatch`) un run
   antérieur du workflow `Deploy` correspondant à ce tag (**Actions → Deploy →
   sélectionner le run → Re-run all jobs**) — plus simple qu'un nouveau tag si
   le run reste disponible.
3. **Rollback direct sur le serveur** (si la CI n'est pas utilisable) :
   ```bash
   ssh deploy@<HETZNER_HOST>
   cd "$DEPLOY_PATH"
   docker images | grep sallycourse   # repérer les tags GHCR précédents localement présents
   docker tag ghcr.io/<owner>/sallycourse-web:<sha-precedent> sallycourse-web:rollback
   docker tag ghcr.io/<owner>/sallycourse-worker:<sha-precedent> sallycourse-worker:rollback
   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
     --profile core up -d --remove-orphans
   ```
4. **Vérifier après rollback** :
   ```bash
   curl -f https://<votre-domaine>/api/health
   docker compose logs --tail=100 web worker
   ```
5. Si le rollback nécessite aussi une restauration de base de données
   (migration incompatible), voir la section suivante — restaurer **après**
   avoir confirmé que le code applicatif est bien celui de la version
   compatible.

---

## 5. Sauvegarde et restauration Mongo

Scripts : `scripts/backup-mongo.sh` (dump + upload S3/MinIO) et
`scripts/restore-mongo.sh` (restauration depuis archive locale ou distante).

### Sauvegarde manuelle immédiate

```bash
cd /opt/sallycourse
./scripts/backup-mongo.sh                # dump + upload S3/MinIO, supprime la copie locale
./scripts/backup-mongo.sh --keep-local    # + garde l'archive .tar.gz locale
```

Nommage : `sallycourse-mongo-AAAAMMJJ-HHmmss` (UTC).

Cron recommandé (voir en-tête de `scripts/backup-mongo.sh`, à installer
manuellement sur le serveur — pas automatisé par ce repo) :

```cron
0 3 * * *   cd /opt/sallycourse && ./scripts/backup-mongo.sh >> /var/log/sallycourse-backup.log 2>&1
30 3 * * *  cd /opt/sallycourse && node scripts/backup-upload.mjs --prune 30 >> /var/log/sallycourse-backup.log 2>&1
```

### Restauration

```bash
# Depuis une archive locale (fusion, ne supprime pas les données existantes)
./scripts/restore-mongo.sh ./backups/sallycourse-mongo-20260710-030001.tar.gz

# Depuis un backup distant (S3/MinIO)
./scripts/restore-mongo.sh --remote sallycourse-mongo-20260710-030001

# Restauration destructive (purge les collections existantes avant restauration)
./scripts/restore-mongo.sh ./backups/<archive>.tar.gz --drop
# → demande confirmation interactive ; --yes pour l'automatiser (usage prudent uniquement)
```

**Attention** : `--drop` est destructif et irréversible sans un autre backup.
Toujours confirmer qu'un backup du **dernier état actuel** existe avant de
restaurer un état antérieur avec `--drop`.

---

## 6. Alertes ops et supervision

- **`OPS_WEBHOOK_URL`** (`.env`) — si configuré, `notifyOps()`
  (`apps/worker/src/lib/alerts.ts`) envoie les alertes critiques (échec de job
  répété dès la 3ᵉ tentative, queue potentiellement bloquée) vers ce webhook,
  en plus du log pino systématique. Si les alertes ops n'arrivent pas,
  vérifier que cette variable est bien définie et que l'endpoint webhook
  répond sous 5 s (timeout appliqué).
- **`GET /api/health`** (`apps/web/src/app/api/health/route.ts`) — healthcheck
  public utilisé par la CI (`deploy.yml`) et par uptime-kuma (profil
  `monitoring`). Vérifie Mongo (ping), Redis (ping), MinIO (`checkStorage`) et
  la fraîcheur du heartbeat worker (clé Redis `worker:heartbeat`, doit dater
  de moins de 60 s) ; répond `200` (`status: 'ok'`) ou `503`
  (`status: 'degraded'`) avec le détail par check.
- **`GET /metrics`** (worker, port `9090` par défaut, `METRICS_PORT`) —
  compteurs texte brut (jobs complétés/échoués par queue, durée). Scrutable
  par uptime-kuma en "HTTP Keyword" ou tout autre superviseur.
- **uptime-kuma** (profil `monitoring`, `http://localhost:3001`) — à
  configurer au premier lancement avec deux moniteurs : `GET /api/health` côté
  web (intervalle 60 s) et le heartbeat Redis (`worker:heartbeat`) côté
  worker. Voir les commentaires dans `docker-compose.yml`.
- **`SECURITY-AUDIT.md`** (racine du repo) — référence pour tout incident de
  nature sécurité (en-têtes, credentials, rate-limiting) plutôt que ce
  runbook opérationnel.
