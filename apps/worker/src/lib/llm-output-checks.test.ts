// Tests des détections d'hallucination structurelle (P121) : chaque check a un
// cas qui doit échouer (problems non vide) et un cas qui doit passer (vide).
import { describe, expect, it } from 'vitest';
import type { Outline, QuizQuestion } from '../shared.js';
import { checkOutlineStructuralIntegrity, checkQuizNoDuplicateCorrectAnswer } from './llm-output-checks.js';

/** Outline minimal conforme au schéma — deux sections, chacune terminée par un quiz. */
function baseOutline(): Outline {
  return {
    title: 'Apprendre Docker de zéro',
    subtitle: 'Conteneurs pour les débutants',
    description: 'Un cours complet sur Docker.',
    learningObjectives: ['Comprendre les images', 'Lancer un conteneur', 'Écrire un Dockerfile', 'Déployer une app'],
    prerequisites: [],
    targetAudience: ['Développeurs débutants'],
    sections: [
      {
        title: 'Les fondamentaux',
        lessons: [
          { title: 'Comprendre les images', type: 'video', durationMin: 10, summary: 'Couches et tags.' },
          { title: 'TP : premier conteneur', type: 'tp', durationMin: 15, summary: 'docker run pas à pas.' },
          { title: 'Quiz — Les fondamentaux', type: 'quiz', durationMin: 5, summary: 'Vérification des acquis.' },
        ],
      },
      {
        title: 'Aller plus loin',
        lessons: [
          { title: 'Dockerfile avancé', type: 'video', durationMin: 12, summary: 'Multi-stage builds.' },
          { title: 'Quiz — Aller plus loin', type: 'quiz', durationMin: 5, summary: 'Vérification des acquis.' },
        ],
      },
    ],
  };
}

/** Question de quiz minimale conforme au schéma (4 choix distincts). */
function baseQuestion(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    question: 'Quelle commande lance un conteneur ?',
    choices: ['docker run', 'docker build', 'docker ps', 'docker pull'],
    correctIndex: 0,
    explanation: '« docker run » démarre un conteneur depuis une image ; les autres commandes ne le font pas.',
    difficulty: 'beginner',
    ...overrides,
  };
}

describe('checkOutlineStructuralIntegrity', () => {
  it('ne signale rien sur un outline conforme (quiz en fin de section, aucune section vide)', () => {
    expect(checkOutlineStructuralIntegrity(baseOutline())).toEqual([]);
  });

  it('signale une section vide', () => {
    const outline = baseOutline();
    outline.sections.push({ title: 'Section fantôme', lessons: [] });
    const problems = checkOutlineStructuralIntegrity(outline);
    expect(problems.some((p) => p.includes('aucune leçon'))).toBe(true);
  });

  it('signale un quiz en première position d\'une section (incohérence pédagogique)', () => {
    const outline = baseOutline();
    outline.sections[0]!.lessons.unshift({
      title: 'Quiz surprise',
      type: 'quiz',
      durationMin: 5,
      summary: 'Un quiz avant tout contenu.',
    });
    const problems = checkOutlineStructuralIntegrity(outline);
    expect(problems.some((p) => p.includes('commence par un quiz'))).toBe(true);
  });
});

describe('checkQuizNoDuplicateCorrectAnswer', () => {
  it('ne signale rien quand tous les choix sont distincts', () => {
    expect(checkQuizNoDuplicateCorrectAnswer([baseQuestion()])).toEqual([]);
  });

  it('signale une bonne réponse dupliquée parmi les choix (question ambiguë)', () => {
    const question = baseQuestion({
      choices: ['docker run', 'docker build', 'Docker run', 'docker pull'],
      correctIndex: 0,
    });
    const problems = checkQuizNoDuplicateCorrectAnswer([question]);
    expect(problems.some((p) => p.includes('apparaît 2 fois'))).toBe(true);
  });
});
