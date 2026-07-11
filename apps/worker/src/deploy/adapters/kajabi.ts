// Adapter de déploiement Kajabi (Prompt 105).
//
// Kajabi n'expose pas d'API publique complète pour la création de produit
// (offering/course) : comme Udemy/Podia, la publication est automatisée via
// Playwright. Ce fichier reprend les patterns d'udemy.ts (SELECTORS en tête,
// storageState CHIFFRÉ par compte, checkpoint après chaque leçon) :
//  - authenticate  : login email/mdp, session réutilisable (storageState).
//  - createCourse  : flow « Create Product » → type « Course ».
//  - uploadLesson  : modules (= sections) + upload vidéo/article, CHECKPOINT
//    après chaque leçon (reprise sans ré-upload).
//  - setLandingPage: page d'offre (titre/description/image de couverture).
//  - submitForReview / getStatus : Kajabi n'a PAS de revue éditoriale — la
//    publication est directe (bascule offre en « live »). documenté ci-dessous.
//
// MOCK-FRIENDLY : en mode simulé (MOCK_PROVIDERS ou credentials absents),
// aucun navigateur n'est lancé — chaque étape est journalisée « [mock] ».

import type { Browser, BrowserContext, Page } from 'playwright';
import {
  getConfig,
  storageKeys,
  getObjectStream,
  objectExists,
  uploadObject,
  encryptSecret,
  decryptSecret,
  VIDEO_PROCESSING,
  type ILesson,
  type ISection,
} from '../../shared.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import { guardBrowserSession, type BrowserSessionGuard } from '../browser-session-guard.js';
import type { DeployContext, DeployStatus } from '../types.js';
import type { DeploymentMode } from '../../shared.js';

/* ------------------------------------------------------------------ */
/* Sélecteurs (source unique — même convention qu'udemy.ts)            */
/* ------------------------------------------------------------------ */

export const SELECTORS = {
  login: {
    email: 'input[name="email"]',
    password: 'input[name="password"]',
    submit: 'button[type="submit"]',
    // Présence = session valide (menu du site admin Kajabi).
    loggedIn: '[data-testid="admin-nav"], a[href*="/admin/"]',
  },
  createProduct: {
    trigger: '[data-testid="create-product"], a[href*="/admin/products/new"]',
    typeCourse: '[data-testid="product-type-course"]',
    titleInput: 'input[data-testid="product-title"], input[name="title"]',
    next: '[data-testid="next-step"], button[type="submit"]',
    // URL après création : /admin/products/{id}/… → externalId.
    manageUrlPattern: /\/admin\/products\/([^/?#]+)/,
  },
  curriculum: {
    addModule: '[data-testid="add-module"]',
    moduleTitleInput: 'input[data-testid="module-title"]',
    addPost: '[data-testid="add-post"]',
    postTitleInput: 'input[data-testid="post-title"]',
    videoFileInput: 'input[type="file"][accept*="video"]',
    processingDone: '[data-testid="encoding-status-done"], [data-testid="asset-ready"]',
    articleEditor: '[data-testid="post-editor"] [contenteditable="true"]',
    savePost: '[data-testid="save-post"], button[type="submit"]',
  },
  offer: {
    descriptionEditor: '[data-testid="offer-description"] [contenteditable="true"]',
    imageInput: 'input[type="file"][data-testid="offer-image"]',
    save: '[data-testid="save-offer"], button[type="submit"]',
  },
  publish: {
    // Kajabi n'a pas de revue : ce bouton bascule directement l'offre en « live ».
    button: '[data-testid="publish-offer"]',
    liveBadge: '[data-testid="offer-live-badge"]',
  },
} as const;

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

const KAJABI_BASE = 'https://app.kajabi.com';
// Timeout/intervalle de poll d'encodage vidéo : VIDEO_PROCESSING (constants.ts, P113).

/* ------------------------------------------------------------------ */
/* Logique PURE (testable sans navigateur)                             */
/* ------------------------------------------------------------------ */

/** Slug URL déterministe (aligné sur udemy.buildCourseSlug). */
export function buildProductSlug(title: string): string {
  const slug = (title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'produit';
}

/** URL publique (mock) d'une offre Kajabi à partir du titre du cours. */
export function mockOfferUrl(title: string): string {
  return `${KAJABI_BASE}/offers/${buildProductSlug(title)}`;
}

/** Étapes logiques du flow (valeurs de checkpoint.step). */
export const KAJABI_STEPS = {
  auth: 'authenticate',
  create: 'createCourse',
  upload: 'upload',
  landing: 'landing',
  review: 'review',
  done: 'done',
} as const;

export type KajabiStep = (typeof KAJABI_STEPS)[keyof typeof KAJABI_STEPS];

/** Indique si une leçon (index absolu) reste à uploader compte tenu du checkpoint. */
export function shouldUploadLesson(index: number, checkpointLessonIndex: number): boolean {
  return index >= Math.max(0, checkpointLessonIndex);
}

/**
 * Regroupe les leçons en structure Kajabi « modules → posts » : un module par
 * section (ordre conservé), un post par leçon. Logique PURE (aucune I/O) —
 * sert de plan avant upload et de base aux tests de mapping.
 */
export interface KajabiModulePlan {
  moduleTitle: string;
  moduleOrder: number;
  posts: Array<{ lessonIndex: number; postTitle: string; type: ILesson['type'] }>;
}

export function buildModulePlan(sections: ISection[], lessons: ILesson[]): KajabiModulePlan[] {
  const sorted = [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return sorted.map((section) => {
    const sectionId = String((section as { _id?: unknown })._id ?? '');
    const posts = lessons
      .map((lesson, idx) => ({ lesson, idx }))
      .filter(({ lesson }) => String(lesson.sectionId ?? '') === sectionId)
      .sort((a, b) => (a.lesson.order ?? 0) - (b.lesson.order ?? 0))
      .map(({ lesson, idx }) => ({ lessonIndex: idx, postTitle: lesson.title, type: lesson.type }));
    return { moduleTitle: section.title, moduleOrder: section.order ?? 0, posts };
  });
}

/** Clé de stockage du storageState chiffré d'une session Kajabi (isolée par compte). */
export function sessionStateKey(scopeId: string): string {
  return `deploy/kajabi/session-${scopeId}.enc`;
}

/** Portée d'isolation de session : credentialId prioritaire, sinon userId du cours. */
export function sessionScopeId(ctx: {
  credentialId?: string;
  course: { userId?: unknown };
}): string {
  if (ctx.credentialId) return ctx.credentialId;
  return String(ctx.course.userId ?? '');
}

/* ------------------------------------------------------------------ */
/* Erreurs spécifiques                                                 */
/* ------------------------------------------------------------------ */

/** Levée quand la session chiffrée réutilisée n'est plus valide (expiration). */
export class KajabiSessionExpiredError extends Error {
  constructor(message = 'Session Kajabi expirée : nouvelle connexion requise.') {
    super(message);
    this.name = 'KajabiSessionExpiredError';
  }
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export class KajabiAdapter extends BaseDeploymentAdapter {
  readonly platform = 'kajabi';
  readonly capabilities: { modes: DeploymentMode[]; needsBrowser: boolean } = {
    modes: ['assisted', 'auto', 'manual'],
    needsBrowser: true,
  };

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  // Garde de durée de vie (P126) : ferme le contexte de force si la session dépasse le timeout.
  private sessionGuard: BrowserSessionGuard | null = null;

  // ────────────────────────────────────────────────────────────────
  // authenticate
  // ────────────────────────────────────────────────────────────────

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.saveCheckpoint(ctx, { lessonIndex: ctx.checkpoint.lessonIndex, step: KAJABI_STEPS.auth });
    await this.guardMock(
      ctx,
      () => this.realAuthenticate(ctx),
      async () => {
        await this.log(ctx, 'info', 'authentification Kajabi simulée (aucun navigateur lancé)', 5);
      },
    );
  }

  private async realAuthenticate(ctx: DeployContext): Promise<void> {
    const email = ctx.credentials.email;
    const password = ctx.credentials.password;
    if (!email || !password) {
      throw new Error('Credentials Kajabi manquants (email/password) — mode réel impossible.');
    }

    const restored = await this.tryRestoreSession(ctx);
    const page = await this.ensurePage(ctx, restored);

    if (restored) {
      await page.goto(`${KAJABI_BASE}/admin/products`, { waitUntil: 'domcontentloaded' });
      if (await this.isLoggedIn(page)) {
        await this.log(ctx, 'info', 'session Kajabi réutilisée (storageState déchiffré)', 8);
        return;
      }
      await this.log(ctx, 'warn', 'session Kajabi expirée — nouvelle connexion', 6);
    }

    await this.withRetry(async () => {
      await page.goto(`${KAJABI_BASE}/login`, { waitUntil: 'domcontentloaded' });
      // Anti-phishing (P126) : le domaine de la page AVANT saisie doit être kajabi.com.
      this.assertExpectedDomain(page.url(), 'kajabi.com');
      await page.fill(SELECTORS.login.email, email);
      await page.fill(SELECTORS.login.password, password);
      await page.click(SELECTORS.login.submit);
      await page.waitForLoadState('domcontentloaded');
      if (!(await this.isLoggedIn(page))) {
        throw new Error('échec de connexion Kajabi (identifiants refusés ou page inattendue)');
      }
    }, 'kajabi.login');

    await this.persistSession(ctx);
    await this.log(ctx, 'info', 'connexion Kajabi réussie, session chiffrée persistée', 10);
  }

  // ────────────────────────────────────────────────────────────────
  // createCourse
  // ────────────────────────────────────────────────────────────────

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    if (ctx.externalId) return { externalId: ctx.externalId };

    await this.saveCheckpoint(ctx, { lessonIndex: ctx.checkpoint.lessonIndex, step: KAJABI_STEPS.create });

    return this.guardMock(
      ctx,
      () => this.realCreateCourse(ctx),
      async () => {
        const externalId = `mock-${buildProductSlug(ctx.course.title)}`;
        await this.log(ctx, 'info', `produit Kajabi créé (mock) → id ${externalId}`, 12);
        return { externalId };
      },
    );
  }

  private async realCreateCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    const page = await this.ensurePage(ctx);
    return this.withRetry(async () => {
      await page.goto(`${KAJABI_BASE}/admin/products/new`, { waitUntil: 'domcontentloaded' });
      await this.clickIfPresent(page, SELECTORS.createProduct.typeCourse);
      await page.fill(SELECTORS.createProduct.titleInput, ctx.course.title);
      await page.click(SELECTORS.createProduct.next);
      await page.waitForLoadState('domcontentloaded');

      const match = SELECTORS.createProduct.manageUrlPattern.exec(page.url());
      const externalId = match?.[1];
      if (!externalId) {
        throw new Error(`externalId Kajabi introuvable dans l'URL « ${page.url()} »`);
      }
      await this.log(ctx, 'info', `produit Kajabi créé (id ${externalId})`, 14);
      return { externalId };
    }, 'kajabi.createCourse');
  }

  // ────────────────────────────────────────────────────────────────
  // uploadLesson (modules + posts, CHECKPOINT après chaque leçon)
  // ────────────────────────────────────────────────────────────────

  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    await this.guardMock(
      ctx,
      () => this.realUploadLesson(ctx, lesson, index),
      async () => {
        await this.log(ctx, 'info', `leçon ${index + 1} « ${lesson.title} » (${lesson.type}) uploadée sur Kajabi`);
      },
    );
    // CHECKPOINT après chaque leçon : reprise sans ré-upload.
    await this.saveCheckpoint(ctx, { lessonIndex: index + 1, step: KAJABI_STEPS.upload });
  }

  private async realUploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const page = await this.ensurePage(ctx);

    await this.withRetry(async () => {
      await page.goto(`${KAJABI_BASE}/admin/products/${ctx.externalId}/curriculum`, {
        waitUntil: 'domcontentloaded',
      });

      const section = ctx.sections.find(
        (s) => String((s as { _id?: unknown })._id ?? '') === String(lesson.sectionId),
      );
      await this.clickIfPresent(page, SELECTORS.curriculum.addModule);
      if (section) {
        await this.fillIfPresent(page, SELECTORS.curriculum.moduleTitleInput, section.title);
      }

      await page.click(SELECTORS.curriculum.addPost);
      await page.fill(SELECTORS.curriculum.postTitleInput, lesson.title);

      const keys = this.lessonKeys(courseId, ctx, lesson);

      if (lesson.type === 'video' && lesson.assets.videoUrl) {
        await this.uploadVideo(ctx, page, keys.video());
      } else if (lesson.type === 'article' && lesson.assets.articleMd) {
        await this.injectArticle(page, await this.readText(keys.article()));
      }

      await this.clickIfPresent(page, SELECTORS.curriculum.savePost);
      await this.log(ctx, 'info', `leçon ${index + 1} « ${lesson.title} » enregistrée sur Kajabi`);
    }, `kajabi.uploadLesson[${index}]`);
  }

  /** Upload vidéo puis polling de l'encodage jusqu'à disponibilité (ou timeout). */
  private async uploadVideo(ctx: DeployContext, page: Page, videoKey: string): Promise<void> {
    await this.uploadFile(page, SELECTORS.curriculum.videoFileInput, videoKey, 'video.mp4');
    const deadline = Date.now() + VIDEO_PROCESSING.TIMEOUT_MS;
    while (true) {
      const done = await page.locator(SELECTORS.curriculum.processingDone).count();
      if (done > 0) return;
      if (Date.now() > deadline) {
        throw new Error("encodage vidéo Kajabi non terminé dans le délai imparti");
      }
      await this.log(ctx, 'info', 'encodage vidéo Kajabi en cours…');
      await page.waitForTimeout(VIDEO_PROCESSING.POLL_INTERVAL_MS);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // setLandingPage (page d'offre)
  // ────────────────────────────────────────────────────────────────

  async setLandingPage(ctx: DeployContext): Promise<void> {
    await this.saveCheckpoint(ctx, { lessonIndex: ctx.lessons.length, step: KAJABI_STEPS.landing });
    await this.guardMock(
      ctx,
      () => this.realSetLandingPage(ctx),
      async () => {
        await this.log(ctx, 'info', 'page d\'offre Kajabi renseignée (titre/description/image)', 82);
      },
    );
  }

  private async realSetLandingPage(ctx: DeployContext): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const page = await this.ensurePage(ctx);
    await this.withRetry(async () => {
      await page.goto(`${KAJABI_BASE}/admin/products/${ctx.externalId}/offer`, {
        waitUntil: 'domcontentloaded',
      });
      const description =
        (ctx.course.outline as { description?: string } | null)?.description ?? ctx.course.title;
      await this.fillIfPresent(page, SELECTORS.offer.descriptionEditor, description);
      if (ctx.course.coverImageUrl) {
        const imageKey = storageKeys.course(courseId).marketing('cover-offer.png');
        if (await objectExists(imageKey)) {
          await this.uploadFile(page, SELECTORS.offer.imageInput, imageKey, 'cover.png');
        }
      }
      await this.clickIfPresent(page, SELECTORS.offer.save);
      await this.log(ctx, 'info', 'page d\'offre Kajabi enregistrée', 82);
    }, 'kajabi.setLandingPage');
  }

  // ────────────────────────────────────────────────────────────────
  // submitForReview : PAS de revue chez Kajabi — publication DIRECTE.
  // ────────────────────────────────────────────────────────────────

  /**
   * Kajabi ne propose aucun processus de revue éditoriale (contrairement à
   * Udemy) : l'appel bascule directement l'offre en statut « live ». Documenté
   * ici pour ne pas surprendre l'appelant du flow générique — getStatus renvoie
   * ensuite 'published' sans reviewState intermédiaire ('not_applicable').
   */
  async submitForReview(ctx: DeployContext): Promise<void> {
    await this.saveCheckpoint(ctx, { lessonIndex: ctx.lessons.length, step: KAJABI_STEPS.review });
    await this.guardMock(
      ctx,
      () => this.realSubmitForReview(ctx),
      async () => {
        await this.log(ctx, 'info', 'offre Kajabi publiée directement (pas de revue éditoriale)', 92);
      },
    );
  }

  private async realSubmitForReview(ctx: DeployContext): Promise<void> {
    const page = await this.ensurePage(ctx);
    await this.withRetry(async () => {
      await page.goto(`${KAJABI_BASE}/admin/products/${ctx.externalId}/offer`, {
        waitUntil: 'domcontentloaded',
      });
      await page.click(SELECTORS.publish.button);
      await page.waitForLoadState('domcontentloaded');
      await this.log(ctx, 'info', 'offre Kajabi publiée (live)', 92);
    }, 'kajabi.submitForReview');
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    return this.guardMock<DeployStatus>(
      ctx,
      () => this.realGetStatus(ctx),
      async () => {
        const externalUrl = mockOfferUrl(ctx.course.title);
        await this.log(ctx, 'info', `statut simulé : published (pas de revue) → ${externalUrl}`);
        return { status: 'published', externalUrl, reviewState: 'not_applicable' };
      },
    ).finally(() => void this.closeBrowser());
  }

  private async realGetStatus(ctx: DeployContext): Promise<DeployStatus> {
    const page = await this.ensurePage(ctx);
    return this.withRetry(async () => {
      await page.goto(`${KAJABI_BASE}/admin/products/${ctx.externalId}/offer`, {
        waitUntil: 'domcontentloaded',
      });
      const live = (await page.locator(SELECTORS.publish.liveBadge).count()) > 0;
      const externalUrl = mockOfferUrl(ctx.course.title);
      return {
        status: live ? 'published' : 'running',
        externalUrl,
        // Kajabi n'a pas de revue : 'not_applicable' une fois live, sinon en cours.
        reviewState: live ? 'not_applicable' : 'in_progress',
      };
    }, 'kajabi.getStatus');
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers navigateur / session
  // ────────────────────────────────────────────────────────────────

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
    this.sessionGuard = guardBrowserSession(this.context, 'kajabi.deploy');
    this.page = await this.context.newPage();
    return this.page;
  }

  private async tryRestoreSession(ctx: DeployContext): Promise<string | undefined> {
    const scopeId = sessionScopeId(ctx);
    if (!scopeId) return undefined;
    const key = sessionStateKey(scopeId);
    try {
      if (!(await objectExists(key))) return undefined;
      const blob = await this.readText(key);
      return decryptSecret(blob, getConfig().CREDENTIALS_MASTER_KEY);
    } catch (err) {
      await this.log(ctx, 'warn', `session Kajabi illisible, connexion complète — ${(err as Error).message}`);
      return undefined;
    }
  }

  private async persistSession(ctx: DeployContext): Promise<void> {
    if (!this.context) return;
    const scopeId = sessionScopeId(ctx);
    if (!scopeId) return;
    try {
      const state = await this.context.storageState();
      const blob = encryptSecret(JSON.stringify(state), getConfig().CREDENTIALS_MASTER_KEY);
      await uploadObject(sessionStateKey(scopeId), blob, 'text/plain');
    } catch (err) {
      await this.log(ctx, 'warn', `session Kajabi non persistée — ${(err as Error).message}`);
    }
  }

  private async isLoggedIn(page: Page): Promise<boolean> {
    return (await page.locator(SELECTORS.login.loggedIn).count()) > 0;
  }

  private lessonKeys(courseId: string, ctx: DeployContext, lesson: ILesson) {
    const section = ctx.sections.find(
      (s) => String((s as { _id?: unknown })._id ?? '') === String(lesson.sectionId),
    );
    return storageKeys.course(courseId).lesson(section?.order ?? 0, lesson.order);
  }

  private async readText(key: string): Promise<string> {
    const stream = await getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Injecte un article : Markdown → HTML basique dans l'éditeur contenteditable. */
  private async injectArticle(page: Page, markdown: string): Promise<void> {
    const html = markdownToBasicHtml(markdown);
    await page.locator(SELECTORS.curriculum.articleEditor).first().evaluate(
      (el: { innerHTML: string }, value: string) => {
        el.innerHTML = value;
      },
      html,
    );
  }

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
 * italique, listes, paragraphes). Reprise exacte de la logique d'udemy.ts
 * (mêmes garanties : pas de dépendance externe, échappement du HTML brut).
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
registerAdapter(new KajabiAdapter());
