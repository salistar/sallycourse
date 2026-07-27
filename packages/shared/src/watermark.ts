// Anti-piratage — filigrane VISIBLE discret du LMS interne (Prompt 206).
// Logique PURE (aucune I/O) : échappement du texte drawtext, expressions de
// position qui TOURNENT dans le temps (dissuade le recadrage/masquage), et
// construction des arguments ffmpeg du rendu filigrané. Le rendu réel (lecture
// vidéo depuis S3, exécution ffmpeg, upload) vit côté worker (media/watermark.ts) ;
// on isole ici tout ce qui est testable sans binaire ni réseau.
//
// Décisions produit (P206) :
//   - filigrane = email de l'étudiant, opacité FAIBLE (discret mais lisible sur
//     une capture), afin d'identifier la source d'une fuite sans gêner la lecture ;
//   - la POSITION change à intervalle régulier (rotation entre plusieurs ancrages)
//     pour qu'un simple crop fixe ne suffise pas à l'éliminer ;
//   - police = chemin .ttf configurable (WATERMARK_FONT_FILE) avec repli PROPRE :
//     si aucune police n'est fournie, drawtext s'appuie sur fontconfig — et si le
//     rendu échoue malgré tout, l'appelant sert la vidéo NON filigranée (jamais
//     de blocage de lecture, cf. media/watermark.ts).

/** Ancrages de position possibles du filigrane (coins/bords). */
export type WatermarkAnchor = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

/** Réglages par défaut du filigrane (discret : petite taille, faible opacité). */
export const WATERMARK_DEFAULTS = {
  /** Opacité du texte (0–1). Faible = discret mais visible sur une capture. */
  opacity: 0.18,
  /** Taille de police en pixels (référence 1080p). */
  fontSize: 26,
  /** Durée d'affichage d'un ancrage avant rotation vers le suivant (secondes). */
  rotateEverySec: 20,
  /** Marge en pixels par rapport aux bords. */
  margin: 40,
  /** Ordre de rotation des ancrages (cycle). */
  anchors: ['top-right', 'bottom-left', 'top-left', 'bottom-right'] as readonly WatermarkAnchor[],
} as const;

/**
 * Échappe une chaîne pour l'option `text=` de drawtext. ffmpeg interprète
 * `\`, `:`, `'` et `%` DANS la valeur du filtre — non échappés, ils cassent le
 * filtergraph (ex. le `@` d'un email passe, mais le contenu doit rester neutre).
 * Les retours à la ligne sont remplacés par une espace (filigrane sur une ligne).
 */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Expressions ffmpeg (x, y) d'un ancrage, en fonction de w/h/text_w/text_h. */
export function anchorExpression(anchor: WatermarkAnchor, margin: number): { x: string; y: string } {
  const m = Math.max(0, Math.round(margin));
  switch (anchor) {
    case 'top-left':
      return { x: `${m}`, y: `${m}` };
    case 'top-right':
      return { x: `w-text_w-${m}`, y: `${m}` };
    case 'bottom-left':
      return { x: `${m}`, y: `h-text_h-${m}` };
    case 'bottom-right':
      return { x: `w-text_w-${m}`, y: `h-text_h-${m}` };
  }
}

export interface WatermarkFilterOptions {
  /** Chemin absolu d'une police .ttf. Absent → drawtext via fontconfig. */
  fontFile?: string;
  opacity?: number;
  fontSize?: number;
  rotateEverySec?: number;
  margin?: number;
  anchors?: readonly WatermarkAnchor[];
}

/** Borne l'opacité dans [0.02, 1] (jamais totalement invisible ni > 1). */
function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return WATERMARK_DEFAULTS.opacity;
  return Math.min(1, Math.max(0.02, value));
}

/**
 * Construit le filtergraph drawtext du filigrane rotatif : UN drawtext par
 * ancrage, chacun activé (`enable=`) uniquement pendant sa tranche de temps via
 * `eq(mod(floor(t/interval), N), i)`. À tout instant, exactement un ancrage est
 * visible ; l'ancrage change toutes les `rotateEverySec` secondes et cycle.
 * Les virgules/deux-points internes aux expressions sont échappés (`\,`, `\:`)
 * car ils sont significatifs pour le parseur de filtres ffmpeg.
 */
export function buildWatermarkDrawtextFilter(email: string, options: WatermarkFilterOptions = {}): string {
  const opacity = clampOpacity(options.opacity ?? WATERMARK_DEFAULTS.opacity);
  const fontSize = Math.max(8, Math.round(options.fontSize ?? WATERMARK_DEFAULTS.fontSize));
  const interval = Math.max(1, Math.round(options.rotateEverySec ?? WATERMARK_DEFAULTS.rotateEverySec));
  const margin = options.margin ?? WATERMARK_DEFAULTS.margin;
  const anchors = options.anchors && options.anchors.length > 0 ? options.anchors : WATERMARK_DEFAULTS.anchors;
  const n = anchors.length;

  const safeText = escapeDrawtext(email);
  const fontClause = options.fontFile ? `fontfile='${options.fontFile.replace(/'/g, "\\'")}':` : '';

  const drawtexts = anchors.map((anchor, i) => {
    const { x, y } = anchorExpression(anchor, margin);
    // enable : n'affiche cet ancrage que sur sa tranche de rotation.
    const enable =
      n > 1 ? `:enable='eq(mod(floor(t/${interval})\\,${n})\\,${i})'` : '';
    return (
      `drawtext=${fontClause}text='${safeText}':` +
      `fontcolor=white@${opacity.toFixed(3)}:fontsize=${fontSize}:` +
      // Légère ombre pour rester lisible sur fonds clairs ET sombres.
      `shadowcolor=black@${(opacity * 0.6).toFixed(3)}:shadowx=1:shadowy=1:` +
      `x=${x}:y=${y}${enable}`
    );
  });

  return drawtexts.join(',');
}

/** Preset d'encodage du filigrane (re-encode ponctuel, paresseux et mis en cache). */
export interface WatermarkEncodeOptions {
  /** -c:v (défaut libx264). */
  videoCodec?: string;
  /** -preset x264 (défaut veryfast : rendu unique par (leçon×étudiant), on privilégie la vitesse). */
  x264Preset?: string;
  /** -crf (défaut 23). */
  crf?: number;
}

/**
 * Arguments ffmpeg complets du rendu filigrané : incruste le drawtext rotatif
 * sur la vidéo source et ré-encode (H.264/AAC, +faststart pour le streaming).
 * L'audio est copié (le filigrane est purement visuel). Fonction PURE : aucun
 * accès disque — l'appelant fournit les chemins locaux et le filtre déjà bâti.
 */
export function buildWatermarkFfmpegArgs(
  inputPath: string,
  outputPath: string,
  drawtextFilter: string,
  encode: WatermarkEncodeOptions = {},
): string[] {
  return [
    '-y',
    '-i',
    inputPath,
    '-vf',
    `${drawtextFilter},format=yuv420p`,
    '-c:v',
    encode.videoCodec ?? 'libx264',
    '-preset',
    encode.x264Preset ?? 'veryfast',
    '-crf',
    String(encode.crf ?? 23),
    '-pix_fmt',
    'yuv420p',
    // Audio inchangé (filigrane visuel uniquement) : copie sans réencodage.
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}
