// Catalogue d'avatars présentateurs (2026-07-26).
//
// L'option avatar existait avec deux entrées HeyGen fictives sans photo — le
// chemin réel (Ditto sur Modal : photo + audio → vidéo présentateur) ne
// s'activait qu'avec la photo UPLOADÉE par l'utilisateur. Ce catalogue fournit
// de vrais avatars prêts à l'emploi : chaque entrée a un portrait frontal
// GÉNÉRÉ par le pipeline image du produit lui-même (SDXL/Z-Image, licence
// sans ambiguïté), mis en cache storage sous avatar-catalog/{id}.png puis
// animé par Ditto. Le choix se fait à la création (avatarEnabled + avatarId).
//
// Ids stables — ne jamais renommer (persistés sur Course.avatarId). Les
// anciens ids maquette « heygen-avatar-clara/marc » restent acceptés en base
// (champ String) et retombent sur le comportement historique.

export interface CatalogAvatar {
  /** Identifiant stable (Course.avatarId). */
  id: string;
  /** Nom d'affichage (identique dans les 3 langues d'interface). */
  name: string;
  gender: 'female' | 'male';
  /** Prompt de génération du portrait frontal (une seule fois, puis cache). */
  photoPrompt: string;
}

const PORTRAIT_STYLE =
  'professional studio headshot photograph, frontal face, looking directly at camera, neutral expression with a slight warm smile, ' +
  'soft even lighting, plain dark neutral background, sharp focus, photorealistic, high detail, head and shoulders framing';

export const AVATAR_CATALOG: CatalogAvatar[] = [
  {
    id: 'clara',
    name: 'Clara',
    gender: 'female',
    photoPrompt: `portrait of a professional woman in her mid-30s, European features, brown hair tied back, wearing a navy blazer, ${PORTRAIT_STYLE}`,
  },
  {
    id: 'marc',
    name: 'Marc',
    gender: 'male',
    photoPrompt: `portrait of a friendly professional man in his late 30s, short dark hair, light stubble, wearing a charcoal sweater, ${PORTRAIT_STYLE}`,
  },
  {
    id: 'ines',
    name: 'Inès',
    gender: 'female',
    photoPrompt: `portrait of a confident professional woman in her early 30s, North African features, dark wavy hair, wearing an elegant beige blouse, ${PORTRAIT_STYLE}`,
  },
  {
    id: 'karim',
    name: 'Karim',
    gender: 'male',
    photoPrompt: `portrait of a professional man in his early 40s, North African features, short black hair, trimmed beard, wearing a dark suit jacket, ${PORTRAIT_STYLE}`,
  },
];

export const AVATAR_CATALOG_IDS = AVATAR_CATALOG.map((a) => a.id) as [string, ...string[]];

/** Avatar du catalogue par id — undefined si inconnu (ids legacy HeyGen inclus). */
export function getCatalogAvatar(avatarId: string | undefined | null): CatalogAvatar | undefined {
  if (!avatarId) return undefined;
  return AVATAR_CATALOG.find((a) => a.id === avatarId);
}

/** Clé storage du portrait d'un avatar du catalogue. */
export function avatarCatalogPhotoKey(avatarId: string): string {
  return `avatar-catalog/${avatarId}.png`;
}
