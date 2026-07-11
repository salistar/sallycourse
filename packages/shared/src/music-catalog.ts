// Bibliothèque de musiques libres de droits (Prompt 135 — habillage sonore).
//
// IMPORTANT : ce module ne fournit AUCUN fichier audio. C'est un catalogue de
// MÉTADONNÉES statiques (id, nom, ambiance, clé de stockage attendue). Les
// vrais fichiers MP3 doivent être déposés MANUELLEMENT dans le stockage S3/MinIO
// sous la clé `library/music/{id}.mp3` (voir musicStorageKey ci-dessous) — le
// code de mixage (background-music.ts) fonctionne dès qu'un fichier est présent
// à cette clé, et SKIP proprement (aucun mixage, vidéo inchangée) si absent.
// Même mécanisme pour le jingle SALISTAR par défaut (clé dédiée, cf. JINGLE_TRACK_ID).

/** Ambiance d'une piste — sert de filtre de sélection (Course.backgroundMusicId
 * peut être omis : on choisit alors une piste au hasard dans le mood demandé). */
export type MusicMood = 'calm' | 'upbeat' | 'corporate' | 'inspirational' | 'neutral';

/** Une entrée du catalogue — métadonnées seules, pas de contenu binaire. */
export interface MusicTrack {
  /** Identifiant stable (utilisé dans Course.backgroundMusicId et la clé de stockage). */
  id: string;
  /** Nom affichable dans l'UI (sélecteur de musique). */
  name: string;
  /** Ambiance dominante — sert à la sélection automatique par mood. */
  mood: MusicMood;
  /** Clé de stockage ATTENDUE (documentation — dérivée par musicStorageKey, ne pas dupliquer en dur). */
  storageKey: string;
}

/**
 * Catalogue statique — bibliothèque libre de droits par défaut. Chaque piste
 * DOIT correspondre à un fichier réel déposé sous `library/music/{id}.mp3`
 * (cf. musicStorageKey) pour être mixée ; sinon getOrSkipMusicTrack (worker)
 * ignore silencieusement la demande. Étendre cette liste n'affecte aucun cours
 * existant (Course.backgroundMusicId reste undefined par défaut).
 */
export const MUSIC_CATALOG: readonly MusicTrack[] = [
  { id: 'calm-piano-01', name: 'Piano posé', mood: 'calm', storageKey: 'library/music/calm-piano-01.mp3' },
  { id: 'calm-ambient-01', name: 'Nappe ambiante', mood: 'calm', storageKey: 'library/music/calm-ambient-01.mp3' },
  { id: 'upbeat-corporate-01', name: 'Corporate énergique', mood: 'upbeat', storageKey: 'library/music/upbeat-corporate-01.mp3' },
  { id: 'upbeat-tech-01', name: 'Tech dynamique', mood: 'upbeat', storageKey: 'library/music/upbeat-tech-01.mp3' },
  { id: 'corporate-neutral-01', name: 'Corporate neutre', mood: 'corporate', storageKey: 'library/music/corporate-neutral-01.mp3' },
  { id: 'inspirational-strings-01', name: 'Cordes inspirantes', mood: 'inspirational', storageKey: 'library/music/inspirational-strings-01.mp3' },
  { id: 'neutral-lofi-01', name: 'Lo-fi discret', mood: 'neutral', storageKey: 'library/music/neutral-lofi-01.mp3' },
] as const;

/** Identifiant réservé du jingle SALISTAR par défaut (Course.jingleEnabled). */
export const JINGLE_TRACK_ID = 'salistar-jingle';

/** Jingle SALISTAR — même mécanisme que le catalogue (fichier optionnel côté storage). */
export const JINGLE_TRACK: MusicTrack = {
  id: JINGLE_TRACK_ID,
  name: 'Jingle SALISTAR',
  mood: 'corporate',
  storageKey: `library/music/${JINGLE_TRACK_ID}.mp3`,
};

/** Clé de stockage d'une piste du catalogue (ou du jingle) — source unique, pas de chemin en dur ailleurs. */
export function musicStorageKey(trackId: string): string {
  return `library/music/${trackId}.mp3`;
}

/** Retrouve une piste du catalogue par id (jingle inclus). Undefined si inconnue. */
export function findMusicTrack(trackId: string): MusicTrack | undefined {
  if (trackId === JINGLE_TRACK_ID) return JINGLE_TRACK;
  return MUSIC_CATALOG.find((t) => t.id === trackId);
}

/**
 * Sélection PURE d'une piste par ambiance : retourne la première piste du
 * catalogue correspondant au mood demandé (déterministe — pas d'aléatoire,
 * pour un comportement reproductible en test et en mock). Undefined si
 * aucune piste ne correspond (catalogue vide pour ce mood).
 */
export function selectTrackByMood(mood: MusicMood): MusicTrack | undefined {
  return MUSIC_CATALOG.find((t) => t.mood === mood);
}

/** Paramètres par défaut du mixage musique de fond (Prompt 135). */
export const MUSIC_MIX = {
  /** Volume linéaire par défaut de la musique (avant ducking), 0-1. */
  DEFAULT_VOLUME: 0.25,
  /** Seuil (dB) du sidechaincompress : la voix au-delà de ce niveau déclenche le ducking. */
  SIDECHAIN_THRESHOLD_DB: -30,
  /** Ratio de compression appliqué à la musique quand la voix parle. */
  SIDECHAIN_RATIO: 8,
  /** Attaque du compresseur (ms) — rapide pour suivre la parole. */
  SIDECHAIN_ATTACK_MS: 5,
  /** Release du compresseur (ms) — le retour au volume plein est progressif. */
  SIDECHAIN_RELEASE_MS: 300,
} as const;
