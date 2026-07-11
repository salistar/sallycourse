// Adapter Coursera / edX (Prompt 101) — ces plateformes n'acceptent AUCUNE
// automatisation : Coursera Partner Center et edX Studio ne s'ouvrent qu'aux
// partenaires institutionnels (universités, écoles) après candidature humaine,
// et n'exposent pas d'API publique de publication. Cet adapter est donc du
// pur EXPORT : capabilities.modes = ['manual'] uniquement, needsBrowser=false.
//
// authenticate/createCourse/uploadLesson/setLandingPage/submitForReview sont
// des NO-OP documentés (rien à automatiser côté plateforme) : ils se contentent
// de journaliser l'étape. Le vrai travail se fait une fois, à submitForReview :
// génération d'un export Common Cartridge (.imscc, common-cartridge.ts) archivé
// dans le stockage, prêt à être importé MANUELLEMENT dans Coursera Partner
// Studio ou edX Studio. getStatus renvoie toujours {status:'published',
// externalUrl: undefined} une fois l'export généré (rien à publier, le cours
// existe en tant que fichier téléchargeable).
//
// Le guide d'import (docs/COURSERA-EDX-IMPORT-GUIDE.md) référence les vraies
// étapes de candidature partenaire B2B universités.

import {
  Quiz,
  getObjectStream,
  storageKeys,
  uploadObject,
  type DeploymentMode,
  type ILesson,
} from '../../shared.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import {
  COMMON_CARTRIDGE_FILENAME,
  buildCartridgeItems,
  buildCommonCartridge,
  type CartridgeCourseModel,
  type CartridgeQuizQuestion,
  type CartridgeSource,
} from '../common-cartridge.js';

/** Plateforme (clé du registre). Deux entrées distinctes partagent cet adapter. */
export const COURSERA_PLATFORM = 'coursera';
export const EDX_PLATFORM = 'edx';

/** Lit le contenu binaire complet d'un objet du stockage (null si absent/erreur). */
async function readObjectBuffer(key: string): Promise<Buffer | null> {
  try {
    const stream = await getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/** Lit le Markdown d'un article depuis le stockage (null si absent/erreur). */
async function readArticleMarkdown(lesson: ILesson): Promise<string | null> {
  const key = lesson.assets?.articleMd;
  if (!key) return null;
  const buf = await readObjectBuffer(key);
  return buf ? buf.toString('utf-8') : null;
}

/**
 * Adapter d'export Common Cartridge — commun à Coursera et edX (même besoin :
 * aucune automatisation possible, seul un fichier d'échange standard a du sens).
 * `platform` est injecté au constructeur pour enregistrer les deux entrées du
 * registre sans dupliquer la classe.
 */
export class CourseraEdxAdapter extends BaseDeploymentAdapter {
  platform: string;
  // Manuel uniquement : aucun mode automatique/assisté n'a de sens ici — il
  // n'existe rien à automatiser (pas d'API, pas de navigateur pilotable).
  capabilities = { modes: ['manual'] as DeploymentMode[], needsBrowser: false };

  constructor(platform: string) {
    super();
    this.platform = platform;
  }

  /** NO-OP documenté : aucune session à ouvrir (pas d'API partenaire accessible ici). */
  async authenticate(ctx: DeployContext): Promise<void> {
    await this.log(
      ctx,
      'info',
      `${this.platform} : authentification non applicable (export manuel, aucune API publique) — no-op`,
      4,
    );
  }

  /**
   * NO-OP documenté : « créer le cours » côté plateforme se fait dans le
   * Partner Studio de Coursera/edX, hors de portée de cet adapter. On renvoie
   * un identifiant local stable (courseId) pour que le flow générique du
   * processor puisse continuer sans branche spéciale.
   */
  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    const id = String((ctx.course as { _id?: unknown })._id ?? 'course');
    await this.log(
      ctx,
      'info',
      `${this.platform} : création de cours non applicable (candidature partenaire requise) — no-op`,
      15,
    );
    return { externalId: id };
  }

  /** NO-OP documenté : le contenu est empaqueté en une fois dans submitForReview. */
  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    await this.log(
      ctx,
      'info',
      `${this.platform} : leçon ${index + 1} (« ${lesson.title} ») incluse dans l'export Common Cartridge — no-op`,
    );
  }

  /** NO-OP documenté : la page de présentation se configure manuellement dans le Studio partenaire. */
  async setLandingPage(ctx: DeployContext): Promise<void> {
    await this.log(
      ctx,
      'info',
      `${this.platform} : page de présentation non applicable (à renseigner manuellement dans le Studio partenaire) — no-op`,
      80,
    );
  }

  /**
   * Étape utile : construit l'export Common Cartridge (.imscc) et l'archive
   * dans le stockage. C'est ICI que le vrai travail a lieu, faute d'API de
   * revue/publication réelle sur ces plateformes.
   */
  async submitForReview(ctx: DeployContext): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');

    const quizzesBySection = new Map<string, CartridgeQuizQuestion[]>();
    await this.guardMock(
      ctx,
      async () => {
        const quizzes = await Quiz.find({ courseId: (ctx.course as { _id?: unknown })._id }).lean();
        for (const quiz of quizzes) {
          const sid = String(quiz.sectionId);
          const bucket = quizzesBySection.get(sid) ?? [];
          for (const q of quiz.questions) {
            bucket.push({
              question: q.question,
              choices: [...q.choices],
              correctIndex: q.correctIndex,
              explanation: q.explanation,
            });
          }
          quizzesBySection.set(sid, bucket);
        }
      },
      async () => undefined,
    );

    const model: CartridgeCourseModel = {
      courseId,
      title: ctx.course.title,
      locale: ctx.course.locale,
      sections: ctx.sections.map((s) => ({
        id: String((s as { _id?: unknown })._id ?? ''),
        order: s.order,
        title: s.title,
      })),
      lessons: ctx.lessons,
      quizzesBySection,
    };

    const source: CartridgeSource = {
      async readArticle(lesson: ILesson): Promise<string | null> {
        return ctx.mock ? '# Article\n\nContenu simulé.' : readArticleMarkdown(lesson);
      },
      async videoKey(lesson: ILesson, sectionOrder: number): Promise<string | null> {
        if (lesson.type !== 'video') return null;
        return storageKeys.course(courseId).lesson(sectionOrder, lesson.order).video();
      },
    };

    const items = await buildCartridgeItems(model, source);

    const result = await this.guardMock(
      ctx,
      async () => {
        const pack = await buildCommonCartridge(model, items, async (sourceKey) =>
          readObjectBuffer(sourceKey),
        );
        const key = storageKeys.course(courseId).exportFile(COMMON_CARTRIDGE_FILENAME);
        await uploadObject(key, pack.buffer, 'application/zip');
        return { key, ...pack };
      },
      async () => {
        const pack = await buildCommonCartridge(model, items, async () => null);
        const key = storageKeys.course(courseId).exportFile(COMMON_CARTRIDGE_FILENAME);
        return { key, ...pack };
      },
    );

    await this.log(
      ctx,
      'info',
      `${this.platform} : export Common Cartridge généré (${result.items} item(s), ${result.assets} asset(s)) — ${result.key} — importez-le manuellement via le Studio partenaire (voir docs/COURSERA-EDX-IMPORT-GUIDE.md)`,
      92,
    );
  }

  /**
   * Toujours « published » une fois l'export généré : il n'existe pas
   * d'état de revue réel à interroger (pas d'API). `externalUrl` reste
   * undefined — le cours n'a pas d'URL publique tant que le partenaire
   * ne l'a pas importé et publié lui-même dans son propre LMS.
   */
  async getStatus(_ctx: DeployContext): Promise<DeployStatus> {
    return { status: 'published', externalUrl: undefined, reviewState: 'export_ready' };
  }
}

registerAdapter(new CourseraEdxAdapter(COURSERA_PLATFORM));
registerAdapter(new CourseraEdxAdapter(EDX_PLATFORM));
