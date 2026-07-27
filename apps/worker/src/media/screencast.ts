// Narration + incrustations de texte sur un ENREGISTREMENT D'ÉCRAN (TP/démo).
//
// Objectif (feature « capture d'écran + narration ») : l'utilisateur enregistre
// son écran (voir docs/SCREENCAST-NARRATION.md pour l'outil de capture), fournit
// une liste de textes horodatés à afficher, et le SaaS produit une vidéo finale
// NARRÉE avec la MÊME voix que le reste du cours (Chatterbox/Modal via media/tts)
// et des légendes incrustées (drawtext), synchronisées.
//
// Ce module fournit le PRIMITIF de composition (pur, testable) : construction des
// arguments ffmpeg. L'orchestration (upload de l'enregistrement, synthèse de la
// narration, file d'attente) réutilise le pipeline média existant (tts.ts +
// runFfmpeg) — voir la doc pour le branchement de bout en bout.

/** Une légende à incruster entre deux instants (secondes) sur l'enregistrement. */
export interface ScreencastOverlay {
  /** Texte à afficher (une ou deux lignes courtes). */
  text: string;
  /** Début d'affichage (s). */
  startSec: number;
  /** Fin d'affichage (s). */
  endSec: number;
  /** Position verticale — bas (défaut), haut, ou centre. */
  position?: 'bottom' | 'top' | 'center';
}

/**
 * Neutralise un chemin de fichier pour une valeur drawtext entre quotes simples
 * (fontfile / textfile). Ces chemins sont CONTRÔLÉS (police de config, fichiers
 * temporaires générés par nous) — jamais du texte utilisateur — mais on
 * normalise quand même les antislashs Windows et on double toute quote.
 */
function ffQuotedPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/'/g, "\\'");
}

/** Expression `y` de position drawtext selon l'ancrage vertical. */
function yExpr(position: ScreencastOverlay['position']): string {
  switch (position) {
    case 'top':
      return 'h*0.08';
    case 'center':
      return '(h-text_h)/2';
    case 'bottom':
    default:
      return 'h*0.88-text_h';
  }
}

/**
 * Construit UN filtre drawtext pour une légende : texte centré horizontalement,
 * fond semi-transparent (box), affiché uniquement sur [startSec, endSec].
 *
 * SÉCURITÉ : le texte de la légende est lu depuis un FICHIER (`textfile=`) et non
 * inséré en clair (`text=`) dans la chaîne de filtres. Le texte est saisi par
 * l'auteur ; l'inline `text='...'` est infalsifiable à échapper correctement
 * (le backslash n'échappe pas la quote à l'intérieur des quotes ffmpeg), ce qui
 * permettait d'INJECTER des filtres via `'` puis `,`/`;`/`[`/`]`/`=`. Avec
 * `textfile`, le contenu ne transite jamais par le parseur de filtergraph :
 * seul le chemin (contrôlé, temporaire) apparaît dans la commande.
 *
 * `fontFile` : chemin d'une police .ttf présente sur le worker. `textFile` :
 * chemin d'un fichier temporaire contenant le texte brut de la légende (écrit
 * par l'appelant).
 */
export function buildOverlayFilter(overlay: ScreencastOverlay, fontFile: string, textFile: string): string {
  const start = Math.max(0, overlay.startSec);
  const end = Math.max(start, overlay.endSec);
  const parts = [
    `fontfile='${ffQuotedPath(fontFile)}'`,
    `textfile='${ffQuotedPath(textFile)}'`,
    'fontcolor=white',
    'fontsize=36',
    'box=1',
    'boxcolor=black@0.55',
    'boxborderw=16',
    'x=(w-text_w)/2',
    `y=${yExpr(overlay.position)}`,
    `enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`,
  ];
  return `drawtext=${parts.join(':')}`;
}

/**
 * Arguments ffmpeg complets : prend l'enregistrement d'écran `videoPath`, y
 * REMPLACE l'audio par la narration `audioPath` (voix du cours), incruste toutes
 * les légendes `overlays`, et écrit `output` (H.264 + AAC, faststart).
 *
 * `textFiles[i]` est le fichier temporaire contenant le texte de `overlays[i]`
 * (cf. buildOverlayFilter — anti-injection).
 *
 * La durée finale est celle de la VIDÉO : `apad` complète la narration par du
 * silence si elle est plus courte (sinon `-shortest` seul aurait tronqué la
 * vidéo à la fin de la narration) ; `-shortest` cale ensuite sur la vidéo (finie)
 * puisque l'audio padé est infini. Fonction PURE — testable sans ffmpeg.
 */
export function buildScreencastNarrationArgs(
  videoPath: string,
  audioPath: string,
  overlays: ScreencastOverlay[],
  textFiles: string[],
  output: string,
  fontFile: string,
): string[] {
  const filters = overlays.map((o, i) => buildOverlayFilter(o, fontFile, textFiles[i]!));
  // Chaîne de filtres vidéo : format d'entrée sûr puis chaque drawtext.
  const vf = ['format=yuv420p', ...filters].join(',');
  return [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    vf,
    // Narration plus courte que la vidéo → complétée par du silence (la vidéo
    // reste l'ancre de durée grâce à -shortest ci-dessous).
    '-af',
    'apad',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-shortest',
    output,
  ];
}
