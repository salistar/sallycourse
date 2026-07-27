// Phase 10 (P163-174) — rendu des PARAMÈTRES AVANCÉS en directives texte
// injectées dans les prompts de génération (plan/scripts/articles/TP/quiz).
//
// Fonction PURE (aucune dépendance, testable) : prend les AdvancedParams d'un
// cours + la phase de génération, et renvoie un bloc de consignes en français à
// APPENDRE au prompt utilisateur. Retourne '' si aucun paramètre pertinent —
// aucun changement de comportement pour un cours créé en mode simple.
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import type { AdvancedParams } from './schemas/course';

/** Phase de génération à laquelle les directives sont appliquées. */
export type GenerationPhase = 'outline' | 'content' | 'script' | 'article' | 'quiz' | 'tp';

const TONE_LABEL: Record<string, string> = {
  academic: 'académique et rigoureux',
  conversational: 'conversationnel et accessible',
  energetic: 'énergique et motivant',
};
const DENSITY_LABEL: Record<string, string> = {
  concise: "synthétique (va droit à l'essentiel)",
  normal: 'équilibrée',
  detailed: 'très détaillée (explications approfondies, plusieurs exemples)',
};
const APPROACH_LABEL: Record<string, string> = {
  'theory-first': "théorie d'abord, puis mise en pratique",
  'examples-first': "exemples concrets d'abord, théorie ensuite",
  'practice-first': 'orientation pratique maximale (apprendre en faisant)',
};
const OBJECTIVE_LABEL: Record<string, string> = {
  certification: 'préparer une certification',
  'career-change': 'réussir une reconversion professionnelle',
  upskilling: 'monter en compétence sur le sujet',
};
const QUIZ_POS_LABEL: Record<string, string> = {
  'per-section': 'un quiz à la fin de chaque section',
  'mid-course': 'un quiz de bilan à mi-parcours',
  'final-only': 'un unique quiz final récapitulatif',
};
const TP_OS_LABEL: Record<string, string> = {
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
  web: 'navigateur web',
};

/**
 * Construit le bloc de consignes avancées pour une phase donnée. Les consignes
 * pédagogiques et de domaine s'appliquent à toutes les phases ; les consignes de
 * structure uniquement au plan (outline) ; les consignes d'OS/commentaires aux
 * TP/scripts. Ordre stable (facilite les tests + le cache de prompt).
 */
export function renderGenerationDirectives(
  params: AdvancedParams | undefined | null,
  phase: GenerationPhase,
): string {
  if (!params) return '';
  const lines: string[] = [];

  // ── Pédagogie (P165) — toutes phases ──
  if (params.tone && TONE_LABEL[params.tone]) lines.push(`Ton : ${TONE_LABEL[params.tone]}.`);
  if (params.density && DENSITY_LABEL[params.density]) lines.push(`Densité du contenu : ${DENSITY_LABEL[params.density]}.`);
  if (params.approach && APPROACH_LABEL[params.approach]) lines.push(`Approche pédagogique : ${APPROACH_LABEL[params.approach]}.`);
  if (params.analogies) lines.push('Utilise des analogies et du storytelling pour ancrer les concepts.');
  if (params.spacedRepetition) lines.push('Applique la répétition espacée : rappelle brièvement les concepts clés déjà vus.');
  if (params.audience && params.audience.trim()) {
    lines.push(`Public cible : ${params.audience.trim()}. Adapte impérativement les exemples, le vocabulaire et le rythme à ce public.`);
  }
  if (params.objective && OBJECTIVE_LABEL[params.objective]) {
    lines.push(`Objectif de l'apprenant : ${OBJECTIVE_LABEL[params.objective]} — oriente les exercices en ce sens.`);
  }

  // ── Domaine expert (P166) — toutes phases ──
  if (params.mandatoryKeywords?.length) {
    lines.push(`Couvre OBLIGATOIREMENT ces notions : ${params.mandatoryKeywords.join(', ')}.`);
  }
  if (params.excludedTopics?.length) {
    lines.push(`N'aborde surtout PAS ces sujets : ${params.excludedTopics.join(', ')}.`);
  }
  if (params.imposedTools && params.imposedTools.trim()) {
    lines.push(`Outils et versions IMPOSÉS : ${params.imposedTools.trim()}. N'utilise aucune alternative ni autre version.`);
  }
  if (params.glossary && params.glossary.trim()) {
    lines.push(`Respecte scrupuleusement cette terminologie imposée : ${params.glossary.trim()}.`);
  }
  if (params.certificationTarget && params.certificationTarget.trim()) {
    lines.push(`Aligne le contenu sur le référentiel officiel de la certification « ${params.certificationTarget.trim()} ».`);
  }

  // ── Structure (P164) — uniquement le plan ──
  if (phase === 'outline') {
    if (params.targetHours) lines.push(`Durée totale cible du cours : environ ${params.targetHours} heures de contenu.`);
    if (params.avgVideoLength) lines.push(`Durée moyenne visée par leçon vidéo : ${params.avgVideoLength} minutes.`);
    if (params.contentRatio) {
      const r = params.contentRatio;
      lines.push(
        `Répartition indicative des types de leçon (poids relatifs) : vidéo ${r.video}, article ${r.article}, TP ${r.tp}, quiz ${r.quiz}.`,
      );
    }
    if (params.quizPosition && QUIZ_POS_LABEL[params.quizPosition]) {
      lines.push(`Position des quiz : ${QUIZ_POS_LABEL[params.quizPosition]}.`);
    }
    if (params.finalExam) {
      const score = params.finalExamPassingScore ? ` (note de passage : ${params.finalExamPassingScore} %)` : '';
      lines.push(`Termine par un EXAMEN FINAL récapitulatif${score}.`);
    }
    if (params.projectMode === 'fil-rouge') {
      lines.push('Conçois les TP comme un PROJET FIL ROUGE unique qui évolue et se complexifie au fil du cours.');
    } else if (params.projectMode === 'independent') {
      lines.push('Conçois des TP INDÉPENDANTS, chacun autonome et complet en lui-même.');
    }
  }

  // ── TP / scripts pratiques (P166) ──
  if (phase === 'tp' || phase === 'script' || phase === 'content') {
    if (params.tpOs && params.tpOs !== 'any' && TP_OS_LABEL[params.tpOs]) {
      lines.push(`Cible les manipulations et commandes pour ${TP_OS_LABEL[params.tpOs]}.`);
    }
    if (params.codeCommentLang && params.codeCommentLang.trim()) {
      lines.push(`Rédige les commentaires de code en ${params.codeCommentLang.trim()}.`);
    }
  }

  // ── Dialogue multi-voix (P169) — narration en dialogue formateur/apprenant ──
  if ((phase === 'script' || phase === 'content') && params.dialogueMode) {
    lines.push(
      'Rédige la NARRATION de chaque slide sous forme de DIALOGUE entre un formateur (qui explique) et un ' +
        'apprenant (qui pose des questions pertinentes). Préfixe CHAQUE réplique par "[Formateur]" ou "[Apprenant]", ' +
        'une réplique par ligne.',
    );
  }

  // ── Quiz au format examen de certification (P168) ──
  if (phase === 'quiz' && params.certificationTarget && params.certificationTarget.trim()) {
    lines.push(
      `Rédige les questions au STYLE et au niveau de l'examen de certification « ${params.certificationTarget.trim()} » : ` +
        `mises en situation réalistes, distracteurs plausibles, formulation et difficulté conformes à l'examen réel.`,
    );
  }

  if (lines.length === 0) return '';
  return `\n\nCONSIGNES AVANCÉES (à respecter STRICTEMENT) :\n- ${lines.join('\n- ')}`;
}

/**
 * Normalise le ratio de types de contenu en pourcentages sommant à 100.
 * Si tous les poids sont nuls, retombe sur une répartition par défaut équilibrée.
 */
export function normalizeContentRatio(
  ratio: { video: number; article: number; tp: number; quiz: number } | undefined | null,
): { video: number; article: number; tp: number; quiz: number } {
  const r = ratio ?? { video: 40, article: 25, tp: 20, quiz: 15 };
  const total = r.video + r.article + r.tp + r.quiz;
  if (total <= 0) return { video: 40, article: 25, tp: 20, quiz: 15 };
  const pct = (v: number) => Math.round((v / total) * 100);
  return { video: pct(r.video), article: pct(r.article), tp: pct(r.tp), quiz: pct(r.quiz) };
}
