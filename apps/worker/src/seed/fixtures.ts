// Jeu de données de test déterministe (Prompt 185).
//
// Ce fichier est la SOURCE DE VÉRITÉ des fixtures : il est consommé à la fois
// par seed.ts (peuplement Mongo local/démo) et par les tests d'intégration
// futurs. Tout est déterministe (aucun Math.random au runtime) : les variantes
// sont dérivées d'un index fixe, de sorte que deux exécutions produisent
// exactement les mêmes documents.
//
// Les contenus « golden » (outline complet, script vidéo, article, tp, quiz)
// valident contre les schémas Zod partagés — cf. fixtures.test.ts.

import {
  type ArticleContent,
  type Outline,
  type PlanId,
  type QuizQuestion,
  type SlideScript,
  type TpContent,
} from '../shared.js';

// ────────────────────────────────────────────────────────────────────
// Marqueurs de démo — permettent un RESET idempotent ciblé (cf. seed.ts).
// Tout ce que le seed crée porte l'un de ces marqueurs ; le reset n'efface
// QUE ces documents, jamais des données réelles.
// ────────────────────────────────────────────────────────────────────

/** Domaine e-mail réservé aux comptes de démo. */
export const DEMO_EMAIL_DOMAIN = 'demo.sallycourse.test';

/** Préfixe de titre apposé à tous les cours de démo (marqueur de reset). */
export const DEMO_COURSE_TAG = '[DEMO]';

/** Vrai si l'e-mail appartient au jeu de démo. */
export function isDemoEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

// ────────────────────────────────────────────────────────────────────
// Comptes de démo
// ────────────────────────────────────────────────────────────────────

/** Mot de passe en clair commun à tous les comptes de démo (loggé au seed). */
export const DEMO_PASSWORD = 'demo1234';

/**
 * Hash bcrypt PRÉ-CALCULÉ de DEMO_PASSWORD (coût 12, salt fixe).
 *
 * Volontairement figé en constante : le worker n'embarque pas bcryptjs (présent
 * seulement côté web), donc on évite une dépendance runtime et un appel réseau.
 * Ce hash est un vrai hash bcrypt vérifiable par `bcryptjs.compare()` côté web,
 * ce qui permet de se connecter réellement avec DEMO_PASSWORD.
 * Régénérer avec : bcryptjs.hashSync('demo1234', '$2a$12$abcdefghijklmnopqrstuu').
 */
export const DEMO_PASSWORD_BCRYPT =
  '$2a$12$abcdefghijklmnopqrstuunCz/jw6mEQ1fEwlTNGfRvRz80jk1Wzy';

export interface DemoUserFixture {
  email: string;
  name: string;
  plan: PlanId;
  role: 'user' | 'admin';
}

/** Compte administrateur de démo (plan business pour lever les quotas). */
export const DEMO_ADMIN: DemoUserFixture = {
  email: `admin@${DEMO_EMAIL_DOMAIN}`,
  name: 'Admin Démo',
  plan: 'business',
  role: 'admin',
};

/** Un utilisateur standard par plan (free / pro / business). */
export const DEMO_USERS: readonly DemoUserFixture[] = [
  { email: `free@${DEMO_EMAIL_DOMAIN}`, name: 'Utilisateur Free', plan: 'free', role: 'user' },
  { email: `pro@${DEMO_EMAIL_DOMAIN}`, name: 'Utilisateur Pro', plan: 'pro', role: 'user' },
  {
    email: `business@${DEMO_EMAIL_DOMAIN}`,
    name: 'Utilisateur Business',
    plan: 'business',
    role: 'user',
  },
];

// ────────────────────────────────────────────────────────────────────
// Contenu « golden » — un cours COMPLET, prêt à publier.
// Toutes les valeurs respectent les schémas Zod partagés.
// ────────────────────────────────────────────────────────────────────

/** Titre du cours golden (préfixé DEMO_COURSE_TAG au moment du seed). */
export const GOLDEN_COURSE_TITLE = 'Maîtriser Git en pratique';

/**
 * Plan de cours complet : 5 sections, difficulté intermédiaire.
 * Le nombre de sections respecte UDEMY.MIN_SECTIONS ; chaque section a au
 * moins une leçon ; 4-8 objectifs pédagogiques (contrainte outlineSchema).
 */
export const GOLDEN_OUTLINE: Outline = {
  title: GOLDEN_COURSE_TITLE,
  subtitle: 'De zéro à un workflow Git professionnel, branches et collaboration',
  description:
    'Un cours pratique et progressif pour dompter Git : dépôts, commits, ' +
    'branches, fusions, résolution de conflits et collaboration à plusieurs. ' +
    'Chaque section combine explication, démonstration filmée et travaux ' +
    'pratiques pour ancrer durablement les réflexes du versionnage.',
  learningObjectives: [
    'Initialiser et structurer un dépôt Git proprement',
    'Créer, isoler et fusionner des branches sans stress',
    'Résoudre des conflits de fusion en toute sérénité',
    'Collaborer via des dépôts distants et des pull requests',
    'Adopter un workflow Git professionnel et reproductible',
  ],
  prerequisites: ['Savoir utiliser un terminal', 'Notions de base en programmation'],
  targetAudience: [
    'Développeurs débutants souhaitant industrialiser leur code',
    'Étudiants en informatique',
    'Toute personne travaillant en équipe sur du code',
  ],
  sections: [
    {
      title: 'Prise en main de Git',
      lessons: [
        { title: 'Pourquoi versionner son code', type: 'video', durationMin: 6, summary: 'Le rôle du versionnage et les problèmes qu\'il résout.' },
        { title: 'Installer et configurer Git', type: 'article', durationMin: 8, summary: 'Installation multi-OS et configuration initiale (user, editor).' },
        { title: 'Créer votre premier dépôt', type: 'tp', durationMin: 12, summary: 'init, add, commit sur un projet vierge.' },
      ],
    },
    {
      title: 'Commits et historique',
      lessons: [
        { title: 'Anatomie d\'un commit', type: 'video', durationMin: 7, summary: 'Ce que contient un commit et pourquoi les messages comptent.' },
        { title: 'Explorer et réécrire l\'historique', type: 'article', durationMin: 9, summary: 'log, diff, amend et bonnes pratiques de messages.' },
      ],
    },
    {
      title: 'Les branches',
      lessons: [
        { title: 'Créer et basculer entre branches', type: 'video', durationMin: 8, summary: 'branch, switch/checkout et le modèle de branches légères.' },
        { title: 'Fusionner deux branches', type: 'tp', durationMin: 14, summary: 'merge fast-forward vs merge commit sur un cas concret.' },
      ],
    },
    {
      title: 'Résoudre les conflits',
      lessons: [
        { title: 'Comprendre un conflit de fusion', type: 'video', durationMin: 6, summary: 'D\'où viennent les conflits et comment Git les signale.' },
        { title: 'Résoudre un conflit pas à pas', type: 'tp', durationMin: 15, summary: 'Résolution manuelle d\'un conflit puis validation.' },
      ],
    },
    {
      title: 'Collaboration à distance',
      lessons: [
        { title: 'Dépôts distants et remotes', type: 'video', durationMin: 7, summary: 'remote, push, pull et le cycle de synchronisation.' },
        { title: 'Contribuer via une pull request', type: 'article', durationMin: 10, summary: 'Fork, branche de feature et revue de code.' },
        { title: 'Quiz de fin de cours', type: 'quiz', durationMin: 5, summary: 'Vérifier les acquis sur l\'ensemble du cours.' },
      ],
    },
  ],
};

/**
 * Script vidéo golden réutilisable pour toute leçon de type "video".
 * Respecte slideScriptSchema (>= 2 slides, narration non vide).
 */
export const GOLDEN_VIDEO_SCRIPT: SlideScript = {
  slides: [
    {
      template: 'title',
      title: 'Pourquoi versionner son code',
      bullets: ['Le versionnage en 3 idées'],
      narration:
        'Bienvenue dans cette leçon. Nous allons voir pourquoi versionner son ' +
        'code change radicalement votre façon de travailler.',
    },
    {
      template: 'content',
      title: 'Trois bénéfices immédiats',
      bullets: [
        'Revenir à un état antérieur sans peur',
        'Travailler à plusieurs sans écraser le code des autres',
        'Documenter l\'évolution du projet',
      ],
      narration:
        'Un système de version vous offre un filet de sécurité : vous pouvez ' +
        'toujours revenir en arrière, collaborer sereinement, et retracer ' +
        'chaque changement.',
    },
    {
      template: 'recap',
      title: 'À retenir',
      bullets: ['Git enregistre des instantanés', 'Chaque commit est réversible'],
      narration:
        'Retenez que Git enregistre des instantanés de votre projet, et que ' +
        'chaque commit constitue un point de restauration.',
    },
  ],
};

/**
 * Article golden réutilisable pour toute leçon de type "article".
 * Contient des H2, un encadré « À retenir » et un placeholder screenshot :
 * le seed pose une clé d'asset fictive mais le Markdown reste réaliste.
 */
export const GOLDEN_ARTICLE: ArticleContent = {
  title: 'Installer et configurer Git',
  markdown: [
    '## Installation',
    '',
    'Sur macOS, installez Git via Homebrew avec `brew install git`. Sur Linux,',
    'utilisez le gestionnaire de paquets de votre distribution. Sur Windows,',
    'téléchargez Git for Windows qui embarque un terminal Bash.',
    '',
    '{{screenshot:page de téléchargement de Git for Windows}}',
    '',
    '## Configuration initiale',
    '',
    'Renseignez votre identité, utilisée dans chaque commit :',
    '',
    '```bash',
    'git config --global user.name "Votre Nom"',
    'git config --global user.email "vous@example.com"',
    '```',
    '',
    '> **À retenir** : la configuration `--global` s\'applique à tous vos dépôts,',
    '> mais peut être surchargée dépôt par dépôt.',
    '',
    '## Vérifier son installation',
    '',
    'La commande `git --version` confirme que Git est bien installé et',
    'accessible depuis votre terminal.',
  ].join('\n'),
};

/**
 * Contenu de TP golden réutilisable pour toute leçon de type "tp".
 * Respecte tpSchema (>= 3 étapes, environnement/validation/troubleshooting).
 */
export const GOLDEN_TP: TpContent = {
  objective: 'Créer un dépôt Git local et réaliser votre premier commit.',
  environment: ['Un terminal', 'Git installé (git --version)'],
  steps: [
    {
      instruction: 'Créez un dossier de projet et placez-vous dedans.',
      command: 'mkdir mon-projet && cd mon-projet',
      expectedResult: 'Le terminal est positionné dans le dossier mon-projet.',
    },
    {
      instruction: 'Initialisez le dépôt Git.',
      command: 'git init',
      expectedResult: 'Git affiche « Initialized empty Git repository ».',
    },
    {
      instruction: 'Créez un fichier puis ajoutez-le à l\'index.',
      command: 'echo "# Mon projet" > README.md && git add README.md',
      expectedResult: 'Le fichier README.md est suivi (staged).',
    },
    {
      instruction: 'Réalisez le premier commit.',
      command: 'git commit -m "Premier commit"',
      expectedResult: 'Git confirme la création du commit avec un identifiant court.',
    },
  ],
  validation: ['`git log` affiche exactement un commit', '`git status` indique un arbre de travail propre'],
  troubleshooting: [
    'Si « command not found: git » apparaît, Git n\'est pas installé ou pas dans le PATH.',
    'Si le commit échoue pour identité manquante, configurez user.name et user.email.',
  ],
};

/**
 * Générateur déterministe d'un quiz golden pour une section.
 * L'index de section sert de graine : deux appels avec le même index
 * renvoient exactement les mêmes questions (aucun Math.random).
 * Produit QUIZ.MIN_QUESTIONS_PER_SECTION questions valides (4 choix chacune).
 */
export function goldenQuizForSection(sectionIndex: number): QuizQuestion[] {
  const difficulties = ['beginner', 'intermediate', 'advanced'] as const;
  const count = 8; // == QUIZ.MIN_QUESTIONS_PER_SECTION (validé par le test)
  return Array.from({ length: count }, (_, i) => {
    const seed = sectionIndex * 100 + i;
    const correctIndex = seed % 4;
    const difficulty = difficulties[i % difficulties.length] ?? 'beginner';
    return {
      question: `Section ${sectionIndex + 1} — question ${i + 1} : quelle commande Git convient ?`,
      choices: [`git a-${seed}`, `git b-${seed}`, `git c-${seed}`, `git d-${seed}`],
      correctIndex,
      explanation: `La bonne réponse est le choix ${correctIndex + 1} (déterministe, graine ${seed}).`,
      difficulty,
    };
  });
}
