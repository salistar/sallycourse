// Gabarits d'email HTML SALISTAR — maison (React Email absent). Chaque gabarit
// est une fonction pure { subject, html, text } → testable sans I/O. Les couleurs
// reprennent l'identité de marque (violet/or) ; HTML inline pour compatibilité
// clients mail. Contenu en français.

/** Palette de marque (inline dans le HTML des mails, hors design tokens Tailwind). */
const BRAND = {
  bg: '#0f0a1e',
  surface: '#1b1430',
  border: '#2e2450',
  text: '#ece8f5',
  muted: '#a99fc4',
  primary: '#7c5cff',
  accent: '#f5b642',
} as const;

/** Types de gabarit disponibles — alignés sur NotificationType (+ variantes email). */
export type EmailTemplateName =
  | 'generation_complete'
  | 'deployment_complete'
  | 'review_approved'
  | 'review_rejected'
  | 'quota_reached'
  | 'sequence_step';

/** Données passées au gabarit (toutes optionnelles selon le type). */
export interface EmailTemplateData {
  /** Nom d'affichage du destinataire. */
  name?: string;
  /** Titre du cours concerné. */
  courseTitle?: string;
  /** Plateforme de déploiement (Udemy, LMS…). */
  platform?: string;
  /** Motif d'un rejet de review. */
  reason?: string;
  /** Plan concerné par un quota atteint. */
  plan?: string;
  /** URL absolue d'action (bouton principal). */
  actionUrl?: string;
  /** Libellé du bouton d'action. */
  actionLabel?: string;
  /** Sujet déjà interpolé d'une étape de séquence email (Prompt 140). */
  sequenceSubject?: string;
  /** Corps HTML déjà interpolé d'une étape de séquence email (Prompt 140). */
  sequenceHtml?: string;
}

/** Résultat rendu d'un gabarit. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Échappement HTML minimal des valeurs interpolées (anti-injection). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Bouton d'action (rendu seulement si une URL est fournie). */
function actionButton(url?: string, label?: string): string {
  if (!url) return '';
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label ?? 'Ouvrir SallyCourse');
  return `
    <tr><td style="padding:8px 0 4px;">
      <a href="${safeUrl}" style="display:inline-block;background:${BRAND.primary};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${safeLabel}</a>
    </td></tr>`;
}

/**
 * Enveloppe commune : en-tête de marque, carte centrale, pied. `bodyRows`
 * contient les <tr> du corps (titre, paragraphes, bouton).
 */
function layout(preheader: string, bodyRows: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid ${BRAND.border};">
          <span style="font-size:18px;font-weight:700;color:${BRAND.text};letter-spacing:-0.02em;">Sally<span style="color:${BRAND.accent};">Course</span></span>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="color:${BRAND.text};font-size:15px;line-height:1.6;">
            ${bodyRows}
          </table>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px;line-height:1.5;">
          Vous recevez cet email car vous utilisez SallyCourse.<br/>
          SALISTAR — génération automatisée de cours.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Salutation (« Bonjour X, » ou « Bonjour, »). */
function greeting(name?: string): string {
  const who = name?.trim() ? ` ${escapeHtml(name.trim())}` : '';
  return `<tr><td style="padding-bottom:12px;color:${BRAND.muted};">Bonjour${who},</td></tr>`;
}

/** Titre de section. */
function heading(text: string): string {
  return `<tr><td style="padding-bottom:10px;font-size:20px;font-weight:700;color:${BRAND.text};">${escapeHtml(text)}</td></tr>`;
}

/** Paragraphe simple. */
function paragraph(text: string): string {
  return `<tr><td style="padding-bottom:14px;color:${BRAND.text};">${text}</td></tr>`;
}

/** Met en évidence une valeur (cours, plateforme…). */
function strong(value: string): string {
  return `<strong style="color:${BRAND.accent};">${escapeHtml(value)}</strong>`;
}

/* ------------------------------------------------------------------ */
/* Gabarits par type                                                   */
/* ------------------------------------------------------------------ */

type Renderer = (data: EmailTemplateData) => RenderedEmail;

const generationComplete: Renderer = (d) => {
  const course = d.courseTitle ?? 'votre cours';
  const subject = `Votre cours « ${d.courseTitle ?? 'nouveau cours'} » est prêt`;
  const html = layout(
    'La génération de votre cours est terminée.',
    greeting(d.name) +
      heading('Génération terminée') +
      paragraph(`Le cours ${strong(course)} a été généré avec succès : leçons, quiz et supports sont disponibles.`) +
      actionButton(d.actionUrl, d.actionLabel ?? 'Voir le cours'),
  );
  const text = `Bonjour${d.name ? ' ' + d.name : ''},\n\nLe cours « ${course} » a été généré avec succès.\n${d.actionUrl ?? ''}`;
  return { subject, html, text };
};

const deploymentComplete: Renderer = (d) => {
  const course = d.courseTitle ?? 'votre cours';
  const platform = d.platform ?? 'la plateforme';
  const subject = `Déploiement terminé — « ${d.courseTitle ?? 'votre cours'} »`;
  const html = layout(
    `Votre cours a été déployé sur ${platform}.`,
    greeting(d.name) +
      heading('Déploiement terminé') +
      paragraph(`Le cours ${strong(course)} a été déployé sur ${strong(platform)}.`) +
      actionButton(d.actionUrl, d.actionLabel ?? 'Voir le déploiement'),
  );
  const text = `Bonjour${d.name ? ' ' + d.name : ''},\n\nLe cours « ${course} » a été déployé sur ${platform}.\n${d.actionUrl ?? ''}`;
  return { subject, html, text };
};

const reviewApproved: Renderer = (d) => {
  const course = d.courseTitle ?? 'votre cours';
  const platform = d.platform ?? 'la plateforme';
  const subject = `Review approuvée — « ${d.courseTitle ?? 'votre cours'} »`;
  const html = layout(
    'Votre cours a passé la review avec succès.',
    greeting(d.name) +
      heading('Review approuvée') +
      paragraph(`Bonne nouvelle : ${strong(course)} a été approuvé par ${strong(platform)} et est désormais publié.`) +
      actionButton(d.actionUrl, d.actionLabel ?? 'Voir le cours'),
  );
  const text = `Bonjour${d.name ? ' ' + d.name : ''},\n\nLe cours « ${course} » a été approuvé par ${platform}.\n${d.actionUrl ?? ''}`;
  return { subject, html, text };
};

const reviewRejected: Renderer = (d) => {
  const course = d.courseTitle ?? 'votre cours';
  const platform = d.platform ?? 'la plateforme';
  const reason = d.reason?.trim();
  const subject = `Review rejetée — « ${d.courseTitle ?? 'votre cours'} »`;
  const html = layout(
    'Votre cours nécessite des corrections avant publication.',
    greeting(d.name) +
      heading('Review rejetée') +
      paragraph(`Le cours ${strong(course)} a été rejeté par ${strong(platform)}.`) +
      (reason ? paragraph(`Motif : ${escapeHtml(reason)}`) : '') +
      actionButton(d.actionUrl, d.actionLabel ?? 'Corriger le cours'),
  );
  const text = `Bonjour${d.name ? ' ' + d.name : ''},\n\nLe cours « ${course} » a été rejeté par ${platform}.${reason ? '\nMotif : ' + reason : ''}\n${d.actionUrl ?? ''}`;
  return { subject, html, text };
};

const quotaReached: Renderer = (d) => {
  const plan = d.plan ?? 'votre plan actuel';
  const subject = 'Quota mensuel de cours atteint';
  const html = layout(
    'Vous avez atteint votre quota mensuel de cours.',
    greeting(d.name) +
      heading('Quota atteint') +
      paragraph(`Vous avez atteint la limite de génération de cours de ${strong(plan)} pour ce mois.`) +
      paragraph('Passez à un plan supérieur pour continuer à produire des cours sans attendre le renouvellement.') +
      actionButton(d.actionUrl, d.actionLabel ?? 'Voir les offres'),
  );
  const text = `Bonjour${d.name ? ' ' + d.name : ''},\n\nVous avez atteint le quota de cours de ${plan} pour ce mois.\n${d.actionUrl ?? ''}`;
  return { subject, html, text };
};

const sequenceStep: Renderer = (d) => {
  // Contenu déjà rédigé et interpolé en amont (générateur de séquence, P140) —
  // ce gabarit ne fait qu'appliquer l'enveloppe de marque commune (layout()).
  // Repli générique si sequenceSubject/sequenceHtml sont absents (ne devrait
  // pas arriver en usage réel — le worker les fournit toujours).
  const subject = d.sequenceSubject?.trim() || `Des nouvelles de ${d.courseTitle ?? 'votre cours'}`;
  const bodyHtml = d.sequenceHtml?.trim() || `Bonjour${d.name ? ' ' + escapeHtml(d.name) : ''}, une nouvelle étape de votre parcours vous attend.`;
  const html = layout(subject, `<tr><td>${bodyHtml}</td></tr>`);
  // Repli texte brut minimal (balises HTML simples retirées).
  const text = bodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  return { subject, html, text };
};

/** Registre des gabarits par nom. */
export const EMAIL_TEMPLATES: Record<EmailTemplateName, Renderer> = {
  generation_complete: generationComplete,
  deployment_complete: deploymentComplete,
  review_approved: reviewApproved,
  review_rejected: reviewRejected,
  quota_reached: quotaReached,
  sequence_step: sequenceStep,
};

/** Rend un gabarit par nom — sujet + HTML + texte brut de repli. */
export function renderEmailTemplate(
  template: EmailTemplateName,
  data: EmailTemplateData = {},
): RenderedEmail {
  const renderer = EMAIL_TEMPLATES[template];
  if (!renderer) throw new Error(`Gabarit email inconnu : ${template}`);
  return renderer(data);
}
