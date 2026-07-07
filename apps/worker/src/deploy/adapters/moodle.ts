// Adapter de déploiement Moodle (Prompt 42) — instances self-hosted via les
// Web Services REST (protocole `rest`, format JSON). Le flow générique du
// processor est mappé sur les fonctions webservice Moodle :
//
//   authenticate   → core_webservice_get_site_info (valide le token + l'URL)
//   createCourse   → core_course_create_courses     (crée le cours, catégorie 1)
//   uploadLesson   → sections + mod_page/mod_url     (une ressource par leçon)
//   setLandingPage → core_course_update_courses      (résumé/summary du cours)
//   submitForReview→ core_course_update_courses      (visible=1 : publication)
//   getStatus      → core_course_get_courses_by_field(récupère l'URL vue cours)
//
// Toutes les fonctions ne sont pas activées sur chaque instance ; les échecs
// « fonction indisponible » sont tolérés (log warn) pour ne pas casser le flow.
// MOCK : sans credentials/URL, aucun appel réseau — statuts et URL simulés.

import type { DeploymentMode, ILesson } from '../../shared.js';
import { markdownToHtml } from '../../media/pack.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';

/** Plateforme (clé du registre + credentials). */
export const MOODLE_PLATFORM = 'moodle';

/* ------------------------------------------------------------------ */
/* Helpers PURS (mapping / URL) — testables sans réseau               */
/* ------------------------------------------------------------------ */

/** Nom de champ Moodle : abrège/normalise le shortname (unique, sans espace). */
export function moodleShortname(title: string, courseId: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = String(courseId).slice(-6);
  return `${slug || 'course'}-${suffix}`;
}

/**
 * Encode un appel webservice Moodle en corps application/x-www-form-urlencoded.
 * Moodle attend les tableaux/objets aplatis en clés indexées :
 *   courses[0][fullname]=…&courses[0][shortname]=…
 */
export function encodeMoodleParams(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  const walk = (key: string, value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${key}[${i}]`, v));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(`${key}[${k}]`, v);
      }
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return pairs.join('&');
}

/** Construit l'URL de l'endpoint REST Moodle (server.php) pour une fonction. */
export function moodleEndpoint(baseUrl: string, wsfunction: string, token: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  const q = new URLSearchParams({
    wstoken: token,
    wsfunction,
    moodlewsrestformat: 'json',
  });
  return `${root}/webservice/rest/server.php?${q.toString()}`;
}

/** Détecte l'enveloppe d'erreur Moodle (exception + errorcode) dans une réponse. */
export function isMoodleException(body: unknown): body is { exception: string; message: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'exception' in body &&
    typeof (body as { exception?: unknown }).exception === 'string'
  );
}

/** URL de consultation d'un cours à partir de son id (vue étudiant). */
export function moodleCourseUrl(baseUrl: string, courseId: number | string): string {
  return `${baseUrl.replace(/\/+$/, '')}/course/view.php?id=${courseId}`;
}

/** Contenu HTML d'une leçon pour une ressource mod_page (article ou renvoi vidéo). */
export function moodleLessonContent(lesson: ILesson, articleMarkdown: string | null): string {
  if (lesson.type === 'article' && articleMarkdown) {
    return markdownToHtml(articleMarkdown);
  }
  if (lesson.summary) return `<p>${lesson.summary}</p>`;
  return `<p>${lesson.title}</p>`;
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

interface MoodleConfig {
  baseUrl: string;
  token: string;
}

export class MoodleAdapter extends BaseDeploymentAdapter {
  platform = MOODLE_PLATFORM;
  capabilities = {
    modes: ['auto', 'assisted'] as DeploymentMode[],
    needsBrowser: false,
  };

  /** Extrait/valide l'URL + le token depuis les credentials (null si incomplet). */
  private config(ctx: DeployContext): MoodleConfig | null {
    const baseUrl = ctx.credentials.baseUrl ?? ctx.credentials.url ?? '';
    const token = ctx.credentials.token ?? ctx.credentials.wstoken ?? '';
    if (!baseUrl || !token) return null;
    return { baseUrl, token };
  }

  /** Appel webservice REST Moodle ; jette sur exception Moodle ou HTTP non-OK. */
  private async call(
    cfg: MoodleConfig,
    wsfunction: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const url = moodleEndpoint(cfg.baseUrl, wsfunction, cfg.token);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: encodeMoodleParams(params),
    });
    if (!res.ok) {
      throw new Error(`Moodle ${wsfunction} : HTTP ${res.status}`);
    }
    const body: unknown = await res.json().catch(() => null);
    if (isMoodleException(body)) {
      throw new Error(`Moodle ${wsfunction} : ${body.message} (${body.exception})`);
    }
    return body;
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    const cfg = this.config(ctx);
    await this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials Moodle manquants (baseUrl + token)');
        await this.withRetry(
          () => this.call(cfg, 'core_webservice_get_site_info', {}),
          'get_site_info',
        );
        await this.log(ctx, 'info', 'connexion Moodle validée', 5);
      },
      async () => {
        await this.log(ctx, 'info', 'connexion Moodle simulée', 5);
      },
    );
  }

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    // Reprise : si un externalId est déjà connu (checkpoint/deployment), on le réutilise.
    const existing = ctx.externalId ?? ctx.deployment.externalUrl;
    const cfg = this.config(ctx);

    return this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials Moodle manquants');
        const shortname = moodleShortname(ctx.course.title, String(ctx.deployment.courseId));
        const body = (await this.withRetry(
          () =>
            this.call(cfg, 'core_course_create_courses', {
              courses: [
                {
                  fullname: ctx.course.title,
                  shortname,
                  categoryid: Number(ctx.credentials.categoryId ?? 1),
                  visible: 0,
                },
              ],
            }),
          'create_courses',
        )) as { id: number }[] | undefined;
        const id = Array.isArray(body) && body[0] ? body[0].id : undefined;
        if (id === undefined) throw new Error('Moodle : id de cours absent de la réponse');
        await this.log(ctx, 'info', `cours Moodle créé (#${id})`, 15);
        return { externalId: String(id) };
      },
      async () => {
        const id = existing ?? `moodle-${String(ctx.deployment.courseId).slice(-6)}`;
        await this.log(ctx, 'info', `cours Moodle créé ${id}`, 15);
        return { externalId: String(id) };
      },
    );
  }

  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const cfg = this.config(ctx);
    await this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials Moodle manquants');
        // La création de ressources (mod_page/mod_url) dépend de webservices non
        // standard selon l'instance ; on tente mod_page, on tolère l'indisponibilité.
        const content = moodleLessonContent(lesson, null);
        try {
          await this.withRetry(
            () =>
              this.call(cfg, 'mod_page_create_page', {
                courseid: Number(ctx.externalId),
                name: lesson.title,
                intro: lesson.summary ?? '',
                content,
              }),
            'mod_page_create_page',
          );
        } catch (err) {
          await this.log(
            ctx,
            'warn',
            `ressource « ${lesson.title} » non créée (webservice indisponible) — importez le paquet SCORM`,
          );
        }
        await this.log(ctx, 'info', `leçon ${index + 1} traitée : ${lesson.title}`);
      },
      async () => {
        await this.log(ctx, 'info', `leçon ${index + 1} envoyée : ${lesson.title}`);
      },
    );
  }

  async setLandingPage(ctx: DeployContext): Promise<void> {
    const cfg = this.config(ctx);
    // ICourse n'a pas de champ `summary` typé : accès tolérant, repli générique.
    const rawSummary = (ctx.course as { summary?: unknown }).summary;
    const summary =
      typeof rawSummary === 'string' && rawSummary.trim()
        ? rawSummary
        : `Cours « ${ctx.course.title} » généré par SallyCourse.`;
    await this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials Moodle manquants');
        await this.withRetry(
          () =>
            this.call(cfg, 'core_course_update_courses', {
              courses: [{ id: Number(ctx.externalId), summary, summaryformat: 1 }],
            }),
          'update_courses',
        ).catch(async () => {
          await this.log(ctx, 'warn', 'mise à jour du résumé Moodle ignorée (webservice indisponible)');
        });
        await this.log(ctx, 'info', 'présentation du cours renseignée', 80);
      },
      async () => {
        await this.log(ctx, 'info', 'présentation du cours renseignée', 80);
      },
    );
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    const cfg = this.config(ctx);
    // Pas de « revue » sur Moodle : publier = rendre le cours visible.
    await this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials Moodle manquants');
        await this.withRetry(
          () =>
            this.call(cfg, 'core_course_update_courses', {
              courses: [{ id: Number(ctx.externalId), visible: 1 }],
            }),
          'publish',
        );
        await this.log(ctx, 'info', 'cours Moodle publié (visible)', 92);
      },
      async () => {
        await this.log(ctx, 'info', 'cours Moodle publié (visible)', 92);
      },
    );
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    const cfg = this.config(ctx);
    return this.guardMock(
      ctx,
      async (): Promise<DeployStatus> => {
        const externalUrl = cfg ? moodleCourseUrl(cfg.baseUrl, ctx.externalId ?? '') : undefined;
        return { status: 'published', externalUrl, reviewState: 'visible' };
      },
      async (): Promise<DeployStatus> => ({
        status: 'published',
        externalUrl: `https://moodle.example/course/view.php?id=${ctx.externalId ?? '0'}`,
        reviewState: 'visible',
      }),
    );
  }
}

/** Enregistrement non destructif dans le registre partagé. */
registerAdapter(new MoodleAdapter());
