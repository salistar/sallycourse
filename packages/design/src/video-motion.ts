/**
 * @sallycourse/design — video-motion
 *
 * Spec typée de l'habillage vidéo SALISTAR : décrit chaque séquence animée
 * de render-templates/motion/ (durée, fps, mode de pilotage, placeholders,
 * données injectées) ainsi que le plan de transitions entre slides.
 *
 * Consommateurs :
 *  · le worker Playwright, qui capture les templates image par image
 *    (cf. render-templates/motion/README.md pour le protocole exact) ;
 *  · le worker FFmpeg, qui assemble les frames et applique les transitions
 *    (filtre xfade) décrites par `TransitionSpec`.
 *
 * Règle d'or : transitions SOBRES uniquement — fade, glissement, zoom léger.
 * Jamais de spirales, rotations ou effets « PowerPoint 2003 ».
 */

import { easings } from '@sallycourse/design/tokens';

/* ------------------------------------------------------------------ */
/* Constantes de rendu                                                 */
/* ------------------------------------------------------------------ */

/** Cadence de rendu par défaut (images/seconde). */
export const MOTION_FPS = 30;

/** Viewport de capture — plein HD, deviceScaleFactor 1. */
export const MOTION_VIEWPORT = { width: 1920, height: 1080 } as const;

export interface MotionViewport {
  readonly width: number;
  readonly height: number;
}

/* ------------------------------------------------------------------ */
/* Horloge virtuelle : frames ↔ --t                                    */
/* ------------------------------------------------------------------ */

/** Une image à capturer : indice, temps et valeur de --t à poser. */
export interface MotionFrame {
  /** Indice de l'image (0-based) — sert au nommage frame_%05d.png. */
  readonly frame: number;
  /** Position temporelle de l'image en millisecondes. */
  readonly timeMs: number;
  /** Valeur de la variable CSS `--t` (0 → 1) à poser sur <html>. */
  readonly t: number;
}

/** Nombre d'images d'un segment balayé (minimum 2 : première et dernière pose). */
export function motionFrameCount(durationMs: number, fps: number = MOTION_FPS): number {
  return Math.max(2, Math.round((durationMs / 1000) * fps));
}

/** Nombre d'images d'une tenue (0 accepté : aucune image répétée). */
export function motionHoldFrameCount(durationMs: number, fps: number = MOTION_FPS): number {
  return Math.max(0, Math.round((durationMs / 1000) * fps));
}

/** Valeur de --t pour une image donnée (dernière image = exactement 1). */
export function motionTForFrame(frame: number, totalFrames: number): number {
  if (totalFrames <= 1) return 1;
  return Math.min(1, Math.max(0, frame / (totalFrames - 1)));
}

/**
 * Plan de capture complet d'un segment seeké par --t : la boucle du worker
 * itère ce tableau, pose --t, attend la stabilisation, screenshote.
 */
export function motionFramePlan(
  durationMs: number,
  fps: number = MOTION_FPS,
): readonly MotionFrame[] {
  const total = motionFrameCount(durationMs, fps);
  return Array.from({ length: total }, (_, frame) => ({
    frame,
    timeMs: (frame / (total - 1)) * durationMs,
    t: motionTForFrame(frame, total),
  }));
}

/* ------------------------------------------------------------------ */
/* Transitions entre slides (assemblage FFmpeg)                        */
/* ------------------------------------------------------------------ */

/** Familles de transitions autorisées — sobres, rien d'autre. */
export type TransitionKind = 'cut' | 'fade' | 'slide' | 'zoom';

/**
 * Direction LOGIQUE d'un glissement : 'forward' suit le sens de lecture
 * (gauche → droite en LTR, droite → gauche en RTL), 'up'/'down' sont
 * indépendants de la direction d'écriture.
 */
export type TransitionDirection = 'forward' | 'backward' | 'up' | 'down';

/** Spécification d'une transition, consommable par le filtre xfade FFmpeg. */
export interface TransitionSpec {
  readonly kind: TransitionKind;
  /** Durée du chevauchement entre les deux plans, en millisecondes. */
  readonly durationMs: number;
  /** Direction logique — glissements uniquement. */
  readonly direction?: TransitionDirection;
  /** Sens du zoom — zooms uniquement ('in' = léger rapprochement). */
  readonly zoom?: 'in' | 'out';
  /**
   * Courbe indicative (tokens du design system) — xfade ne paramètre pas
   * l'easing, mais la valeur documente l'intention et sert aux previews CSS.
   */
  readonly cssEasing: string;
}

/**
 * Résout le nom de transition xfade FFmpeg pour une spec donnée, en tenant
 * compte du sens de lecture (les glissements 'forward'/'backward' s'inversent
 * en RTL). Exemple : `xfade=transition=slideleft:duration=0.45:offset=…`.
 */
export function resolveXfade(spec: TransitionSpec, dir: 'ltr' | 'rtl' = 'ltr'): string {
  switch (spec.kind) {
    case 'cut':
      // Pas de filtre : simple concaténation des segments.
      return 'none';
    case 'fade':
      return 'fade';
    case 'zoom':
      // xfade ne propose que zoomin ; le zoom arrière retombe sur un fondu.
      return spec.zoom === 'out' ? 'fade' : 'zoomin';
    case 'slide': {
      const direction = spec.direction ?? 'forward';
      if (direction === 'up') return 'slideup';
      if (direction === 'down') return 'slidedown';
      const forward = dir === 'rtl' ? 'slideright' : 'slideleft';
      const backward = dir === 'rtl' ? 'slideleft' : 'slideright';
      return direction === 'forward' ? forward : backward;
    }
  }
}

/** Types de slides connus du pipeline de rendu. */
export type SlideKind = 'intro' | 'title' | 'content' | 'bullet-highlight' | 'outro';

/** Clé d'une paire de slides consécutives. */
export type SlidePair = `${SlideKind}->${SlideKind}`;

/**
 * Plan de transitions : quelle transition entre deux types de slides.
 * Volontairement court — la sobriété EST la signature visuelle.
 */
export const motionTransitionPlan: {
  /** Transition par défaut quand la paire n'est pas listée. */
  readonly fallback: TransitionSpec;
  readonly byPair: Partial<Record<SlidePair, TransitionSpec>>;
} = {
  fallback: { kind: 'fade', durationMs: 400, cssEasing: easings.standard },
  byPair: {
    // L'intro laisse place au premier plan de leçon : fondu ample.
    'intro->title': { kind: 'fade', durationMs: 500, cssEasing: easings.out },
    'intro->content': { kind: 'fade', durationMs: 500, cssEasing: easings.out },
    // Titre → contenu : léger glissement vertical, on « descend » dans la leçon.
    'title->content': {
      kind: 'slide',
      durationMs: 450,
      direction: 'up',
      cssEasing: easings.standard,
    },
    // Contenu → contenu : fondu court, rythme soutenu.
    'content->content': { kind: 'fade', durationMs: 350, cssEasing: easings.standard },
    // Passage au surlignage de bullets : même famille visuelle, fondu discret.
    'content->bullet-highlight': { kind: 'fade', durationMs: 300, cssEasing: easings.standard },
    'bullet-highlight->content': { kind: 'fade', durationMs: 300, cssEasing: easings.standard },
    // Enchaînement de deux slides de bullets : glissement au sens de lecture.
    'bullet-highlight->bullet-highlight': {
      kind: 'slide',
      durationMs: 450,
      direction: 'forward',
      cssEasing: easings.standard,
    },
    // Vers l'outro : zoom léger, sensation de conclusion.
    'content->outro': { kind: 'zoom', durationMs: 600, zoom: 'in', cssEasing: easings.out },
    'bullet-highlight->outro': {
      kind: 'zoom',
      durationMs: 600,
      zoom: 'in',
      cssEasing: easings.out,
    },
    // Outro → intro de la leçon suivante (playlists) : fondu posé.
    'outro->intro': { kind: 'fade', durationMs: 600, cssEasing: easings.in },
  },
};

/** Transition à appliquer entre deux slides consécutives. */
export function transitionBetween(from: SlideKind, to: SlideKind): TransitionSpec {
  return motionTransitionPlan.byPair[`${from}->${to}`] ?? motionTransitionPlan.fallback;
}

/* ------------------------------------------------------------------ */
/* Séquences animées (render-templates/motion/*)                       */
/* ------------------------------------------------------------------ */

/** Description d'un placeholder {{NOM}} d'un template. */
export interface MotionPlaceholder {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

/**
 * Mode de pilotage d'une séquence :
 *  · 'timeline' — une timeline maîtresse unique, seekée par --t (0 → 1) ;
 *  · 'phases'   — phases in / hold / out posées en classe sur <body>,
 *                 --t balaie l'intérieur des phases in et out ;
 *  · 'steps'    — machine à états par élément (classes is-*), --t balaie
 *                 la transition d'activation de chaque étape.
 */
export type MotionDriveMode = 'timeline' | 'phases' | 'steps';

/** Socle commun à toutes les séquences. */
interface MotionSequenceBase<TId extends string, TData> {
  readonly id: TId;
  /** Fichier template, relatif à packages/design/render-templates/motion/. */
  readonly templateFile: string;
  readonly viewport: MotionViewport;
  readonly fps: number;
  /** true → capture avec alpha (omitBackground) pour superposition FFmpeg. */
  readonly transparent: boolean;
  readonly placeholders: readonly MotionPlaceholder[];
  /** Marqueur de type des données injectées — jamais peuplé au runtime. */
  readonly __data?: TData;
}

/** Séquence à timeline unique (intro, outro). */
export interface TimelineMotionSequence<TId extends string = string, TData = unknown>
  extends MotionSequenceBase<TId, TData> {
  readonly mode: 'timeline';
  /** Durée par défaut de la timeline (remplace {{SEQ_MS}}). */
  readonly durationMs: number;
}

/** Séquence à phases in / hold / out (lower-third). */
export interface PhasedMotionSequence<TId extends string = string, TData = unknown>
  extends MotionSequenceBase<TId, TData> {
  readonly mode: 'phases';
  /** Durée de la phase d'entrée (remplace {{SEQ_IN_MS}}). */
  readonly inMs: number;
  /** Durée de la phase de sortie (remplace {{SEQ_OUT_MS}}). */
  readonly outMs: number;
  /** Durée de hold — 1 frame capturée puis tenue par FFmpeg. */
  readonly holdMs: { readonly min: number; readonly default: number };
  /** Classes posées sur <body> pour sélectionner la phase. */
  readonly phaseClasses: { readonly in: string; readonly hold: string; readonly out: string };
}

/** Séquence à étapes (bullet-highlight). */
export interface SteppedMotionSequence<TId extends string = string, TData = unknown>
  extends MotionSequenceBase<TId, TData> {
  readonly mode: 'steps';
  /** Durée du balayage d'activation d'une étape (remplace {{SEQ_STEP_MS}}). */
  readonly stepMs: number;
  /** Nombre maximal d'étapes (bullets) par slide. */
  readonly maxSteps: number;
  /** Classes d'état posées sur chaque étape — exactement une à la fois. */
  readonly stateClasses: {
    readonly dim: string;
    readonly activating: string;
    readonly active: string;
    readonly done: string;
  };
}

/* ------------------------------ Données ------------------------------ */

/** Langue + sens d'écriture, communs à tous les templates. */
export interface MotionLocale {
  /** Code langue posé sur <html lang> ('fr' | 'ar' | 'en'…). */
  readonly lang: string;
  /** Sens d'écriture posé sur <html dir>. */
  readonly dir: 'ltr' | 'rtl';
}

/** Données de intro.html. */
export interface IntroData extends MotionLocale {
  readonly kicker: string;
  readonly courseTitle: string;
  /** Optionnel — le <p> vide est masqué par :empty. */
  readonly courseSubtitle?: string;
}

/** Données de lower-third.html. */
export interface LowerThirdData extends MotionLocale {
  readonly label: string;
  readonly term: string;
  readonly definition: string;
}

/** Données de outro.html. */
export interface OutroData extends MotionLocale {
  readonly outroLabel: string;
  readonly nextLessonTitle: string;
  /** Optionnel — le <span> vide est masqué par :empty. */
  readonly courseTitle?: string;
}

/** Données de bullet-highlight.html. */
export interface BulletHighlightData extends MotionLocale {
  readonly lessonLabel: string;
  readonly title: string;
  /** Textes bruts — le worker les échappe et fabrique les <li> (5 max). */
  readonly bullets: readonly string[];
}

/* --------------------------- Specs concrètes -------------------------- */

/** Intro 3 s : logo dessiné (stroke-dashoffset) + cascade de titres. */
export const introSequence: TimelineMotionSequence<'intro', IntroData> = {
  id: 'intro',
  templateFile: 'intro.html',
  mode: 'timeline',
  durationMs: 3000,
  fps: MOTION_FPS,
  viewport: MOTION_VIEWPORT,
  transparent: false,
  placeholders: [
    { name: 'LANG', required: true, description: 'Code langue (<html lang>).' },
    { name: 'DIR', required: true, description: "Sens d'écriture ltr|rtl (<html dir>)." },
    { name: 'SEQ_MS', required: true, description: 'Durée de la timeline, ex. « 3000 ».' },
    { name: 'KICKER', required: true, description: 'Surtitre court (nom de la marque/série).' },
    { name: 'COURSE_TITLE', required: true, description: 'Titre du cours (échappé).' },
    { name: 'COURSE_SUBTITLE', required: false, description: 'Sous-titre — vide accepté.' },
  ],
};

/** Lower-third : bandeau définition, couche alpha superposée à la vidéo. */
export const lowerThirdSequence: PhasedMotionSequence<'lower-third', LowerThirdData> = {
  id: 'lower-third',
  templateFile: 'lower-third.html',
  mode: 'phases',
  inMs: 600,
  outMs: 400,
  holdMs: { min: 2000, default: 4000 },
  phaseClasses: { in: 'phase-in', hold: 'phase-hold', out: 'phase-out' },
  fps: MOTION_FPS,
  viewport: MOTION_VIEWPORT,
  transparent: true,
  placeholders: [
    { name: 'LANG', required: true, description: 'Code langue (<html lang>).' },
    { name: 'DIR', required: true, description: "Sens d'écriture ltr|rtl (<html dir>)." },
    { name: 'SEQ_IN_MS', required: true, description: "Durée de la phase d'entrée." },
    { name: 'SEQ_OUT_MS', required: true, description: 'Durée de la phase de sortie.' },
    { name: 'LABEL', required: true, description: 'Étiquette (« Définition », « À retenir »).' },
    { name: 'TERM', required: true, description: 'Terme défini (échappé).' },
    { name: 'DEFINITION', required: true, description: 'Texte de la définition (échappé).' },
  ],
};

/** Outro 4 s : carte « leçon suivante » avec flèche d'invite. */
export const outroSequence: TimelineMotionSequence<'outro', OutroData> = {
  id: 'outro',
  templateFile: 'outro.html',
  mode: 'timeline',
  durationMs: 4000,
  fps: MOTION_FPS,
  viewport: MOTION_VIEWPORT,
  transparent: false,
  placeholders: [
    { name: 'LANG', required: true, description: 'Code langue (<html lang>).' },
    { name: 'DIR', required: true, description: "Sens d'écriture ltr|rtl (<html dir>)." },
    { name: 'SEQ_MS', required: true, description: 'Durée de la timeline, ex. « 4000 ».' },
    { name: 'OUTRO_LABEL', required: true, description: 'Badge (« Leçon suivante »).' },
    { name: 'NEXT_LESSON_TITLE', required: true, description: 'Titre de la leçon suivante.' },
    { name: 'COURSE_TITLE', required: false, description: 'Nom du cours — vide accepté.' },
  ],
};

/** Bullets surlignées au fil de la narration (sync audio par étapes). */
export const bulletHighlightSequence: SteppedMotionSequence<
  'bullet-highlight',
  BulletHighlightData
> = {
  id: 'bullet-highlight',
  templateFile: 'bullet-highlight.html',
  mode: 'steps',
  stepMs: 600,
  maxSteps: 5,
  stateClasses: {
    dim: 'is-dim',
    activating: 'is-activating',
    active: 'is-active',
    done: 'is-done',
  },
  fps: MOTION_FPS,
  viewport: MOTION_VIEWPORT,
  transparent: false,
  placeholders: [
    { name: 'LANG', required: true, description: 'Code langue (<html lang>).' },
    { name: 'DIR', required: true, description: "Sens d'écriture ltr|rtl (<html dir>)." },
    { name: 'SEQ_STEP_MS', required: true, description: "Durée du balayage d'activation." },
    { name: 'LESSON_LABEL', required: true, description: 'Kicker (« Leçon 3 »).' },
    { name: 'TITLE', required: true, description: 'Titre de la slide (échappé).' },
    { name: 'BULLETS', required: true, description: 'Fragments <li> générés — 5 max.' },
  ],
};

/* ------------------------------- Registre ---------------------------- */

/** Registre de toutes les séquences, indexé par id. */
export const motionSequences = {
  intro: introSequence,
  'lower-third': lowerThirdSequence,
  outro: outroSequence,
  'bullet-highlight': bulletHighlightSequence,
} as const;

/** Union discriminée (par `mode`) de toutes les séquences. */
export type MotionSequence =
  | typeof introSequence
  | typeof lowerThirdSequence
  | typeof outroSequence
  | typeof bulletHighlightSequence;

/** Identifiants valides de séquence. */
export type MotionSequenceId = MotionSequence['id'];

/** Données attendues par une séquence donnée (via le marqueur __data). */
export type MotionSequenceData<TId extends MotionSequenceId> = NonNullable<
  (typeof motionSequences)[TId]['__data']
>;

/* ------------------------------------------------------------------ */
/* Plans de capture par mode                                           */
/* ------------------------------------------------------------------ */

/**
 * Segment de capture prêt à exécuter : le worker itère `frames`, applique
 * `bodyClasses` / `stepStates` UNE fois en début de segment, puis pose --t
 * frame par frame. `holdFrames` > 0 signifie « répéter la dernière image ».
 */
export interface CaptureSegment {
  /** Étiquette du segment — sert au nommage des dossiers de frames. */
  readonly label: string;
  /** Classes à poser sur <body> pendant tout le segment. */
  readonly bodyClasses: readonly string[];
  /**
   * États par étape (mode 'steps') : classe à poser sur le n-ième .bh-bullet.
   * Vide pour les autres modes.
   */
  readonly stepStates: readonly string[];
  /** Frames seekées via --t (vide si le segment est une simple tenue). */
  readonly frames: readonly MotionFrame[];
  /** Nombre d'images supplémentaires tenant la dernière pose. */
  readonly holdFrames: number;
}

/** Plan de capture d'une séquence 'timeline' : un seul segment balayé. */
export function timelineCapturePlan(
  seq: TimelineMotionSequence<string, unknown>,
  durationMs: number = seq.durationMs,
): readonly CaptureSegment[] {
  return [
    {
      label: seq.id,
      bodyClasses: [],
      stepStates: [],
      frames: motionFramePlan(durationMs, seq.fps),
      holdFrames: 0,
    },
  ];
}

/** Plan de capture d'une séquence 'phases' : in balayé, hold tenu, out balayé. */
export function phasedCapturePlan(
  seq: PhasedMotionSequence<string, unknown>,
  holdMs: number = seq.holdMs.default,
): readonly CaptureSegment[] {
  const effectiveHold = Math.max(seq.holdMs.min, holdMs);
  return [
    {
      label: `${seq.id}-in`,
      bodyClasses: [seq.phaseClasses.in],
      stepStates: [],
      frames: motionFramePlan(seq.inMs, seq.fps),
      holdFrames: 0,
    },
    {
      // 1 seule image capturée (état final = état hold), répétée par FFmpeg.
      label: `${seq.id}-hold`,
      bodyClasses: [seq.phaseClasses.hold],
      stepStates: [],
      frames: [],
      holdFrames: motionHoldFrameCount(effectiveHold, seq.fps),
    },
    {
      label: `${seq.id}-out`,
      bodyClasses: [seq.phaseClasses.out],
      stepStates: [],
      frames: motionFramePlan(seq.outMs, seq.fps),
      holdFrames: 0,
    },
  ];
}

/**
 * Plan de capture d'une séquence 'steps' (bullet-highlight) : pour chaque
 * bullet, un segment d'activation balayé (--t) suivi d'une tenue dont la
 * durée vient du timing audio (`holdMsPerStep[i]` = durée de narration de
 * la bullet i, balayage déduit).
 */
export function steppedCapturePlan(
  seq: SteppedMotionSequence<string, unknown>,
  holdMsPerStep: readonly number[],
): readonly CaptureSegment[] {
  const steps = Math.min(holdMsPerStep.length, seq.maxSteps);
  const segments: CaptureSegment[] = [];
  for (let i = 0; i < steps; i += 1) {
    // États : déjà lues = done, courante = activating puis active, futures = dim.
    const activating = Array.from({ length: steps }, (_, j) =>
      j < i ? seq.stateClasses.done : j === i ? seq.stateClasses.activating : seq.stateClasses.dim,
    );
    const holding = Array.from({ length: steps }, (_, j) =>
      j < i ? seq.stateClasses.done : j === i ? seq.stateClasses.active : seq.stateClasses.dim,
    );
    segments.push({
      label: `${seq.id}-step${i}-in`,
      bodyClasses: [],
      stepStates: activating,
      frames: motionFramePlan(seq.stepMs, seq.fps),
      holdFrames: 0,
    });
    const holdMs = Math.max(0, (holdMsPerStep[i] ?? 0) - seq.stepMs);
    segments.push({
      label: `${seq.id}-step${i}-hold`,
      bodyClasses: [],
      stepStates: holding,
      frames: [],
      holdFrames: motionHoldFrameCount(holdMs, seq.fps),
    });
  }
  return segments;
}
