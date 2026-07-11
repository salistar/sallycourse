// Upload d'une archive de backup Mongo vers le storage S3/MinIO (P74).
// Appelé par scripts/backup-mongo.sh (via le lanceur scripts/backup-upload.mjs
// à la racine, qui délègue ici pour bénéficier de tsx + resolution des paths
// TS du workspace worker). Réutilise @sallycourse/shared/storage — aucune
// dépendance à un vrai Storage Box externe (voir commentaire rclone dans
// backup-mongo.sh pour brancher Hetzner Storage Box en prod).
//
// Usage : tsx src/scripts/backup-upload.ts <chemin-archive.tar.gz> <nom-backup>
// Sortie : imprime la clé S3 uploadée sur stdout (dernière ligne) pour un
// éventuel chaînage shell.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
// @ts-ignore TS6059/TS2305 — import sans extension, résolu en source par tsx (NodeNext)
import { storageKeys, uploadObject, listObjectKeys, deleteObject } from '@sallycourse/shared/storage.js';

async function main(): Promise<void> {
  const [archivePath, backupName] = process.argv.slice(2);
  if (!archivePath || !backupName) {
    console.error('Usage: tsx src/scripts/backup-upload.ts <archive.tar.gz> <nom-backup>');
    process.exitCode = 1;
    return;
  }

  await stat(archivePath); // jette une erreur claire si le fichier n'existe pas

  const key = storageKeys.mongoBackup(backupName);
  const stream = createReadStream(archivePath);
  await uploadObject(key, stream, 'application/gzip');

  console.log(`Backup uploadé: ${key}`);
}

/**
 * Purge les backups distants plus vieux que `retentionDays` (défaut 30j),
 * en s'appuyant sur la même logique de rétention que les tests worker
 * (applyRetentionPolicy / formatBackupName dans src/lib/backup-retention.ts).
 * Appelable séparément : tsx src/scripts/backup-upload.ts --prune [jours]
 */
async function prune(retentionDays: number): Promise<void> {
  // @ts-ignore TS6059/TS2305 — import sans extension, résolu en source par tsx (NodeNext)
  const { applyRetentionPolicy } = await import('../lib/backup-retention.js');

  const keys = await listObjectKeys('backups/mongo/');
  // Les clés sont "backups/mongo/{nom}.tar.gz" → on retrouve le nom horodaté
  // (même motif que formatBackupName) pour appliquer la politique de rétention.
  const entries = keys
    .map((key) => {
      const fileName = key.split('/').pop() ?? '';
      const name = fileName.replace(/\.tar\.gz$/, '');
      return { name, key };
    });

  const { remove } = applyRetentionPolicy(entries, new Date(), retentionDays);

  for (const entry of remove) {
    await deleteObject(entry.key);
    console.log(`Backup supprimé (rétention ${retentionDays}j dépassée): ${entry.key}`);
  }

  console.log(`Purge terminée: ${remove.length} backup(s) supprimé(s) sur ${entries.length} au total.`);
}

const args = process.argv.slice(2);
if (args[0] === '--prune') {
  const days = args[1] ? Number(args[1]) : 30;
  prune(days).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
} else {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
