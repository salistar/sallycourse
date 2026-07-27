// Helpers PURS du « pack guide manuel » (Prompt 176) : pour une plateforme en
// mode d'upload MANUEL (Udemy/Teachable/Thinkific/LMS interne…), on produit un
// artefact téléchargeable qui guide l'auteur pas-à-pas dans le téléversement de
// son cours sur le back-office de la plateforme.
//
// Ce module ne fait AUCUNE I/O (ni stockage, ni navigateur) : il ne calcule que
//  - le descripteur de format d'import PAR plateforme (natif vs générique),
//  - les étapes rédigées d'upload,
//  - les items de la checklist interactive,
//  - les blocs de texte à copier-coller (titre, description, marketing…),
//  - le document HTML autonome (checklist cochable + boutons « Copier ») et sa
//    variante d'impression (pour le rendu PDF côté processor),
//  - le README du pack.
// Le processor (processors/packaging.ts) construit l'input, appelle ces
// fonctions, rend le PDF via Playwright et empaquette le tout en ZIP.
//
// LIMITE ASSUMÉE (documentée ici ET dans le guide généré) : les CAPTURES de
// l'interface AUTHENTIFIÉE du back-office (Udemy connecté, etc.) ne peuvent PAS
// être générées dans le repo — captureFromSpec est SSRF-gardé aux URLs
// publiques et aucune session plateforme n'est disponible. On fournit donc des
// INSTRUCTIONS TEXTUELLES précises, jamais de fausses captures.

import { escapeHtml, slugify } from './pack.js';
import { remainingSteps, type AnnotatedStep } from '../deploy/steps.js';

/* ------------------------------------------------------------------ */
/* Descripteur de format d'import par plateforme                       */
/* ------------------------------------------------------------------ */

/** Descripteur PUR du format d'import d'une plateforme en mode manuel. */
export interface ManualPlatformFormat {
  platform: string;
  label: string;
  /**
   * true → la plateforme a un format d'import NATIF modélisé dans le repo.
   * Aujourd'hui seul Udemy en a un (CSV bulk quiz, cf. quizToUdemyCsv). Les
   * autres plateformes manuelles reçoivent un guide générique + fichiers de
   * contenu (articles HTML) + blocs copier-coller, sans CSV natif.
   */
  hasNativeQuizCsv: boolean;
  /** Libellé du format d'import affiché dans le guide. */
  importFormatName: string;
  /** URL PUBLIQUE de la documentation d'import (jamais une page authentifiée). */
  docUrl?: string;
}

/** Libellés d'affichage des plateformes manuelles connues (repli : l'id capitalisé). */
const PLATFORM_LABELS: Record<string, string> = {
  udemy: 'Udemy',
  teachable: 'Teachable',
  thinkific: 'Thinkific',
  internal: 'LMS interne SallyCourse',
};

/** Capitalise un id de plateforme inconnue pour un libellé de repli lisible. */
function fallbackLabel(platform: string): string {
  if (!platform) return 'la plateforme';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

/**
 * Descripteur de format d'import d'une plateforme (PUR). Udemy dispose d'un
 * format natif (CSV bulk quiz) ; toute autre plateforme manuelle reçoit le
 * traitement générique (fichiers de contenu + blocs copier-coller).
 */
export function manualPlatformFormat(platform: string): ManualPlatformFormat {
  const id = platform.toLowerCase().trim();
  const label = PLATFORM_LABELS[id] ?? fallbackLabel(id);
  if (id === 'udemy') {
    return {
      platform: id,
      label,
      hasNativeQuizCsv: true,
      importFormatName: 'CSV bulk quiz Udemy + conférences vidéo/article',
      docUrl: 'https://support.udemy.com/hc/en-us/articles/360058016414',
    };
  }
  return {
    platform: id,
    label,
    hasNativeQuizCsv: false,
    importFormatName: 'Fichiers de contenu + blocs à copier-coller',
  };
}

/* ------------------------------------------------------------------ */
/* Input du guide (vue simplifiée cours/plateforme pour le processor)  */
/* ------------------------------------------------------------------ */

export interface ManualGuideLesson {
  order: number;
  title: string;
  type: 'video' | 'article';
  durationMin?: number;
  /** Chemin relatif du .mp4 dans le pack standard (course-pack.zip), leçon vidéo. */
  videoRef?: string;
  /** Nom de fichier HTML de l'article inclus dans CE pack (leçon article). */
  articleFile?: string;
}

export interface ManualGuideSection {
  order: number;
  title: string;
  lessons: ManualGuideLesson[];
  /** Nom du fichier CSV de quiz de la section inclus dans le pack (Udemy), si présent. */
  quizCsvFile?: string;
}

/** Blocs marketing/plan à copier-coller dans le back-office de la plateforme. */
export interface ManualGuideMarketing {
  subtitle?: string;
  description?: string;
  udemyDescription?: string;
  welcomeMessage?: string;
  congratsMessage?: string;
  promoText?: string;
  learningObjectives?: readonly string[];
  prerequisites?: readonly string[];
  targetAudience?: readonly string[];
  titleIdeas?: readonly string[];
}

/**
 * Reprise (Prompt 179) : point de reprise d'un déploiement AUTO/ASSISTÉ
 * interrompu. Présent → le guide devient un guide de REPRISE (n'énumère que les
 * étapes RESTANTES, avec le déjà-fait indiqué). Absent → guide complet (P176).
 */
export interface ManualGuideResume {
  /** Checkpoint du Deployment interrompu (lessonIndex = leçons déjà uploadées). */
  checkpoint: { lessonIndex: number; step: string };
}

export interface ManualGuideInput {
  platform: string;
  courseTitle: string;
  courseId: string;
  locale: string;
  sections: readonly ManualGuideSection[];
  marketing?: ManualGuideMarketing;
  /** Reprise partielle (Prompt 179) — absent en génération de guide complet. */
  resume?: ManualGuideResume;
}

/** Nombre total de leçons (toutes sections) — base du déroulé des étapes d'upload. */
function totalLessonCount(input: ManualGuideInput): number {
  return input.sections.reduce((n, s) => n + s.lessons.length, 0);
}

/** Étapes de reprise séparées en déjà-faites / restantes (null hors reprise). */
export interface ManualGuideResumeSteps {
  done: AnnotatedStep[];
  pending: AnnotatedStep[];
}

/**
 * Décompose le flow de déploiement (steps.ts) au regard du checkpoint de reprise :
 * étapes déjà réalisées automatiquement vs étapes RESTANTES à faire à la main.
 * Retourne null si l'input n'est pas un guide de reprise. PUR.
 */
export function buildResumeSteps(input: ManualGuideInput): ManualGuideResumeSteps | null {
  if (!input.resume) return null;
  const annotated = remainingSteps(totalLessonCount(input), input.resume.checkpoint);
  return {
    done: annotated.filter((s) => s.done),
    pending: annotated.filter((s) => !s.done),
  };
}

/* ------------------------------------------------------------------ */
/* Blocs copier-coller                                                 */
/* ------------------------------------------------------------------ */

export interface ManualGuideCopyBlock {
  /** Identifiant stable (slug) — sert aussi de nom de fichier .txt. */
  id: string;
  label: string;
  /** Contenu brut (multi-ligne autorisé) à copier tel quel. */
  text: string;
}

/**
 * Construit la liste des blocs de texte à copier-coller depuis le contenu déjà
 * généré (plan + marketing). N'inclut que les blocs réellement renseignés —
 * un cours sans marketing produit tout de même les blocs titre/plan. PUR.
 */
export function buildCopyBlocks(input: ManualGuideInput): ManualGuideCopyBlock[] {
  const m = input.marketing ?? {};
  const blocks: ManualGuideCopyBlock[] = [];
  const push = (id: string, label: string, text: string | undefined): void => {
    const value = (text ?? '').trim();
    if (value) blocks.push({ id, label, text: value });
  };

  push('titre', 'Titre du cours', input.courseTitle);
  push('sous-titre', 'Sous-titre', m.subtitle);
  push('description', 'Description (plan)', m.description);
  push('description-udemy', 'Description optimisée (SEO)', m.udemyDescription);
  push('message-bienvenue', 'Message de bienvenue', m.welcomeMessage);
  push('message-felicitations', 'Message de félicitations', m.congratsMessage);
  push('texte-promo', 'Texte promotionnel', m.promoText);

  if (m.learningObjectives && m.learningObjectives.length > 0) {
    push('objectifs', 'Objectifs pédagogiques', m.learningObjectives.map((o) => `- ${o}`).join('\n'));
  }
  if (m.prerequisites && m.prerequisites.length > 0) {
    push('prerequis', 'Prérequis', m.prerequisites.map((o) => `- ${o}`).join('\n'));
  }
  if (m.targetAudience && m.targetAudience.length > 0) {
    push('public-cible', 'Public cible', m.targetAudience.map((o) => `- ${o}`).join('\n'));
  }
  if (m.titleIdeas && m.titleIdeas.length > 0) {
    push('idees-titres', 'Idées de titres alternatifs', m.titleIdeas.map((t) => `- ${t}`).join('\n'));
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/* Étapes d'upload rédigées                                            */
/* ------------------------------------------------------------------ */

/**
 * Étapes pas-à-pas d'upload, PUR et adaptées au format de la plateforme. Udemy
 * mentionne l'import CSV natif des quiz ; les plateformes génériques renvoient
 * à la création manuelle des quiz depuis le PDF des solutions du pack standard.
 */
export function buildUploadSteps(input: ManualGuideInput): string[] {
  const fmt = manualPlatformFormat(input.platform);
  const hasArticles = input.sections.some((s) => s.lessons.some((l) => l.type === 'article'));
  const hasVideos = input.sections.some((s) => s.lessons.some((l) => l.type === 'video'));
  const hasQuiz = input.sections.some((s) => Boolean(s.quizCsvFile));

  const steps: string[] = [
    `Connectez-vous à ${fmt.label} et ouvrez la création d'un nouveau cours dans votre espace formateur.`,
    'Renseignez le titre et le sous-titre du cours en copiant les blocs correspondants (section « Textes à copier-coller » ci-dessous).',
    'Recréez la structure du cours en ajoutant les sections dans l’ordre exact du plan (voir « Structure du cours »).',
  ];

  if (hasVideos) {
    steps.push(
      'Pour chaque leçon vidéo, ajoutez une conférence puis téléversez le fichier .mp4 correspondant. ' +
        'Les vidéos ne sont PAS incluses dans ce guide (fichiers volumineux) : utilisez celles du pack standard (course-pack.zip), le nom de fichier attendu est indiqué en face de chaque leçon.',
    );
  }
  if (hasArticles) {
    steps.push(
      'Pour chaque leçon de type article, ajoutez une conférence « Article » puis collez le contenu du fichier HTML fourni dans le dossier content/articles/ de ce pack.',
    );
  }
  if (hasQuiz) {
    if (fmt.hasNativeQuizCsv) {
      steps.push(
        'Pour chaque section comportant un quiz, ajoutez un quiz puis utilisez « Importer des questions » et sélectionnez le fichier CSV de la section (dossier content/quiz/). ' +
          'Le format respecte l’import en masse d’Udemy (question, 4 réponses, bonne réponse, explication).',
      );
    } else {
      steps.push(
        'Pour chaque section comportant un quiz, recréez les questions manuellement dans l’éditeur de quiz de la plateforme. ' +
          'Les questions, bonnes réponses et explications figurent dans le fichier CSV du dossier content/quiz/ (ouvrable dans un tableur).',
      );
    }
  }

  steps.push(
    'Collez la description, le message de bienvenue et le message de félicitations dans les réglages du cours (blocs à copier ci-dessous).',
  );
  if (fmt.platform === 'udemy') {
    steps.push(
      'Cochez la mention « contenu généré par IA » exigée par Udemy, puis soumettez le cours à la revue.',
    );
  } else {
    steps.push('Vérifiez l’aperçu du cours puis publiez-le.');
  }
  return steps;
}

/* ------------------------------------------------------------------ */
/* Checklist interactive                                               */
/* ------------------------------------------------------------------ */

export interface ManualGuideChecklistItem {
  /** Identifiant stable (persistance localStorage). */
  id: string;
  label: string;
}

/**
 * Items de la checklist interactive : une entrée par grande étape + une entrée
 * par section (pour cocher l'avancement section par section). PUR.
 */
export function buildChecklistItems(input: ManualGuideInput): ManualGuideChecklistItem[] {
  const fmt = manualPlatformFormat(input.platform);
  const items: ManualGuideChecklistItem[] = [
    { id: 'creer-cours', label: `Créer le cours sur ${fmt.label}` },
    { id: 'titre-soustitre', label: 'Renseigner titre et sous-titre' },
    { id: 'description', label: 'Coller la description et les objectifs' },
  ];
  input.sections.forEach((section) => {
    const videoCount = section.lessons.filter((l) => l.type === 'video').length;
    const articleCount = section.lessons.filter((l) => l.type === 'article').length;
    const parts: string[] = [];
    if (videoCount > 0) parts.push(`${videoCount} vidéo(s)`);
    if (articleCount > 0) parts.push(`${articleCount} article(s)`);
    if (section.quizCsvFile) parts.push('quiz');
    const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    items.push({
      id: `section-${section.order}`,
      label: `Section ${section.order + 1} — ${section.title}${detail}`,
    });
  });
  items.push({ id: 'messages', label: 'Coller messages de bienvenue et de félicitations' });
  if (fmt.platform === 'udemy') {
    items.push({ id: 'mention-ia', label: 'Cocher la mention « contenu généré par IA »' });
    items.push({ id: 'revue', label: 'Soumettre le cours à la revue Udemy' });
  } else {
    items.push({ id: 'publier', label: 'Vérifier l’aperçu et publier le cours' });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* README du pack                                                      */
/* ------------------------------------------------------------------ */

/** Contenu texte du README.txt du pack (PUR). */
export function buildReadme(input: ManualGuideInput): string {
  const fmt = manualPlatformFormat(input.platform);
  const resumeSteps = buildResumeSteps(input);
  const lines = [
    `Guide d'upload manuel — ${input.courseTitle}`,
    `Plateforme : ${fmt.label}`,
    `Format d'import : ${fmt.importFormatName}`,
    '',
    ...(resumeSteps
      ? [
          'REPRISE D’UN DÉPLOIEMENT INTERROMPU (Prompt 179)',
          `  Le déploiement automatique s'est arrêté ; ${resumeSteps.done.length} étape(s) déjà`,
          `  réalisée(s), ${resumeSteps.pending.length} restante(s). Le guide ne couvre que les`,
          '  étapes restantes (section « Étapes restantes » de guide.html).',
          '',
        ]
      : []),
    'CONTENU DE CE PACK',
    '  guide.html             Guide interactif (checklist cochable + boutons « Copier »).',
    '  guide.pdf              Version imprimable du même guide.',
    '  textes-a-copier/       Blocs de texte prêts à coller (titre, description, marketing…).',
    '  content/articles/      Leçons de type article en HTML, à coller dans la plateforme.',
    fmt.hasNativeQuizCsv
      ? '  content/quiz/          Quiz par section au format CSV bulk Udemy (import direct).'
      : '  content/quiz/          Quiz par section au format CSV (à recréer manuellement).',
    '  content/inventaire.txt Liste des vidéos à téléverser (depuis course-pack.zip).',
    '',
    'IMPORTANT',
    "  Les vidéos ne sont pas incluses ici (fichiers volumineux) : téléchargez le pack",
    '  standard (course-pack.zip) pour récupérer les .mp4.',
    '',
    "  Ce guide ne contient PAS de captures d'écran du back-office connecté de la",
    '  plateforme : elles ne sont pas générables automatiquement. Suivez les',
    '  instructions textuelles du guide, étape par étape.',
    '',
    'Ouvrez guide.html dans un navigateur pour commencer.',
  ];
  return lines.join('\n');
}

/** Inventaire texte des vidéos à téléverser (PUR). */
export function buildVideoInventory(input: ManualGuideInput): string {
  const lines: string[] = [
    `Vidéos à téléverser sur ${manualPlatformFormat(input.platform).label}`,
    '(récupérez les fichiers .mp4 dans le pack standard course-pack.zip)',
    '',
  ];
  let any = false;
  for (const section of input.sections) {
    const videos = section.lessons.filter((l) => l.type === 'video');
    if (videos.length === 0) continue;
    any = true;
    lines.push(`Section ${section.order + 1} — ${section.title}`);
    for (const lesson of videos) {
      const dur = lesson.durationMin ? ` (~${lesson.durationMin} min)` : '';
      lines.push(`  - ${lesson.title}${dur}  →  ${lesson.videoRef ?? 'video.mp4'}`);
    }
    lines.push('');
  }
  if (!any) lines.push('(aucune leçon vidéo dans ce cours)');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Document HTML autonome (checklist + boutons copier)                 */
/* ------------------------------------------------------------------ */

const GUIDE_STYLE = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{font-family:Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;max-width:920px;margin:0 auto;padding:1.5rem;color:#1a1523;background:#fbfaff}
h1,h2,h3{font-family:Georgia,serif;line-height:1.25}
h1{margin-bottom:.25rem}
.subtitle{color:#6b6478;margin-top:0}
.banner{border:1px solid #e5c07b;background:#fdf6e3;border-radius:.6rem;padding:.9rem 1.1rem;margin:1.25rem 0;font-size:.92rem}
.banner strong{color:#8a6d1a}
.banner.resume{border-color:#a7b6e8;background:#eef1fc}
.banner.resume strong{color:#3a49a8}
ul.done-steps{list-style:none;padding:0;margin:.5rem 0 0}
ul.done-steps li{padding:.3rem 0;color:#5c7a5c;display:flex;align-items:flex-start;gap:.5rem;border-bottom:1px solid #f0ecf8;font-size:.9rem}
ul.done-steps li:last-child{border-bottom:none}
ul.done-steps li::before{content:"✓";color:#1e6b3a;font-weight:700;flex-shrink:0}
section.block{border:1px solid #e4dff2;border-radius:.75rem;padding:1rem 1.25rem;margin:1.25rem 0;background:#fff}
ol.steps{padding-inline-start:1.3rem}
ol.steps li{margin:.5rem 0}
ul.checklist{list-style:none;padding:0;margin:0}
ul.checklist li{display:flex;align-items:flex-start;gap:.6rem;padding:.45rem 0;border-bottom:1px solid #f0ecf8}
ul.checklist li:last-child{border-bottom:none}
ul.checklist input{margin-top:.35rem;width:1.1rem;height:1.1rem;accent-color:#6b46e5;flex-shrink:0}
ul.checklist label{cursor:pointer}
ul.checklist li.done label{text-decoration:line-through;color:#8a8296}
.progress-line{font-size:.85rem;color:#6b6478;margin-top:.75rem}
.copy-block{margin:1rem 0}
.copy-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.35rem}
.copy-head .label{font-weight:600}
button.copy-btn{border:1px solid #6b46e5;background:#6b46e5;color:#fff;border-radius:.45rem;padding:.35rem .8rem;font-size:.85rem;cursor:pointer}
button.copy-btn:hover{background:#5a37d6}
button.copy-btn.copied{background:#1e6b3a;border-color:#1e6b3a}
pre.copy-text{background:#f6f3fb;border:1px solid #e4dff2;border-radius:.5rem;padding:.8rem 1rem;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9rem;margin:0}
table.structure{width:100%;border-collapse:collapse;font-size:.92rem}
table.structure th,table.structure td{text-align:start;padding:.4rem .5rem;border-bottom:1px solid #f0ecf8}
table.structure th{font-size:.8rem;text-transform:uppercase;letter-spacing:.03em;color:#6b6478}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem}
.tag{display:inline-block;font-size:.72rem;padding:.1rem .45rem;border-radius:1rem;background:#efeaf6;color:#4a4458}
footer.note{margin-top:2.5rem;font-size:.8rem;color:#8a8296;border-top:1px solid #e4dff2;padding-top:1rem}
@media print{button.copy-btn{display:none}body{background:#fff}}
`;

/**
 * Script de checklist : coche/décoche persisté en localStorage (namespacé par
 * cours + plateforme) + compteur d'avancement. Boutons « Copier » : lecture du
 * <pre> associé (textContent — déjà déséchappé par le navigateur), écriture
 * presse-papier avec repli execCommand pour les navigateurs anciens / file://.
 */
function guideScript(courseId: string, platform: string): string {
  const key = `sallycourse-manual-guide:${JSON.stringify(courseId + ':' + platform).slice(1, -1)}`;
  return `
(function(){
  var STORAGE_KEY = "${key}";
  function load(){ try { var r = window.localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : {}; } catch(e){ return {}; } }
  function save(p){ try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch(e){} }
  function updateProgress(){
    var boxes = document.querySelectorAll('ul.checklist input[type=checkbox]');
    var done = 0;
    boxes.forEach(function(b){ if (b.checked) done++; });
    var el = document.getElementById('progress-line');
    if (el) el.textContent = done + ' / ' + boxes.length + ' étape(s) terminée(s)';
  }
  document.addEventListener('DOMContentLoaded', function(){
    var state = load();
    document.querySelectorAll('ul.checklist input[type=checkbox]').forEach(function(box){
      var id = box.getAttribute('data-item-id');
      if (state[id]) { box.checked = true; box.closest('li').classList.add('done'); }
      box.addEventListener('change', function(){
        var s = load();
        s[id] = box.checked;
        save(s);
        box.closest('li').classList.toggle('done', box.checked);
        updateProgress();
      });
    });
    updateProgress();
    document.querySelectorAll('button.copy-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var pre = document.getElementById(btn.getAttribute('data-target'));
        if (!pre) return;
        var text = pre.textContent || '';
        function ok(){ var t = btn.textContent; btn.textContent = 'Copié ✓'; btn.classList.add('copied'); setTimeout(function(){ btn.textContent = t; btn.classList.remove('copied'); }, 1500); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(ok, function(){ fallback(text, ok); });
        } else { fallback(text, ok); }
      });
    });
    function fallback(text, ok){
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); ok();
      } catch(e){}
    }
  });
})();
`;
}

/** Rend la table « structure du cours » (sections → leçons + réf. de fichier). */
function structureTableHtml(input: ManualGuideInput): string {
  const rows: string[] = [];
  for (const section of input.sections) {
    rows.push(
      `<tr><td colspan="3" style="padding-top:.8rem"><strong>${escapeHtml(
        `Section ${section.order + 1} — ${section.title}`,
      )}</strong></td></tr>`,
    );
    for (const lesson of section.lessons) {
      const typeTag =
        lesson.type === 'video'
          ? '<span class="tag">Vidéo</span>'
          : '<span class="tag">Article</span>';
      // videoRef contient DÉJÀ le dossier de section (ex. '01-intro/01-x.mp4') :
      // ne pas re-préfixer par le numéro de section (chemin inexistant sinon,
      // incohérent avec content/inventaire.txt et la vraie disposition du ZIP).
      const ref =
        lesson.type === 'video'
          ? escapeHtml(lesson.videoRef ?? 'video.mp4')
          : lesson.articleFile
            ? `content/articles/${escapeHtml(lesson.articleFile)}`
            : '—';
      rows.push(
        `<tr><td>${escapeHtml(lesson.title)}</td><td>${typeTag}</td><td class="mono">${ref}</td></tr>`,
      );
    }
    if (section.quizCsvFile) {
      rows.push(
        `<tr><td>Quiz de section</td><td><span class="tag">Quiz</span></td><td class="mono">content/quiz/${escapeHtml(
          section.quizCsvFile,
        )}</td></tr>`,
      );
    }
  }
  return [
    '<table class="structure">',
    '<thead><tr><th>Leçon</th><th>Type</th><th>Fichier / référence</th></tr></thead>',
    `<tbody>${rows.join('')}</tbody>`,
    '</table>',
  ].join('');
}

export interface BuildGuideHtmlOptions {
  /**
   * true (défaut) : document interactif (checklist cochable + boutons Copier +
   * script). false : variante d'IMPRESSION pour le rendu PDF (aucun script,
   * cases statiques, pas de boutons — un PDF fige l'interactivité).
   */
  interactive?: boolean;
}

/**
 * Document HTML autonome du guide d'upload manuel : bannière de limite (pas de
 * captures authentifiées), étapes pas-à-pas, checklist interactive, structure
 * du cours et blocs copier-coller. Aucune dépendance externe (style + script
 * inline) — ouvrable en double-clic (file://). PUR.
 */
export function buildGuideHtml(input: ManualGuideInput, options: BuildGuideHtmlOptions = {}): string {
  const interactive = options.interactive ?? true;
  const fmt = manualPlatformFormat(input.platform);
  const dir = input.locale === 'ar' ? 'rtl' : 'ltr';
  const steps = buildUploadSteps(input);
  const copyBlocks = buildCopyBlocks(input);

  // Guide de reprise (Prompt 179) : la checklist ne liste que les étapes
  // RESTANTES du flow interrompu ; le déjà-fait est indiqué séparément.
  const resumeSteps = buildResumeSteps(input);
  const checklist: ManualGuideChecklistItem[] = resumeSteps
    ? resumeSteps.pending.map((s) => ({ id: s.key, label: s.label }))
    : buildChecklistItems(input);

  const stepsHtml = steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('\n');

  const checklistHtml = checklist
    .map((item) => {
      const box = interactive
        ? `<input type="checkbox" data-item-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.label)}">`
        : `<input type="checkbox" disabled aria-hidden="true">`;
      return `<li>${box}<label>${escapeHtml(item.label)}</label></li>`;
    })
    .join('\n');

  const copyBlocksHtml = copyBlocks
    .map((block, i) => {
      const preId = `copy-${block.id}-${i}`;
      const button = interactive
        ? `<button type="button" class="copy-btn" data-target="${preId}">Copier</button>`
        : '';
      return [
        '<div class="copy-block">',
        `<div class="copy-head"><span class="label">${escapeHtml(block.label)}</span>${button}</div>`,
        `<pre class="copy-text" id="${preId}">${escapeHtml(block.text)}</pre>`,
        '</div>',
      ].join('\n');
    })
    .join('\n');

  const docLink = fmt.docUrl
    ? `<p class="progress-line">Documentation officielle d’import : <a href="${escapeHtml(
        fmt.docUrl,
      )}">${escapeHtml(fmt.docUrl)}</a></p>`
    : '';

  // Bandeau + récapitulatif de reprise (Prompt 179), uniquement en mode reprise.
  const resumeBannerHtml = resumeSteps
    ? [
        '<div class="banner resume">',
        '<strong>Reprise d’un déploiement interrompu.</strong> Ce guide ne couvre que les ',
        'étapes qu’il RESTE à réaliser à la main : le déploiement automatique s’est arrêté ',
        'en cours de route (captcha ou étape non automatisable). Reprenez à partir de la ',
        'première étape ci-dessous — inutile de refaire ce qui a déjà été publié.',
        '</div>',
      ].join('')
    : '';
  const resumeDoneHtml =
    resumeSteps && resumeSteps.done.length > 0
      ? [
          '<section class="block">',
          '<h2>Déjà réalisé automatiquement</h2>',
          '<p class="progress-line">Ces étapes ont été effectuées par le déploiement automatique avant l’interruption — rien à refaire.</p>',
          `<ul class="done-steps">${resumeSteps.done
            .map((s) => `<li>${escapeHtml(s.label)}</li>`)
            .join('')}</ul>`,
          '</section>',
        ].join('\n')
      : '';
  const checklistHeading = resumeSteps ? 'Étapes restantes' : 'Checklist d’avancement';

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(input.locale)}" dir="${dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Guide d’upload manuel — ${escapeHtml(input.courseTitle)} (${escapeHtml(fmt.label)})</title>`,
    `<style>${GUIDE_STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>Guide d’upload manuel</h1>`,
    `<p class="subtitle">${escapeHtml(input.courseTitle)} — ${escapeHtml(fmt.label)} · Format : ${escapeHtml(
      fmt.importFormatName,
    )}</p>`,

    resumeBannerHtml,

    '<div class="banner">',
    `<strong>Pas de captures d’écran du back-office.</strong> Les copies d’écran de l’interface `,
    `${escapeHtml(fmt.label)} connectée ne peuvent pas être générées automatiquement. `,
    'Ce guide fournit des instructions textuelles précises, étape par étape — suivez-les dans l’ordre.',
    '</div>',

    resumeDoneHtml,

    '<section class="block">',
    '<h2>Étapes d’upload</h2>',
    `<ol class="steps">${stepsHtml}</ol>`,
    docLink,
    '</section>',

    '<section class="block">',
    `<h2>${escapeHtml(checklistHeading)}</h2>`,
    interactive
      ? '<p class="progress-line">Cochez chaque étape au fur et à mesure — votre progression est sauvegardée dans ce navigateur.</p>'
      : '',
    `<ul class="checklist">${checklistHtml}</ul>`,
    interactive ? '<p class="progress-line" id="progress-line"></p>' : '',
    '</section>',

    '<section class="block">',
    '<h2>Structure du cours</h2>',
    structureTableHtml(input),
    '</section>',

    copyBlocks.length > 0
      ? [
          '<section class="block">',
          '<h2>Textes à copier-coller</h2>',
          copyBlocksHtml,
          '</section>',
        ].join('\n')
      : '',

    '<footer class="note">Guide généré par SallyCourse — pack manuel (Prompt 176). Aucune donnée n’est envoyée : tout est local à ce fichier.</footer>',
    interactive ? `<script>${guideScript(input.courseId, input.platform)}</script>` : '',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Nom de fichier du pack manuel d'une plateforme (PUR) : sûr pour S3/ZIP. Le
 * guide de REPRISE (Prompt 179) porte un suffixe `-resume` pour ne PAS écraser le
 * guide complet (P176) — les deux peuvent coexister pour une même plateforme.
 */
export function manualGuidePackFileName(platform: string, resume = false): string {
  return `course-manual-guide-${slugify(platform)}${resume ? '-resume' : ''}.zip`;
}
