#!/usr/bin/env bash
# Restauration MongoDB (P74) — mongorestore depuis un backup donné (archive
# locale .tar.gz OU nom de backup à retélécharger depuis le storage S3/MinIO).
#
# Usage :
#   ./scripts/restore-mongo.sh <archive-locale.tar.gz>
#   ./scripts/restore-mongo.sh --remote sallycourse-mongo-20260711-030509
#   ./scripts/restore-mongo.sh <archive-locale.tar.gz> --drop   # ATTENTION : purge les collections existantes avant restauration
#
# Variables d'environnement (lues depuis .env si présent) :
#   MONGO_URI        — requis (voir .env.example)
#   BACKUP_LOCAL_DIR — dossier local de travail (défaut: ./backups)
#
# Sécurité : par défaut, mongorestore FUSIONNE avec les données existantes
# (n'écrase pas). Passer --drop pour repartir d'un état propre (destructif —
# demande une confirmation interactive, sautée avec --yes pour l'automatisation).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

MONGO_URI="${MONGO_URI:?MONGO_URI requis (voir .env.example)}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-$ROOT_DIR/backups}"

if [ $# -eq 0 ]; then
  echo "Usage: $0 <archive-locale.tar.gz> [--drop] [--yes]" >&2
  echo "       $0 --remote <nom-backup> [--drop] [--yes]" >&2
  exit 1
fi

DROP=0
YES=0
REMOTE=0
SOURCE_ARG=""

for arg in "$@"; do
  case "$arg" in
    --drop) DROP=1 ;;
    --yes) YES=1 ;;
    --remote) REMOTE=1 ;;
    *) SOURCE_ARG="$arg" ;;
  esac
done

mkdir -p "$BACKUP_LOCAL_DIR"

if [ "$REMOTE" -eq 1 ]; then
  BACKUP_NAME="$SOURCE_ARG"
  ARCHIVE_PATH="$BACKUP_LOCAL_DIR/$BACKUP_NAME.tar.gz"
  echo "▶ téléchargement du backup distant: $BACKUP_NAME"
  # Le rapatriement passe par une URL présignée générée côté Node (storage.ts),
  # pas de dépendance à un client S3 en bash.
  node -e "
    const { presignedGetUrl, storageKeys } = await import('@sallycourse/shared/storage.js');
    const url = await presignedGetUrl(storageKeys.mongoBackup(process.argv[1]), 300);
    console.log(url);
  " "$BACKUP_NAME" > /tmp/sallycourse-restore-url.txt 2>/dev/null || {
    echo "✗ échec de génération de l'URL présignée — utilisez plutôt un backup local" >&2
    exit 1
  }
  PRESIGNED_URL="$(cat /tmp/sallycourse-restore-url.txt)"
  curl -fsSL "$PRESIGNED_URL" -o "$ARCHIVE_PATH"
  rm -f /tmp/sallycourse-restore-url.txt
else
  ARCHIVE_PATH="$SOURCE_ARG"
  if [ -z "$ARCHIVE_PATH" ] || [ ! -f "$ARCHIVE_PATH" ]; then
    echo "✗ archive locale introuvable: $ARCHIVE_PATH" >&2
    exit 1
  fi
  BACKUP_NAME="$(basename "$ARCHIVE_PATH" .tar.gz)"
fi

EXTRACT_DIR="$BACKUP_LOCAL_DIR/restore-$BACKUP_NAME"
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
echo "▶ extraction de $ARCHIVE_PATH"
tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"

# Le dump mongodump crée un sous-dossier au nom du backup (--out="$DUMP_DIR" côté backup-mongo.sh).
DUMP_DIR="$EXTRACT_DIR/$BACKUP_NAME"
if [ ! -d "$DUMP_DIR" ]; then
  # Repli : certains tar peuvent avoir été créés différemment — on prend le seul sous-dossier présent.
  DUMP_DIR="$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d | head -n1)"
fi
if [ -z "$DUMP_DIR" ] || [ ! -d "$DUMP_DIR" ]; then
  echo "✗ structure de dump introuvable dans l'archive" >&2
  exit 1
fi

RESTORE_ARGS=(--uri="$MONGO_URI" "$DUMP_DIR")
if [ "$DROP" -eq 1 ]; then
  if [ "$YES" -ne 1 ]; then
    read -r -p "⚠ --drop va SUPPRIMER les collections existantes avant restauration. Continuer ? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
      echo "Annulé."
      exit 1
    fi
  fi
  RESTORE_ARGS+=(--drop)
fi

echo "▶ mongorestore depuis $DUMP_DIR"
mongorestore "${RESTORE_ARGS[@]}"

rm -rf "$EXTRACT_DIR"
echo "✓ restauration terminée depuis: $BACKUP_NAME"
