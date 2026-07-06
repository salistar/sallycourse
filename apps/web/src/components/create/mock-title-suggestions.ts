/**
 * Moteur local de suggestions de titres — maquette provisoire.
 * Sera remplacé par un appel API (worker IA) ; l'interface du composant
 * consommateur ne changera pas (string[] en entrée/sortie).
 */

const ANNEE_COURANTE = new Date().getFullYear();

/** Capitalise la première lettre sans toucher au reste (sigles, noms propres). */
function capitaliser(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/**
 * Génère 3–4 variantes de titres « accrocheuses » à partir de la frappe.
 * Retourne un tableau vide si la saisie est trop courte pour être exploitable.
 */
export function buildTitleSuggestions(saisie: string): string[] {
  const sujet = saisie.trim().replace(/[.!?…\s]+$/u, '');
  if (sujet.length < 4) return [];

  const sujetCapitalise = capitaliser(sujet);
  const candidats = [
    `${sujetCapitalise} : de zéro à la maîtrise`,
    `Maîtriser ${sujet} en 30 jours`,
    `${sujetCapitalise} — le guide complet ${ANNEE_COURANTE}`,
    `L'essentiel de ${sujet}, par la pratique`,
  ];

  // Contraintes du schéma partagé (titre <= 120 caractères) + pas de doublon exact.
  return candidats
    .filter((c) => c.length <= 120 && c.toLowerCase() !== sujet.toLowerCase())
    .slice(0, 4);
}
