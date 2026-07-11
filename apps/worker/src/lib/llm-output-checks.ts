// Détection d'HALLUCINATION STRUCTURELLE (P121) : au-delà du safeParse Zod
// (qui garantit la FORME), ces checks vérifient la COHÉRENCE métier d'une
// sortie LLM déjà validée par schéma. Logique PURE (aucune I/O) — les
// processors appellent ces fonctions après le parse réussi de callClaudeJson
// et réinjectent les problèmes en feedback dans leur boucle de retry
// existante (même pattern que validateOutlineBusiness / validateQuizBusiness).
import type { Outline, QuizQuestion } from '../shared.js';

/**
 * Vérifie qu'aucune section de l'outline n'est vide et qu'aucune section ne
 * commence par un quiz (incohérence pédagogique : le quiz doit clôturer une
 * section, jamais l'ouvrir — l'apprenant serait évalué avant tout contenu).
 * Retourne la liste des problèmes (vide si conforme).
 */
export function checkOutlineStructuralIntegrity(outline: Outline): string[] {
  const problems: string[] = [];

  outline.sections.forEach((section, index) => {
    const n = index + 1;
    if (section.lessons.length === 0) {
      problems.push(`La section ${n} (« ${section.title} ») ne contient aucune leçon.`);
      return;
    }
    const first = section.lessons[0];
    if (first?.type === 'quiz') {
      problems.push(
        `La section ${n} (« ${section.title} ») commence par un quiz — un quiz ne peut pas être la première leçon d'une section (incohérence pédagogique : rien n'a encore été enseigné).`,
      );
    }
  });

  return problems;
}

/**
 * Vérifie qu'aucune question de quiz n'a deux choix identiques au texte de la
 * bonne réponse (correctIndex) : si un distracteur reprend mot pour mot la
 * bonne réponse, la question devient ambiguë ou insoluble (deux choix
 * « corrects » aux yeux de l'apprenant). Distinct de la vérif d'unicité
 * globale des choix (validateQuizBusiness) : ici on cible spécifiquement la
 * bonne réponse dupliquée ailleurs dans la liste.
 */
export function checkQuizNoDuplicateCorrectAnswer(questions: readonly QuizQuestion[]): string[] {
  const problems: string[] = [];

  questions.forEach((q, index) => {
    const n = index + 1;
    const correctText = q.choices[q.correctIndex]?.trim().toLowerCase();
    if (correctText === undefined) return;
    const occurrences = q.choices.filter((c) => c.trim().toLowerCase() === correctText).length;
    if (occurrences > 1) {
      problems.push(
        `Question ${n} : la bonne réponse (« ${q.choices[q.correctIndex]} ») apparaît ${occurrences} fois parmi les choix — deux choix identiques rendraient la question ambiguë.`,
      );
    }
  });

  return problems;
}
