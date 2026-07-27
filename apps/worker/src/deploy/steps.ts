// Modèle PUR des étapes du flow de déploiement (Prompt 179) : sert de base à la
// BASCULE et à la REPRISE entre modes. Quand un déploiement AUTO/ASSISTÉ se bloque
// à mi-parcours (captcha, sélecteur cassé), on doit savoir précisément CE QU'IL
// RESTE à faire pour proposer un guide (mode manuel) ou une reprise (mode assisté)
// qui ne repart PAS de zéro.
//
// Le flow générique piloté par le processor (processors/deployment.ts) est :
//   authenticate → createCourse → upload (une étape PAR leçon) → landing → review
// Le checkpoint {lessonIndex, step} persisté sur le Deployment permet de replacer
// le curseur dans cette liste ordonnée.
//
// LIMITE ASSUMÉE (documentée ici ET dans le guide généré) : checkpoint.step est
// GROSSIER pour les phases pré-upload. L'adapter Udemy pose step='authenticate'
// AVANT même de réussir le login (juste avant la détection de captcha) ; les
// adapters qui ne persistent pas encore leur step laissent checkpoint vide. On
// adopte donc une règle CONSERVATRICE : une étape n'est considérée « faite » que
// si le curseur a STRICTEMENT dépassé sa phase. Ainsi une pause sur captcha
// (step='authenticate') re-propose l'authentification (comportement voulu), et un
// checkpoint vide re-propose TOUTES les étapes (dégradation propre). On n'invente
// aucune détection multi-plateforme : seule l'info réellement persistée est lue.

/** Phases logiques ordonnées du flow (miroir de UDEMY_STEPS / du processor). */
export const DEPLOY_PHASES = [
  'authenticate',
  'createCourse',
  'upload',
  'landing',
  'review',
] as const;

export type DeployPhase = (typeof DEPLOY_PHASES)[number];

/** Une étape du flow de déploiement (déroulée : une entrée par leçon pour l'upload). */
export interface DeployStep {
  /** Clé stable et unique (sert d'id de checklist / de persistance). */
  key: string;
  /** Phase logique de l'étape. */
  phase: DeployPhase;
  /** Index (0-based) de la leçon pour les étapes d'upload ; absent sinon. */
  lessonIndex?: number;
  /** Libellé lisible (FR), générique et sans dépendance plateforme. */
  label: string;
}

/** Étape annotée de son état d'avancement (déjà faite / restante). */
export interface AnnotatedStep extends DeployStep {
  /** true → déjà réalisée d'après le checkpoint ; false → restante. */
  done: boolean;
}

/** Point de reprise minimal (sous-ensemble du checkpoint du Deployment). */
export interface StepCheckpoint {
  lessonIndex: number;
  step: string;
}

/**
 * Rang d'une phase dans le flow. 'done' vaut au-delà de toutes les phases (flow
 * terminé). Un step inconnu / vide vaut -1 (aucune phase atteinte).
 */
const PHASE_RANK: Record<string, number> = {
  authenticate: 0,
  createCourse: 1,
  upload: 2,
  landing: 3,
  review: 4,
  done: 5,
};

/** Rang atteint par le checkpoint (-1 si vide/inconnu). */
function reachedRank(step: string): number {
  return step in PHASE_RANK ? (PHASE_RANK[step] as number) : -1;
}

/**
 * Liste ordonnée COMPLÈTE des étapes du flow pour un cours de `totalLessons`
 * leçons. L'upload est déroulé en une étape par leçon (index absolu = position
 * d'upload, alignée sur la boucle du processor). PUR.
 */
export function buildDeploySteps(totalLessons: number): DeployStep[] {
  const total = Math.max(0, Math.floor(totalLessons));
  const steps: DeployStep[] = [
    {
      key: 'authenticate',
      phase: 'authenticate',
      label: 'Se connecter à la plateforme et ouvrir votre espace formateur',
    },
    {
      key: 'createCourse',
      phase: 'createCourse',
      label: 'Créer le cours (titre, sous-titre, structure des sections)',
    },
  ];
  for (let i = 0; i < total; i += 1) {
    steps.push({
      key: `upload-${i}`,
      phase: 'upload',
      lessonIndex: i,
      label: `Téléverser la leçon ${i + 1} / ${total}`,
    });
  }
  steps.push({
    key: 'landing',
    phase: 'landing',
    label: 'Compléter la page de présentation (description, messages, image)',
  });
  steps.push({
    key: 'review',
    phase: 'review',
    label: 'Vérifier l’aperçu puis soumettre le cours à la publication',
  });
  return steps;
}

/** Une étape est-elle déjà faite d'après le checkpoint (règle conservatrice) ? */
function stepDone(step: DeployStep, checkpoint: StepCheckpoint): boolean {
  const reached = reachedRank(checkpoint.step);
  if (step.phase === 'upload') {
    // Upload dépassé (landing/review/done atteint) → toutes les leçons faites.
    if (reached > PHASE_RANK.upload!) return true;
    // Toujours en phase upload → leçon faite si son index a été dépassé.
    if (reached === PHASE_RANK.upload!) {
      return (step.lessonIndex ?? 0) < Math.max(0, checkpoint.lessonIndex);
    }
    return false;
  }
  // Phases singleton : faites uniquement si le curseur les a STRICTEMENT dépassées.
  return PHASE_RANK[step.phase]! < reached;
}

/**
 * Étapes du flow annotées de leur état d'avancement (done/pending) compte tenu
 * du checkpoint. Retourne la liste ORDONNÉE COMPLÈTE : les appelants filtrent sur
 * `done` (récapitulatif du déjà-fait) ou `!done` (étapes RESTANTES du guide de
 * reprise). Un checkpoint vide ⇒ toutes les étapes `pending` (guide complet). PUR.
 */
export function remainingSteps(
  totalLessons: number,
  checkpoint: StepCheckpoint,
): AnnotatedStep[] {
  return buildDeploySteps(totalLessons).map((step) => ({
    ...step,
    done: stepDone(step, checkpoint),
  }));
}
