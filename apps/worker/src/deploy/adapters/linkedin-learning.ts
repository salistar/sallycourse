// Adapter LinkedIn Learning (Prompt 102) — plateforme fonctionnant sur
// CANDIDATURE instructeur (formulaire officiel LinkedIn), sans upload direct
// ni API publique de publication. Comme Coursera/edX (Prompt 101), cet adapter
// est du pur EXPORT : capabilities.modes = ['manual'] uniquement.
//
// authenticate/createCourse/uploadLesson/setLandingPage sont des NO-OP
// documentés (rien à automatiser côté plateforme). Le vrai travail se fait
// dans submitForReview : génération d'un DOSSIER DE CANDIDATURE complet
// (« pitch pack ») :
//   1. Pitch percutant (2-3 phrases), plan résumé, bio instructeur suggérée
//      et arguments différenciants — générés par Claude (callClaudeJson,
//      mock-friendly).
//   2. Sélection de la première leçon vidéo déjà rendue comme « échantillon ».
//   3. Assemblage d'un PDF (gabarit linkedin-pitch, packages/design) rendu via
//      Playwright et archivé dans le stockage
//      (storageKeys.course(id).exportFile('linkedin-pitch-pack.pdf')).
//
// getStatus renvoie {status:'ready-to-submit'} une fois le pack généré — il
// n'existe pas d'état de revue interrogeable (pas d'API). La VRAIE démarche
// de candidature reste manuelle : déposer ce pack via le formulaire officiel
// LinkedIn Learning (https://www.linkedin.com/learning-instructor/), joindre
// l'extrait vidéo échantillon, et attendre l'évaluation éditoriale humaine.
// Aucune automatisation illégitime (pas de scraping, pas de remplissage
// automatique du formulaire) : LinkedIn Learning ne l'autorise pas.
//
// MOCK (MOCK_PROVIDERS ou credentials absents — ici aucun credential requis) :
// aucun appel réseau réel, pitch simulé déterministe, PDF minimal archivé.

import { z } from 'zod';
import {
  getConfig,
  PdfTemplate,
  renderPdfTemplate,
  storageKeys,
  uploadObject,
  presignedGetUrl,
  type Difficulty,
  type DeploymentMode,
  type ILesson,
  type LinkedinPitchPdfInput,
} from '../../shared.js';
import { callClaudeJson } from '../../lib/claude.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import { isVideoLesson } from './lesson-transforms.js';

/** Plateforme (clé du registre). */
export const LINKEDIN_LEARNING_PLATFORM = 'linkedin-learning';

/** Nom de fichier du dossier de candidature archivé. */
export const LINKEDIN_PITCH_PACK_FILENAME = 'linkedin-pitch-pack.pdf';

/** Instructions RÉELLES de candidature (formulaire officiel, aucune automatisation). */
export const LINKEDIN_APPLY_NOTE =
  "LinkedIn Learning ne propose aucune API de publication : la candidature se dépose " +
  "manuellement via le formulaire officiel « Become an instructor » " +
  "(www.linkedin.com/learning-instructor/), en y joignant ce dossier (pitch, plan, bio) " +
  "et l'extrait vidéo échantillon. L'évaluation est éditoriale et humaine — aucune " +
  "automatisation du formulaire n'est légitime ni tentée ici.";

/** Libellés de niveau (mêmes intitulés que les autres prompts du worker). */
const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Niveau débutant',
  intermediate: 'Niveau intermédiaire',
  advanced: 'Niveau avancé',
};

/* ------------------------------------------------------------------ */
/* Schéma du contenu de candidature généré par Claude                  */
/* ------------------------------------------------------------------ */

/** Contenu structuré du pitch pack — généré en un seul appel Claude. */
export const linkedinPitchContentSchema = z.object({
  /** Pitch percutant du cours, 2-3 phrases. */
  pitch: z.string().min(1),
  /** Plan résumé en bullet points (titres de sections/leçons condensés). */
  planItems: z.array(z.string().min(1)).min(1).max(20),
  /** Bio instructeur suggérée, à partir du titre/niveau du cours. */
  instructorBio: z.string().min(1),
  /** 3-4 arguments différenciants. */
  differentiators: z.array(z.string().min(1)).min(3).max(4),
});
export type LinkedinPitchContent = z.infer<typeof linkedinPitchContentSchema>;

/* ------------------------------------------------------------------ */
/* Helpers PURS (sélection vidéo, prompt, mock) — testables sans réseau */
/* ------------------------------------------------------------------ */

/**
 * Sélectionne la leçon « échantillon » : la PREMIÈRE leçon de type vidéo déjà
 * rendue (assets.videoUrl présent), dans l'ordre de `lessons` (= ordre absolu
 * du cours). Retourne null si aucune vidéo n'est encore disponible.
 */
export function selectSampleVideoLesson(lessons: readonly ILesson[]): ILesson | null {
  return lessons.find(isVideoLesson) ?? null;
}

/** Prompt système du pitch pack (français, orienté candidature éditoriale). */
export function linkedinPitchSystemPrompt(): string {
  return (
    "Tu rédiges un dossier de candidature instructeur pour LinkedIn Learning. " +
    "Réponds en JSON conforme au schéma demandé : { pitch, planItems[], instructorBio, " +
    "differentiators[] (3 à 4) }. Le pitch (2-3 phrases) doit être percutant et orienté " +
    "bénéfices concrets pour l'apprenant professionnel. Le plan résumé condense la " +
    "structure du cours en bullet points clairs. La bio instructeur est crédible et " +
    "professionnelle, cohérente avec le titre et le niveau du cours. Les arguments " +
    "différenciants mettent en avant ce qui distingue ce cours de l'offre existante. " +
    "Tout en français, ton professionnel."
  );
}

/** Prompt utilisateur (données du cours) du pitch pack. */
export function linkedinPitchUserPrompt(
  courseTitle: string,
  difficulty: Difficulty,
  lessonTitles: readonly string[],
): string {
  const plan = lessonTitles.length > 0 ? lessonTitles.join(', ') : '(plan non encore détaillé)';
  return [
    `Cours : « ${courseTitle} ».`,
    `Niveau : ${DIFFICULTY_LABELS[difficulty]}.`,
    `Leçons du cours : ${plan}.`,
  ].join('\n');
}

/** Fixture déterministe (mode mock) — même contrat que le schéma Claude. */
export function mockLinkedinPitchContent(courseTitle: string): LinkedinPitchContent {
  return {
    pitch:
      `« ${courseTitle} » guide les apprenants pas à pas vers une compétence directement ` +
      `applicable en entreprise. Un format court, concret, pensé pour progresser entre deux réunions.`,
    planItems: [
      'Introduction et mise en contexte professionnelle',
      'Fondamentaux illustrés par des cas concrets',
      'Exercices pratiques guidés',
      'Synthèse et prochaines étapes',
    ],
    instructorBio:
      `Formateur spécialisé sur le sujet de « ${courseTitle} », avec une expérience terrain ` +
      `orientée résultats et une pédagogie centrée sur la mise en pratique immédiate.`,
    differentiators: [
      'Approche 100% orientée mise en pratique professionnelle',
      'Rythme court, compatible avec un emploi du temps chargé',
      'Exemples ancrés dans des situations réelles d’entreprise',
    ],
  };
}

/** true si aucun appel réseau réel ne doit être tenté (mode mock global). */
function isMockMode(): boolean {
  const config = getConfig();
  return Boolean(config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY);
}

/**
 * Génère le contenu du pitch pack via Claude (mock-friendly). Le schéma est
 * spécifique à cet adapter (aucune fixture générique ne correspond) : on
 * court-circuite explicitement en mode mock, comme pour Systeme.io (P104).
 */
export async function generateLinkedinPitchContent(
  courseTitle: string,
  difficulty: Difficulty,
  lessonTitles: readonly string[],
): Promise<LinkedinPitchContent> {
  if (isMockMode()) return mockLinkedinPitchContent(courseTitle);
  return callClaudeJson<LinkedinPitchContent>({
    schema: linkedinPitchContentSchema,
    system: linkedinPitchSystemPrompt(),
    user: linkedinPitchUserPrompt(courseTitle, difficulty, lessonTitles),
  });
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export class LinkedinLearningAdapter extends BaseDeploymentAdapter {
  platform = LINKEDIN_LEARNING_PLATFORM;
  // Manuel uniquement : aucune API de publication, candidature humaine requise.
  capabilities = { modes: ['manual'] as DeploymentMode[], needsBrowser: false };

  /** NO-OP documenté : aucune session à ouvrir (pas d'API instructeur accessible ici). */
  async authenticate(ctx: DeployContext): Promise<void> {
    await this.log(
      ctx,
      'info',
      'LinkedIn Learning : authentification non applicable (candidature manuelle, aucune API) — no-op',
      4,
    );
  }

  /**
   * NO-OP documenté : « créer le cours » côté plateforme n'a pas de sens tant
   * que la candidature instructeur n'a pas été acceptée. Renvoie un identifiant
   * local stable pour que le flow générique du processor continue sans branche
   * spéciale.
   */
  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    const id = String((ctx.course as { _id?: unknown })._id ?? 'course');
    await this.log(
      ctx,
      'info',
      'LinkedIn Learning : création de cours non applicable (candidature instructeur requise au préalable) — no-op',
      15,
    );
    return { externalId: id };
  }

  /** NO-OP documenté : le contenu n'est pas uploadé leçon par leçon — un seul pack est généré. */
  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    await this.log(
      ctx,
      'info',
      `LinkedIn Learning : leçon ${index + 1} (« ${lesson.title} ») non uploadée individuellement — incluse au dossier de candidature — no-op`,
    );
  }

  /** NO-OP documenté : pas de page de présentation à configurer avant acceptation de la candidature. */
  async setLandingPage(ctx: DeployContext): Promise<void> {
    await this.log(
      ctx,
      'info',
      'LinkedIn Learning : page de présentation non applicable avant acceptation de la candidature — no-op',
      80,
    );
  }

  /**
   * Étape utile : génère le dossier de candidature complet (pitch, plan, bio,
   * différenciants, extrait vidéo échantillon) et l'archive en PDF.
   */
  async submitForReview(ctx: DeployContext): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const difficulty = (ctx.course as { difficulty?: Difficulty }).difficulty ?? 'beginner';
    const lessonTitles = ctx.lessons.map((l) => l.title);

    const content = await generateLinkedinPitchContent(ctx.course.title, difficulty, lessonTitles);

    const sampleLesson = selectSampleVideoLesson(ctx.lessons);
    let sampleVideoUrl = '';
    if (sampleLesson?.assets?.videoUrl) {
      sampleVideoUrl = await this.guardMock(
        ctx,
        () => presignedGetUrl(sampleLesson.assets.videoUrl!, 3600),
        () => `https://mock.storage.local/${sampleLesson.assets.videoUrl}`,
      );
    }

    const pdfInput: LinkedinPitchPdfInput = {
      courseTitle: ctx.course.title,
      generatedLine: `Généré le ${new Date().toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`,
      levelLine: DIFFICULTY_LABELS[difficulty],
      pitch: content.pitch,
      planItems: content.planItems,
      instructorBio: content.instructorBio,
      differentiators: content.differentiators,
      sampleVideoUrl,
      sampleVideoTitle: sampleLesson?.title ?? '',
      applyNote: LINKEDIN_APPLY_NOTE,
    };

    const html = renderPdfTemplate(PdfTemplate.LinkedinPitch, pdfInput);

    const pdfBuffer = await this.guardMock(
      ctx,
      async () => {
        const { getSlideBrowser } = await import('../../media/slide-renderer.js');
        const browser = await getSlideBrowser();
        const page = await browser.newPage();
        try {
          await page.setContent(html, { waitUntil: 'networkidle' });
          const pdf = await page.pdf({ format: 'A4', printBackground: true });
          return Buffer.from(pdf);
        } finally {
          await page.close().catch(() => undefined);
        }
      },
      async () =>
        Buffer.from(
          `%PDF-1.4\n% [mock] dossier de candidature LinkedIn Learning\n% ${ctx.course.title}\n%%EOF\n`,
          'utf-8',
        ),
    );

    const key = storageKeys.course(courseId).exportFile(LINKEDIN_PITCH_PACK_FILENAME);
    await uploadObject(key, pdfBuffer, 'application/pdf');

    await this.log(
      ctx,
      'info',
      `LinkedIn Learning : dossier de candidature généré (${content.planItems.length} point(s) de plan, ` +
        `${content.differentiators.length} argument(s) différenciant(s)${sampleVideoUrl ? ', extrait vidéo inclus' : ', aucun extrait vidéo disponible'}) — ${key}`,
      92,
    );
  }

  /**
   * DeploymentStatus n'a pas d'état dédié « prêt à candidater » (enum fixé :
   * pending/running/paused/failed/published) : on réutilise 'published' —
   * comme l'adapter Coursera/edX — pour signifier « le pack est généré, prêt
   * côté SallyCourse ». `reviewState` porte le VRAI statut lisible
   * (« ready-to-submit ») et documente la marche à suivre : formulaire
   * officiel LinkedIn Learning, candidature humaine, aucune revue API.
   */
  async getStatus(_ctx: DeployContext): Promise<DeployStatus> {
    return {
      status: 'published',
      externalUrl: undefined,
      reviewState: `ready-to-submit — ${LINKEDIN_APPLY_NOTE}`,
    };
  }
}

/** Instance prête à l'enregistrement dans le registre. */
export const linkedinLearningAdapter = new LinkedinLearningAdapter();

registerAdapter(linkedinLearningAdapter);
