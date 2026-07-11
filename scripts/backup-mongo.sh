#!/usr/bin/env bash
# Backup MongoDB (P74) — mongodump vers un dossier local horodaté, puis upload
# vers le storage S3/MinIO existant via scripts/backup-upload.mjs.
#
# Usage :
#   ./scripts/backup-mongo.sh                # dump + upload (défaut)
#   ./scripts/backup-mongo.sh --no-upload     # dump local uniquement (debug)
#   ./scripts/backup-mongo.sh --keep-local    # dump + upload, garde la copie locale
#
# Variables d'environnement (lues depuis .env si présent, sinon l'environnement) :
#   MONGO_URI        — requis (voir .env.example)
#   BACKUP_LOCAL_DIR — dossier local des dumps (défaut: ./backups)
#
# Nommage : sallycourse-mongo-AAAAMMJJ-HHmmss (UTC), identique à la logique
# testée dans apps/worker/src/lib/backup-retention.ts (formatBackupName).
#
# ── Calendrier cron recommandé (à installer manuellement, PAS ajouté ici) ──
# Backup quotidien à 3h du matin (UTC) + purge des backups > 30 jours à 3h30 :
#   0 3 * * *   cd /opt/sallycourse && ./scripts/backup-mongo.sh >> /var/log/sallycourse-backup.log 2>&1
#   30 3 * * *  cd /opt/sallycourse && node scripts/backup-upload.mjs --prune 30 >> /var/log/sallycourse-backup.log 2>&1
# Installation (crontab de l'utilisateur de service, pas root) :
#   crontab -e
# Vérifier ensuite : crontab -l
#
# ── Brancher un vrai stockage externe en production (Hetzner Storage Box) ──
# En prod, préférer une synchronisation directe disque → Storage Box en plus
# (ou à la place) de l'upload S3/MinIO applicatif, via rclone :
#   1. Configurer un remote rclone une fois :
#        rclone config create hetzner-storagebox sftp \
#          host=<user>.your-storagebox.de user=<user> port=23 \
#          key_file=/root/.ssh/storagebox_ed25519
#   2. Synchroniser après chaque dump (idempotent, ne retransmet que les deltas) :
#        rclone sync "$BACKUP_LOCAL_DIR" hetzner-storagebox:sallycourse-backups/mongo
#   3. Appliquer la même rétention côté Storage Box :
#        rclone delete --min-age 30d hetzner-storagebox:sallycourse-backups/mongo
# Ce script ne dépend PAS de rclone/Storage Box : l'upload par défaut passe par
# le storage S3/MinIO déjà configuré (@sallycourse/shared/storage), pour rester
# testable et fonctionner en local (docker compose) comme en prod (bucket réel).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Charge .env si présent (n'écrase pas les variables déjà exportées par l'appelant).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

MONGO_URI="${MONGO_URI:?MONGO_URI requis (voir .env.example)}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-$ROOT_DIR/backups}"

UPLOAD=1
KEEP_LOCAL=0
for arg in "$@"; do
  case "$arg" in
    --no-upload) UPLOAD=0 ;;
    --keep-local) KEEP_LOCAL=1 ;;
    *)
      echo "Argument inconnu: $arg" >&2
      exit 1
      ;;
  esac
done

# Nommage horodaté UTC — même format que formatBackupName() côté worker.
BACKUP_NAME="sallycourse-mongo-$(date -u +%Y%m%d-%H%M%S)"
DUMP_DIR="$BACKUP_LOCAL_DIR/$BACKUP_NAME"

mkdir -p "$DUMP_DIR"
echo "▶ mongodump vers $DUMP_DIR"
mongodump --uri="$MONGO_URI" --out="$DUMP_DIR"

# Archive l'ensemble du dump en un seul fichier .tar.gz (plus simple à uploader/lister).
ARCHIVE_PATH="$BACKUP_LOCAL_DIR/$BACKUP_NAME.tar.gz"
echo "▶ archivage vers $ARCHIVE_PATH"
tar -czf "$ARCHIVE_PATH" -C "$BACKUP_LOCAL_DIR" "$BACKUP_NAME"
rm -rf "$DUMP_DIR"

if [ "$UPLOAD" -eq 1 ]; then
  echo "▶ upload vers le storage S3/MinIO"
  node "$ROOT_DIR/scripts/backup-upload.mjs" "$ARCHIVE_PATH" "$BACKUP_NAME"
  if [ "$KEEP_LOCAL" -eq 0 ]; then
    rm -f "$ARCHIVE_PATH"
    echo "▶ copie locale supprimée (utiliser --keep-local pour la garder)"
  fi
else
  echo "▶ upload sauté (--no-upload) — archive conservée en local: $ARCHIVE_PATH"
fi

echo "✓ backup terminé: $BACKUP_NAME"
