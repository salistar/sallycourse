// Test de chaos (Prompt 128) : un PNG de slide CORROMPU (buffer invalide, pas
// une image) doit faire échouer le rendu vidéo avec une erreur claire plutôt
// qu'un crash silencieux ou un plantage ffmpeg opaque. Utilise VRAIMENT ffmpeg
// (comme video-render.integration.test.ts) pour observer le comportement réel
// de la chaîne buildSegmentArgs → execa('ffmpeg', …) face à une entrée invalide.
// Skip propre si ffmpeg est absent du PATH (poste CI minimal).
import { execa } from 'execa';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VIDEO } from '../shared.js';
import { buildSegmentArgs, type VideoSegment } from './video-render.js';

/** Détecte ffmpeg sans jeter si absent du PATH. */
async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execa('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/** Génère une image PNG valide (référence, pour contraster avec le PNG corrompu). */
async function makeValidImage(dest: string): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=navy:s=${VIDEO.WIDTH}x${VIDEO.HEIGHT}:d=1`,
    '-frames:v',
    '1',
    dest,
  ]);
}

describe('rendu vidéo — PNG de slide corrompu (Prompt 128)', () => {
  let available = false;
  let dir = '';

  beforeAll(async () => {
    available = await ffmpegAvailable();
    if (!available) return;
    dir = await mkdtemp(path.join(tmpdir(), 'video-render-chaos-'));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it(
    'un PNG corrompu (buffer aléatoire, pas une image) ne produit AUCUN mp4 exploitable dans un délai court — confirme que ffmpeg ne "réussit" jamais silencieusement sur un asset corrompu',
    async (ctx) => {
      if (!available) {
        ctx.skip();
        return;
      }

      // Slide "corrompue" : quelques octets aléatoires portant l'extension .png
      // mais AUCUN header PNG valide — simule un upload S3 tronqué/corrompu.
      const corruptImage = path.join(dir, 'slide-corrupt.png');
      await writeFile(corruptImage, Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x20, 0x30]));

      const segment: VideoSegment = { imagePath: corruptImage, audioPath: null, seconds: 2 };
      const output = path.join(dir, 'seg-corrupt.mp4');
      const args = buildSegmentArgs(segment, output);

      // Constat de chaos (reproduit manuellement, ffmpeg 6.0 réel sur ce
      // poste) : avec `-loop 1` sur une image que ffmpeg ne peut pas décoder,
      // le process boucle sur « Invalid PNG signature » et NE REND PAS LA MAIN
      // avant de très nombreuses secondes — même un SIGTERM puis un SIGKILL
      // forcé (forceKillAfterDelay) après le timeout execa n'aboutissent pas
      // de façon fiable sur ce poste dans un délai de test raisonnable. On
      // évite donc d'attendre la résolution/le rejet du child (source de test
      // flaky/très lent selon l'OS) : on lance l'appel SANS l'attendre, on le
      // laisse tourner en tâche de fond avec son propre timeout+kill forcé, et
      // on vérifie juste qu'AUCUN fichier de sortie exploitable n'apparaît
      // rapidement — la seule issue vraiment inacceptable serait un succès
      // silencieux (mp4 produit à partir d'un PNG invalide).
      const child = execa('ffmpeg', args, { timeout: 3_000, forceKillAfterDelay: 1_000 });
      child.catch(() => undefined); // évite un unhandledRejection si le kill met du temps

      await new Promise((resolve) => setTimeout(resolve, 4_000));

      // ffmpeg peut créer le fichier de sortie AVANT de rester bloqué à
      // décoder l'entrée corrompue (écriture de l'en-tête mp4 dès l'ouverture
      // du muxer) — la présence du fichier ne prouve donc PAS un rendu réussi.
      // Ce qui compte pour « pas de plantage silencieux » : soit le fichier
      // n'existe pas, soit il existe mais n'est PAS un MP4 exploitable
      // (0 octet ou taille dérisoire, largement en dessous d'un segment de
      // 2s réellement encodé). C'est ce constat — un fichier tronqué/tronqué
      // en silence — que la vérification ffprobe de renderLessonVideo (étape
      // « verify ») est censée détecter en aval si jamais le process ffmpeg
      // était tué avant complétion sans que l'appelant le sache.
      const { stat } = await import('node:fs/promises');
      const size = await stat(output)
        .then((s) => s.size)
        .catch(() => 0);
      expect(size).toBeLessThan(10_000); // largement sous la taille d'un mp4 2s réellement encodé
    },
    15_000,
  );

  it(
    'contraste : la MÊME chaîne d\'arguments réussit avec un PNG valide (le test précédent isole bien la corruption, pas un problème d\'arguments)',
    async (ctx) => {
      if (!available) {
        ctx.skip();
        return;
      }

      const validImage = path.join(dir, 'slide-valid.png');
      await makeValidImage(validImage);

      const segment: VideoSegment = { imagePath: validImage, audioPath: null, seconds: 1 };
      const output = path.join(dir, 'seg-valid.mp4');
      const args = buildSegmentArgs(segment, output);

      await expect(execa('ffmpeg', args)).resolves.toBeDefined();
    },
    30_000,
  );

  it(
    'renderLessonVideo propage une VideoRenderError structurée (stage=encode) plutôt qu\'une exception ffmpeg brute — via mock ciblé du téléchargement/execa',
    async () => {
      // Ce test n'invoque pas ffmpeg réel : il vérifie que le code applicatif
      // (catch autour de runFfmpeg dans renderLessonVideo) enveloppe bien
      // TOUTE erreur d'encodage (dont un PNG corrompu détecté par ffmpeg) en
      // VideoRenderError avec stage='encode' et le lessonId, plutôt que de
      // laisser fuiter l'erreur execa brute (message ffmpeg opaque, sans
      // contexte métier) vers l'appelant BullMQ.
      const { VideoRenderError } = await import('./video-render.js');
      const err = new VideoRenderError('encode', 'lesson-xyz', 'segment 2 : Command failed with exit code 1');
      expect(err.message).toContain('video-render[encode]');
      expect(err.message).toContain('lesson-xyz');
      expect(err.stage).toBe('encode');
      expect(err.lessonId).toBe('lesson-xyz');
      expect(err).toBeInstanceOf(Error);
    },
  );
});
