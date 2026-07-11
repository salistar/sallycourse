# Déploiement — Hetzner (staging / production)

Guide pas-à-pas pour déployer SallyCourse sur un serveur Hetzner via Docker
Compose, en cohérence avec le pipeline CI/CD existant
(`.github/workflows/deploy.yml`).

## 1. Provisionner le serveur

Prérequis serveur (Hetzner Cloud, type CX/CPX recommandé — le worker fait du
rendu vidéo/Playwright, prévoir au moins 4 Go de RAM, davantage en profil `full`
avec Ollama) :

```bash
# Sur le serveur, en root ou via un utilisateur sudo
apt-get update && apt-get install -y docker.io docker-compose-plugin git
systemctl enable --now docker

# Utilisateur dédié au déploiement (celui référencé par HETZNER_USER)
adduser --disabled-password deploy
usermod -aG docker deploy
```

Générer une paire de clés SSH dédiée au déploiement CI (sans passphrase, car
utilisée par `appleboy/ssh-action` en non-interactif) :

```bash
ssh-keygen -t ed25519 -f ./sallycourse_deploy_key -C "ci-deploy@sallycourse" -N ""
# Copier la clé PUBLIQUE dans le serveur
ssh-copy-id -i ./sallycourse_deploy_key.pub deploy@<HETZNER_HOST>
```

Cloner le repo à l'emplacement qui deviendra `DEPLOY_PATH` :

```bash
su - deploy
git clone <url-du-repo> /opt/sallycourse
cd /opt/sallycourse
```

## 2. Secrets et variables d'environnement

### Secrets GitHub Actions

Dans **Settings → Secrets and variables → Actions** du repo, configurer (voir
en-tête de commentaire de `.github/workflows/deploy.yml`) :

| Secret | Description |
|---|---|
| `HETZNER_HOST` | IP ou hostname du serveur (ex. `88.198.205.229`) |
| `HETZNER_USER` | Utilisateur SSH (ex. `deploy`) |
| `HETZNER_SSH_KEY` | Clé privée SSH (PEM, sans passphrase) |
| `HETZNER_SSH_PORT` | Port SSH (optionnel, défaut `22`) |
| `DEPLOY_PATH` | Chemin absolu du projet sur le serveur (ex. `/opt/sallycourse`) |
| `GHCR_USERNAME` | Optionnel — nécessaire seulement si un compte GHCR dédié est utilisé (sinon `github.actor` + `GITHUB_TOKEN` suffisent) |

Configurer aussi les environnements GitHub `staging` et `production`
(**Settings → Environments**) si une validation manuelle est souhaitée avant
déploiement en production — le workflow référence
`environment: ${{ github.event.inputs.environment || 'staging' }}`.

### Fichier `.env` sur le serveur

Le `.env` de production **n'est jamais commité** ni transporté par la CI : il
doit exister à `DEPLOY_PATH/.env` avant le premier déploiement. Le générer à
partir de `.env.example` :

```bash
cd /opt/sallycourse
cp .env.example .env
```

Valeurs à définir impérativement en production (voir `.env.example` pour la
liste complète) :

- `NODE_ENV=production`
- `APP_URL=https://<votre-domaine>`
- `MONGO_URI`, `REDIS_URL` — pointer vers les services `mongo`/`redis` du
  compose (`mongodb://mongo:27017/sallycourse`, `redis://redis:6379`) sauf si
  une base managée externe est utilisée
- `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` — MinIO
  interne ou bucket S3 réel
- `AUTH_SECRET` — générer via `openssl rand -base64 32`
- `CREDENTIALS_MASTER_KEY` — clé AES-256-GCM, générer via
  `openssl rand -hex 32` (chiffrement des credentials de plateformes) ;
  **ne jamais faire tourner cette clé sans plan de migration** : elle chiffre
  les `PlatformCredential` déjà stockés
- `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY` — clés réelles
  (`MOCK_PROVIDERS=false`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth si activé
- `OPS_WEBHOOK_URL` — webhook d'alerting ops (voir `docs/RUNBOOK.md`)
- `METRICS_PORT` — optionnel, défaut `9090` (voir profil `monitoring`)

Protéger le fichier :

```bash
chmod 600 /opt/sallycourse/.env
```

## 3. DNS et reverse proxy (Caddy/Traefik)

Le compose de base n'embarque pas de reverse proxy — le service `web` écoute
en clair sur le port `3000` de l'hôte (voir `docker-compose.yml`), et
`docker-compose.prod.yml` place `web` sur un réseau `edge` dédié à cet effet.
Terminer le TLS en frontal avec Caddy (recommandé, config minimale) ou Traefik
selon l'existant de votre infra.

1. Pointer le DNS du domaine choisi (ex. `app.sallycourse.com`) en enregistrement
   `A` vers l'IP du serveur Hetzner.
2. Installer Caddy sur l'hôte (hors conteneur, ou en conteneur sur le réseau
   `edge`) avec un `Caddyfile` minimal :

   ```
   app.sallycourse.com {
       reverse_proxy localhost:3000
   }
   ```

   Caddy gère le certificat TLS (Let's Encrypt) automatiquement au premier
   démarrage — aucune étape manuelle supplémentaire.
3. Vérifier que le port `443` (et `80` pour le challenge ACME) est ouvert dans
   le pare-feu Hetzner (Cloud Firewall ou `ufw`).
4. Le port `3000` ne doit pas être exposé publiquement sans le proxy devant —
   restreindre via le pare-feu Hetzner si Caddy tourne sur le même hôte.

## 4. Première mise en route manuelle

Avant de déclencher la CI, valider une première fois manuellement sur le
serveur :

```bash
cd /opt/sallycourse
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --profile core pull web worker   # images déjà buildées par la CI (GHCR)
# OU, pour un tout premier déploiement sans image GHCR encore publiée :
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --profile core build web worker

docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --profile core up -d --remove-orphans
```

Vérifier la santé :

```bash
curl -f http://localhost:3000/api/health
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f worker
```

Le healthcheck Mongo (`docker-compose.yml`) doit passer `healthy` avant que
`web`/`worker` ne démarrent (`depends_on: condition: service_healthy`).

Seed optionnel de données de démo (à éviter en production réelle, utile pour
une démo/staging) :

```bash
docker compose exec worker pnpm --filter @sallycourse/worker seed
```

## 5. Déploiement continu (CI/CD existant)

Une fois l'installation initiale validée, tous les déploiements suivants
passent par `.github/workflows/deploy.yml` :

- **Déclenchement** : push d'un tag `v*` (ex. `git tag v1.2.0 && git push --tags`)
  ou manuellement via **Actions → Deploy → Run workflow** (choix
  `staging`/`production`).
- **Étapes** : build + push des images `web` et `worker` vers GHCR
  (`ghcr.io/<owner>/sallycourse-web`, `ghcr.io/<owner>/sallycourse-worker`) →
  SSH sur le serveur → `docker compose pull` + `up -d --remove-orphans` →
  healthcheck `GET /api/health` (5 tentatives, 5 s d'intervalle) → **rollback
  automatique** vers l'image précédente (taguée localement `:rollback`) si le
  healthcheck échoue.
- Le tag d'image précédent est tracé via `docker compose images -q` avant le
  pull, ce qui permet le rollback ciblé sans redéployer depuis GHCR.

Pour un rollback manuel en dehors de ce flux, voir `docs/RUNBOOK.md`.

## 6. Profils Docker Compose disponibles

Rappel (voir aussi le README racine et les commentaires dans
`docker-compose.yml`) :

| Profil | Contenu | Usage |
|---|---|---|
| `core` | web, worker, mongo, redis, minio | Production standard |
| `full` | `core` + `ai` (ollama, piper) | Avec IA/TTS auto-hébergés (Phase 9) |
| `debug` | mongo-express, redis-commander, mailpit | Jamais en production |
| `monitoring` | uptime-kuma | Supervision externe (`/api/health`, heartbeat Redis, `/metrics` worker) |

En production, ne démarrer que `core` (ou `full` si les services IA locaux
sont utilisés) + éventuellement `monitoring`, jamais `debug`.

## 7. Sauvegardes

Voir `scripts/backup-mongo.sh` (dump + upload S3/MinIO) et le calendrier cron
recommandé documenté en en-tête de ce script. Détails opérationnels dans
`docs/RUNBOOK.md`.
