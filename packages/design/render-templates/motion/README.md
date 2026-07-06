# Habillage vidéo SALISTAR — templates motion

Templates HTML **animés et déterministes**, capturés image par image par le
worker Playwright puis assemblés par FFmpeg. La spec typée correspondante vit
dans `packages/design/src/video-motion.ts` (`@sallycourse/design/video-motion`) :
séquences, durées, fps, placeholders, plan de transitions (`TransitionSpec`,
`MotionSequence`) et générateurs de plans de capture (`timelineCapturePlan`,
`phasedCapturePlan`, `steppedCapturePlan`).

| Fichier | Rôle | Mode | Fond |
| --- | --- | --- | --- |
| `intro.html` | Intro 3 s — logo dessiné (stroke-dashoffset) + cascade de titres | `timeline` | opaque |
| `lower-third.html` | Bandeau « définition importante » | `phases` (in / hold / out) | **transparent** (couche overlay) |
| `outro.html` | Carte « leçon suivante » 4 s | `timeline` | opaque |
| `bullet-highlight.html` | Surlignage progressif des bullets, sync narration | `steps` (états par bullet) | opaque |

## Le principe de déterminisme

Aucune horloge, aucun `requestAnimationFrame`, aucun aléa, aucune `transition`
CSS. Toutes les animations sont des `@keyframes` **en pause** ; le « temps »
est une variable CSS `--t ∈ [0, 1]` posée sur `<html>` :

```css
.anim {
  animation-duration: var(--seq);            /* durée de la timeline */
  animation-play-state: paused !important;   /* jamais d'horloge réelle */
  animation-fill-mode: both;
  animation-timing-function: linear;         /* le easing vit DANS les keyframes */
  animation-delay: calc(-1 * var(--t) * var(--seq)); /* délai négatif = seek */
}
```

Poser `--t: 0.5` affiche exactement la pose à mi-parcours. Deux captures avec
le même `--t` produisent des pixels identiques — c'est ce qui rend le rendu
distribuable et re-exécutable.

## Contrat d'instanciation (avant toute capture)

1. **Tokens** — remplacer `/*__SC_TOKENS__*/` par le bloc de variables du
   design system : `import { cssVariables } from '@sallycourse/design/css-variables'`
   (ou reconstruire depuis `tokens.json`). Les templates portent
   `<html class="dark">`, le thème sombre s'applique donc tout seul.
   **Jamais de hex dans ces fichiers** — uniquement `rgb(var(--sc-*))`.
2. **Polices** — remplacer `/*__SC_FONTS__*/` par des `@font-face`
   (Fraunces, Figtree, IBM Plex Sans Arabic) en **woff2 inline base64** ou
   `src: local(...)`. Zéro requête réseau : la capture doit marcher offline.
   Attendre `document.fonts.ready` avant la première frame.
3. **Placeholders** — remplacer les `{{NOM}}` (liste exacte + caractère
   requis/optionnel dans `motionSequences[id].placeholders`). Tout texte
   utilisateur est **échappé HTML**. `{{BULLETS}}` reçoit des fragments
   `<li>` déjà construits (gabarit en tête de `bullet-highlight.html`, 5 max).
4. **Langue / RTL** — `{{LANG}}` et `{{DIR}}` sur `<html>`. En `dir="rtl"`,
   les templates basculent seuls sur IBM Plex Sans Arabic (jamais de serif,
   jamais d'italique) et miroitent les éléments directionnels.

## Boucle de capture Playwright

```ts
import {
  motionSequences, timelineCapturePlan, phasedCapturePlan, steppedCapturePlan,
} from '@sallycourse/design/video-motion';

const seq = motionSequences.intro;
const page = await browser.newPage({
  viewport: seq.viewport,          // 1920×1080
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',  // ne pas laisser l'OS neutraliser les keyframes
});
await page.setContent(instantiatedHtml, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

for (const segment of timelineCapturePlan(seq)) {
  // Classes de segment posées UNE fois (phases sur <body>, états sur les bullets)
  await page.evaluate(applySegmentState, segment);
  for (const { frame, t } of segment.frames) {
    await page.evaluate((v) => {
      document.documentElement.style.setProperty('--t', String(v));
    }, t);
    await page.screenshot({
      path: `${outDir}/${segment.label}/frame_${String(frame).padStart(5, '0')}.png`,
      omitBackground: seq.transparent, // PNG alpha pour lower-third
    });
  }
  // segment.holdFrames > 0 : capturer 1 image et la dupliquer (cp, pas re-capture)
}
```

Notes de fiabilité :

- `setProperty('--t', …)` + screenshot suffit : le style est recalculé de
  façon synchrone avant la capture. Pas de `waitForTimeout`.
- Réutiliser la même page pour toutes les frames d'une séquence (le reload
  par frame multiplie le temps de rendu par ~50).
- La dernière frame d'un segment balayé a toujours `--t = 1` exactement :
  c'est la pose que les frames de hold dupliquent.

### Spécificités par mode

**`timeline`** (intro, outro) — un seul segment, `--t` balaie toute la
timeline maîtresse (`{{SEQ_MS}}`). Les fenêtres d'apparition des éléments
sont encodées en pourcentages dans les keyframes.

**`phases`** (lower-third) — trois segments :

1. `<body class="phase-in">`, `--t` 0 → 1 sur `{{SEQ_IN_MS}}` ;
2. `<body class="phase-hold">` (aucune classe d'anim active) : l'état par
   défaut du DOM **est** l'état final visible — capturer 1 frame, la dupliquer
   `holdFrames` fois ;
3. `<body class="phase-out">`, `--t` 0 → 1 sur `{{SEQ_OUT_MS}}`.

Capture en `omitBackground: true` ; l'assemblage se fait en overlay (voir plus bas).

**`steps`** (bullet-highlight) — machine à états par bullet. Chaque
`.bh-bullet` porte exactement une classe parmi `is-dim` / `is-activating` /
`is-active` / `is-done`. Pour la bullet _i_ (timing audio `holdMsPerStep[i]`
fourni par la piste de narration) :

1. états : `0..i-1 → is-done`, `i → is-activating`, `i+1.. → is-dim` ;
   `--t` balaie 0 → 1 sur `{{SEQ_STEP_MS}}` (600 ms par défaut) ;
2. états : `i → is-active` (les autres inchangés) ; capturer 1 frame, tenue
   pendant `holdMsPerStep[i] − stepMs`.

`steppedCapturePlan(seq, holdMsPerStep)` génère exactement cette suite de
segments. Les états sont instantanés (aucune `transition` CSS) : changer les
classes entre deux segments ne crée aucune frame parasite.

## Assemblage FFmpeg

Frames → segment vidéo (à 30 fps, `MOTION_FPS`) :

```sh
ffmpeg -framerate 30 -i intro/frame_%05d.png \
  -c:v libx264 -pix_fmt yuv420p -r 30 intro.mp4
```

Overlay du lower-third (PNG alpha) sur la vidéo de leçon, à `t = 12 s` :

```sh
ffmpeg -i lesson.mp4 -framerate 30 -i lt/frame_%05d.png \
  -filter_complex "[1]format=rgba[lt];[0][lt]overlay=0:0:enable='gte(t,12)'" \
  -c:a copy lesson_lt.mp4
```

Transitions entre slides : `transitionBetween(from, to)` renvoie la
`TransitionSpec` du plan (fade / slide / zoom léger — **jamais de spirales**),
et `resolveXfade(spec, dir)` donne le nom de filtre xfade, en inversant les
glissements horizontaux en RTL :

```sh
# spec = transitionBetween('content', 'outro')  → zoom léger 600 ms
# resolveXfade(spec, 'ltr')                     → 'zoomin'
ffmpeg -i content.mp4 -i outro.mp4 -filter_complex \
  "xfade=transition=zoomin:duration=0.6:offset=${contentDur - 0.6}" out.mp4
```

`kind: 'cut'` (`resolveXfade` → `'none'`) = simple concaténation, sans filtre.

## Ajouter un template motion

1. Repartir d'un template existant (mêmes slots `/*__SC_TOKENS__*/`,
   `/*__SC_FONTS__*/`, mêmes règles `--t`/pause/délai négatif).
2. Interdits : `transition`, `animation-iteration-count: infinite`,
   `Math.random`, horloges JS, requêtes réseau, couleurs hex.
3. Déclarer la séquence dans `video-motion.ts` (id, mode, durées,
   placeholders) et l'ajouter à `motionSequences`.
4. Vérifier LTR **et** RTL (`{{DIR}} = rtl`, texte arabe réel) : polices,
   miroirs directionnels, `letter-spacing` réduit.
