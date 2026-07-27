// Processor BullMQ « screenshot-capture » (Prompt 21).
// Consomme { courseId, lessonId } : lit le TP de la leçon (Lesson.script conforme
// à tpSchema), et pour chaque step.screenshotSpec :
//   1. rejoue la spec dans Playwright (contexte isolé 1920x1080, garde SSRF) ;
//   2. habille la capture BRUTE de façon ÉDITORIALE via annotateScreenshot
//      (@sallycourse/design) puis compose l'overlay SVG avec sharp ;
//   3. uploade sous storageKeys…screenshot(i) et remplit Lesson.assets.screenshots ;
//   4. remplace les placeholders {{screenshot:…}} de l'article de la leçon liée.
// Chaque étape est isolée : une capture en échec est journalisée (GenerationJob.logs)
// sans faire échouer les autres. Enregistré avec concurrency 1 dans index.ts.
import type { Job } from 'bullmq';
import sharp from 'sharp';
import {
  GenerationJob,
  Lesson,
  QUEUES,
  Section,
  altTextResultSchema,
  annotateScreenshot,
  buildAltTextPrompt,
  colors,
  extractScreenshotPlaceholders,
  getObjectStream,
  objectExists,
  publishProgress,
  storageKeys,
  tpSchema,
  uploadObject,
  zoomInsetMaskSvg,
  type AnnotationSpecInput,
  type ScreenshotJobData,
  type TpContent,
  type TpScreenshotSpec,
  streamToBuffer,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { callClaudeJson } from '../lib/claude.js';
import {
  captureFromSpec,
  hashScreenshotSpec,
  isScreencastSpec,
  launchCaptureBrowser,
  renderScreencastFromSpec,
  type CapturedScreenshot,
} from '../media/screenshot-capture.js';
import { captureTpStep } from '../media/tp-step-environment.js';
import { readFile } from 'node:fs/promises';
import { mongoCheckpointStore, withCheckpoint } from '../lib/idempotency.js';
import { bumpCacheStat } from '../lib/cache.js';
import { finalizeCourseIfComplete } from './content-generation.js';

export interface ScreenshotCaptureResult {
  courseId: string;
  lessonId: string;
  /** Nombre de captures produites et uploadées. */
  captured: number;
  /** Nombre d'étapes en échec (journalisées, non bloquantes). */
  failed: number;
  /** Placeholders {{screenshot:…}} remplacés dans l'article lié. */
  placeholdersReplaced: number;
  /** Nombre de screencasts produits (Prompt 85, étapes avec recordVideo). */
  screencasts: number;
}

/** Publie la progression + journalise dans GenerationJob (best-effort). */
async function report(
  courseId: string,
  progress: number,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  try {
    await publishProgress(getRedisConnection(), {
      courseId,
      step: QUEUES.screenshot,
      progress,
      message,
      level,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ courseId, err }, 'publication de progression impossible');
  }
  try {
    await GenerationJob.updateOne(
      { courseId, step: QUEUES.screenshot },
      {
        $set: { progress },
        $push: { logs: { ts: new Date(), level, msg: message } },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.warn({ courseId, err }, 'mise à jour GenerationJob impossible');
  }
}

/**
 * Capture de repli (mode dégradé) : PNG 1920×1080 déterministe aux couleurs du
 * design system, produit quand la capture réelle est impossible — URL locale
 * de l'apprenant (refusée par la garde SSRF), environnement injoignable,
 * Playwright en échec. Même philosophie que les autres providers (TTS →
 * silence, image → SVG) : le pipeline ne laisse JAMAIS un placeholder
 * {{screenshot:…}} brut dans l'article publié.
 */
export async function fallbackScreenshotPng(caption: string, stepNumber: number): Promise<Buffer> {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const shortCaption = caption.length > 90 ? `${caption.slice(0, 87)}…` : caption;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <rect width="1920" height="1080" fill="${colors.violet[950]}"/>
  <rect x="60" y="60" width="1800" height="960" rx="24" fill="${colors.violet[900]}" stroke="${colors.violet[700]}" stroke-width="2"/>
  <circle cx="960" cy="420" r="88" fill="none" stroke="${colors.gold[500]}" stroke-width="6"/>
  <text x="960" y="448" text-anchor="middle" font-family="Georgia, serif" font-size="72" fill="${colors.gold[500]}">${stepNumber}</text>
  <text x="960" y="600" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" fill="${colors.white}">Étape ${stepNumber} — illustration à réaliser dans votre environnement</text>
  <text x="960" y="672" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" fill="${colors.violet[300]}">${esc(shortCaption)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// (« stream S3 -> Buffer » factorise dans @sallycourse/shared/storage —
// audit dedup 2026-07-26 : readObjectBuffer/streamToBuffer importes.)

/**
 * Construit la spec d'annotation ÉDITORIALE à partir de la capture brute et de
 * la légende de la spec TP. Volontairement sobre : pastille + surbrillance
 * douce autour du focusSelector n'est pas rejouable ici (coordonnées inconnues
 * après capture d'élément), on s'en tient au cadre + légende signés.
 */
export function buildAnnotationSpec(
  captured: CapturedScreenshot,
  spec: TpScreenshotSpec,
  stepNumber: number,
): AnnotationSpecInput {
  return {
    screenshot: { width: captured.width, height: captured.height },
    theme: 'dark',
    lang: 'fr',
    backdrop: 'surfaceSubtle',
    caption: {
      label: `Étape ${stepNumber}`,
      text: spec.caption,
      align: 'start',
    },
  };
}

/**
 * Compose la capture BRUTE avec l'habillage éditorial (overlay SVG) via sharp,
 * en respectant le contrat de annotateScreenshot :
 *   base transparente → capture → (loupe masquée) → overlay SVG.
 * Retourne le PNG final habillé.
 */
export async function composeAnnotated(
  captured: CapturedScreenshot,
  annotationInput: AnnotationSpecInput,
): Promise<Buffer> {
  const ann = annotateScreenshot(annotationInput);

  const layers: sharp.OverlayOptions[] = [
    {
      input: captured.buffer,
      left: Math.round(ann.imagePlacement.left),
      top: Math.round(ann.imagePlacement.top),
    },
  ];

  // Loupe optionnelle : extrait agrandi de la capture brute, masqué en cercle.
  if (ann.zoomInsetPlacement) {
    const zoom = ann.zoomInsetPlacement;
    const enlarged = await sharp(captured.buffer)
      .extract(zoom.extract)
      .resize(zoom.size, zoom.size, { fit: 'fill' })
      .composite([
        {
          input: Buffer.from(zoomInsetMaskSvg(zoom.size)),
          blend: 'dest-in',
        },
      ])
      .png()
      .toBuffer();
    layers.push({ input: enlarged, left: zoom.composite.left, top: zoom.composite.top });
  }

  // Overlay plein cadre par-dessus (fond, ombre, annotations, légende).
  layers.push({ input: Buffer.from(ann.overlaySvg), left: 0, top: 0 });

  return sharp({
    create: {
      width: ann.canvasWidth,
      height: ann.canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

/**
 * Borne les dimensions d'une capture à 8192 px : annotationSpecSchema
 * (@sallycourse/design) rejette width/height > 8192 (au-delà, l'overlay SVG
 * exploserait en mémoire). Une page longue capturée en fullPage peut dépasser
 * en hauteur → on la redimensionne proportionnellement pour rester sous la
 * borne, plutôt que de laisser annotateScreenshot jeter (ce qui retombait sur
 * l'illustration dégradée, perdant la vraie capture).
 */
const MAX_CAPTURE_PX = 8192;
export async function clampCapturedScreenshot(captured: CapturedScreenshot): Promise<CapturedScreenshot> {
  if (captured.width <= MAX_CAPTURE_PX && captured.height <= MAX_CAPTURE_PX) return captured;
  const scale = MAX_CAPTURE_PX / Math.max(captured.width, captured.height);
  const width = Math.max(1, Math.floor(captured.width * scale));
  const height = Math.max(1, Math.floor(captured.height * scale));
  const buffer = await sharp(captured.buffer).resize(width, height, { fit: 'fill' }).png().toBuffer();
  logger.info(
    { from: { w: captured.width, h: captured.height }, to: { w: width, h: height } },
    'capture redimensionnée sous la borne 8192 px (annotation)',
  );
  return { ...captured, buffer, width, height };
}

/** Étape TP à illustrer : spec Playwright OU commande terminal (P22, env Docker). */
interface StepWithSpec {
  /** Spec de capture navigateur — absente pour une étape terminal pure. */
  spec?: TpScreenshotSpec;
  /** Étape brute — nécessaire à captureTpStep (environnement Docker P22). */
  step: TpContent['steps'][number];
  instruction: string;
}

/**
 * Étapes du TP à illustrer, dans l'ordre du script : celles portant une
 * screenshotSpec (capture Playwright classique) ET — P22, branché par l'audit
 * connectivité 2026-07-17 — celles portant une `command` SANS spec, illustrées
 * via un environnement Docker jetable + terminal web (captureTpStep). Avant ce
 * branchement, les étapes terminal pures n'étaient jamais illustrées.
 */
function stepsWithSpec(tp: TpContent): StepWithSpec[] {
  return tp.steps
    .filter((step) => Boolean(step.screenshotSpec) || Boolean(step.command?.trim()))
    .map((step) => ({ spec: step.screenshotSpec, step, instruction: step.instruction }));
}

/**
 * Génère un texte alternatif descriptif (Prompt 137, accessibilité) via
 * callClaudeJson à partir de la légende + l'instruction de l'étape (vision
 * non nécessaire — le contexte texte suffit). Best-effort : une erreur
 * (LLM en échec, quota…) retombe silencieusement sur la légende brute, JAMAIS
 * bloquant pour le pipeline de capture.
 */
export async function generateScreenshotAltText(
  lessonTitle: string,
  stepNumber: number,
  caption: string,
  instruction: string,
): Promise<string> {
  try {
    // La construction du prompt (validation zod stricte) est englobée dans le
    // même try : un titre de leçon vide ou une instruction trop longue ne doit
    // JAMAIS faire échouer le pipeline de capture, seulement dégrader vers la
    // légende brute (comportement identique à un échec de l'appel LLM).
    const { system, user } = buildAltTextPrompt({
      caption,
      stepNumber,
      lessonTitle: lessonTitle.trim() || 'Étape du tutoriel',
      // altTextRequestSchema borne `action` à 400 car — une instruction de TP
      // plus longue faisait jeter buildAltTextPrompt (repli systématique sur la
      // légende brute). On tronque pour conserver un alt réellement descriptif.
      action: instruction.slice(0, 400),
    });
    const result = await callClaudeJson({ schema: altTextResultSchema, system, user });
    return result.altText;
  } catch (err) {
    logger.warn({ lessonTitle, stepNumber, err }, 'génération du texte alternatif échouée — repli sur la légende');
    return caption;
  }
}

/**
 * Remplace les placeholders {{screenshot:…}} de l'article de la leçon liée par
 * des images Markdown pointant vers les captures uploadées. La leçon liée est
 * l'article de la MÊME section (s'il existe) ; l'appariement se fait dans
 * l'ordre : i-ème placeholder ↔ i-ème capture. Idempotent (retélécharge,
 * remplace, réuploade). Retourne le nombre de placeholders remplacés.
 */
async function replaceArticlePlaceholders(
  courseId: string,
  sectionId: unknown,
  captions: string[],
  screenshotKeys: string[],
  altTexts: string[] = [],
): Promise<number> {
  // Pas de bail-out sur screenshotKeys vide (audit ESG E2) : même si TOUTES les
  // captures du TP voisin ont échoué, l'article peut avoir des placeholders à
  // combler par une illustration de repli (voir plus bas).
  const article = await Lesson.findOne({ courseId, sectionId, type: 'article' });
  if (!article?.assets?.articleMd) return 0;

  const section = await Section.findById(sectionId);
  if (!section) return 0;
  const articleKey = storageKeys.course(courseId).lesson(section.order, article.order).article();

  let markdown: string;
  try {
    markdown = (await streamToBuffer(await getObjectStream(articleKey))).toString('utf8');
  } catch (err) {
    logger.warn({ courseId, articleKey, err }, 'article introuvable pour substitution des captures');
    return 0;
  }

  const placeholders = extractScreenshotPlaceholders(markdown);
  if (placeholders.length === 0) return 0;

  // Garde-fou (audit ESG 2026-07-19, E2) : un article peut contenir PLUS de
  // placeholders {{screenshot:…}} que le TP voisin n'a d'étapes capturées
  // (l'article et le TP sont générés indépendamment). Sans ce complément, les
  // placeholders excédentaires restaient bruts dans l'article publié — le QA
  // final (checkArticlePlaceholders) est censé l'empêcher mais un cours peut
  // être laissé `failed` avec ce défaut visible. On génère donc une
  // illustration de repli (même mécanisme que les captures en échec, cf.
  // fallbackScreenshotPng) pour CHAQUE placeholder au-delà des captures
  // disponibles : aucun placeholder brut ne peut plus survivre à cette passe.
  const keys = storageKeys.course(courseId).lesson(section.order, article.order);
  const extraKeys: string[] = [];
  const extraCaptions: string[] = [];
  for (let i = screenshotKeys.length; i < placeholders.length; i += 1) {
    const desc = placeholders[i]?.trim() || `illustration ${i + 1}`;
    const stepNumber = i + 1;
    try {
      const key = keys.screenshot(1000 + i); // espace d'index dédié : jamais de collision avec le TP.
      await uploadObject(key, await fallbackScreenshotPng(desc, stepNumber), 'image/png');
      extraKeys.push(key);
      extraCaptions.push(desc);
    } catch (err) {
      logger.warn({ courseId, articleKey, index: i, err }, 'illustration de repli (placeholder excédentaire) impossible');
    }
  }
  const allKeys = [...screenshotKeys, ...extraKeys];
  const allCaptions = [...captions, ...extraCaptions];
  const allAltTexts = [...altTexts, ...extraCaptions];

  let index = 0;
  let replaced = 0;
  const next = markdown.replace(/\{\{screenshot:([^}]+)\}\}/g, (match, desc: string) => {
    const key = allKeys[index];
    if (!key) return match; // ne devrait plus jamais arriver (repli garanti ci-dessus).
    // Texte alternatif descriptif (P137) prioritaire sur la légende brute.
    const alt = (allAltTexts[index] || allCaptions[index] || desc.trim()).replace(/[[\]()]/g, '');
    // Chemin relatif d'asset dans le paquet exporté (résolu au packaging P24+).
    const rel = key.startsWith(`${storageKeys.course(courseId).prefix}/`)
      ? key.slice(storageKeys.course(courseId).prefix.length + 1)
      : key;
    index += 1;
    replaced += 1;
    return `![${alt}](./${rel})`;
  });

  if (replaced > 0 && next !== markdown) {
    await uploadObject(articleKey, next, 'text/markdown; charset=utf-8');
    article.assets.screenshots = allKeys.slice(0, replaced);
    await article.save();
  }
  return replaced;
}

/** Processor de la queue screenshot-capture (un job = une leçon TP). */
export async function processScreenshotCapture(
  job: Job<ScreenshotJobData>,
): Promise<ScreenshotCaptureResult> {
  const { courseId, lessonId } = job.data;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);

  // Seules les leçons TP portent des specs de capture ; sinon on sort proprement.
  const parsed = tpSchema.safeParse(lesson.script);
  if (lesson.type !== 'tp' || !parsed.success) {
    await report(courseId, 100, `Aucune capture à produire pour « ${lesson.title} » (leçon non-TP ou script absent)`);
    return { courseId, lessonId, captured: 0, failed: 0, placeholdersReplaced: 0, screencasts: 0 };
  }

  const section = await Section.findById(lesson.sectionId);
  if (!section) throw new Error(`section introuvable : ${String(lesson.sectionId)}`);
  const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);

  const specs = stepsWithSpec(parsed.data);
  if (specs.length === 0) {
    await report(courseId, 100, `TP « ${lesson.title} » sans étape à illustrer`);
    return { courseId, lessonId, captured: 0, failed: 0, placeholdersReplaced: 0, screencasts: 0 };
  }

  await report(courseId, 5, `Capture d'écran : ${specs.length} étape(s) à illustrer pour « ${lesson.title} »`);

  const browser = await launchCaptureBrowser();
  const uploadedKeys: string[] = [];
  const captions: string[] = [];
  const altTexts: string[] = [];

  /** Résultat checkpointé d'une étape : capture réussie (clé+légende) ou échec toléré. */
  interface StepCheckpoint {
    ok: boolean;
    key?: string;
    caption?: string;
    /** Texte alternatif descriptif généré (P137), replié sur la légende si le LLM échoue. */
    altText?: string;
    /** Clé S3 du screencast (Prompt 85), présente uniquement si spec.recordVideo. */
    screencastKey?: string;
    /** true si l'image est une illustration de repli (capture réelle impossible). */
    degraded?: boolean;
  }

  let failed = 0;
  const screencastKeys: string[] = [];
  // Correctif N2 (audit 2026-07-20) : position (dans `uploadedKeys`) de chaque
  // capture produite en mode dégradé (carton de repli) — voir usage plus bas.
  const degradedPositions: number[] = [];
  try {
    // Reprise granulaire (P69) : chaque étape (réussie OU en échec toléré) est
    // checkpointée avant de passer à la suivante. Un crash DUR du worker (pas
    // une erreur de capture, déjà tolérée ci-dessous) au milieu de la boucle
    // ne fait donc perdre que l'étape en cours — la relance rejoue les étapes
    // déjà traitées sans rouvrir Playwright dessus ni sauter d'étape.
    const { results } = await withCheckpoint<StepWithSpec, StepCheckpoint>({
      jobId: lessonId,
      steps: specs,
      store: mongoCheckpointStore(courseId, QUEUES.screenshot),
      runStep: async ({ spec, step, instruction }, i) => {
        const stepNumber = i + 1;
        // Étape terminal pure (command sans spec, P22) : la légende vient de
        // l'instruction ; spec d'annotation synthétique (actions vides).
        const caption = spec?.caption ?? instruction.slice(0, 200);
        const annotSpec: TpScreenshotSpec = spec ?? { actions: [], caption };
        try {
          const key = keys.screenshot(i);
          // Texte alternatif descriptif (P137) — indépendant du cache image
          // par contenu (deux cours différents peuvent vouloir un alt propre
          // à LEUR titre de leçon même si la capture brute est identique).
          const altText = await generateScreenshotAltText(lesson.title, stepNumber, caption, instruction);

          // Cache par CONTENU (Prompt 72) : deux TP — même cours ou cours
          // différents — qui rejouent la même spec (url/actions/focus/légende)
          // réutilisent la capture déjà annotée sans relancer Playwright/sharp.
          // Réservé aux specs navigateur : la sortie d'une commande dans un
          // environnement Docker n'est pas reproductible par contenu.
          const contentKey = spec ? storageKeys.screenshotCache(hashScreenshotSpec(spec)) : undefined;
          if (contentKey && (await objectExists(contentKey))) {
            const cached = await streamToBuffer(await getObjectStream(contentKey));
            await uploadObject(key, cached, 'image/png');
            await bumpCacheStat('screenshot', 'hit');
            return { ok: true, key, caption, altText };
          }
          await bumpCacheStat('screenshot', 'miss');

          let rawCaptured;
          if (spec) {
            rawCaptured = await captureFromSpec(browser, spec);
          } else {
            // P22 : environnement Docker jetable + terminal web — la commande
            // du step est exécutée et son résultat capturé. skipped (Docker
            // absent, image inconnue…) → repli illustration dégradée via throw.
            const term = await captureTpStep(browser, step);
            if (term.skipped) throw new Error(`environnement TP indisponible : ${term.reason}`);
            rawCaptured = term.screenshot;
          }
          const captured = await clampCapturedScreenshot(rawCaptured);
          const annotated = await composeAnnotated(captured, buildAnnotationSpec(captured, annotSpec, stepNumber));
          await uploadObject(key, annotated, 'image/png');
          if (contentKey) {
            await uploadObject(contentKey, annotated, 'image/png').catch((err) => {
              logger.warn({ contentKey, err }, 'écriture du cache de capture par contenu impossible (non bloquant)');
            });
          }

          // Screencast (Prompt 85) : en plus de la capture image (ci-dessus,
          // conservée pour l'article/annotation), produit une mini-vidéo de
          // démonstration si l'étape le demande. Échec de screencast toléré
          // isolément (log + on continue avec la capture image seule).
          let screencastKey: string | undefined;
          if (spec && isScreencastSpec(spec)) {
            try {
              const screencast = await renderScreencastFromSpec(browser, spec, {
                narrationText: spec.caption,
              });
              const scKey = keys.screencast(i);
              await uploadObject(scKey, await readFile(screencast.path), 'video/mp4');
              screencastKey = scKey;
            } catch (err) {
              logger.warn({ courseId, lessonId, step: stepNumber, err }, 'screencast en échec (non bloquant)');
            }
          }

          return { ok: true, key, caption, altText, screencastKey };
        } catch (err) {
          logger.warn({ courseId, lessonId, step: stepNumber, err }, 'capture en échec — repli sur une illustration dégradée');
          // Mode dégradé : illustration de repli plutôt qu'un placeholder brut
          // dans l'article (cf. fallbackScreenshotPng). Si même le repli échoue,
          // l'étape est réellement abandonnée (comportement historique).
          try {
            const key = keys.screenshot(i);
            await uploadObject(key, await fallbackScreenshotPng(caption, stepNumber), 'image/png');
            return { ok: true, key, caption, altText: caption, degraded: true };
          } catch (fallbackErr) {
            logger.warn({ courseId, lessonId, step: stepNumber, err: fallbackErr }, 'illustration de repli impossible');
            return { ok: false };
          }
        }
      },
      onStep: async ({ index, total, result }) => {
        const stepNumber = index + 1;
        if (!result.ok) {
          failed += 1;
          await report(
            courseId,
            Math.round(5 + (stepNumber / total) * 80),
            `Capture ${stepNumber}/${total} échouée`,
            'warn',
          );
          return;
        }
        await report(
          courseId,
          Math.round(5 + (stepNumber / total) * 80),
          `Capture ${stepNumber}/${total} produite : ${result.caption ?? ''}`,
        );
      },
    });

    for (const r of results) {
      if (r.ok && r.key) {
        if (r.degraded) degradedPositions.push(uploadedKeys.length);
        uploadedKeys.push(r.key);
      }
      if (r.ok && r.caption) captions.push(r.caption);
      if (r.ok && r.altText) altTexts.push(r.altText);
      if (r.ok && r.screencastKey) screencastKeys.push(r.screencastKey);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  // Persiste les captures produites sur la leçon TP elle-même.
  lesson.assets.screenshots = uploadedKeys;
  lesson.assets.screenshotsDegraded = degradedPositions.length > 0 ? degradedPositions : undefined;
  // Screencasts (Prompt 85) : additif, uniquement rempli si au moins une étape
  // du TP a demandé recordVideo — sinon on laisse le champ absent (undefined).
  if (screencastKeys.length > 0) {
    lesson.assets.screencasts = screencastKeys;
  }
  // Les captures sont la DERNIÈRE étape du média d'un TP : la leçon est prête.
  // Constaté en réel le 2026-07-25 : dans le flux « édition TP (PATCH, status
  // 'pending') → Recapturer (regenerate render-only, status 'generating') »,
  // AUCUN autre job ne repasse jamais le statut à 'ready' (dans le flux de
  // génération normal, c'est content-generation qui l'avait déjà posé AVANT la
  // capture — no-op ici dans ce cas) : les TP réédités restaient bloqués en
  // 'generating' pour toujours, et finalizeCourseIfComplete (qui exige toutes
  // les leçons 'ready') ne finalisait plus jamais le cours.
  lesson.status = 'ready';
  await lesson.save();

  // Reporte les captures dans l'article de la leçon liée (même section).
  let placeholdersReplaced = 0;
  try {
    placeholdersReplaced = await replaceArticlePlaceholders(courseId, lesson.sectionId, captions, uploadedKeys, altTexts);
  } catch (err) {
    logger.warn({ courseId, lessonId, err }, 'substitution des placeholders article impossible');
  }

  await report(
    courseId,
    100,
    `Captures terminées : ${uploadedKeys.length} produite(s), ${screencastKeys.length} screencast(s), ${failed} en échec, ${placeholdersReplaced} placeholder(s) d'article remplacé(s)`,
    failed > 0 ? 'warn' : 'info',
  );

  // Si les captures finissent APRÈS le dernier rendu vidéo, plus aucun autre
  // job ne rappellerait la finalisation : on re-vérifie ici (ne jette jamais).
  await finalizeCourseIfComplete(courseId);

  return {
    courseId,
    lessonId,
    captured: uploadedKeys.length,
    failed,
    placeholdersReplaced,
    screencasts: screencastKeys.length,
  };
}
