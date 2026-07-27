// Suivi de la publication MANUELLE d'un déploiement (P178) — logique PURE.
//
// En mode manuel, l'auteur publie lui-même le cours sur la plateforme (aucune
// automatisation navigateur). Pour intégrer ce mode au tableau de bord unifié,
// on matérialise une CHECKLIST de conformité par plateforme : l'auteur coche
// chaque étape franchie, colle l'URL publique finale, et le déploiement bascule
// en `published` dès que tout est coché ET l'URL valide — ce qui déclenche les
// mêmes traitements que les autres modes (rapport P50, polling review P47).
//
// Ce module ne fait AUCUNE I/O : il définit les items par plateforme, initialise
// une checklist, fusionne les cases cochées reçues du client (sans jamais faire
// confiance aux libellés client) et décide si l'on peut publier. Testé hors-ligne.

/** Définition immuable d'un item de checklist (source de vérité serveur). */
export interface DeployChecklistItemDef {
  key: string;
  label: string;
}

/** Item de checklist tel que persisté sur un Deployment (état coché inclus). */
export interface DeployChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

/** Mise à jour d'état reçue du client (on ne lit QUE key + done). */
export interface DeployChecklistDoneInput {
  key: string;
  done?: boolean;
}

/**
 * Étapes de publication manuelle par plateforme. Chaque item reflète une action
 * concrète et vérifiable par l'auteur sur la console de la plateforme. Les clés
 * sont stables (persistées) ; les libellés sont en français (le panneau de
 * déploiement n'utilise pas next-intl, cf. deploy-panel.tsx — texte en dur iso).
 */
export const DEPLOY_CHECKLIST_BY_PLATFORM: Record<string, readonly DeployChecklistItemDef[]> = {
  udemy: [
    { key: 'curriculum', label: 'Programme (sections et leçons) téléversé dans l’ordre' },
    { key: 'landing', label: 'Page de destination : titre, sous-titre, description et image' },
    { key: 'goals', label: 'Objectifs d’apprentissage et prérequis renseignés' },
    { key: 'ai_disclosure', label: 'Mention « contenu généré par IA » cochée sur Udemy' },
    { key: 'pricing', label: 'Prix / plan tarifaire défini' },
    { key: 'submit', label: 'Cours soumis à la revue Udemy' },
  ],
  youtube: [
    { key: 'upload', label: 'Toutes les vidéos des leçons mises en ligne' },
    { key: 'playlist', label: 'Playlist du cours créée et leçons ordonnées' },
    { key: 'metadata', label: 'Titres, descriptions et vignettes renseignés' },
    { key: 'visibility', label: 'Visibilité réglée (publique ou non répertoriée)' },
  ],
  teachable: [
    { key: 'curriculum', label: 'Curriculum créé et leçons téléversées' },
    { key: 'landing', label: 'Page de vente renseignée (titre, description, visuel)' },
    { key: 'pricing', label: 'Offre tarifaire configurée' },
    { key: 'publish', label: 'Cours publié (visible aux étudiants)' },
  ],
  thinkific: [
    { key: 'curriculum', label: 'Chapitres et leçons créés et téléversés' },
    { key: 'landing', label: 'Page de cours renseignée (titre, description, visuel)' },
    { key: 'pricing', label: 'Offre tarifaire configurée' },
    { key: 'publish', label: 'Cours publié' },
  ],
  podia: [
    { key: 'content', label: 'Sections et leçons ajoutées au produit' },
    { key: 'landing', label: 'Page produit renseignée (titre, description, visuel)' },
    { key: 'pricing', label: 'Prix du produit défini' },
    { key: 'publish', label: 'Produit publié' },
  ],
  gumroad: [
    { key: 'content', label: 'Contenu du cours ajouté au produit' },
    { key: 'landing', label: 'Fiche produit renseignée (titre, description, couverture)' },
    { key: 'pricing', label: 'Prix du produit défini' },
    { key: 'publish', label: 'Produit publié' },
  ],
  skillshare: [
    { key: 'upload', label: 'Vidéos des leçons téléversées' },
    { key: 'project', label: 'Projet de classe et ressources renseignés' },
    { key: 'landing', label: 'Titre, description et image de couverture renseignés' },
    { key: 'submit', label: 'Classe soumise / publiée' },
  ],
  moodle: [
    { key: 'content', label: 'Sections et activités créées et téléversées' },
    { key: 'settings', label: 'Paramètres du cours renseignés (nom, résumé, format)' },
    { key: 'enrolment', label: 'Méthodes d’inscription configurées' },
    { key: 'publish', label: 'Cours rendu visible aux étudiants' },
  ],
  internal: [
    { key: 'content', label: 'Leçons publiées sur l’espace interne' },
    { key: 'landing', label: 'Page de présentation renseignée' },
    { key: 'access', label: 'Accès / inscription configurés' },
    { key: 'publish', label: 'Cours rendu visible' },
  ],
};

/**
 * Checklist par défaut pour une plateforme non cataloguée (repli prudent, jamais
 * vide) : les étapes génériques de toute publication de cours en ligne.
 */
export const DEFAULT_DEPLOY_CHECKLIST: readonly DeployChecklistItemDef[] = [
  { key: 'content', label: 'Contenu du cours téléversé (vidéos / articles)' },
  { key: 'landing', label: 'Page de présentation renseignée (titre, description, visuel)' },
  { key: 'pricing', label: 'Prix et accès configurés' },
  { key: 'publish', label: 'Cours publié sur la plateforme' },
];

/** Définitions d'items pour une plateforme (repli sur la checklist générique). */
export function checklistDefForPlatform(platform: string): readonly DeployChecklistItemDef[] {
  return DEPLOY_CHECKLIST_BY_PLATFORM[platform] ?? DEFAULT_DEPLOY_CHECKLIST;
}

/** Checklist initiale d'une plateforme : toutes les cases décochées. */
export function initManualChecklist(platform: string): DeployChecklistItem[] {
  return checklistDefForPlatform(platform).map((item) => ({
    key: item.key,
    label: item.label,
    done: false,
  }));
}

/**
 * Fusionne les cases cochées reçues du client dans une checklist de base. On
 * conserve les clés et libellés de `base` (source serveur — anti-falsification)
 * et on ne reprend du client QUE l'état `done`, par clé. Les items inconnus du
 * client sont ignorés ; un item de base absent de l'entrée garde son état.
 */
export function mergeChecklistDone(
  base: readonly DeployChecklistItem[],
  updates: readonly DeployChecklistDoneInput[] | undefined,
): DeployChecklistItem[] {
  if (!updates || updates.length === 0) {
    return base.map((item) => ({ ...item }));
  }
  const doneByKey = new Map<string, boolean>();
  for (const u of updates) {
    if (u && typeof u.key === 'string') doneByKey.set(u.key, Boolean(u.done));
  }
  return base.map((item) => ({
    key: item.key,
    label: item.label,
    done: doneByKey.has(item.key) ? doneByKey.get(item.key)! : item.done,
  }));
}

/** Vrai si `value` est une URL http(s) absolue et bien formée. */
export function isValidHttpUrl(value: string | undefined | null): boolean {
  if (!value || typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // Un hôte est requis (rejette « http:/// » et assimilés).
  return url.hostname.length > 0;
}

/**
 * Décide si un déploiement manuel peut basculer en `published` : la checklist
 * doit être NON VIDE, toutes ses cases cochées, ET une URL publique http(s)
 * valide fournie. Pure : aucune I/O, entièrement testable.
 */
export function canPublishManually(
  checklist: readonly DeployChecklistItem[] | undefined,
  externalUrl: string | undefined | null,
): boolean {
  if (!checklist || checklist.length === 0) return false;
  if (!checklist.every((item) => item.done === true)) return false;
  return isValidHttpUrl(externalUrl);
}
