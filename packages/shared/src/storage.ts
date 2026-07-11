import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { getConfig } from './config';

// Stockage objet S3/MinIO : client unique, organisation des clés typée,
// helpers upload/download/presign et nettoyage par préfixe de cours.

/** Erreur enrichie du contexte (opération + clé) pour un diagnostic rapide. */
export class StorageError extends Error {
  readonly operation: string;
  readonly key?: string;

  constructor(operation: string, key: string | undefined, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Stockage: échec de "${operation}"${key ? ` sur "${key}"` : ''} — ${reason}`);
    this.name = 'StorageError';
    this.operation = operation;
    this.key = key;
    this.cause = cause;
  }
}

let client: S3Client | null = null;

/** Client S3 partagé (MinIO : endpoint custom + path-style obligatoire). */
export function getS3Client(): S3Client {
  if (client) return client;
  const cfg = getConfig();
  client = new S3Client({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.S3_ACCESS_KEY,
      secretAccessKey: cfg.S3_SECRET_KEY,
    },
  });
  return client;
}

function bucket(): string {
  return getConfig().S3_BUCKET;
}

// ---------------------------------------------------------------------------
// Organisation des clés — une seule source de vérité pour toute l'arborescence
// "courses/{courseId}/..." afin d'éviter les chemins construits à la main.
// ---------------------------------------------------------------------------

export interface LessonKeys {
  /** Préfixe de la leçon : courses/{id}/sections/{n}/lessons/{n} */
  prefix: string;
  video(): string;
  article(): string;
  screenshot(index: number): string;
  /** Slide vidéo rendue en PNG (gabarits D7 rendus par Playwright). */
  slide(index: number): string;
  captionsSrt(): string;
  captionsVtt(): string;
  audio(slide: number): string;
  quiz(): string;
}

export interface CourseKeys {
  /** Préfixe racine du cours : courses/{id} */
  prefix: string;
  lesson(sectionOrder: number, lessonOrder: number): LessonKeys;
  marketing(fileName: string): string;
  exportFile(fileName: string): string;
  /** Ressource téléchargeable du cours (Prompt 65) : courses/{id}/resources/{fileName} */
  resource(fileName: string): string;
}

export const storageKeys = {
  /** Cache TTS partagé entre cours : clé = hash sha256(texte+voix). */
  ttsCache(hash: string): string {
    return `tts-cache/${hash}.mp3`;
  },
  /**
   * Cache de captures d'écran partagé entre cours (Prompt 72) : clé = hash
   * sha256 du screenshotSpec (contenu, pas le cours) — deux TP différents qui
   * rejouent exactement la même spec (même url/actions/focusSelector/caption)
   * réutilisent la capture déjà annotée sans relancer Playwright.
   */
  screenshotCache(hash: string): string {
    return `screenshot-cache/${hash}.png`;
  },
  /**
   * Backup MongoDB (Prompt 74) : clé = backups/mongo/{nom-horodaté}.tar.gz.
   * `name` est produit par formatBackupName() côté worker (ou par le script
   * bash équivalent) — ce préfixe est distinct de "courses/" pour ne jamais
   * être supprimé par deleteCoursePrefix.
   */
  mongoBackup(name: string): string {
    return `backups/mongo/${name}.tar.gz`;
  },
  course(courseId: string): CourseKeys {
    const prefix = `courses/${courseId}`;
    return {
      prefix,
      lesson(sectionOrder: number, lessonOrder: number): LessonKeys {
        const base = `${prefix}/sections/${sectionOrder}/lessons/${lessonOrder}`;
        return {
          prefix: base,
          video: () => `${base}/video.mp4`,
          article: () => `${base}/article.md`,
          screenshot: (index: number) => `${base}/screenshots/${index}.png`,
          slide: (index: number) => `${base}/slides/${index}.png`,
          captionsSrt: () => `${base}/captions.srt`,
          captionsVtt: () => `${base}/captions.vtt`,
          audio: (slide: number) => `${base}/audio/${slide}.mp3`,
          quiz: () => `${base}/quiz.json`,
        };
      },
      marketing: (fileName: string) => `${prefix}/marketing/${fileName}`,
      exportFile: (fileName: string) => `${prefix}/exports/${fileName}`,
      resource: (fileName: string) => `${prefix}/resources/${fileName}`,
    };
  },
};

// ---------------------------------------------------------------------------
// Opérations
// ---------------------------------------------------------------------------

export type UploadBody = Buffer | Uint8Array | string | Readable;

/** Écrit un objet dans le bucket. */
export async function uploadObject(
  key: string,
  body: UploadBody,
  contentType: string,
): Promise<void> {
  try {
    await getS3Client().send(
      new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
    );
  } catch (err) {
    throw new StorageError('uploadObject', key, err);
  }
}

/** Récupère un objet sous forme de stream Node lisible. */
export async function getObjectStream(key: string): Promise<Readable> {
  try {
    const res = await getS3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    if (!res.Body) throw new Error('réponse sans corps');
    return res.Body as Readable;
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw new StorageError('getObjectStream', key, err);
  }
}

/**
 * Vérifie l'existence d'un objet (HeadObject) sans télécharger son corps.
 * Retourne false sur 404/NotFound, propage toute autre erreur (StorageError).
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err) {
    const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (code === 'NotFound' || code === 'NoSuchKey' || status === 404) return false;
    throw new StorageError('objectExists', key, err);
  }
}

/** URL de lecture présignée (défaut 1 h). */
export async function presignedGetUrl(key: string, expiresSec = 3600): Promise<string> {
  try {
    return await getSignedUrl(
      getS3Client(),
      new GetObjectCommand({ Bucket: bucket(), Key: key }),
      { expiresIn: expiresSec },
    );
  } catch (err) {
    throw new StorageError('presignedGetUrl', key, err);
  }
}

/** URL d'écriture présignée (défaut 1 h). */
export async function presignedPutUrl(
  key: string,
  contentType?: string,
  expiresSec = 3600,
): Promise<string> {
  try {
    return await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
      { expiresIn: expiresSec },
    );
  } catch (err) {
    throw new StorageError('presignedPutUrl', key, err);
  }
}

/** Supprime un objet (idempotent côté S3). */
export async function deleteObject(key: string): Promise<void> {
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } catch (err) {
    throw new StorageError('deleteObject', key, err);
  }
}

/**
 * Supprime tous les objets d'un cours (listage paginé + suppression par lots
 * de 1000, la limite de DeleteObjects). Retourne le nombre d'objets supprimés.
 */
export async function deleteCoursePrefix(courseId: string): Promise<number> {
  const prefix = `${storageKeys.course(courseId).prefix}/`;
  const s3 = getS3Client();
  let deleted = 0;
  let continuationToken: string | undefined;
  try {
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket(),
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );
      const keys = (page.Contents ?? [])
        .map((obj) => obj.Key)
        .filter((k): k is string => Boolean(k));
      if (keys.length > 0) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket(),
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += keys.length;
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return deleted;
  } catch (err) {
    throw new StorageError('deleteCoursePrefix', prefix, err);
  }
}

/**
 * Liste les clés d'un préfixe donné (paginé, toutes pages agrégées). Générique
 * — utilisé notamment par le script de backup pour lister/purger
 * "backups/mongo/" selon la politique de rétention (Prompt 74).
 */
export async function listObjectKeys(prefix: string): Promise<string[]> {
  const s3 = getS3Client();
  const keys: string[] = [];
  let continuationToken: string | undefined;
  try {
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket(),
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );
      for (const obj of page.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  } catch (err) {
    throw new StorageError('listObjectKeys', prefix, err);
  }
}

/**
 * Vérifie l'accès au stockage (HeadBucket) — utilisé par le healthcheck.
 * Jette une StorageError si le bucket est injoignable ou absent.
 */
export async function checkStorage(): Promise<void> {
  const name = bucket();
  try {
    await getS3Client().send(new HeadBucketCommand({ Bucket: name }));
  } catch (err) {
    throw new StorageError('checkStorage', name, err);
  }
}

/** Crée le bucket au démarrage s'il n'existe pas (ignore "déjà possédé"). */
export async function ensureBucket(): Promise<void> {
  const s3 = getS3Client();
  const name = bucket();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: name }));
    return; // Bucket déjà présent.
  } catch {
    // Absent (ou HEAD refusé) : on tente la création ci-dessous.
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: name }));
  } catch (err) {
    const code = (err as { name?: string })?.name;
    if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') return;
    throw new StorageError('ensureBucket', name, err);
  }
}
