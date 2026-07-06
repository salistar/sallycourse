// Générateur de TP (Prompt 17) : pour une leçon de type 'tp', appelle Claude
// avec tpSchema, applique les validations métier (screenshotSpec Playwright
// exigé pour les étapes sur ordinateur) avec retry + feedback, puis persiste
// Lesson.script + status. Mode mock : fixture locale déterministe, zéro appel payant.
import { Course, Lesson, getConfig, tpSchema, type TpContent } from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import { hashString } from '../lib/mock-fixtures.js';
import { logger } from '../queues/index.js';
import { tpSystemPrompt, tpUserPrompt, type TpPromptInput } from '../prompts/tp.js';

/** Tentatives quand les validations MÉTIER échouent (le schéma est garanti par callClaudeJson). */
const MAX_BUSINESS_ATTEMPTS = 3;
/** Un TP détaillé (étapes + specs de capture) est volumineux. */
const TP_MAX_TOKENS = 8192;

export interface TpResult {
  lessonId: string;
  steps: number;
  screenshots: number;
}

/**
 * Validations métier au-delà du schéma Zod : le TP doit être illustrable par
 * le module de capture P21. Retourne la liste des violations (vide = conforme),
 * réinjectée au LLM en cas d'échec.
 */
export function validateTpBusiness(tp: TpContent): string[] {
  const problems: string[] = [];

  if (!tp.steps.some((step) => step.screenshotSpec)) {
    problems.push(
      'Aucune étape ne fournit de "screenshotSpec" — chaque étape réalisée sur ordinateur doit en inclure un (capture Playwright).',
    );
  }

  tp.steps.forEach((step, index) => {
    // Une étape qui exécute une commande se déroule forcément sur ordinateur.
    if (step.command && !step.screenshotSpec) {
      problems.push(
        `L'étape ${index + 1} exécute une commande ("${step.command}") mais n'a pas de "screenshotSpec" — toute étape sur ordinateur doit être illustrée.`,
      );
    }
  });

  return problems;
}

/**
 * Fixture déterministe conforme à tpSchema (même titre → même TP) : quatre
 * étapes réalistes dont trois avec screenshotSpec rejouable par Playwright.
 */
export function mockTpContent(lessonTitle: string): TpContent {
  const t = lessonTitle.trim() || 'le sujet du TP';
  const port = 3000 + (hashString(t) % 10);
  const baseUrl = `http://localhost:${port}`;

  const tp: TpContent = {
    objective: `Mettre en pratique ${t} de bout en bout : préparation de l'environnement, manipulation guidée et vérification du résultat obtenu.`,
    environment: [
      'Un ordinateur avec un navigateur récent (Chrome ou Firefox)',
      'Node.js 20+ et npm installés et fonctionnels',
      `Le projet d'exemple du cours, démarré en local sur ${baseUrl}`,
    ],
    steps: [
      {
        instruction: `Démarrez le projet d'exemple lié à ${t} depuis le dossier du cours.`,
        command: 'npm run dev',
        expectedResult: `Le serveur écoute sur ${baseUrl} sans erreur dans le terminal.`,
        screenshotSpec: {
          url: baseUrl,
          actions: [{ type: 'wait', value: '1000' }],
          caption: `Page d'accueil du projet : l'environnement de ${t} est opérationnel.`,
        },
      },
      {
        instruction: `Ouvrez le formulaire de démonstration et renseignez le champ principal avec une valeur liée à ${t}.`,
        expectedResult: 'Le formulaire accepte la saisie et le bouton de validation devient actif.',
        screenshotSpec: {
          actions: [
            { type: 'goto', value: `${baseUrl}/demo` },
            { type: 'fill', selector: '#demo-input', value: `Essai ${t}` },
          ],
          focusSelector: '#demo-input',
          caption: `Champ renseigné avec la valeur d'essai pour ${t}.`,
        },
      },
      {
        instruction: 'Validez le formulaire puis observez le résultat affiché sous le bouton.',
        expectedResult: `Un message de confirmation apparaît, démontrant l'application correcte de ${t}.`,
        screenshotSpec: {
          url: `${baseUrl}/demo`,
          actions: [
            { type: 'click', selector: '#demo-submit' },
            { type: 'wait', selector: '#demo-result' },
            { type: 'scroll', value: '300' },
          ],
          focusSelector: '#demo-result',
          caption: 'Résultat attendu après validation du formulaire.',
        },
      },
      {
        instruction: `Adaptez l'exercice : modifiez au moins deux paramètres et comparez le comportement obtenu avec ${t}.`,
        expectedResult: 'Vous savez expliquer la différence de comportement entre vos deux essais.',
      },
    ],
    validation: [
      `Le serveur local répond sur ${baseUrl}.`,
      'Le message de confirmation est visible après soumission du formulaire.',
      'Vos deux variantes et leurs résultats sont consignés dans vos notes.',
    ],
    troubleshooting: [
      `Port ${port} déjà utilisé : arrêtez le processus existant ou changez de port avant de relancer.`,
      `Le champ #demo-input est introuvable : vérifiez que vous êtes bien sur ${baseUrl}/demo.`,
      "Rien ne s'affiche après validation : ouvrez la console du navigateur et corrigez la première erreur listée.",
    ],
  };

  // Garantie interne : la fixture doit toujours satisfaire le schéma partagé.
  return tpSchema.parse(tp);
}

/**
 * Cœur du générateur (sans Mongo, testable isolément) : retourne un TpContent
 * conforme à tpSchema ET aux règles métier.
 * - Mode mock (MOCK_PROVIDERS ou clé absente) : fixture déterministe locale.
 * - Mode réel : callClaudeJson + boucle métier avec réinjection du feedback.
 */
export async function generateTpContent(input: TpPromptInput): Promise<TpContent> {
  const config = getConfig();
  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    logger.debug({ lesson: input.lessonTitle, mock: true }, 'generateTpContent : fixture mock déterministe');
    return mockTpContent(input.lessonTitle);
  }

  const system = tpSystemPrompt();
  const baseUser = tpUserPrompt(input);

  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_BUSINESS_ATTEMPTS; attempt++) {
    const user =
      feedback.length === 0
        ? baseUser
        : `${baseUser}\n\nTa précédente proposition violait ces règles — corrige-les impérativement :\n${feedback
            .map((p) => `- ${p}`)
            .join('\n')}`;

    const candidate = await callClaudeJson({
      schema: tpSchema,
      system,
      user,
      maxTokens: TP_MAX_TOKENS,
    });

    feedback = validateTpBusiness(candidate);
    if (feedback.length === 0) return candidate;
    logger.warn({ lesson: input.lessonTitle, attempt, problems: feedback }, 'TP non conforme aux règles métier');
  }

  throw new Error(`TP non conforme après ${MAX_BUSINESS_ATTEMPTS} tentatives :\n${feedback.join('\n')}`);
}

/**
 * Génère le TP d'une leçon et le persiste : Lesson.script reçoit le TpContent
 * validé et status passe à 'ready'. Jette en cas d'échec (le dispatcher
 * content-generation gère alors le statut 'failed').
 */
export async function generateTp(params: {
  courseId: string;
  lessonId: string;
  /** Contexte de continuité (résumés des leçons précédentes, P19). */
  context?: string;
}): Promise<TpResult> {
  const { courseId, lessonId, context } = params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  if (lesson.type !== 'tp') {
    throw new Error(`generateTp : leçon ${lessonId} de type « ${lesson.type} » (attendu : tp)`);
  }
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const tp = await generateTpContent({
    courseTitle: course.title,
    lessonTitle: lesson.title,
    summary: lesson.summary,
    difficulty: course.difficulty,
    locale: course.locale,
    context,
  });

  lesson.script = tp;
  lesson.status = 'ready';
  await lesson.save();

  const result: TpResult = {
    lessonId,
    steps: tp.steps.length,
    screenshots: tp.steps.filter((s) => s.screenshotSpec).length,
  };
  logger.info({ courseId, ...result }, 'TP généré et persisté');
  return result;
}
