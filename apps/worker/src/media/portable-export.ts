// Helpers purs du mode hors-ligne / export portable (Prompt 142) : génèrent un
// mini-site HTML/CSS/JS autonome (aucun framework) utilisable en file:// depuis
// une clé USB — page d'accueil + une page par leçon, quiz en JS pur (aucun
// fetch(), progression en localStorage). Isolés du processor pour être testés
// sans navigateur ni stockage (mêmes conventions que media/pack.ts).
//
// Contraintes file:// strictes respectées ici :
//  - aucune requête réseau (pas de fetch/XHR, pas de CDN, pas de lien externe) ;
//  - vidéos/CSS/JS embarqués localement, chemins relatifs uniquement ;
//  - progression persistée en localStorage (clé namespacée par cours) ;
//  - <video> HTML5 natif avec fichier local relatif (fonctionne en file://
//    contrairement à fetch() qui est bloqué par CORS sous ce protocole).

import type { QuizQuestion } from '../shared.js';
import { escapeHtml, markdownToHtml, orderedName, slugify } from './pack.js';

/* ------------------------------------------------------------------ */
/* Types d'entrée (vue simplifiée cours/section/leçon pour l'export)   */
/* ------------------------------------------------------------------ */

export interface PortableLessonInput {
  order: number;
  title: string;
  type: 'video' | 'article';
  /** Nom de fichier vidéo relatif déjà copié dans le ZIP (ex. "video.mp4"), si leçon vidéo présente. */
  videoFileName?: string;
  /** Sous-titres WebVTT relatifs (ex. "captions.vtt"), si présents. */
  captionsFileName?: string;
  /** Markdown brut de l'article, si leçon article présente. */
  articleMarkdown?: string;
  /** Résumé court affiché sur la page d'accueil. */
  summary?: string;
  durationMin?: number;
  /** Questions de quiz rattachées à cette leçon (optionnel — un quiz peut être par section). */
  quiz?: readonly QuizQuestion[];
}

export interface PortableSectionInput {
  order: number;
  title: string;
  lessons: readonly PortableLessonInput[];
}

export interface PortableCourseInput {
  courseId: string;
  title: string;
  description?: string;
  locale: string;
  sections: readonly PortableSectionInput[];
}

/** Chemin relatif (depuis la racine du site) du dossier d'une section. */
export function sectionDirName(section: { order: number; title: string }): string {
  return orderedName(section.order, section.title);
}

/** Nom de fichier HTML d'une leçon (sans dossier). */
export function lessonFileName(lesson: { order: number; title: string }): string {
  return `${orderedName(lesson.order, lesson.title)}.html`;
}

/* ------------------------------------------------------------------ */
/* CSS partagé (inline dans chaque page — aucun lien externe)          */
/* ------------------------------------------------------------------ */

const SHARED_STYLE = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{font-family:Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;max-width:900px;margin:0 auto;padding:1.5rem;color:#1a1523;background:#fbfaff}
h1,h2,h3{font-family:Georgia,serif;line-height:1.25}
a{color:#6b46e5}
nav.breadcrumb{font-size:.9rem;margin-bottom:1rem}
nav.breadcrumb a{text-decoration:none}
.card{border:1px solid #e4dff2;border-radius:.75rem;padding:1rem 1.25rem;margin:.75rem 0;background:#fff}
.card a{text-decoration:none;font-weight:600;display:block}
.meta{color:#6b6478;font-size:.85rem;margin-top:.25rem}
.progress-badge{display:inline-block;font-size:.75rem;padding:.15rem .5rem;border-radius:1rem;background:#efeaf6;color:#4a4458;margin-left:.5rem}
.progress-badge.done{background:#dff5e6;color:#1e6b3a}
video{width:100%;border-radius:.5rem;background:#000}
.quiz-question{border:1px solid #e4dff2;border-radius:.5rem;padding:1rem;margin:1rem 0}
.quiz-choice{display:block;width:100%;text-align:left;padding:.6rem .8rem;margin:.35rem 0;border:1px solid #d8d2e8;border-radius:.5rem;background:#fff;cursor:pointer;font-size:1rem}
.quiz-choice:hover{background:#f6f3fb}
.quiz-choice.correct{background:#dff5e6;border-color:#1e6b3a}
.quiz-choice.incorrect{background:#fbe4e4;border-color:#a33}
.quiz-explanation{margin-top:.5rem;font-size:.9rem;color:#4a4458}
.quiz-score{font-weight:600;margin-top:1rem}
footer.usb-note{margin-top:3rem;font-size:.8rem;color:#8a8296;border-top:1px solid #e4dff2;padding-top:1rem}
button.mark-done{margin-top:1.5rem;padding:.6rem 1.1rem;border:none;border-radius:.5rem;background:#6b46e5;color:#fff;font-size:1rem;cursor:pointer}
button.mark-done:disabled{background:#bcb3d9;cursor:default}
`;

/* ------------------------------------------------------------------ */
/* JS partagé — progression localStorage (aucun réseau)                */
/* ------------------------------------------------------------------ */

/**
 * Script de progression injecté sur chaque page. Namespace localStorage par
 * cours (clé `sallycourse-portable:{courseId}`) pour ne pas collisionner si
 * plusieurs exports sont ouverts depuis le même navigateur/USB.
 */
function progressScript(courseId: string): string {
  const key = `sallycourse-portable:${JSON.stringify(courseId).slice(1, -1)}`;
  return `
(function(){
  var STORAGE_KEY = "${key}";
  function loadProgress(){
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveProgress(p){
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) {}
  }
  window.sallycoursePortable = {
    isDone: function(lessonId){ return !!loadProgress()[lessonId]; },
    markDone: function(lessonId){ var p = loadProgress(); p[lessonId] = true; saveProgress(p); },
    all: loadProgress
  };
})();
`;
}

/** Applique les badges « terminé » sur la page d'accueil au chargement (lecture localStorage seule). */
const HOME_PROGRESS_APPLY_SCRIPT = `
document.addEventListener('DOMContentLoaded', function(){
  var progress = window.sallycoursePortable.all();
  document.querySelectorAll('[data-lesson-id]').forEach(function(el){
    var id = el.getAttribute('data-lesson-id');
    if (progress[id]) {
      var badge = el.querySelector('.progress-badge');
      if (badge) { badge.textContent = 'Terminé'; badge.classList.add('done'); }
    }
  });
});
`;

/* ------------------------------------------------------------------ */
/* Quiz JS pur (aucun backend, correction + score côté client)         */
/* ------------------------------------------------------------------ */

/**
 * Sérialise les questions en JSON embarqué dans la page (pas de fetch()) et
 * génère le script de rendu/correction. Une question à la fois, feedback
 * immédiat (bonne/mauvaise réponse + explication), score final affiché.
 */
export function quizScript(questions: readonly QuizQuestion[]): string {
  const safeQuestions = questions.map((q) => ({
    question: q.question,
    choices: [...q.choices],
    correctIndex: q.correctIndex,
    explanation: q.explanation ?? '',
  }));
  const data = JSON.stringify(safeQuestions).replace(/</g, '\\u003c');
  return `
(function(){
  var QUESTIONS = ${data};
  var current = 0;
  var score = 0;
  var root = document.getElementById('quiz-root');
  if (!root || QUESTIONS.length === 0) return;

  function render(){
    root.innerHTML = '';
    if (current >= QUESTIONS.length) {
      var done = document.createElement('p');
      done.className = 'quiz-score';
      done.textContent = 'Score final : ' + score + ' / ' + QUESTIONS.length;
      root.appendChild(done);
      return;
    }
    var q = QUESTIONS[current];
    var box = document.createElement('div');
    box.className = 'quiz-question';
    var title = document.createElement('p');
    title.textContent = (current + 1) + '. ' + q.question;
    box.appendChild(title);

    var answered = false;
    q.choices.forEach(function(choice, idx){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-choice';
      btn.textContent = choice;
      btn.addEventListener('click', function(){
        if (answered) return;
        answered = true;
        var buttons = box.querySelectorAll('.quiz-choice');
        buttons.forEach(function(b, bi){
          b.disabled = true;
          if (bi === q.correctIndex) b.classList.add('correct');
          else if (bi === idx) b.classList.add('incorrect');
        });
        if (idx === q.correctIndex) score += 1;
        if (q.explanation) {
          var expl = document.createElement('p');
          expl.className = 'quiz-explanation';
          expl.textContent = q.explanation;
          box.appendChild(expl);
        }
        var next = document.createElement('button');
        next.type = 'button';
        next.className = 'mark-done';
        next.textContent = (current + 1 < QUESTIONS.length) ? 'Question suivante' : 'Voir le score';
        next.addEventListener('click', function(){
          current += 1;
          render();
        });
        box.appendChild(next);
      });
      box.appendChild(btn);
    });
    root.appendChild(box);
  }
  render();
})();
`;
}

/* ------------------------------------------------------------------ */
/* Page d'accueil du cours                                             */
/* ------------------------------------------------------------------ */

/** Construit le lien relatif (depuis la racine du site) vers la page d'une leçon. */
function lessonHref(section: PortableSectionInput, lesson: PortableLessonInput): string {
  return `${sectionDirName(section)}/${lessonFileName(lesson)}`;
}

/** Identifiant stable d'une leçon pour la progression localStorage. */
export function lessonProgressId(sectionOrder: number, lessonOrder: number): string {
  return `s${sectionOrder}-l${lessonOrder}`;
}

/**
 * Page d'accueil du site portable : titre + description du cours, sommaire
 * par section avec lien vers chaque leçon. Aucune requête réseau — tous les
 * liens sont relatifs (fonctionne en double-clic sur index.html).
 */
export function portableHomeHtml(course: PortableCourseInput): string {
  const dir = course.locale === 'ar' ? 'rtl' : 'ltr';
  const sectionsHtml = course.sections
    .map((section) => {
      const lessonsHtml = section.lessons
        .map((lesson) => {
          const id = lessonProgressId(section.order, lesson.order);
          const duration = lesson.durationMin ? ` · ${lesson.durationMin} min` : '';
          return [
            `<div class="card" data-lesson-id="${escapeHtml(id)}">`,
            `<a href="${escapeHtml(lessonHref(section, lesson))}">${escapeHtml(lesson.title)}</a>`,
            `<span class="progress-badge">À faire</span>`,
            lesson.summary ? `<p class="meta">${escapeHtml(lesson.summary)}${escapeHtml(duration)}</p>` : `<p class="meta">${escapeHtml(duration.replace(' · ', ''))}</p>`,
            `</div>`,
          ].join('');
        })
        .join('\n');
      return `<h2>${escapeHtml(section.title)}</h2>\n${lessonsHtml}`;
    })
    .join('\n');

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(course.locale)}" dir="${dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(course.title)}</title>`,
    `<style>${SHARED_STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(course.title)}</h1>`,
    course.description ? `<p>${escapeHtml(course.description)}</p>` : '',
    sectionsHtml,
    '<footer class="usb-note">Export portable SallyCourse — fonctionne hors ligne, sans serveur ni connexion internet.</footer>',
    `<script>${progressScript(course.courseId)}</script>`,
    `<script>${HOME_PROGRESS_APPLY_SCRIPT}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Page de leçon (vidéo native ou article statique + quiz optionnel)   */
/* ------------------------------------------------------------------ */

export interface PortableLessonPageOptions {
  course: PortableCourseInput;
  section: PortableSectionInput;
  lesson: PortableLessonInput;
}

/**
 * Page HTML autonome d'une leçon. Vidéo : balise <video> HTML5 native pointant
 * vers le fichier MP4 EMBARQUÉ (chemin relatif, aucune presigned URL). Article :
 * Markdown déjà converti en HTML. Quiz (si présent) : rendu/corrigé en JS pur.
 * Bouton « Marquer terminé » persiste en localStorage (aucun appel réseau).
 */
export function portableLessonHtml({ course, section, lesson }: PortableLessonPageOptions): string {
  const dir = course.locale === 'ar' ? 'rtl' : 'ltr';
  const lessonId = lessonProgressId(section.order, lesson.order);
  const backHref = '../index.html';

  const bodyParts: string[] = [
    `<nav class="breadcrumb"><a href="${backHref}">&larr; ${escapeHtml(course.title)}</a></nav>`,
    `<h1>${escapeHtml(lesson.title)}</h1>`,
  ];

  if (lesson.type === 'video' && lesson.videoFileName) {
    const track = lesson.captionsFileName
      ? `<track kind="subtitles" src="${escapeHtml(lesson.captionsFileName)}" srclang="${escapeHtml(course.locale)}" label="Sous-titres" default>`
      : '';
    bodyParts.push(
      `<video controls preload="metadata">`,
      `<source src="${escapeHtml(lesson.videoFileName)}" type="video/mp4">`,
      track,
      `Votre navigateur ne supporte pas la lecture vidéo HTML5.`,
      `</video>`,
    );
  } else if (lesson.type === 'article' && lesson.articleMarkdown) {
    bodyParts.push(markdownToHtml(lesson.articleMarkdown));
  }

  let quizScriptTag = '';
  if (lesson.quiz && lesson.quiz.length > 0) {
    bodyParts.push('<h2>Quiz</h2>', '<div id="quiz-root"></div>');
    quizScriptTag = `<script>${quizScript(lesson.quiz)}</script>`;
  }

  bodyParts.push(
    `<button type="button" class="mark-done" id="mark-done-btn">Marquer comme terminé</button>`,
    `<footer class="usb-note">Export portable SallyCourse — fonctionne hors ligne, sans serveur ni connexion internet.</footer>`,
  );

  const markDoneScript = `
document.addEventListener('DOMContentLoaded', function(){
  var btn = document.getElementById('mark-done-btn');
  if (!btn) return;
  var id = ${JSON.stringify(lessonId)};
  function refresh(){
    if (window.sallycoursePortable.isDone(id)) {
      btn.textContent = 'Terminé ✓';
      btn.disabled = true;
    }
  }
  btn.addEventListener('click', function(){
    window.sallycoursePortable.markDone(id);
    refresh();
  });
  refresh();
});
`;

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(course.locale)}" dir="${dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(lesson.title)} — ${escapeHtml(course.title)}</title>`,
    `<style>${SHARED_STYLE}</style>`,
    '</head>',
    '<body>',
    ...bodyParts,
    `<script>${progressScript(course.courseId)}</script>`,
    `<script>${markDoneScript}</script>`,
    quizScriptTag,
    '</body>',
    '</html>',
  ].join('\n');
}

// Réexports pratiques pour le processor (évite un second import de pack.js).
export { orderedName, slugify };
