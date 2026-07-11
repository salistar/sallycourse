#!/usr/bin/env node
// Lanceur racine (P74) — upload d'une archive de backup Mongo vers le storage
// S3/MinIO existant, en réutilisant @sallycourse/shared/storage.
//
// Ce fichier reste un .mjs pur (pas de dépendance TypeScript à la racine) et
// délègue la logique réelle à apps/worker/src/scripts/backup-upload.ts, exécuté
// via `tsx` dans le workspace worker : on bénéficie ainsi de la résolution des
// paths TS (@sallycourse/shared/*) déjà configurée là-bas, sans dupliquer de
// tooling à la racine.
//
// Usage : node scripts/backup-upload.mjs <chemin-archive.tar.gz> <nom-backup>
//         node scripts/backup-upload.mjs --prune [jours=30]   (purge distante)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WORKER_SCRIPT = 'src/scripts/backup-upload.ts';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/backup-upload.mjs <archive.tar.gz> <nom-backup>');
  console.error('       node scripts/backup-upload.mjs --prune [jours=30]');
  process.exit(1);
}

if (args[0] !== '--prune' && !existsSync(args[0])) {
  console.error(`Archive introuvable: ${args[0]}`);
  process.exit(1);
}

const result = spawnSync(
  'pnpm',
  ['--filter', '@sallycourse/worker', 'exec', 'tsx', WORKER_SCRIPT, ...args],
  { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
);

process.exit(result.status ?? 1);
