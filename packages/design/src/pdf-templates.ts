/**
 * @sallycourse/design — pdf-templates.ts
 * Loader typé des gabarits de documents PDF (packages/design/pdf-templates/*.html,
 * CSS print @page, rendus par WeasyPrint ou Playwright PDF côté worker).
 *
 * Contrat : renderPdfTemplate(name, data) → HTML complet prêt à imprimer.
 *  - Validation zod par gabarit (défauts inclus : lang 'fr', direction 'ltr',
 *    libellés français…) — même pattern que render-templates.ts.
 *  - Tout texte est échappé ; seuls `introHtml` / `sectionsHtml` (workbook)
 *    sont injectés BRUTS via triple moustache {{{…}}} — ne jamais y placer
 *    de contenu utilisateur non assaini. Quiz et cheatsheet reçoivent des
 *    données STRUCTURÉES ; leurs fragments sont générés (et échappés) ici.
 *  - Module Node uniquement (node:fs) : à consommer côté worker / serveur,
 *    jamais dans un bundle client.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { escapeHtml } from '@sallycourse/design/render-templates';

/* ------------------------------------------------------------------ */
/* Gabarits disponibles                                                */
/* ------------------------------------------------------------------ */

/** Énumération des gabarits PDF — objet const (ergonomie enum sans ses pièges TS). */
export const PdfTemplate = {
  Cover: 'cover',
  Workbook: 'workbook',
  QuizSolutions: 'quiz-solutions',
  Cheatsheet: 'cheatsheet',
  Certificate: 'certificate',
} as const;

export type PdfTemplateName = (typeof PdfTemplate)[keyof typeof PdfTemplate];

/** Liste ordonnée des noms de gabarits (= noms de fichiers .html). */
export const PDF_TEMPLATE_NAMES = Object.values(
  PdfTemplate,
) as readonly PdfTemplateName[];

/* ------------------------------------------------------------------ */
/* Schémas zod par gabarit                                             */
/* ------------------------------------------------------------------ */

/** Champs communs à tous les documents (localisation). */
const pdfBaseSchema = z.object({
  /** Code langue BCP 47 court ('fr', 'ar', 'en'…) — attribut lang. */
  lang: z.string().min(2).max(12).default('fr'),
  /** Sens de lecture — pilote la mise en page et la police arabe. */
  direction: z.enum(['ltr', 'rtl']).default('ltr'),
});

/** Champs communs aux documents intérieurs (en-têtes/pieds de page @page). */
const pdfDocSchema = pdfBaseSchema.extend({
  /** Titre du cours (en-tête @top-left des pages courantes). */
  courseTitle: z.string().min(1),
  /** Titre du document (masthead + en-tête @top-right). */
  docTitle: z.string().min(1),
  /** Mention légale / lien du pied de page @bottom-left. */
  footerNote: z.string().default(''),
});

const coverSchema = pdfBaseSchema.extend({
  courseTitle: z.string().min(1),
  /** Sur-titre or au-dessus du titre (ex. « Formation complète »). */
  kicker: z.string().default(''),
  courseSubtitle: z.string().default(''),
  /** Badge capsule (ex. « Niveau intermédiaire »). */
  levelLabel: z.string().default(''),
  /** Ligne méta libre (ex. « 8 h de vidéo · 24 leçons · 5 TP »). */
  metaLine: z.string().default(''),
  authorLine: z.string().default(''),
  editionLine: z.string().default(''),
});

const workbookSchema = pdfDocSchema.extend({
  docKicker: z.string().default('Travaux pratiques'),
  /**
   * Introduction HTML, injectée BRUTE (paragraphes <p>). Contenu de
   * confiance uniquement — jamais de texte utilisateur non assaini.
   */
  introHtml: z.string().default(''),
  /**
   * Sections TP HTML, injectées BRUTES. Contrat de classes attendu
   * documenté en tête de workbook.html (.wb-section, .wb-steps,
   * .wb-answer, .wb-lines.lines-N, .wb-tip…).
   */
  sectionsHtml: z.string().min(1),
});

const quizQuestionSchema = z
  .object({
    question: z.string().min(1),
    /** 2 à 6 propositions, lettrées A→F au rendu. */
    choices: z.array(z.string().min(1)).min(2).max(6),
    /** Index (base 0) de la bonne réponse dans `choices`. */
    answerIndex: z.number().int().nonnegative(),
    explanation: z.string().default(''),
  })
  .superRefine((q, ctx) => {
    if (q.answerIndex >= q.choices.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['answerIndex'],
        message: `answerIndex ${q.answerIndex} hors limites (${q.choices.length} propositions)`,
      });
    }
  });

const quizSolutionsSchema = pdfDocSchema.extend({
  docKicker: z.string().default('Quiz'),
  /** Consigne d'introduction (texte simple, échappé). */
  intro: z.string().default(''),
  /** Libellés des onglets visuels — à localiser pour AR/EN. */
  questionsTitle: z.string().min(1).default('Questions'),
  solutionsTitle: z.string().min(1).default('Solutions'),
  questions: z.array(quizQuestionSchema).min(1).max(60),
});

/** Tons de carte cheatsheet — hiérarchie couleur (voir cheatsheet.html). */
const cheatsheetToneSchema = z.enum(['violet', 'gold', 'info', 'success']);

const cheatsheetItemSchema = z.object({
  /** Terme / raccourci / commande — mis en avant en gras coloré. */
  term: z.string().min(1),
  detail: z.string().default(''),
  /** Ligne de code optionnelle (chip sombre monospace, toujours LTR). */
  code: z.string().default(''),
});

const cheatsheetSectionSchema = z.object({
  title: z.string().min(1),
  tone: cheatsheetToneSchema.default('violet'),
  items: z.array(cheatsheetItemSchema).min(1).max(20),
});

const cheatsheetSchema = pdfDocSchema.extend({
  docKicker: z.string().default('Aide-mémoire'),
  intro: z.string().default(''),
  sections: z.array(cheatsheetSectionSchema).min(1).max(24),
});

const certificateSchema = pdfBaseSchema.extend({
  certLabel: z.string().min(1).default("Certificat d'accomplissement"),
  /** Ligne d'attribution au-dessus du nom (« décerné à »). */
  awardLine: z.string().default('décerné à'),
  recipientName: z.string().min(1),
  descriptionLine: z.string().default('pour avoir suivi et validé le cours'),
  courseTitle: z.string().min(1),
  /** Date déjà formatée dans la langue du document (ex. « 6 juillet 2026 »). */
  completionDate: z.string().min(1),
  /** Identifiant de vérification affiché sous le QR. */
  certificateId: z.string().min(1),
  /** QR code encodé en data URI (image/png ou image/svg+xml). */
  qrDataUri: z.string().startsWith('data:', 'qrDataUri doit être un data URI'),
  signerName: z.string().min(1),
  signerRole: z.string().default(''),
});

/** Schéma zod de chaque gabarit — exporté pour validation en amont (worker). */
export const pdfTemplateSchemas = {
  [PdfTemplate.Cover]: coverSchema,
  [PdfTemplate.Workbook]: workbookSchema,
  [PdfTemplate.QuizSolutions]: quizSolutionsSchema,
  [PdfTemplate.Cheatsheet]: cheatsheetSchema,
  [PdfTemplate.Certificate]: certificateSchema,
} as const;

/** Données d'entrée par gabarit (défauts optionnels). */
export type PdfTemplateInput = {
  [K in PdfTemplateName]: z.input<(typeof pdfTemplateSchemas)[K]>;
};
/** Données validées par gabarit (défauts résolus). */
export type PdfTemplateData = {
  [K in PdfTemplateName]: z.output<(typeof pdfTemplateSchemas)[K]>;
};

export type CoverPdfInput = PdfTemplateInput['cover'];
export type WorkbookPdfInput = PdfTemplateInput['workbook'];
export type QuizSolutionsPdfInput = PdfTemplateInput['quiz-solutions'];
export type CheatsheetPdfInput = PdfTemplateInput['cheatsheet'];
export type CertificatePdfInput = PdfTemplateInput['certificate'];
export type QuizQuestion = z.output<typeof quizQuestionSchema>;
export type CheatsheetSection = z.output<typeof cheatsheetSectionSchema>;
export type CheatsheetTone = z.output<typeof cheatsheetToneSchema>;

/* ------------------------------------------------------------------ */
/* Helpers de fragments (quiz + cheatsheet)                            */
/* ------------------------------------------------------------------ */

/** Lettres des propositions (A→F, 6 max — voir quizQuestionSchema). */
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** Numéro zéro-paddé (4 → « 04 ») pour les compteurs de questions. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Carte question : numéro, énoncé, propositions à cocher. */
function questionFragment(index: number, q: QuizQuestion): string {
  const choices = q.choices
    .map(
      (choice, i) =>
        `<li class="qz-choice"><span class="qz-box" aria-hidden="true"></span><span class="qz-letter">${CHOICE_LETTERS[i]}</span><span class="qz-choice-text">${escapeHtml(choice)}</span></li>`,
    )
    .join('\n      ');
  return [
    '<article class="qz-question">',
    `  <header class="qz-q-head"><span class="qz-num">${pad2(index)}</span><h3>${escapeHtml(q.question)}</h3></header>`,
    '  <ol class="qz-choices">',
    `      ${choices}`,
    '  </ol>',
    '</article>',
  ].join('\n');
}

/** Encart solution : badge losange or (lettre), bonne réponse, explication. */
function solutionFragment(index: number, q: QuizQuestion): string {
  const letter = CHOICE_LETTERS[q.answerIndex] ?? '?';
  const answer = q.choices[q.answerIndex] ?? '';
  const explanation =
    q.explanation === ''
      ? ''
      : `\n  <p class="qz-explanation">${escapeHtml(q.explanation)}</p>`;
  return [
    '<article class="qz-solution">',
    `  <div class="qz-sol-head"><span class="qz-num">${pad2(index)}</span><span class="qz-answer-badge"><span>${letter}</span></span><span class="qz-sol-question">${escapeHtml(q.question)}</span></div>`,
    `  <p class="qz-answer-text">${letter} — ${escapeHtml(answer)}</p>${explanation}`,
    '</article>',
  ].join('\n');
}

/** Item de carte cheatsheet — detail et code omis quand vides. */
function cheatsheetItemFragment(
  item: z.output<typeof cheatsheetItemSchema>,
): string {
  const detail =
    item.detail === ''
      ? ''
      : `<div class="cs-detail">${escapeHtml(item.detail)}</div>`;
  const code =
    item.code === '' ? '' : `<code class="cs-code">${escapeHtml(item.code)}</code>`;
  return `<li class="cs-item"><div class="cs-term">${escapeHtml(item.term)}</div>${detail}${code}</li>`;
}

/** Carte cheatsheet complète, ton couleur inclus. */
function cheatsheetCardFragment(section: CheatsheetSection): string {
  const items = section.items.map(cheatsheetItemFragment).join('\n    ');
  return [
    `<section class="cs-card tone-${section.tone}">`,
    `  <h2 class="cs-card-title">${escapeHtml(section.title)}</h2>`,
    '  <ul class="cs-items">',
    `    ${items}`,
    '  </ul>',
    '</section>',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Chargement des fichiers gabarits                                    */
/* ------------------------------------------------------------------ */

const templatesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'pdf-templates',
);

const templateCache = new Map<PdfTemplateName, string>();

/** Lit (et met en cache) le fichier HTML d'un gabarit. */
function loadPdfTemplate(name: PdfTemplateName): string {
  const cached = templateCache.get(name);
  if (cached !== undefined) return cached;
  const html = readFileSync(join(templatesDir, `${name}.html`), 'utf8');
  templateCache.set(name, html);
  return html;
}

/* ------------------------------------------------------------------ */
/* Construction des valeurs de placeholders                            */
/* ------------------------------------------------------------------ */

type PlaceholderMap = Record<string, string>;

/** Valeurs communes (échappées) : localisation du document. */
function basePlaceholders(data: z.output<typeof pdfBaseSchema>): PlaceholderMap {
  return {
    lang: escapeHtml(data.lang),
    direction: data.direction,
  };
}

/** Valeurs communes aux documents intérieurs (masthead + margin boxes). */
function docPlaceholders(data: z.output<typeof pdfDocSchema>): PlaceholderMap {
  return {
    ...basePlaceholders(data),
    courseTitle: escapeHtml(data.courseTitle),
    docTitle: escapeHtml(data.docTitle),
    footerNote: escapeHtml(data.footerNote),
  };
}

/** Construit la table placeholder → valeur finale pour un gabarit donné. */
function buildPlaceholders(
  name: PdfTemplateName,
  data: PdfTemplateData[PdfTemplateName],
): PlaceholderMap {
  switch (name) {
    case PdfTemplate.Cover: {
      const d = data as PdfTemplateData['cover'];
      return {
        ...basePlaceholders(d),
        courseTitle: escapeHtml(d.courseTitle),
        kicker: escapeHtml(d.kicker),
        courseSubtitle: escapeHtml(d.courseSubtitle),
        levelLabel: escapeHtml(d.levelLabel),
        metaLine: escapeHtml(d.metaLine),
        authorLine: escapeHtml(d.authorLine),
        editionLine: escapeHtml(d.editionLine),
      };
    }
    case PdfTemplate.Workbook: {
      const d = data as PdfTemplateData['workbook'];
      return {
        ...docPlaceholders(d),
        docKicker: escapeHtml(d.docKicker),
        introHtml: d.introHtml, // injecté brut (HTML de confiance)
        sectionsHtml: d.sectionsHtml, // injecté brut (HTML de confiance)
      };
    }
    case PdfTemplate.QuizSolutions: {
      const d = data as PdfTemplateData['quiz-solutions'];
      return {
        ...docPlaceholders(d),
        docKicker: escapeHtml(d.docKicker),
        intro: escapeHtml(d.intro),
        questionsTitle: escapeHtml(d.questionsTitle),
        solutionsTitle: escapeHtml(d.solutionsTitle),
        questionsHtml: d.questions
          .map((q, i) => questionFragment(i + 1, q))
          .join('\n    '),
        solutionsHtml: d.questions
          .map((q, i) => solutionFragment(i + 1, q))
          .join('\n    '),
      };
    }
    case PdfTemplate.Cheatsheet: {
      const d = data as PdfTemplateData['cheatsheet'];
      return {
        ...docPlaceholders(d),
        docKicker: escapeHtml(d.docKicker),
        intro: escapeHtml(d.intro),
        cardsHtml: d.sections.map(cheatsheetCardFragment).join('\n    '),
      };
    }
    case PdfTemplate.Certificate: {
      const d = data as PdfTemplateData['certificate'];
      return {
        ...basePlaceholders(d),
        certLabel: escapeHtml(d.certLabel),
        awardLine: escapeHtml(d.awardLine),
        recipientName: escapeHtml(d.recipientName),
        descriptionLine: escapeHtml(d.descriptionLine),
        courseTitle: escapeHtml(d.courseTitle),
        completionDate: escapeHtml(d.completionDate),
        certificateId: escapeHtml(d.certificateId),
        qrDataUri: escapeHtml(d.qrDataUri), // attribut src (échappement sûr)
        signerName: escapeHtml(d.signerName),
        signerRole: escapeHtml(d.signerRole),
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* API publique                                                        */
/* ------------------------------------------------------------------ */

/**
 * Moustaches : {{{clé}}} (fragments HTML bruts) traitées AVANT {{clé}}
 * (valeurs échappées) via alternance — sinon {{{x}}} laisserait des
 * accolades orphelines.
 */
const PDF_PLACEHOLDER_RE = /\{\{\{([\w-]+)\}\}\}|\{\{([\w-]+)\}\}/g;

/**
 * Rend un gabarit PDF : valide `data` (zod), substitue les moustaches
 * et retourne le document HTML print (CSS @page) prêt pour WeasyPrint
 * ou Playwright PDF. Lève une erreur explicite si les données sont
 * invalides, si un placeholder du gabarit n'a pas de valeur, ou si le
 * fichier gabarit est introuvable.
 */
export function renderPdfTemplate<N extends PdfTemplateName>(
  name: N,
  data: PdfTemplateInput[N],
): string {
  const schema = pdfTemplateSchemas[name];
  if (schema === undefined) {
    throw new Error(
      `renderPdfTemplate : gabarit inconnu « ${String(name)} » (attendu : ${PDF_TEMPLATE_NAMES.join(', ')})`,
    );
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join(' ; ');
    throw new Error(
      `renderPdfTemplate("${name}") : données invalides — ${details}`,
    );
  }

  const placeholders = buildPlaceholders(
    name,
    parsed.data as PdfTemplateData[PdfTemplateName],
  );

  const html = loadPdfTemplate(name).replace(
    PDF_PLACEHOLDER_RE,
    (match, rawKey: string | undefined, escapedKey: string | undefined) => {
      const key = rawKey ?? escapedKey ?? '';
      const value = placeholders[key];
      if (value === undefined) {
        throw new Error(
          `renderPdfTemplate("${name}") : placeholder ${match} sans valeur — gabarit et loader désynchronisés`,
        );
      }
      return value;
    },
  );

  return html;
}
