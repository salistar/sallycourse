// Rapport de déploiement (P50) : agrège l'état des Deployment d'un cours en un
// PDF de synthèse (plateformes, URLs publiées, durées, états de revue, checklist
// de conformité), rendu via le gabarit « deployment-report » (Playwright page.pdf,
// navigateur singleton réutilisé) et archivé dans le stockage objet.
//
// L'agrégation (buildDeploymentReportData) est PURE et déterministe : elle ne
// touche ni la base ni le réseau, tout se teste hors-ligne (vitest). Le rendu et
// l'upload vivent dans generateDeploymentReport, MOCK-friendly comme le reste.

import {
  PdfTemplate,
  renderPdfTemplate,
  storageKeys,
  uploadObject,
  type DeploymentReportPdfInput,
  type ReportChecklistItem,
  type ReportChecklistTone,
  type ReportPlatform,
  type ICourse,
  type IDeployment,
  type Locale,
} from '../shared.js';

/* ------------------------------------------------------------------ */
/* Libellés (localisation FR par défaut)                               */
/* ------------------------------------------------------------------ */

/** Libellés lisibles des plateformes connues (repli : id capitalisé). */
const PLATFORM_LABELS: Record<string, string> = {
  udemy: 'Udemy',
  youtube: 'YouTube',
  skillshare: 'Skillshare',
  teachable: 'Teachable',
  thinkific: 'Thinkific',
  podia: 'Podia',
  gumroad: 'Gumroad',
  moodle: 'Moodle',
};

/** Retourne le libellé d'une plateforme (id capitalisé si inconnue). */
export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** Libellés lisibles des statuts de déploiement. */
const STATUS_LABELS: Record<string, string> = {
  pending: 'En file',
  running: 'En cours',
  paused: 'En pause',
  failed: 'Échec',
  published: 'Publié',
};

/** Libellés lisibles des modes d'exécution. */
const MODE_LABELS: Record<string, string> = {
  auto: 'Automatique',
  assisted: 'Assisté',
  manual: 'Manuel',
};

/* ------------------------------------------------------------------ */
/* Formatage pur                                                       */
/* ------------------------------------------------------------------ */

/** Formate une durée en millisecondes en libellé court (« 4 min 12 s »). */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

/** Formate une date en français (« 7 juillet 2026 à 14:32 »). */
export function formatFrDateTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/* ------------------------------------------------------------------ */
/* Vue minimale d'un Deployment pour l'agrégation                      */
/* ------------------------------------------------------------------ */

/**
 * Sous-ensemble d'un Deployment nécessaire au rapport. Accepte aussi bien un
 * document Mongoose qu'un objet .lean() : on ne lit que des champs simples.
 */
export type DeploymentLike = Pick<
  IDeployment,
  'platform' | 'status' | 'mode' | 'externalUrl' | 'externalId'
> & {
  checkpoint?: { lessonIndex?: number; step?: string };
  createdAt?: Date | string;
  updatedAt?: Date | string;
  logs?: Array<{ ts?: Date | string; level?: string; msg?: string }>;
};

/** Convertit une valeur date (Date|string|undefined) en ms epoch, ou null. */
function toMs(value: Date | string | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** État de revue extrait des logs (dernier « (état) » significatif) — best effort. */
function reviewStateFrom(deployment: DeploymentLike): string {
  if (deployment.status === 'published') return 'approved';
  const step = deployment.checkpoint?.step;
  if (step === 'review') return 'in_review';
  return '';
}

/**
 * Transforme un Deployment en ligne plateforme du rapport. Pure : durée =
 * updatedAt − createdAt, leçons = checkpoint.lessonIndex borné.
 */
export function toReportPlatform(deployment: DeploymentLike): ReportPlatform {
  const start = toMs(deployment.createdAt);
  const end = toMs(deployment.updatedAt);
  const durationMs = start !== null && end !== null ? end - start : 0;
  return {
    platform: platformLabel(deployment.platform),
    status: deployment.status,
    statusLabel: STATUS_LABELS[deployment.status] ?? deployment.status,
    mode: MODE_LABELS[deployment.mode] ?? deployment.mode ?? '',
    externalUrl: deployment.externalUrl ?? '',
    externalId: deployment.externalId ?? '',
    lessonsUploaded: Math.max(0, deployment.checkpoint?.lessonIndex ?? 0),
    duration: formatDurationMs(durationMs),
    reviewState: reviewStateFrom(deployment),
  };
}

/* ------------------------------------------------------------------ */
/* Checklist de conformité (dérivée de l'état agrégé)                  */
/* ------------------------------------------------------------------ */

/**
 * Construit la checklist de conformité à partir des lignes plateforme. Purement
 * dérivée : chaque point reflète un fait vérifiable de l'agrégat.
 */
export function buildChecklist(platforms: ReportPlatform[]): ReportChecklistItem[] {
  const items: ReportChecklistItem[] = [];
  const total = platforms.length;
  const published = platforms.filter((p) => p.status === 'published');
  const failed = platforms.filter((p) => p.status === 'failed');
  const withUrl = platforms.filter((p) => p.externalUrl !== '');

  const tone = (ok: boolean, warn = false): ReportChecklistTone =>
    ok ? 'ok' : warn ? 'warn' : 'err';

  // Au moins un déploiement.
  items.push({
    tone: total > 0 ? 'ok' : 'warn',
    title: total > 0 ? `${total} plateforme(s) ciblée(s)` : 'Aucune plateforme ciblée',
    detail:
      total > 0
        ? 'Le cours a été soumis à au moins une plateforme.'
        : 'Lancez un déploiement avant de générer le rapport.',
  });

  // Publications réussies.
  items.push({
    tone: total === 0 ? 'warn' : tone(published.length === total, published.length > 0),
    title: `${published.length}/${total || 0} plateforme(s) publiée(s)`,
    detail:
      published.length === total && total > 0
        ? 'Toutes les cibles sont en ligne.'
        : 'Certaines cibles ne sont pas encore publiées.',
  });

  // Échecs.
  items.push({
    tone: failed.length === 0 ? 'ok' : 'err',
    title: failed.length === 0 ? 'Aucun déploiement en échec' : `${failed.length} déploiement(s) en échec`,
    detail:
      failed.length === 0
        ? 'Aucune erreur bloquante détectée.'
        : `À relancer : ${failed.map((p) => p.platform).join(', ')}.`,
  });

  // URLs publiques disponibles.
  items.push({
    tone: total === 0 ? 'warn' : tone(withUrl.length === published.length && published.length > 0, withUrl.length > 0),
    title: `${withUrl.length} URL publique(s) disponible(s)`,
    detail:
      withUrl.length > 0
        ? 'Les liens publiés sont consignés dans ce rapport.'
        : 'Aucune URL publique enregistrée pour le moment.',
  });

  return items;
}

/* ------------------------------------------------------------------ */
/* Agrégation complète (pure)                                          */
/* ------------------------------------------------------------------ */

export interface ReportContext {
  courseTitle: string;
  locale: Locale;
  deployments: DeploymentLike[];
  /** Horodatage de génération (défaut : maintenant). Injectable pour les tests. */
  generatedAt?: Date;
}

/**
 * Agrège les Deployment d'un cours en données de gabarit PDF. Fonction PURE :
 * aucun accès base/réseau, entièrement testable. Trie les plateformes (publiées
 * d'abord, puis en échec, puis le reste) pour une lecture prioritaire.
 */
export function buildDeploymentReportData(ctx: ReportContext): DeploymentReportPdfInput {
  const generatedAt = ctx.generatedAt ?? new Date();
  const direction: 'ltr' | 'rtl' = ctx.locale === 'ar' ? 'rtl' : 'ltr';

  const platforms = ctx.deployments.map(toReportPlatform);
  // Ordre de priorité de lecture : publié > échec > en cours/file > pause.
  const rank: Record<string, number> = { published: 0, failed: 1, running: 2, pending: 3, paused: 4 };
  platforms.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));

  const checklist = buildChecklist(platforms);

  return {
    lang: ctx.locale,
    direction,
    docKicker: 'Rapport de déploiement',
    courseTitle: ctx.courseTitle,
    generatedLine: `Généré le ${formatFrDateTime(generatedAt)}`,
    durationLine: `${platforms.length} déploiement(s) analysé(s)`,
    footerNote: 'SALISTAR · SallyCourse — génération et déploiement automatisés de cours',
    editionLine: 'SallyCourse',
    platforms,
    checklist,
  };
}

/* ------------------------------------------------------------------ */
/* Rendu PDF + archivage                                               */
/* ------------------------------------------------------------------ */

/** Préfixe des rapports de déploiement archivés (exports du cours). */
export const DEPLOYMENT_REPORT_PREFIX = 'deployment-report';

/** Nom de fichier horodaté d'un rapport de déploiement (archive historique). */
export function deploymentReportFilename(ts: number = Date.now()): string {
  return `${DEPLOYMENT_REPORT_PREFIX}-${ts}.pdf`;
}

/**
 * Nom stable du DERNIER rapport (alias), écrasé à chaque génération. Permet au
 * web de servir le rapport courant sans lister le préfixe (clé déterministe,
 * même pattern que le pack export).
 */
export const DEPLOYMENT_REPORT_LATEST = `${DEPLOYMENT_REPORT_PREFIX}-latest.pdf`;

/**
 * Rend un rapport de déploiement en PDF via le gabarit « deployment-report » et
 * Playwright (page.pdf()). Réutilise le navigateur singleton du slide-renderer.
 * En mode mock, retourne un PDF minimal (l'octet-magie %PDF suffit à archiver un
 * artefact plausible hors-ligne, sans lancer Chromium).
 */
export async function renderDeploymentReportPdf(
  data: DeploymentReportPdfInput,
  mock = false,
): Promise<Buffer> {
  const html = renderPdfTemplate(PdfTemplate.DeploymentReport, data);
  if (mock) {
    // [mock] : pas de navigateur. On archive un PDF factice traçable.
    return Buffer.from(
      `%PDF-1.4\n% [mock] rapport de déploiement\n% ${data.courseTitle}\n%%EOF\n`,
      'utf-8',
    );
  }
  const { getSlideBrowser } = await import('../media/slide-renderer.js');
  const browser = await getSlideBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

export interface GenerateReportResult {
  courseId: string;
  /** Clé S3 du PDF archivé. */
  reportKey: string;
  /** Nombre de plateformes couvertes. */
  platforms: number;
}

/**
 * Génère et archive le rapport de déploiement d'un cours : agrège les Deployment,
 * rend le PDF et l'upload sous courses/{id}/exports/deployment-report-{ts}.pdf.
 * MOCK-friendly (aucun navigateur en mock).
 */
export async function generateDeploymentReport(
  course: ICourse & { _id: unknown },
  deployments: DeploymentLike[],
  mock = false,
): Promise<GenerateReportResult> {
  const courseId = String(course._id);
  const data = buildDeploymentReportData({
    courseTitle: course.title,
    locale: course.locale,
    deployments,
  });
  const pdf = await renderDeploymentReportPdf(data, mock);
  const keys = storageKeys.course(courseId);
  // Archive horodatée (historique) + alias « latest » (servi par le web).
  const reportKey = keys.exportFile(deploymentReportFilename());
  await uploadObject(reportKey, pdf, 'application/pdf');
  await uploadObject(keys.exportFile(DEPLOYMENT_REPORT_LATEST), pdf, 'application/pdf');
  return { courseId, reportKey, platforms: data.platforms?.length ?? deployments.length };
}
