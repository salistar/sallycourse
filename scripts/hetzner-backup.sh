#!/usr/bin/env bash
# Backup quotidien Mongo — serveur Hetzner prod (Phase B, sync 2026-07-29).
#
# Contrairement à backup-mongo.sh (pensé pour tourner depuis un checkout
# complet du repo avec pnpm/mongodump sur l'hôte), ce script tourne DIRECTEMENT
# sur le serveur de prod où seuls docker/mc sont disponibles côté hôte :
#   1. mongodump DANS le conteneur mongo (archive gzip unique, pas de dossier).
#   2. docker cp vers l'hôte (backups/) — protège des erreurs applicatives
#      (suppression accidentelle, migration ratée) même si Mongo tourne mal.
#   3. Upload vers le bucket MinIO existant (via `mc`, déjà présent dans le
#      conteneur minio) — PAS un vrai backup offsite (même disque serveur),
#      mais protège des corruptions/erreurs Mongo. Pour un vrai disaster
#      recovery, ajouter un rclone vers Hetzner Storage Box (compte à créer
#      manuellement — voir README backup-mongo.sh pour la procédure).
#   4. Purge locale + distante des archives > RETENTION_DAYS.
#
# Installation (une fois, sur le serveur) :
#   crontab -e
#   0 3 * * * /home/deploy/sallycourse/scripts/hetzner-backup.sh >> /home/deploy/backups/backup.log 2>&1
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/home/deploy/sallycourse}"
BACKUP_DIR="${BACKUP_DIR:-/home/deploy/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
NAME="sallycourse-mongo-${STAMP}"

mkdir -p "$BACKUP_DIR"
cd "$DEPLOY_PATH"

# tr -d '\r' : le .env peut porter des fins de ligne CRLF (piège déjà rencontré
# sur ce serveur, cf. DEPLOY_PATH) — un \r final dans l'URI/les clés casse
# silencieusement mongodump/mc (exit 0, archive quasi vide, aucune erreur).
MONGO_URI=$(grep -E '^MONGO_URI=' .env | cut -d= -f2- | tr -d '\r')
S3_ACCESS_KEY=$(grep -E '^S3_ACCESS_KEY=' .env | cut -d= -f2- | tr -d '\r')
S3_SECRET_KEY=$(grep -E '^S3_SECRET_KEY=' .env | cut -d= -f2- | tr -d '\r')
S3_BUCKET=$(grep -E '^S3_BUCKET=' .env | cut -d= -f2- | tr -d '\r')

echo "▶ mongodump (dans le conteneur mongo) → ${NAME}.archive.gz"
docker exec sallycourse-mongo-1 sh -c \
  "mongodump --uri='${MONGO_URI}' --archive --gzip" \
  > "${BACKUP_DIR}/${NAME}.archive.gz"

SIZE=$(du -h "${BACKUP_DIR}/${NAME}.archive.gz" | cut -f1)
echo "▶ dump local : ${BACKUP_DIR}/${NAME}.archive.gz (${SIZE})"

echo "▶ upload vers MinIO (bucket ${S3_BUCKET}, préfixe backups/)"
docker cp "${BACKUP_DIR}/${NAME}.archive.gz" sallycourse-minio-1:/tmp/upload.gz
docker exec sallycourse-minio-1 sh -c "
  mc alias set self http://localhost:9000 '${S3_ACCESS_KEY}' '${S3_SECRET_KEY}' >/dev/null 2>&1
  mc cp /tmp/upload.gz self/${S3_BUCKET}/backups/${NAME}.archive.gz
  rm -f /tmp/upload.gz
"

echo "▶ purge locale (> ${RETENTION_DAYS} j)"
find "$BACKUP_DIR" -name 'sallycourse-mongo-*.archive.gz' -mtime "+${RETENTION_DAYS}" -print -delete

# Purge distante : `mc find --older-than --exec` s'est avéré dangereux en test
# (a supprimé le préfixe backups/ ENTIER alors qu'il ne contenait qu'un objet
# vieux de quelques secondes — piège des dossiers virtuels S3/MinIO). On
# calcule donc la coupure NOUS-MÊMES à partir de l'horodatage encodé dans le
# nom (sallycourse-mongo-AAAAMMJJ-HHmmss), déterministe et vérifiable.
echo "▶ purge distante (> ${RETENTION_DAYS} j)"
CUTOFF=$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d 2>/dev/null || date -u -v-${RETENTION_DAYS}d +%Y%m%d)
docker exec sallycourse-minio-1 sh -c "
  mc alias set self http://localhost:9000 '${S3_ACCESS_KEY}' '${S3_SECRET_KEY}' >/dev/null 2>&1
  mc ls self/${S3_BUCKET}/backups/ 2>/dev/null
" | awk '{print $NF}' | grep -oE 'sallycourse-mongo-[0-9]{8}-[0-9]{6}\.archive\.gz' | while read -r obj; do
  OBJ_DATE=$(echo "$obj" | grep -oE '[0-9]{8}' | head -1)
  if [ -n "$OBJ_DATE" ] && [ "$OBJ_DATE" -lt "$CUTOFF" ]; then
    echo "  suppression : $obj (date $OBJ_DATE < coupure $CUTOFF)"
    docker exec sallycourse-minio-1 sh -c "mc rm self/${S3_BUCKET}/backups/${obj}"
  fi
done

echo "✔ backup terminé : ${NAME}"
