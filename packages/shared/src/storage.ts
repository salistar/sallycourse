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
  /**
   * Screencast d'une étape de TP (Prompt 85) : mini-vidéo de démonstration
   * (Playwright recordVideo + zoom ffmpeg + narration TTS synchronisée) —
   * courses/{id}/sections/{n}/lessons/{n}/screencasts/{index}.mp4.
   */
  screencast(index: number): string;
  captionsSrt(): string;
  captionsVtt(): string;
  /**
   * Transcription texte brut (P137, accessibilité) : mêmes cues que le
   * .srt/.vtt mais sans timestamps ni index — un paragraphe par cue,
   * téléchargeable directement par un lecteur d'écran ou pour relecture.
   */
  captionsTxt(): string;
  audio(slide: number): string;
  quiz(): string;
  /**
   * Sous-titres traduits d'une leçon (Prompt 92, traduction des cours publiés) :
   * courses/{id}/sections/{n}/lessons/{n}/captions-{locale}.srt. Distinct du
   * .srt d'origine (captionsSrt) — n'écrase jamais la langue source.
   */
  captionsSrtLocalized(locale: string): string;
  /**
   * Vidéo doublée d'une leçon (Prompt 92, doublage optionnel) : nouveau MP4
   * réassemblé avec l'audio TTS traduit — courses/{id}/sections/{n}/lessons/{n}/video-{locale}.mp4.
   */
  videoLocalized(locale: string): string;
}

export interface CourseKeys {
  /** Préfixe racine du cours : courses/{id} */
  prefix: string;
  lesson(sectionOrder: number, lessonOrder: number): LessonKeys;
  marketing(fileName: string): string;
  exportFile(fileName: string): string;
  /** Ressource téléchargeable du cours (Prompt 65) : courses/{id}/resources/{fileName} */
  resource(fileName: string): string;
  /**
   * Segment avatar « talking head » d'intro/conclusion de section (Prompt 82) :
   * courses/{id}/sections/{n}/avatar/{intro|outro}.mp4. Généré une fois par
   * section (indépendant des leçons), réutilisé par toutes les vidéos de la
   * section lors de l'assemblage final (cf. video-render.ts).
   */
  avatarSegment(sectionOrder: number, kind: 'intro' | 'outro'): string;
  /**
   * Support source importé par l'utilisateur (Prompt 90, RAG simple) :
   * courses/{id}/source-material/{fileName} — fichier brut conservé tel quel
   * (PDF/PPTX/Markdown), extrait puis chunké côté worker (lib/rag-extract.ts).
   */
  sourceMaterial(fileName: string): string;
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
  /**
   * Échantillon audio de clonage vocal (Prompt 81) : clé = voice-samples/{userId}.audio.
   * Conservé pour traçabilité (préfixe distinct de "courses/", jamais purgé
   * par deleteCoursePrefix) — un seul échantillon courant par utilisateur.
   */
  voiceSample(userId: string): string {
    return `voice-samples/${userId}.audio`;
  },
  /**
   * Logo de marque blanche du certificat (Prompt 88) : clé =
   * branding/{userId}/logo.{ext}. Préfixe distinct de "courses/" (jamais
   * purgé par deleteCoursePrefix) — un seul logo courant par utilisateur.
   */
  schoolBrandingLogo(userId: string, ext: string): string {
    return `branding/${userId}/logo.${ext}`;
  },
  /**
   * Facture PDF archivée (Prompt 148, conformité fiscale Maroc) : clé =
   * invoices/{userId}/{invoiceNumber}.pdf. Préfixe distinct de "courses/"
   * (jamais purgé par deleteCoursePrefix) — une facture par paiement réussi.
   */
  invoice(userId: string, invoiceNumber: string): string {
    return `invoices/${userId}/${invoiceNumber}.pdf`;
  },
  /**
   * Preuve de virement d'une demande de paiement manuel (Prompt 158) : clé =
   * manual-payments/{userId}/{requestId}.{ext}. Préfixe distinct de "courses/"
   * (jamais purgé par deleteCoursePrefix).
   */
  manualPaymentProof(userId: string, requestId: string, ext: string): string {
    return `manual-payments/${userId}/${requestId}.${ext}`;
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
          screencast: (index: number) => `${base}/screencasts/${index}.mp4`,
          captionsSrt: () => `${base}/captions.srt`,
          captionsVtt: () => `${base}/captions.vtt`,
          captionsTxt: () => `${base}/captions.txt`,
          audio: (slide: number) => `${base}/audio/${slide}.mp3`,
          quiz: () => `${base}/quiz.json`,
          captionsSrtLocalized: (locale: string) => `${base}/captions-${locale}.srt`,
          videoLocalized: (locale: string) => `${base}/video-${locale}.mp4`,
        };
      },
      marketing: (fileName: string) => `${prefix}/marketing/${fileName}`,
      exportFile: (fileName: string) => `${prefix}/exports/${fileName}`,
      resource: (fileName: string) => `${prefix}/resources/${fileName}`,
      avatarSegment: (sectionOrder: number, kind: 'intro' | 'outro') =>
        `${prefix}/sections/${sectionOrder}/avatar/${kind}.mp4`,
      sourceMaterial: (fileName: string) => `${prefix}/source-material/${fileName}`,
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
    // PutObject exige une longueur connue : un stream sans ContentLength fait
    // échouer la requête côté SDK (« Invalid value "undefined" for header
    // x-amz-decoded-content-length ») — constaté avec le ZIP du packaging
    // (archiver), où l'erreur non rattrapée TUAIT le process worker. On
    // matérialise donc les streams en Buffer avant l'envoi. Pour des exports
    // très volumineux en production, migrer vers @aws-sdk/lib-storage
    // (Upload multipart en flux) — dépendance non installée à ce jour.
    const resolved =
      typeof body === 'object' && body !== null && typeof (body as Readable).pipe === 'function'
        ? await streamToBufferForUpload(body as Readable)
        : (body as Buffer | Uint8Array | string);
    await getS3Client().send(
      new PutObjectCommand({ Bucket: bucket(), Key: key, Body: resolved, ContentType: contentType }),
    );
  } catch (err) {
    throw new StorageError('uploadObject', key, err);
  }
}

/** Agrège un stream lisible en Buffer (voir note ContentLength dans uploadObject). */
async function streamToBufferForUpload(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
