// Musique de fond et habillage sonore (Prompt 135).
//
// Ce module NE GÉNÈRE AUCUN fichier audio : le catalogue MUSIC_CATALOG
// (@sallycourse/shared/music-catalog) documente des pistes libres de droits
// dont les MP3 réels doivent être déposés MANUELLEMENT dans le stockage sous
// `library/music/{id}.mp3`. Tant qu'un fichier n'est pas présent, resolveMusicTrack
// retourne null et le mixage est SKIP proprement (vidéo inchangée, comportement
// historique). Dès que le fichier existe, le mixage FFmpeg s'applique.
//
// Mixage : sidechaincompress fait « ducker » la musique quand la voix parle
// (la piste voix sert de signal de contrôle au compresseur appliqué à la
// musique). Filtre construit en pur (buildSidechainDuckFilter) pour être testé
// sans ffmpeg réel ; l'orchestration I/O (résolution piste + appel ffmpeg) vit
// dans video-render.ts (Course.backgroundMusicId / Course.musicVolume,
// additifs — no-op si absents).

import {
  MUSIC_MIX,
  findMusicTrack,
  musicStorageKey,
  selectTrackByMood,
  objectExists,
  type MusicMood,
  type MusicTrack,
} from '../shared.js';

/** Options de construction du filtre de ducking. */
export interface SidechainDuckOptions {
  /** Volume linéaire de la musique avant ducking (0-1). Défaut MUSIC_MIX.DEFAULT_VOLUME. */
  musicVolume?: number;
  /** Seuil dB déclenchant le ducking. Défaut MUSIC_MIX.SIDECHAIN_THRESHOLD_DB. */
  thresholdDb?: number;
  /** Ratio de compression. Défaut MUSIC_MIX.SIDECHAIN_RATIO. */
  ratio?: number;
  /** Attaque (ms). Défaut MUSIC_MIX.SIDECHAIN_ATTACK_MS. */
  attackMs?: number;
  /** Release (ms). Défaut MUSIC_MIX.SIDECHAIN_RELEASE_MS. */
  releaseMs?: number;
}

/**
 * Construit le graphe de filtres ffmpeg (-filter_complex) qui mixe une piste
 * voix ([voiceLabel]) et une piste musique ([musicLabel]) avec ducking
 * sidechaincompress : la musique est d'abord atténuée à `musicVolume`, puis
 * compressée en utilisant la voix comme signal de contrôle (sidechain), enfin
 * sommée à la voix (amix). Résultat exposé sous [outLabel]. Pur — ne touche à
 * aucun fichier, ne lance aucun process.
 *
 * Convention des labels ffmpeg : `[voiceLabel]` et `[musicLabel]` doivent déjà
 * exister dans le graphe appelant (ex. flux d'entrée -i mappés en [0:a]/[1:a]).
 */
export function buildSidechainDuckFilter(
  voiceLabel: string,
  musicLabel: string,
  outLabel: string,
  options: SidechainDuckOptions = {},
): string {
  const volume = options.musicVolume ?? MUSIC_MIX.DEFAULT_VOLUME;
  const threshold = options.thresholdDb ?? MUSIC_MIX.SIDECHAIN_THRESHOLD_DB;
  const ratio = options.ratio ?? MUSIC_MIX.SIDECHAIN_RATIO;
  const attack = options.attackMs ?? MUSIC_MIX.SIDECHAIN_ATTACK_MS;
  const release = options.releaseMs ?? MUSIC_MIX.SIDECHAIN_RELEASE_MS;

  // Seuil sidechaincompress attend une valeur LINÉAIRE (0-1), pas des dB —
  // conversion classique 10^(dB/20).
  const thresholdLinear = Math.pow(10, threshold / 20);

  const musicVolLabel = `${musicLabel}vol`;
  const duckedLabel = `${musicLabel}ducked`;

  return [
    // 1) Musique atténuée à son volume de mixage cible AVANT compression.
    `[${musicLabel}]volume=${volume}[${musicVolLabel}]`,
    // 2) sidechaincompress : la voix ([voiceLabel]) pilote la compression de
    //    la musique ([musicVolLabel]) — deux entrées, la 1ère est le signal
    //    compressé, la 2ème (sidechain) est le signal de contrôle.
    `[${musicVolLabel}][${voiceLabel}]sidechaincompress=` +
      `threshold=${thresholdLinear.toFixed(6)}:ratio=${ratio}:attack=${attack}:release=${release}[${duckedLabel}]`,
    // 3) Somme voix + musique duckée → sortie finale.
    `[${voiceLabel}][${duckedLabel}]amix=inputs=2:duration=first:dropout_transition=0[${outLabel}]`,
  ].join(';');
}

/**
 * Sélectionne l'id de piste effectif à partir des options du cours : priorité
 * à backgroundMusicId explicite, sinon sélection par mood si fourni, sinon
 * undefined (aucune musique). Pur.
 */
export function resolveTrackId(
  backgroundMusicId: string | undefined,
  mood: MusicMood | undefined,
): string | undefined {
  if (backgroundMusicId) return backgroundMusicId;
  if (mood) return selectTrackByMood(mood)?.id;
  return undefined;
}

/** Résultat de la résolution d'une piste : piste + chemin local si disponible, sinon null (skip). */
export interface ResolvedMusicTrack {
  track: MusicTrack;
  /** Clé de stockage du MP3 (déjà vérifiée présente). */
  storageKey: string;
}

/**
 * Vérifie qu'une piste demandée (par id) existe RÉELLEMENT dans le stockage
 * (HeadObject, pas de téléchargement). Retourne null si l'id est inconnu du
 * catalogue OU si le fichier MP3 n'a pas encore été déposé manuellement —
 * dans les deux cas, l'appelant doit SKIP le mixage proprement (comportement
 * historique, aucune erreur levée).
 */
export async function resolveMusicTrack(trackId: string | undefined): Promise<ResolvedMusicTrack | null> {
  if (!trackId) return null;
  const track = findMusicTrack(trackId);
  if (!track) return null;
  const key = musicStorageKey(trackId);
  const present = await objectExists(key).catch(() => false);
  if (!present) return null;
  return { track, storageKey: key };
}

/**
 * Arguments ffmpeg (purs) qui réencodent la vidéo `videoPath` avec sa piste
 * audio mixée à `musicPath` (ducking sidechaincompress, cf.
 * buildSidechainDuckFilter). Vidéo copiée telle quelle (-c:v copy, aucune
 * perte de qualité/durée) ; seule la piste audio est réencodée AAC. `-shortest`
 * absent volontairement : amix duration=first cale déjà la sortie sur la durée
 * de la voix (entrée 0), la musique est tronquée/bouclée par le filtre lui-même
 * si besoin (comportement standard amix).
 */
export function buildMusicMixArgs(
  videoPath: string,
  musicPath: string,
  output: string,
  options: SidechainDuckOptions = {},
): string[] {
  const filter = buildSidechainDuckFilter('0:a', '1:a', 'mixed', options);
  return [
    '-y',
    '-i',
    videoPath,
    // -stream_loop -1 : boucle la musique si plus courte que la vidéo (cas
    // fréquent, une piste de catalogue dure rarement toute la leçon).
    '-stream_loop',
    '-1',
    '-i',
    musicPath,
    '-filter_complex',
    filter,
    '-map',
    '0:v',
    '-map',
    '[mixed]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-shortest',
    output,
  ];
}
