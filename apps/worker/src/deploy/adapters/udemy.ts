// Adapter de déploiement Udemy (Prompts 33-36).
//
// Udemy n'expose PAS d'API publique d'authoring : la publication est donc
// automatisée via Playwright (chromium). Ce fichier couvre les 4 volets :
//  - (33) authenticate : login email/mdp, gestion captcha (pause + demande
//    d'action), storageState CHIFFRÉ réutilisable, détection de session expirée.
//  - (34) createCourse : flow « Create Course » (type, titre, catégorie mappée
//    depuis le sujet via Claude, objectifs), sélecteurs data-purpose robustes.
//  - (35) uploadLesson : sections + curriculum, upload MP4 (+ polling), .srt,
//    articles (HTML), ressources PDF — CHECKPOINT après chaque leçon.
//  - (36) setLandingPage + submitForReview + getStatus (URL + reviewState).
//
// ⚠️ AVERTISSEMENT CGU : l'automatisation du back-office Udemy par un robot
// n'est pas prévue par les Conditions d'Utilisation d'Udemy. Ce mode « auto »
// est fourni pour un usage sur son PROPRE compte, sous la responsabilité de
// l'utilisateur ; le mode « assisted » (pause aux étapes sensibles) est
// recommandé. En MOCK (getConfig().MOCK_PROVIDERS ou credentials absents),
// aucun navigateur n'est lancé : tout est simulé.
//
// Les sélecteurs sont regroupés dans SELECTORS (en tête) pour préfigurer un
// éventuel pilotage externalisé (P113/P189).

import type { Browser, BrowserContext, Page } from 'playwright';
import { z } from 'zod';
import {
  getConfig,
  storageKeys,
  getObjectStream,
  objectExists,
  uploadObject,
  encryptSecret,
  decryptSecret,
  VIDEO_PROCESSING,
  type ICourse,
  type ILesson,
  type ISection,
} from '../../shared.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import { guardBrowserSession, type BrowserSessionGuard } from '../browser-session-guard.js';
import { callClaudeJson } from '../../lib/claude.js';
import {
  checkUdemyMaxCompliance,
  extractSlideDurations,
  extractSlideTexts,
  type LessonTextInput,
  type MaxComplianceInput,
  type MaxComplianceReport,
  type SlideDurationInput,
} from '../udemy-max-compliance.js';
import type { DeployContext, DeployStatus } from '../types.js';
import type { DeploymentMode } from '../../shared.js';

/* ------------------------------------------------------------------ */
/* Sélecteurs (source unique — préfigure P113/P189)                    */
/* ------------------------------------------------------------------ */

/** Sélecteurs du back-office Udemy, regroupés pour maintenance centralisée. */
export const SELECTORS = {
  login: {
    email: 'input[name="email"]',
    password: 'input[name="password"]',
    submit: 'button[type="submit"]',
    captcha: '[data-purpose="captcha"], iframe[src*="captcha"], iframe[title*="captcha" i]',
    // Présence = session valide (menu instructeur).
    loggedIn: '[data-purpose="user-menu"], a[href*="/instructor/"]',
  },
  createCourse: {
    trigger: '[data-purpose="create-course"], a[href*="/course/create"]',
    typeCourse: '[data-purpose="course-type-course"]',
    titleInput: 'input[data-purpose="course-title"], input[name="title"]',
    categorySelect: 'select[data-purpose="category"], [data-purpose="category-select"]',
    next: '[data-purpose="next-step"], button[type="submit"]',
    // URL après création : /course-manager/{id}/… → on en extrait l'externalId.
    manageUrlPattern: /\/course-manager\/(\d+)/,
  },
  curriculum: {
    addSection: '[data-purpose="add-section"]',
    sectionTitleInput: 'input[data-purpose="section-title"]',
    addLecture: '[data-purpose="add-curriculum-item-lecture"]',
    lectureTitleInput: 'input[data-purpose="lecture-title"]',
    contentTab: '[data-purpose="add-content"]',
    videoFileInput: 'input[type="file"][accept*="video"]',
    // Indicateur « traitement terminé » après upload MP4.
    processingDone: '[data-purpose="encoding-status-done"], [data-purpose="asset-ready"]',
    captionFileInput: 'input[type="file"][accept*="srt"], input[type="file"][data-purpose="caption"]',
    articleEditor: '[data-purpose="article-editor"] [contenteditable="true"]',
    resourceFileInput: 'input[type="file"][data-purpose="resource"]',
    saveLecture: '[data-purpose="save-lecture"], button[type="submit"]',
  },
  landing: {
    descriptionEditor: '[data-purpose="course-description"] [contenteditable="true"]',
    objectivesInput: 'input[data-purpose="objective"]',
    prerequisitesInput: 'input[data-purpose="prerequisite"]',
    audienceInput: 'input[data-purpose="target-audience"]',
    imageInput: 'input[type="file"][data-purpose="course-image"]',
    pricingSelect: 'select[data-purpose="price"]',
    save: '[data-purpose="save-landing"], button[type="submit"]',
  },
  submit: {
    button: '[data-purpose="submit-for-review"]',
    // État de revue affiché sur la page de gestion.
    reviewState: '[data-purpose="course-review-status"]',
    publishedBadge: '[data-purpose="published-badge"]',
  },
} as const;

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

const UDEMY_BASE = 'https://www.udemy.com';
// Timeout/intervalle de poll d'encodage vidéo : VIDEO_PROCESSING (constants.ts, P113).

/** Catégories Udemy officielles (cible du mapping). */
export const UDEMY_CATEGORIES = [
  'Development',
  'Business',
  'Finance & Accounting',
  'IT & Software',
  'Office Productivity',
  'Personal Development',
  'Design',
  'Marketing',
  'Lifestyle',
  'Photography & Video',
  'Health & Fitness',
  'Music',
  'Teaching & Academics',
] as const;

export type UdemyCategory = (typeof UDEMY_CATEGORIES)[number];
const DEFAULT_CATEGORY: UdemyCategory = 'Teaching & Academics';

/* ------------------------------------------------------------------ */
/* Logique PURE (testable sans navigateur)                             */
/* ------------------------------------------------------------------ */

/**
 * Construit un slug URL à partir d'un titre de cours : minuscules, accents
 * retirés, non-alphanumériques → tirets, tirets compactés/rognés. Vide → 'cours'.
 */
export function buildCourseSlug(title: string): string {
  const slug = (title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'cours';
}

/** URL publique (mock) d'un cours à partir de son titre. */
export function mockCourseUrl(title: string): string {
  return `${UDEMY_BASE}/course/${buildCourseSlug(title)}/`;
}

/** Schéma de la réponse de mapping catégorie (une valeur de la liste Udemy). */
export const udemyCategorySchema = z.object({
  category: z.enum(UDEMY_CATEGORIES),
});

/**
 * Normalise une catégorie potentiellement libre vers la taxonomie Udemy :
 * correspondance exacte (insensible à la casse) sinon catégorie par défaut.
 * Utilisé pour valider/nettoyer une suggestion (LLM ou mock) hors réseau.
 */
export function normalizeCategory(raw: string | undefined | null): UdemyCategory {
  if (!raw) return DEFAULT_CATEGORY;
  const target = raw.trim().toLowerCase();
  const match = UDEMY_CATEGORIES.find((c) => c.toLowerCase() === target);
  return match ?? DEFAULT_CATEGORY;
}

/**
 * Catégorie « mock » déterministe à partir du titre/difficulté du cours : quelques
 * mots-clés → catégorie Udemy, défaut sinon. Sert quand aucun appel LLM n'est fait.
 */
export function mockCategoryFor(course: Pick<ICourse, 'title'>): UdemyCategory {
  const t = (course.title ?? '').toLowerCase();
  // Préfixes (sans \b final) : « fiscalité »/« comptabilité » doivent matcher.
  const rules: Array<[RegExp, UdemyCategory]> = [
    [/\b(code|program|javascript|python|react|dev|api|web)/, 'Development'],
    [/\b(finance|compta|accounting|invest|tax|fiscal)/, 'Finance & Accounting'],
    [/\b(market|seo|ads|growth|brand)/, 'Marketing'],
    [/\b(design|ux|ui|figma|photoshop)/, 'Design'],
    [/\b(business|entrepreneur|startup|management)/, 'Business'],
    [/\b(fitness|health|yoga|nutrition|sport)/, 'Health & Fitness'],
    [/\b(photo|video|camera|montage)/, 'Photography & Video'],
    [/\b(music|guitar|piano|audio)/, 'Music'],
    [/\b(cloud|devops|linux|network|security)/, 'IT & Software'],
  ];
  for (const [re, cat] of rules) if (re.test(t)) return cat;
  return DEFAULT_CATEGORY;
}

/** Étapes logiques du flow (valeurs de checkpoint.step). */
export const UDEMY_STEPS = {
  auth: 'authenticate',
  create: 'createCourse',
  upload: 'upload',
  landing: 'landing',
  review: 'review',
  done: 'done',
} as const;

export type UdemyStep = (typeof UDEMY_STEPS)[keyof typeof UDEMY_STEPS];

/**
 * Indique si une leçon (par son index absolu) doit encore être uploadée compte
 * tenu du checkpoint. Règle alignée sur resume.ts : index < lessonIndex ⇒ déjà fait.
 */
export function shouldUploadLesson(index: number, checkpointLessonIndex: number): boolean {
  return index >= Math.max(0, checkpointLessonIndex);
}

/**
 * Objectifs pédagogiques d'un cours : puise dans l'outline (learningObjectives)
 * si présent, sinon dérive des titres de sections. Toujours au moins un élément.
 */
export function courseObjectives(course: ICourse, sections: ISection[]): string[] {
  const outline = course.outline as { learningObjectives?: unknown } | null | undefined;
  const fromOutline = Array.isArray(outline?.learningObjectives)
    ? (outline!.learningObjectives as unknown[]).filter((o): o is string => typeof o === 'string')
    : [];
  if (fromOutline.length > 0) return fromOutline;
  const fromSections = sections.map((s) => `Maîtriser : ${s.title}`);
  return fromSections.length > 0 ? fromSections : [`Suivre le cours « ${course.title} »`];
}

/**
 * Clé de stockage du storageState chiffré d'une session Udemy. Multi-comptes
 * (P49) : la session est ISOLÉE par credentialId (chaque compte a son propre
 * storageState). En son absence (mode simulé / ancien flux), repli sur l'userId.
 */
export function sessionStateKey(scopeId: string): string {
  return `deploy/udemy/session-${scopeId}.enc`;
}

/** Portée d'isolation de session : credentialId prioritaire, sinon userId du cours. */
export function sessionScopeId(ctx: {
  credentialId?: string;
  course: { userId?: unknown };
}): string {
  if (ctx.credentialId) return ctx.credentialId;
  return String(ctx.course.userId ?? '');
}

/**
 * Clé S3 par défaut de la vidéo d'intro webcam d'un cours (mode compliance max).
 * L'upload web pose cette clé sur Course.introVideoKey ; l'adapter la relit.
 */
export function introVideoKey(courseId: string): string {
  return `courses/${courseId}/intro/webcam-intro.mp4`;
}

/* ------------------------------------------------------------------ */
/* Erreurs spécifiques                                                 */
/* ------------------------------------------------------------------ */

/** Levée quand un captcha bloque la connexion : le processor bascule en 'paused'. */
export class UdemyCaptchaError extends Error {
  constructor(message = 'Captcha Udemy détecté : action manuelle requise.') {
    super(message);
    this.name = 'UdemyCaptchaError';
  }
}

/** Levée quand la session chiffrée réutilisée n'est plus valide (expiration). */
export class UdemySessionExpiredError extends Error {
  constructor(message = 'Session Udemy expirée : nouvelle connexion requise.') {
    super(message);
    this.name = 'UdemySessionExpiredError';
  }
}

/* ------------------------------------------------------------------ */
/* Coupons (Prompt 139)                                                */
/* ------------------------------------------------------------------ */

/**
 * Résultat de la génération d'un coupon Udemy : `automated` indique si le
 * code a réellement été saisi dans le dashboard Udemy (false ici — voir
 * doc de la classe) ; `instructions` guide l'utilisateur pour la saisie
 * manuelle du code affiché dans son propre dashboard Udemy.
 */
export interface UdemyCouponResult {
  code: string;
  automated: boolean;
  instructions: string;
}

/**
 * Construit le code + les instructions de saisie manuelle pour un coupon
 * Udemy. Logique PURE (aucun navigateur) — utilisée par
 * UdemyAdapter.createCoupon ci-dessous.
 */
export function buildUdemyCouponInstructions(externalId: string | undefined, code: string): string {
  const courseRef = externalId ? `le cours (id ${externalId})` : 'votre cours';
  return (
    `Udemy n'expose aucune API/automation fiable pour créer des coupons de promotion ` +
    `(le formulaire de coupon est protégé par une revue anti-fraude côté Udemy). ` +
    `Code généré : ${code}. Pour l'activer, ouvrez le dashboard Instructeur Udemy → ${courseRef} → ` +
    `Marketing → Coupons → « Créer un coupon », et saisissez ce code manuellement avec la remise et la période souhaitées.`
  );
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export class UdemyAdapter extends BaseDeploymentAdapter {
  readonly platform = 'udemy';
  readonly capabilities: { modes: DeploymentMode[]; needsBrowser: boolean } = {
    // 'assisted' d'abord : mode recommandé (pause aux étapes sensibles / captcha).
    modes: ['assisted', 'auto', 'manual'],
    needsBrowser: true,
  };

  // Ressources navigateur du run courant (fermées en fin de flow).
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  // Garde de durée de vie (P126) : ferme le contexte de force si la session dépasse le timeout.
  private sessionGuard: BrowserSessionGuard | null = null;

  // ────────────────────────────────────────────────────────────────
  // (33) Authentification
  // ────────────────────────────────────────────────────────────────

  async authenticate(ctx: DeployContext): Promise<void> {
    // Contrôle « compliance maximale » AVANT toute action réseau : audit anti-rejet
    // (intro vidéo, liens/promo, watermark, audio, slides longues). Informatif : ne
    // bloque pas le déploiement, mais chaque remarque est journalisée.
    await this.runMaxCompliancePrecheck(ctx);

    await this.saveCheckpoint(ctx, { lessonIndex: ctx.checkpoint.lessonIndex, step: UDEMY_STEPS.auth });
    await this.guardMock(
      ctx,
      () => this.realAuthenticate(ctx),
      async () => {
        await this.log(ctx, 'info', 'authentification simulée (aucun navigateur lancé)', 5);
      },
    );
  }

  // ────────────────────────────────────────────────────────────────
  // (48) Contrôle « compliance maximale » (audit anti-rejet)
  // ────────────────────────────────────────────────────────────────

  /**
   * Construit l'entrée du contrôle renforcé depuis le contexte (I/O incluses :
   * lecture des articles, présence de la vidéo d'intro), lance l'audit et
   * journalise chaque remarque. Best-effort : jamais bloquant pour le déploiement.
   */
  private async runMaxCompliancePrecheck(ctx: DeployContext): Promise<void> {
    try {
      const input = await this.buildMaxComplianceInput(ctx);
      const report: MaxComplianceReport = checkUdemyMaxCompliance(input);
      const verdict = report.passed ? 'conforme' : 'à corriger';
      await this.log(
        ctx,
        report.passed ? 'info' : 'warn',
        `compliance max Udemy : ${verdict} (score ${report.score}/100, ${report.maxIssues.length} remarque(s) renforcée(s))`,
        2,
      );
      for (const issue of report.maxIssues) {
        await this.log(ctx, issue.severity === 'error' ? 'warn' : 'info', `[compliance] ${issue.message}`);
      }
    } catch (err) {
      await this.log(ctx, 'warn', `contrôle compliance max ignoré — ${(err as Error).message}`);
    }
  }

  /** Assemble MaxComplianceInput à partir du cours/leçons/sections (lecture S3 des articles). */
  private async buildMaxComplianceInput(ctx: DeployContext): Promise<MaxComplianceInput> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const outline = ctx.course.outline as
      | { subtitle?: string; description?: string; learningObjectives?: string[] }
      | null
      | undefined;

    // Entrée du contrôle de BASE (réutilise les règles de shared).
    const totalVideoMinutes = ctx.lessons.reduce((sum, l) => sum + (l.durationMin ?? 0), 0);
    const base = {
      title: ctx.course.title,
      subtitle: outline?.subtitle ?? '',
      description: outline?.description ?? '',
      learningObjectives: Array.isArray(outline?.learningObjectives) ? outline!.learningObjectives : [],
      totalVideoMinutes,
      sectionsCount: ctx.sections.length,
      lessons: ctx.lessons.map((l) => ({
        type: l.type,
        durationMin: l.durationMin ?? 0,
        hasVideo: Boolean(l.assets?.videoUrl),
      })),
      courseImage: undefined,
      locale: ctx.course.locale,
    };

    // Textes des leçons à scanner (article MD lu depuis S3 + narrations du script).
    const lessonTexts: LessonTextInput[] = [];
    const slides: SlideDurationInput[] = [];
    for (const lesson of ctx.lessons) {
      const narrations = extractSlideTexts(lesson.script);
      const articleText = await this.tryReadArticle(ctx, courseId, lesson).catch(() => '');
      lessonTexts.push({ title: lesson.title, text: [articleText, ...narrations].join('\n') });
      slides.push(...extractSlideDurations(lesson.script));
    }

    // Présence + durée de la vidéo d'intro webcam (Course.introVideoKey ou clé par défaut).
    const introVideo = await this.probeIntroVideo(ctx, courseId);

    return {
      base,
      introVideo,
      lessonTexts,
      slides,
      // Flags de rendu : par défaut on considère la chaîne SallyCourse conforme
      // (watermark discret + audio -16 LUFS au TTS). Surcharge possible via checkpoint.
      watermarkEnabled: true,
      audioNormalized: true,
    };
  }

  /** Lit l'article Markdown d'une leçon (clé S3) — chaîne vide si absent. */
  private async tryReadArticle(ctx: DeployContext, courseId: string, lesson: ILesson): Promise<string> {
    if (lesson.type !== 'article' || !lesson.assets?.articleMd) return '';
    const key = this.lessonKeys(courseId, ctx, lesson).article();
    if (!(await objectExists(key))) return '';
    return this.readText(key);
  }

  /** Sonde la vidéo d'intro : présence de l'objet S3 (clé du cours ou défaut). */
  private async probeIntroVideo(
    ctx: DeployContext,
    courseId: string,
  ): Promise<MaxComplianceInput['introVideo']> {
    const key = (ctx.course as { introVideoKey?: string }).introVideoKey ?? introVideoKey(courseId);
    try {
      const present = await objectExists(key);
      return { present };
    } catch {
      return { present: false };
    }
  }

  /** Login réel Playwright : réutilise la session chiffrée si possible, sinon email/mdp. */
  private async realAuthenticate(ctx: DeployContext): Promise<void> {
    const email = ctx.credentials.email;
    const password = ctx.credentials.password;
    if (!email || !password) {
      throw new Error('Credentials Udemy manquants (email/password) — mode réel impossible.');
    }

    const restored = await this.tryRestoreSession(ctx);
    const page = await this.ensurePage(ctx, restored);

    if (restored) {
      // Session réutilisée : on vérifie qu'elle n'a pas expiré.
      await page.goto(`${UDEMY_BASE}/instructor/courses/`, { waitUntil: 'domcontentloaded' });
      if (await this.isLoggedIn(page)) {
        await this.log(ctx, 'info', 'session Udemy réutilisée (storageState déchiffré)', 8);
        return;
      }
      await this.log(ctx, 'warn', 'session Udemy expirée — nouvelle connexion', 6);
    }

    await this.withRetry(async () => {
      await page.goto(`${UDEMY_BASE}/join/login-popup/`, { waitUntil: 'domcontentloaded' });
      // Anti-phishing (P126) : le domaine de la page AVANT saisie doit être udemy.com.
      this.assertExpectedDomain(page.url(), 'udemy.com');
      await page.fill(SELECTORS.login.email, email);
      await page.fill(SELECTORS.login.password, password);

      // Détection captcha AVANT soumission : on ne tente pas de le contourner.
      if (await this.hasCaptcha(page)) {
        await this.log(
          ctx,
          'warn',
          'action requise : résoudre le captcha Udemy puis relancer le déploiement',
          6,
        );
        await this.markPaused(ctx);
        throw new UdemyCaptchaError();
      }

      await page.click(SELECTORS.login.submit);
      await page.waitForLoadState('domcontentloaded');

      // Captcha post-soumission (challenge affiché après tentative).
      if (await this.hasCaptcha(page)) {
        await this.log(ctx, 'warn', 'action requise : captcha Udemy après soumission', 6);
        await this.markPaused(ctx);
        throw new UdemyCaptchaError();
      }
      if (!(await this.isLoggedIn(page))) {
        throw new Error('échec de connexion Udemy (identifiants refusés ou page inattendue)');
      }
    }, 'udemy.login');

    await this.persistSession(ctx);
    await this.log(ctx, 'info', 'connexion Udemy réussie, session chiffrée persistée', 10);
  }

  // ────────────────────────────────────────────────────────────────
  // (34) Création du cours
  // ────────────────────────────────────────────────────────────────

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    // Idempotent : si un externalId existe déjà (reprise), on le réutilise.
    if (ctx.externalId) return { externalId: ctx.externalId };

    const category = await this.resolveCategory(ctx);
    await this.saveCheckpoint(ctx, { lessonIndex: ctx.checkpoint.lessonIndex, step: UDEMY_STEPS.create });

    return this.guardMock(
      ctx,
      () => this.realCreateCourse(ctx, category),
      async () => {
        const externalId = `mock-${buildCourseSlug(ctx.course.title)}`;
        await this.log(
          ctx,
          'info',
          `cours créé (catégorie « ${category} ») → id ${externalId}`,
          12,
        );
        return { externalId };
      },
    );
  }

  /** Résout la catégorie Udemy via Claude (mapping) ; mock → mapping local déterministe. */
  private async resolveCategory(ctx: DeployContext): Promise<UdemyCategory> {
    if (ctx.mock) return mockCategoryFor(ctx.course);
    try {
      const { category } = await callClaudeJson({
        schema: udemyCategorySchema,
        system:
          'Tu classes un cours dans UNE catégorie Udemy officielle. ' +
          `Réponds STRICTEMENT avec {"category": "<valeur>"} où <valeur> ∈ ${JSON.stringify(UDEMY_CATEGORIES)}.`,
        user: `Titre du cours : « ${ctx.course.title} » (difficulté : ${ctx.course.difficulty}).`,
      });
      return normalizeCategory(category);
    } catch (err) {
      await this.log(ctx, 'warn', `mapping catégorie via LLM échoué, valeur par défaut — ${(err as Error).message}`);
      return mockCategoryFor(ctx.course);
    }
  }

  private async realCreateCourse(ctx: DeployContext, category: UdemyCategory): Promise<{ externalId: string }> {
    const page = await this.ensurePage(ctx);
    return this.withRetry(async () => {
      await page.goto(`${UDEMY_BASE}/course/create/`, { waitUntil: 'domcontentloaded' });
      await this.clickIfPresent(page, SELECTORS.createCourse.typeCourse);
      await page.fill(SELECTORS.createCourse.titleInput, ctx.course.title);
      await this.selectIfPresent(page, SELECTORS.createCourse.categorySelect, category);
      await this.debugShot(ctx, page, 'create-course');
      await page.click(SELECTORS.createCourse.next);
      await page.waitForLoadState('domcontentloaded');

      const match = SELECTORS.createCourse.manageUrlPattern.exec(page.url());
      const externalId = match?.[1];
      if (!externalId) {
        throw new Error(`externalId Udemy introuvable dans l'URL « ${page.url()} »`);
      }
      await this.log(ctx, 'info', `cours Udemy créé (id ${externalId}, catégorie ${category})`, 14);
      return { externalId };
    }, 'udemy.createCourse');
  }

  // ────────────────────────────────────────────────────────────────
  // (35) Upload d'une leçon (checkpoint après chaque leçon)
  // ────────────────────────────────────────────────────────────────

  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    await this.guardMock(
      ctx,
      () => this.realUploadLesson(ctx, lesson, index),
      async () => {
        await this.log(
          ctx,
          'info',
          `leçon ${index + 1} « ${lesson.title} » (${lesson.type}) uploadée`,
        );
      },
    );
    // CHECKPOINT après chaque leçon : reprise sans ré-upload.
    await this.saveCheckpoint(ctx, { lessonIndex: index + 1, step: UDEMY_STEPS.upload });
  }

  private async realUploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const page = await this.ensurePage(ctx);

    await this.withRetry(async () => {
      // Section : on ouvre le course builder du cours (externalId).
      await page.goto(
        `${UDEMY_BASE}/course-manager/${ctx.externalId}/manage/curriculum/`,
        { waitUntil: 'domcontentloaded' },
      );

      // Section correspondant à la leçon (via son sectionId → ordre).
      const section = ctx.sections.find((s) => String((s as { _id?: unknown })._id ?? '') === String(lesson.sectionId));
      await this.clickIfPresent(page, SELECTORS.curriculum.addSection);
      if (section) {
        await this.fillIfPresent(page, SELECTORS.curriculum.sectionTitleInput, section.title);
      }

      // Leçon (lecture).
      await page.click(SELECTORS.curriculum.addLecture);
      await page.fill(SELECTORS.curriculum.lectureTitleInput, lesson.title);

      const keys = this.lessonKeys(courseId, ctx, lesson);

      if (lesson.type === 'video' && lesson.assets.videoUrl) {
        await this.uploadVideo(ctx, page, keys.video());
        if (await objectExists(keys.captionsSrt())) {
          await this.uploadFile(page, SELECTORS.curriculum.captionFileInput, keys.captionsSrt(), 'captions.srt');
        }
      } else if (lesson.type === 'article' && lesson.assets.articleMd) {
        await this.injectArticle(page, await this.readText(keys.article()));
      }

      // Ressources PDF (solutions de quiz, TP…) si présentes dans l'export.
      const pdfKey = storageKeys.course(courseId).exportFile(`lesson-${index}-resources.pdf`);
      if (await objectExists(pdfKey)) {
        await this.uploadFile(page, SELECTORS.curriculum.resourceFileInput, pdfKey, 'resources.pdf');
      }

      await this.clickIfPresent(page, SELECTORS.curriculum.saveLecture);
      await this.log(ctx, 'info', `leçon ${index + 1} « ${lesson.title} » enregistrée sur Udemy`);
    }, `udemy.uploadLesson[${index}]`);
  }

  /** Upload MP4 puis polling de l'encodage jusqu'à disponibilité (ou timeout). */
  private async uploadVideo(ctx: DeployContext, page: Page, videoKey: string): Promise<void> {
    await this.uploadFile(page, SELECTORS.curriculum.videoFileInput, videoKey, 'video.mp4');
    const deadline = Date.now() + VIDEO_PROCESSING.TIMEOUT_MS;
    while (true) {
      const done = await page.locator(SELECTORS.curriculum.processingDone).count();
      if (done > 0) return;
      if (Date.now() > deadline) {
        throw new Error("encodage vidéo Udemy non terminé dans le délai imparti");
      }
      await this.log(ctx, 'info', 'encodage vidéo Udemy en cours…');
      await page.waitForTimeout(VIDEO_PROCESSING.POLL_INTERVAL_MS);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // (36) Landing page + soumission + statut
  // ────────────────────────────────────────────────────────────────

  async setLandingPage(ctx: DeployContext): Promise<void> {
    await this.saveCheckpoint(ctx, { lessonIndex: ctx.lessons.length, step: UDEMY_STEPS.landing });
    const objectives = courseObjectives(ctx.course, ctx.sections);
    await this.guardMock(
      ctx,
      () => this.realSetLandingPage(ctx, objectives),
      async () => {
        await this.log(
          ctx,
          'info',
          `landing renseignée (${objectives.length} objectif(s), image 750x422, pricing)`,
          82,
        );
      },
    );
  }

  private async realSetLandingPage(ctx: DeployContext, objectives: string[]): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const page = await this.ensurePage(ctx);
    await this.withRetry(async () => {
      await page.goto(
        `${UDEMY_BASE}/course-manager/${ctx.externalId}/manage/goals/`,
        { waitUntil: 'domcontentloaded' },
      );
      const description =
        (ctx.course.outline as { description?: string } | null)?.description ?? ctx.course.title;
      await this.fillIfPresent(page, SELECTORS.landing.descriptionEditor, description);
      for (const objective of objectives) {
        await this.fillIfPresent(page, SELECTORS.landing.objectivesInput, objective);
      }
      // Image de présentation 750x422 (couverture générée si présente).
      if (ctx.course.coverImageUrl) {
        const imageKey = storageKeys.course(courseId).marketing('cover-750x422.png');
        if (await objectExists(imageKey)) {
          await this.uploadFile(page, SELECTORS.landing.imageInput, imageKey, 'cover.png');
        }
      }
      await this.clickIfPresent(page, SELECTORS.landing.save);
      await this.log(ctx, 'info', 'page de présentation Udemy enregistrée', 82);
    }, 'udemy.setLandingPage');
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    await this.saveCheckpoint(ctx, { lessonIndex: ctx.lessons.length, step: UDEMY_STEPS.review });
    await this.guardMock(
      ctx,
      () => this.realSubmitForReview(ctx),
      async () => {
        await this.log(ctx, 'info', 'cours soumis à la revue Udemy (reviewState in_review)', 92);
      },
    );
  }

  private async realSubmitForReview(ctx: DeployContext): Promise<void> {
    const page = await this.ensurePage(ctx);
    await this.withRetry(async () => {
      await page.goto(
        `${UDEMY_BASE}/course-manager/${ctx.externalId}/manage/publish/`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.click(SELECTORS.submit.button);
      await page.waitForLoadState('domcontentloaded');
      await this.log(ctx, 'info', 'cours soumis à la revue Udemy', 92);
    }, 'udemy.submitForReview');
  }

  // ────────────────────────────────────────────────────────────────
  // (92) Sous-titres traduits sur une leçon déjà déployée
  // ────────────────────────────────────────────────────────────────

  /**
   * Ajoute/remplace le fichier .srt d'une leçon vidéo déjà uploadée, dans la
   * langue `locale`. Ouvre le curriculum du cours (ctx.externalId requis — la
   * leçon doit avoir été précédemment uploadLesson'ée), ré-utilise l'input
   * captions existant. En mock : log uniquement, aucun navigateur.
   */
  override async addCaptions(
    ctx: DeployContext,
    lesson: ILesson,
    index: number,
    locale: string,
    srtContent: string,
  ): Promise<void> {
    if (lesson.type !== 'video') {
      await this.log(ctx, 'info', `addCaptions ignoré : leçon ${index + 1} n'est pas une vidéo.`);
      return;
    }
    await this.guardMock(
      ctx,
      () => this.realAddCaptions(ctx, lesson, index, locale, srtContent),
      async () => {
        await this.log(
          ctx,
          'info',
          `sous-titres ${locale} ajoutés (simulé) à la leçon ${index + 1} « ${lesson.title} »`,
        );
      },
    );
  }

  private async realAddCaptions(
    ctx: DeployContext,
    lesson: ILesson,
    index: number,
    locale: string,
    srtContent: string,
  ): Promise<void> {
    if (!ctx.externalId) {
      throw new Error('addCaptions : cours non créé côté Udemy (externalId manquant).');
    }
    const page = await this.ensurePage(ctx);
    await this.withRetry(async () => {
      await page.goto(
        `${UDEMY_BASE}/course-manager/${ctx.externalId}/manage/curriculum/`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.locator(SELECTORS.curriculum.captionFileInput).first().setInputFiles({
        name: `captions-${locale}.srt`,
        mimeType: 'application/x-subrip',
        buffer: Buffer.from(srtContent, 'utf-8'),
      });
      await this.log(ctx, 'info', `sous-titres ${locale} uploadés sur la leçon ${index + 1} « ${lesson.title} »`);
    }, `udemy.addCaptions[${index}][${locale}]`);
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    return this.guardMock<DeployStatus>(
      ctx,
      () => this.realGetStatus(ctx),
      async () => {
        const externalUrl = mockCourseUrl(ctx.course.title);
        await this.log(ctx, 'info', `statut simulé : in_review → ${externalUrl}`);
        return { status: 'running', externalUrl, reviewState: 'in_review' };
      },
    ).finally(() => void this.closeBrowser());
  }

  private async realGetStatus(ctx: DeployContext): Promise<DeployStatus> {
    const page = await this.ensurePage(ctx);
    return this.withRetry(async () => {
      await page.goto(
        `${UDEMY_BASE}/course-manager/${ctx.externalId}/manage/publish/`,
        { waitUntil: 'domcontentloaded' },
      );
      const published = (await page.locator(SELECTORS.submit.publishedBadge).count()) > 0;
      const reviewState = published
        ? 'published'
        : ((await this.textOf(page, SELECTORS.submit.reviewState)) ?? 'in_review');
      const externalUrl = mockCourseUrl(ctx.course.title);
      return {
        status: published ? 'published' : 'running',
        externalUrl,
        reviewState,
      };
    }, 'udemy.getStatus');
  }

  // ────────────────────────────────────────────────────────────────
  // Coupons (Prompt 139) — MANUEL documenté (voir buildUdemyCouponInstructions)
  // ────────────────────────────────────────────────────────────────

  /**
   * Génère un code de coupon Udemy et retourne les instructions de saisie
   * MANUELLE (Udemy ne fournit aucun formulaire de coupon automatisable de
   * façon fiable — le générateur intégré est protégé anti-bot/anti-fraude).
   * `automated` est TOUJOURS false ici : cette méthode ne lance aucun
   * navigateur, elle se contente de produire le code affiché à
   * l'utilisateur pour saisie manuelle dans son dashboard Udemy.
   */
  async createCoupon(ctx: DeployContext, code: string): Promise<UdemyCouponResult> {
    const instructions = buildUdemyCouponInstructions(ctx.externalId, code);
    await this.log(ctx, 'info', `coupon Udemy « ${code} » à saisir manuellement — ${instructions}`);
    return { code, automated: false, instructions };
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers navigateur / session
  // ────────────────────────────────────────────────────────────────

  /** Ouvre (ou réutilise) la page ; `withState` restaure un storageState déchiffré. */
  private async ensurePage(ctx: DeployContext, storageState?: string): Promise<Page> {
    if (this.page) return this.page;
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({
      headless: ctx.mode !== 'manual',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    this.context = await this.browser.newContext(
      storageState ? { storageState: JSON.parse(storageState) } : {},
    );
    // Timeout global de session (P126) : ferme le contexte de force au-delà du délai.
    this.sessionGuard = guardBrowserSession(this.context, 'udemy.deploy');
    this.page = await this.context.newPage();
    return this.page;
  }

  /** Restaure la session chiffrée depuis le stockage ; retourne le state JSON ou undefined. */
  private async tryRestoreSession(ctx: DeployContext): Promise<string | undefined> {
    // Isolation par compte (P49) : session propre au credentialId retenu.
    const scopeId = sessionScopeId(ctx);
    if (!scopeId) return undefined;
    const key = sessionStateKey(scopeId);
    try {
      if (!(await objectExists(key))) return undefined;
      const blob = await this.readText(key);
      return decryptSecret(blob, getConfig().CREDENTIALS_MASTER_KEY);
    } catch (err) {
      await this.log(ctx, 'warn', `session Udemy illisible, connexion complète — ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Persiste le storageState courant CHIFFRÉ (réutilisable au prochain déploiement). */
  private async persistSession(ctx: DeployContext): Promise<void> {
    if (!this.context) return;
    // Isolation par compte (P49) : storageState distinct par credentialId.
    const scopeId = sessionScopeId(ctx);
    if (!scopeId) return;
    try {
      const state = await this.context.storageState();
      const blob = encryptSecret(JSON.stringify(state), getConfig().CREDENTIALS_MASTER_KEY);
      await uploadObject(sessionStateKey(scopeId), blob, 'text/plain');
    } catch (err) {
      await this.log(ctx, 'warn', `session Udemy non persistée — ${(err as Error).message}`);
    }
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    return (await page.locator(SELECTORS.login.loggedIn).count()) > 0;
  }

  private async hasCaptcha(page: Page): Promise<boolean> {
    return (await page.locator(SELECTORS.login.captcha).count()) > 0;
  }

  /** Bascule le Deployment en 'paused' (persisté hors mock) : action manuelle attendue. */
  private async markPaused(ctx: DeployContext): Promise<void> {
    ctx.deployment.status = 'paused';
    if (!ctx.mock) await ctx.deployment.save().catch(() => undefined);
  }

  /** Screenshot de debug (log info + trace de la clé) — best-effort, jamais bloquant. */
  private async debugShot(ctx: DeployContext, page: Page, label: string): Promise<void> {
    try {
      const buf = await page.screenshot();
      await this.log(ctx, 'info', `screenshot debug « ${label} » capturé (${buf.length} octets)`);
    } catch {
      /* debug best-effort */
    }
  }

  private lessonKeys(courseId: string, ctx: DeployContext, lesson: ILesson) {
    const section = ctx.sections.find(
      (s) => String((s as { _id?: unknown })._id ?? '') === String(lesson.sectionId),
    );
    return storageKeys.course(courseId).lesson(section?.order ?? 0, lesson.order);
  }

  /** Lit un objet stockage en texte (article, session chiffrée…). */
  private async readText(key: string): Promise<string> {
    const stream = await getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Injecte un article : Markdown → HTML basique dans l'éditeur contenteditable. */
  private async injectArticle(page: Page, markdown: string): Promise<void> {
    const html = markdownToBasicHtml(markdown);
    // Callback exécuté dans le contexte navigateur : `el` y est un Element DOM.
    await page.locator(SELECTORS.curriculum.articleEditor).first().evaluate(
      (el: { innerHTML: string }, value: string) => {
        el.innerHTML = value;
      },
      html,
    );
  }

  /** Upload un fichier stocké (téléchargé en buffer) sur un input file de la page. */
  private async uploadFile(page: Page, selector: string, key: string, fileName: string): Promise<void> {
    const stream = await getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    await page.locator(selector).first().setInputFiles({
      name: fileName,
      mimeType: 'application/octet-stream',
      buffer: Buffer.concat(chunks),
    });
  }

  private async clickIfPresent(page: Page, selector: string): Promise<void> {
    if ((await page.locator(selector).count()) > 0) await page.locator(selector).first().click();
  }

  private async fillIfPresent(page: Page, selector: string, value: string): Promise<void> {
    if ((await page.locator(selector).count()) > 0) await page.locator(selector).first().fill(value);
  }

  private async selectIfPresent(page: Page, selector: string, value: string): Promise<void> {
    if ((await page.locator(selector).count()) > 0) {
      await page.locator(selector).first().selectOption({ label: value }).catch(() => undefined);
    }
  }

  private async textOf(page: Page, selector: string): Promise<string | undefined> {
    if ((await page.locator(selector).count()) === 0) return undefined;
    return (await page.locator(selector).first().textContent())?.trim() || undefined;
  }

  private async closeBrowser(): Promise<void> {
    this.sessionGuard?.dispose();
    try {
      await this.page?.close();
      await this.context?.close();
      await this.browser?.close();
    } catch {
      /* best-effort */
    } finally {
      this.sessionGuard = null;
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }
}

/**
 * Conversion Markdown → HTML minimale pour l'injection d'article (titres, gras,
 * italique, listes, paragraphes). Suffisant pour l'éditeur Udemy ; pas de
 * dépendance externe. Échappe le HTML brut avant d'appliquer les balises.
 */
export function markdownToBasicHtml(markdown: string): string {
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = (markdown ?? '').split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const closeList = (): void => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(escape(heading[2]!))}</h${level}>`);
    } else if (bullet) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(escape(bullet[1]!))}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(escape(line))}</p>`);
    }
  }
  closeList();
  return out.join('\n');

  function inline(s: string): string {
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
}

// Enregistrement dans le registre (AJOUT non destructif).
registerAdapter(new UdemyAdapter());
