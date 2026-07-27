// Assistant conversationnel du dashboard (Prompt 210) — catalogue d'actions PUR
// et résolution d'intention DÉTERMINISTE (mots-clés, sans appel LLM ni clé
// API : marche en MOCK_PROVIDERS). L'assistant RÉSOUT une intention et PROPOSE
// une action ; il n'EXÉCUTE JAMAIS. L'exécution passe par les routes MÉTIER
// EXISTANTES (ownership/quota/audit y sont déjà) — ce module ne duplique AUCUNE
// logique métier : il se contente de décrire QUELLE route appeler et avec quel
// corps, pour que l'UI demande confirmation puis appelle cette route telle quelle.
import {
  assistantActionRequiresConfirmation,
  type AssistantAction,
} from '@sallycourse/shared/voice-intent';

/** Contexte de résolution : cours courant si l'assistant est ouvert sur une page cours. */
export interface AssistantResolveContext {
  /** Id du cours actif dans l'UI (page cours), s'il y en a un. */
  currentCourseId?: string;
  /** Titre du cours actif — pour un résumé lisible. */
  currentCourseTitle?: string;
}

/** Route MÉTIER existante à appeler APRÈS confirmation (jamais exécutée ici). */
export interface AssistantExecution {
  method: 'POST';
  /** Chemin de la route existante (ownership/quota/audit déjà en place côté route). */
  path: string;
  /** Corps JSON à envoyer (aligné sur le schéma de la route cible). */
  body?: Record<string, unknown>;
}

/** Plan d'action proposé : action typée + comment l'exécuter + résumé de confirmation. */
export interface ResolvedActionPlan {
  action: AssistantAction;
  /** null pour les actions 'none' (rien à exécuter) ou si le contexte manque. */
  execution: AssistantExecution | null;
  /** Résumé lisible proposé à l'utilisateur avant confirmation. */
  summary: string;
  /** true pour toute action à effet de bord (⇒ confirmation explicite requise). */
  requiresConfirmation: boolean;
}

/** Traduit une action typée en appel de route existant (source unique du mapping). */
export function executionForAction(action: AssistantAction): AssistantExecution | null {
  switch (action.type) {
    case 'create_course':
      return { method: 'POST', path: '/api/courses', body: action.input };
    case 'continue_generation':
      return { method: 'POST', path: `/api/courses/${action.courseId}/continue-generation` };
    case 'regenerate_outline':
      return {
        method: 'POST',
        path: `/api/courses/${action.courseId}/regenerate-outline`,
        ...(action.extraInstructions ? { body: { extraInstructions: action.extraInstructions } } : {}),
      };
    case 'regenerate_lesson':
      return {
        method: 'POST',
        path: `/api/lessons/${action.lessonId}/regenerate`,
        body: { mode: 'full', ...(action.instruction ? { instruction: action.instruction } : {}) },
      };
    case 'deploy_course':
      // La route deploy attend { platforms: string[], mode } — l'UI de
      // confirmation peut compléter la plateforme si l'intention ne la fixe pas.
      return {
        method: 'POST',
        path: `/api/courses/${action.courseId}/deploy`,
        body: { platforms: action.platform ? [action.platform] : [], mode: 'auto' },
      };
    case 'none':
      return null;
  }
}

/** Résumé lisible (français) d'une action proposée. */
function summarize(action: AssistantAction, ctx: AssistantResolveContext): string {
  const courseLabel = ctx.currentCourseTitle ? `« ${ctx.currentCourseTitle} »` : 'ce cours';
  switch (action.type) {
    case 'create_course':
      return `Créer le cours « ${action.input.title} » (niveau ${action.input.difficulty}).`;
    case 'continue_generation':
      return `Valider la leçon relue et lancer la génération de la suivante pour ${courseLabel}.`;
    case 'regenerate_outline':
      return action.extraInstructions
        ? `Régénérer le plan de ${courseLabel} avec la consigne : « ${action.extraInstructions} ».`
        : `Régénérer le plan de ${courseLabel}.`;
    case 'regenerate_lesson':
      return action.instruction
        ? `Régénérer une leçon de ${courseLabel} avec la consigne : « ${action.instruction} ».`
        : `Régénérer une leçon de ${courseLabel}.`;
    case 'deploy_course':
      return action.platform
        ? `Déployer ${courseLabel} sur ${action.platform}.`
        : `Déployer ${courseLabel} (plateforme à choisir).`;
    case 'none':
      return action.reason;
  }
}

/** Construit le plan complet d'une action déjà résolue (mapping + résumé + garde). */
export function planForAction(action: AssistantAction, ctx: AssistantResolveContext = {}): ResolvedActionPlan {
  return {
    action,
    execution: executionForAction(action),
    summary: summarize(action, ctx),
    requiresConfirmation: assistantActionRequiresConfirmation(action),
  };
}

// ── Résolution d'intention (mots-clés, déterministe) ────────────
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function difficultyFromCommand(n: string): 'beginner' | 'intermediate' | 'advanced' {
  if (/(avance|expert|pro\b)/.test(n)) return 'advanced';
  if (/(intermediaire|moyen)/.test(n)) return 'intermediate';
  return 'beginner';
}

/** Extrait le sujet d'une commande « crée un cours sur X … ». */
function extractCourseTopic(raw: string): string {
  const marker = /\b(?:sur|about|concernant|de)\s+(.+)$/i.exec(raw);
  const topic = (marker?.[1] ?? '').replace(/\bpour\b.*$/i, '').replace(/\s+/g, ' ').trim();
  return topic.length >= 3 ? topic.slice(0, 120) : '';
}

/**
 * Résout une commande en langage naturel en une action PROPOSÉE (jamais
 * exécutée). Heuristique par mots-clés — déterministe, sans clé API. Les
 * actions qui ciblent un cours exigent un `currentCourseId` (l'assistant est
 * alors ouvert sur la page d'un cours) ; sinon l'intention est renvoyée en
 * 'none' avec une raison explicite.
 */
export function resolveAssistantCommand(
  command: string,
  ctx: AssistantResolveContext = {},
): ResolvedActionPlan {
  const raw = command.trim();
  const n = normalize(raw);

  if (n.length === 0) {
    return planForAction({ type: 'none', reason: 'Dites-moi ce que vous voulez faire (créer, régénérer, déployer…).' }, ctx);
  }

  // Création de cours — ne dépend d'aucun cours courant.
  if (/(cree|creer|cree-moi|nouveau cours|genere un cours|fais un cours|create)/.test(n)) {
    const topic = extractCourseTopic(raw);
    if (!topic) {
      return planForAction(
        { type: 'none', reason: 'Sur quel sujet voulez-vous créer un cours ? Précisez « … sur <sujet> ».' },
        ctx,
      );
    }
    return planForAction(
      {
        type: 'create_course',
        input: { title: topic, difficulty: difficultyFromCommand(n), locale: 'fr', targetPlatforms: [] },
      },
      ctx,
    );
  }

  // Déploiement.
  if (/(deploie|deployer|publie|publier|deploy|mets en ligne)/.test(n)) {
    if (!ctx.currentCourseId) {
      return planForAction({ type: 'none', reason: 'Ouvrez le cours à déployer, puis redemandez-moi.' }, ctx);
    }
    const platformMatch = /\b(?:sur|to)\s+([a-z0-9-]+)/i.exec(raw);
    const platform = platformMatch?.[1]?.toLowerCase();
    // Sans plateforme explicite, on NE propose PAS un déploiement (qui partirait
    // avec platforms:[] → cible ambiguë) : on demande laquelle, comme pour la
    // création de cours sans sujet.
    if (!platform) {
      return planForAction(
        { type: 'none', reason: 'Sur quelle plateforme déployer ? Précisez « … sur <plateforme> ».' },
        ctx,
      );
    }
    return planForAction(
      { type: 'deploy_course', courseId: ctx.currentCourseId, platform },
      ctx,
    );
  }

  // Régénération du plan.
  if (/(regener|regenere|refais le plan|nouveau plan|change le plan|outline)/.test(n)) {
    if (!ctx.currentCourseId) {
      return planForAction({ type: 'none', reason: 'Ouvrez le cours dont vous voulez régénérer le plan.' }, ctx);
    }
    return planForAction({ type: 'regenerate_outline', courseId: ctx.currentCourseId }, ctx);
  }

  // Validation / continuer la génération (mode validé).
  if (/(valide|valider|continue|continuer|lecon suivante|next lesson)/.test(n)) {
    if (!ctx.currentCourseId) {
      return planForAction({ type: 'none', reason: 'Ouvrez le cours en cours de génération pour continuer.' }, ctx);
    }
    return planForAction({ type: 'continue_generation', courseId: ctx.currentCourseId }, ctx);
  }

  return planForAction(
    {
      type: 'none',
      reason:
        'Je n’ai pas compris l’action. Essayez : « crée un cours sur Docker pour débutants », « régénère le plan », « déploie sur udemy ».',
    },
    ctx,
  );
}
