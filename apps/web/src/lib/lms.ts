import { renderPdfTemplate, PdfTemplate } from '@sallycourse/design/pdf-templates';
import type { CertificatePdfInput } from '@sallycourse/design/pdf-templates';

/**
 * Utilitaires du LMS interne SallyCourse (Prompt 43) : calcul de progression,
 * rendu du certificat de complétion (gabarit PDF D10) et STUB de paiement CMI.
 * Logique PURE et sans I/O — testable hors réseau/DB (vitest).
 */

/* ------------------------------------------------------------------ */
/* Progression                                                         */
/* ------------------------------------------------------------------ */

/** Pourcentage (0–100, arrondi) de leçons complétées sur le total. */
export function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  const pct = Math.round((Math.min(completed, total) / total) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * Cours terminé ? true quand toutes les leçons (>0) sont complétées. Sert à
 * décider de poser `completedAt` et d'ouvrir le certificat.
 */
export function isCourseCompleted(completed: number, total: number): boolean {
  return total > 0 && completed >= total;
}

/**
 * Fusionne l'ensemble des leçons complétées avec une leçon nouvellement
 * terminée, sans doublon et en ne gardant que les ids valides du cours.
 * PURE : renvoie la nouvelle liste triée déterministe (ordre d'insertion).
 */
export function mergeCompletedLesson(
  current: string[],
  lessonId: string,
  validLessonIds: readonly string[],
): string[] {
  const valid = new Set(validLessonIds);
  const set = new Set(current.filter((id) => valid.has(id)));
  if (valid.has(lessonId)) set.add(lessonId);
  return [...set];
}

/* ------------------------------------------------------------------ */
/* QR de vérification (sans dépendance)                                */
/* ------------------------------------------------------------------ */

/**
 * Data-URI d'un QR « décoratif » : le gabarit certificat EXIGE un data-URI,
 * mais `qrcode` n'est pas une dépendance disponible. On produit un motif SVG
 * déterministe dérivé de l'id de vérification (hash simple) — suffisant comme
 * marqueur visuel + libellé lisible sous le QR. Le vrai QR (URL de
 * vérification) sera branché quand la dépendance sera ajoutée.
 */
export function verificationQrDataUri(certificateId: string): string {
  const size = 8; // grille 8×8
  const cell = 12;
  const px = size * cell;
  // Hash déterministe (FNV-1a 32 bits) → bits du motif.
  let h = 0x811c9dc5;
  for (let i = 0; i < certificateId.length; i += 1) {
    h ^= certificateId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let rects = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Bit pseudo-aléatoire stable par cellule.
      const bit = ((h >>> ((x * size + y) % 31)) ^ (x * 7 + y * 13)) & 1;
      if (bit) {
        rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
      }
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
    `<rect width="${px}" height="${px}" fill="#ffffff"/>` +
    `<g fill="#0f172a">${rects}</g></svg>`;
  const b64 = Buffer.from(svg, 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}

/* ------------------------------------------------------------------ */
/* Certificat de complétion (gabarit PDF D10)                          */
/* ------------------------------------------------------------------ */

export interface CertificateParams {
  recipientName: string;
  courseTitle: string;
  /** Id d'inscription — sert d'identifiant de vérification stable. */
  certificateId: string;
  /** Date de complétion ; défaut = maintenant. */
  completedAt?: Date;
  locale?: 'fr' | 'en' | 'ar';
  /** Marque blanche (Prompt 88) — omis/undefined → défauts SALISTAR. */
  branding?: CertificateBranding;
  /**
   * Libellé du certificat (P199) — omis → défaut du gabarit
   * (« Certificat d'accomplissement »). Un certificat de PARCOURS passe
   * « Certificat de parcours » ici : aucun nouveau gabarit n'est créé.
   */
  certLabel?: string;
  /** Ligne descriptive sous le nom (P199) — omise → défaut du gabarit. */
  descriptionLine?: string;
}

/* ------------------------------------------------------------------ */
/* Marque blanche du certificat (Prompt 88, plan Business)             */
/* ------------------------------------------------------------------ */

export interface CertificateBranding {
  schoolName: string;
  logoUrl?: string;
  primaryColorHex: string;
  accentColorHex: string;
}

/**
 * Résout le branding à appliquer au certificat : les couleurs/logo de l'école
 * ne remplacent SALISTAR que pour un utilisateur plan **business** ayant
 * effectivement configuré un SchoolBranding — dans tous les autres cas
 * (plan free/pro, ou business sans branding), le résultat est `undefined` et
 * `renderCertificateHtml` retombe sur les défauts SALISTAR du gabarit.
 * PURE : ne fait aucun I/O, l'appelant fournit déjà le document chargé.
 */
export function resolveCertificateBranding(
  userPlan: string | null | undefined,
  branding: CertificateBranding | null | undefined,
): CertificateBranding | undefined {
  if (userPlan !== 'business') return undefined;
  if (!branding) return undefined;
  return branding;
}

/** Locales Intl pour formater la date de complétion dans la langue du cours. */
const DATE_LOCALES: Record<string, string> = { fr: 'fr-FR', en: 'en-US', ar: 'ar-MA' };

/**
 * Construit les données validées du certificat puis rend le HTML imprimable
 * (gabarit D10 `certificate`). Le HTML est prêt pour « imprimer → PDF » côté
 * navigateur : pas de dépendance Playwright côté web.
 */
export function renderCertificateHtml(params: CertificateParams): string {
  const when = params.completedAt ?? new Date();
  const locale = params.locale ?? 'fr';
  const completionDate = new Intl.DateTimeFormat(DATE_LOCALES[locale] ?? 'fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(when);

  const input: CertificatePdfInput = {
    recipientName: params.recipientName,
    courseTitle: params.courseTitle,
    completionDate,
    certificateId: params.certificateId,
    qrDataUri: verificationQrDataUri(params.certificateId),
    signerName: 'SallyCourse',
    signerRole: 'Plateforme de formation',
    // certLabel / descriptionLine : fournis pour un certificat de parcours
    // (P199), sinon défauts du gabarit (fr). awardLine : toujours le défaut.
    ...(params.certLabel ? { certLabel: params.certLabel } : {}),
    ...(params.descriptionLine ? { descriptionLine: params.descriptionLine } : {}),
    // brandName/brandLogoUrl/brandPrimaryHex/brandAccentHex : défauts SALISTAR
    // du gabarit si params.branding est absent (voir resolveCertificateBranding).
    ...(params.branding
      ? {
          brandName: params.branding.schoolName,
          brandLogoUrl: params.branding.logoUrl ?? '',
          brandPrimaryHex: params.branding.primaryColorHex,
          brandAccentHex: params.branding.accentColorHex,
        }
      : {}),
  };
  // Le schéma zod du gabarit applique les défauts (input → data validée).
  return renderPdfTemplate(PdfTemplate.Certificate, input);
}

/* ------------------------------------------------------------------ */
/* Paiement CMI — STUB (Phase 4)                                       */
/* ------------------------------------------------------------------ */

export interface CmiCheckoutResult {
  /** true → accès accordé immédiatement (gratuit ou mode mock). */
  granted: boolean;
  /** URL de redirection vers la passerelle CMI (branchée en Phase 4). */
  redirectUrl?: string;
  reason: string;
}

/**
 * STUB de paiement CMI (Centre Monétique Interbancaire, Maroc). Documenté et
 * volontairement non fonctionnel : la vraie intégration (signature SHA-512 des
 * champs, redirection 3-D Secure, callback de confirmation) est planifiée en
 * Phase 4. Pour l'instant :
 *   - prix 0 (gratuit)  → accès accordé ;
 *   - mode mock         → accès accordé (test hors-ligne) ;
 *   - prix > 0 réel     → non accordé, on signalerait la redirection CMI.
 */
export function cmiCheckoutStub(priceCents: number, mock: boolean): CmiCheckoutResult {
  if (priceCents <= 0) {
    return { granted: true, reason: 'Cours gratuit — inscription immédiate.' };
  }
  if (mock) {
    return { granted: true, reason: '[mock] Paiement CMI simulé — accès accordé.' };
  }
  // Phase 4 : construire les champs CMI + signature, retourner l'URL 3-D Secure.
  return {
    granted: false,
    reason: 'Paiement CMI requis (intégration prévue en Phase 4).',
  };
}
