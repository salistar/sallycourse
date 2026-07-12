// Tests du mode hors-ligne / export portable (Prompt 142) :
//  - génération du HTML statique d'une leçon (pure, template) — vidéo native
//    en chemin relatif, article Markdown→HTML, aucune requête réseau ;
//  - validité du JS de quiz autonome : on exécute littéralement le script
//    généré dans un DOM minimal maison (aucun jsdom dispo) pour vérifier le
//    comportement réel (clic → feedback → score), pas juste sa présence texte.
import { describe, expect, it } from 'vitest';
import {
  lessonFileName,
  lessonProgressId,
  portableHomeHtml,
  portableLessonHtml,
  quizScript,
  sectionDirName,
  type PortableCourseInput,
  type PortableSectionInput,
} from './portable-export.js';
import type { QuizQuestion } from '../shared.js';

/* ------------------------------------------------------------------ */
/* Génération HTML statique (pure)                                     */
/* ------------------------------------------------------------------ */

describe('portableHomeHtml — page d’accueil du site portable', () => {
  const course: PortableCourseInput = {
    courseId: 'course-abc',
    title: 'Cours de Démo',
    description: 'Une description du cours.',
    locale: 'fr',
    sections: [
      {
        order: 0,
        title: 'Introduction',
        lessons: [
          { order: 0, title: 'Bienvenue', type: 'article', articleMarkdown: '# Salut', durationMin: 5 },
          { order: 1, title: 'Démo vidéo', type: 'video', videoFileName: 'video.mp4' },
        ],
      },
    ],
  };

  it('ne contient aucune requête réseau (pas de fetch/XHR/lien externe http)', () => {
    const html = portableHomeHtml(course);
    expect(html).not.toMatch(/fetch\(/);
    expect(html).not.toMatch(/XMLHttpRequest/);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('liste les sections et les leçons avec liens relatifs', () => {
    const html = portableHomeHtml(course);
    expect(html).toContain('Introduction');
    expect(html).toContain('01-introduction/01-bienvenue.html');
    expect(html).toContain('01-introduction/02-demo-video.html');
    expect(html).toContain('Cours de Démo');
    expect(html).toContain('Une description du cours.');
  });

  it('est un document HTML autonome valide (doctype, head, body, script inline)', () => {
    const html = portableHomeHtml(course);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html lang="fr" dir="ltr">');
    expect(html).toContain('<style>');
    expect(html).toContain('sallycoursePortable');
  });

  it('applique dir="rtl" pour la locale arabe', () => {
    const html = portableHomeHtml({ ...course, locale: 'ar' });
    expect(html).toContain('dir="rtl"');
  });
});

describe('portableLessonHtml — page de leçon (vidéo/article)', () => {
  const course: PortableCourseInput = {
    courseId: 'course-abc',
    title: 'Cours de Démo',
    locale: 'fr',
    sections: [],
  };
  const section: PortableSectionInput = { order: 0, title: 'Introduction', lessons: [] };

  it('rend une leçon vidéo avec <video> HTML5 natif en chemin relatif (pas d’URL absolue)', () => {
    const html = portableLessonHtml({
      course,
      section,
      lesson: { order: 1, title: 'Démo vidéo', type: 'video', videoFileName: 'video.mp4', captionsFileName: 'captions.vtt' },
    });
    expect(html).toContain('<video controls preload="metadata">');
    expect(html).toContain('<source src="video.mp4" type="video/mp4">');
    expect(html).toContain('<track kind="subtitles" src="captions.vtt"');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/fetch\(/);
  });

  it('rend une leçon article en HTML statique (Markdown converti)', () => {
    const html = portableLessonHtml({
      course,
      section,
      lesson: { order: 0, title: 'Bienvenue', type: 'article', articleMarkdown: '# Titre\n\nUn **gras**.' },
    });
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<strong>gras</strong>');
  });

  it('inclut un lien relatif de retour vers la page d’accueil', () => {
    const html = portableLessonHtml({
      course,
      section,
      lesson: { order: 0, title: 'Bienvenue', type: 'article', articleMarkdown: '# Titre' },
    });
    expect(html).toContain('href="../index.html"');
  });

  it('omet le bloc quiz si aucune question rattachée', () => {
    const html = portableLessonHtml({
      course,
      section,
      lesson: { order: 0, title: 'Bienvenue', type: 'article', articleMarkdown: '# Titre' },
    });
    expect(html).not.toContain('quiz-root');
  });

  it('inclut le bloc quiz et son script si des questions sont rattachées', () => {
    const questions: QuizQuestion[] = [
      { question: 'Q1 ?', choices: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: 'Car B.', difficulty: 'beginner' },
    ];
    const html = portableLessonHtml({
      course,
      section,
      lesson: { order: 0, title: 'Bienvenue', type: 'article', articleMarkdown: '# Titre', quiz: questions },
    });
    expect(html).toContain('id="quiz-root"');
    expect(html).toContain('QUESTIONS');
  });
});

describe('sectionDirName / lessonFileName / lessonProgressId', () => {
  it('génère une arborescence ordonnée stable', () => {
    expect(sectionDirName({ order: 0, title: 'Introduction' })).toBe('01-introduction');
    expect(lessonFileName({ order: 2, title: 'Aller plus loin' })).toBe('03-aller-plus-loin.html');
    expect(lessonProgressId(0, 2)).toBe('s0-l2');
  });
});

/* ------------------------------------------------------------------ */
/* Quiz JS autonome — exécution réelle du comportement dans un DOM maison */
/* ------------------------------------------------------------------ */

/**
 * DOM minimal maison (aucun jsdom dans les deps worker) suffisant pour
 * exécuter le script généré par quizScript() : createElement/appendChild/
 * querySelectorAll/addEventListener/click, juste ce qu'utilise le template.
 */
class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
  disabled = false;
  className = '';
  private _textContent = '';

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  set textContent(value: string) {
    this._textContent = value;
    this.children = [];
  }
  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(event: string, cb: () => void): void {
    (this.listeners[event] ??= []).push(cb);
  }

  click(): void {
    for (const cb of this.listeners.click ?? []) cb();
  }

  querySelectorAll(selector: string): FakeElement[] {
    // Seul usage réel dans le template : '.quiz-choice'.
    const cls = selector.replace('.', '');
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      if (el.className.split(' ').includes(cls)) out.push(el);
      for (const c of el.children) walk(c);
    };
    for (const c of this.children) walk(c);
    return out;
  }

  get innerHTML(): string {
    return this.children.length ? '<rendered>' : '';
  }
  set innerHTML(_value: string) {
    this.children = [];
  }

  classList = {
    add: (cls: string): void => {
      const parts = this.className.split(' ').filter(Boolean);
      if (!parts.includes(cls)) parts.push(cls);
      this.className = parts.join(' ');
    },
  };
}

/** Exécute le script de quiz généré dans un environnement DOM factice, retourne le root. */
function runQuizScript(questions: QuizQuestion[]): { root: FakeElement; document: unknown } {
  const root = new FakeElement('div');
  const fakeDocument = {
    getElementById: (id: string) => (id === 'quiz-root' ? root : null),
    createElement: (tag: string) => new FakeElement(tag),
  };
  const script = quizScript(questions);
   
  const fn = new Function('document', script);
  fn(fakeDocument);
  return { root, document: fakeDocument };
}

describe('quizScript — comportement autonome (aucun backend, JS pur)', () => {
  const questions: QuizQuestion[] = [
    { question: 'Capitale de la France ?', choices: ['Lyon', 'Paris', 'Nice', 'Metz'], correctIndex: 1, explanation: 'Paris est la capitale.', difficulty: 'beginner' },
    { question: '2 + 2 ?', choices: ['3', '4', '5', '6'], correctIndex: 1, explanation: '', difficulty: 'beginner' },
  ];

  it('ne référence aucun appel réseau (fetch/XHR)', () => {
    const script = quizScript(questions);
    expect(script).not.toMatch(/fetch\(/);
    expect(script).not.toMatch(/XMLHttpRequest/);
  });

  it('rend la première question avec ses choix en boutons', () => {
    const { root } = runQuizScript(questions);
    const choices = root.querySelectorAll('.quiz-choice');
    expect(choices).toHaveLength(4);
  });

  it('sélectionner la bonne réponse marque le bouton "correct" et incrémente le score', () => {
    const { root } = runQuizScript(questions);
    const choices = root.querySelectorAll('.quiz-choice');
    // Index 1 = "Paris" = bonne réponse.
    choices[1]!.click();

    const afterAnswer = root.querySelectorAll('.quiz-choice');
    expect(afterAnswer[1]!.className).toContain('correct');
    expect(afterAnswer.every((b) => b.disabled)).toBe(true);

    // Le bouton "suivant" apparaît puis fait avancer le quiz jusqu'au score final.
    const nextButtons = root.querySelectorAll('.mark-done');
    expect(nextButtons).toHaveLength(1);
    nextButtons[0]!.click();

    const q2Choices = root.querySelectorAll('.quiz-choice');
    expect(q2Choices).toHaveLength(4);
    q2Choices[1]!.click(); // "4" = bonne réponse.
    root.querySelectorAll('.mark-done')[0]!.click();

    expect(root.textContent).toContain('Score final : 2 / 2');
  });

  it('sélectionner une mauvaise réponse marque "incorrect" et ne compte pas le point', () => {
    const { root } = runQuizScript(questions);
    const choices = root.querySelectorAll('.quiz-choice');
    choices[0]!.click(); // "Lyon" = mauvaise réponse.
    const after = root.querySelectorAll('.quiz-choice');
    expect(after[0]!.className).toContain('incorrect');
    expect(after[1]!.className).toContain('correct'); // La bonne reste indiquée.

    root.querySelectorAll('.mark-done')[0]!.click();
    root.querySelectorAll('.quiz-choice')[1]!.click(); // Bonne réponse Q2.
    root.querySelectorAll('.mark-done')[0]!.click();

    expect(root.textContent).toContain('Score final : 1 / 2');
  });

  it('ne rend rien si la liste de questions est vide', () => {
    const { root } = runQuizScript([]);
    expect(root.children).toHaveLength(0);
  });
});
