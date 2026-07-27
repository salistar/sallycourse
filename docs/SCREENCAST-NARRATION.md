# Capture d'écran + narration (TP / démos)

Objectif : permettre à l'auteur d'**enregistrer son écran** (un TP, une démo d'outil,
une manipulation IDE/terminal), d'ajouter des **légendes horodatées**, et de laisser
le SaaS produire une vidéo finale **narrée avec la même voix que le reste du cours**
(Chatterbox/Modal) et des **incrustations de texte** synchronisées.

Ce document décrit (1) l'outil de capture côté utilisateur, (2) le format d'entrée,
(3) le pipeline de composition côté SaaS, et (4) le branchement de bout en bout.

---

## 1. Outil de capture (poste de l'utilisateur)

Aucun logiciel propriétaire requis — trois options, du plus simple au plus flexible :

| Outil | Plateforme | Comment |
|---|---|---|
| **Xbox Game Bar** | Windows 10/11 | `Win + G` → bouton *Enregistrer*. Sort un MP4 dans `Vidéos/Captures`. |
| **OBS Studio** (gratuit) | Win/Mac/Linux | Source *Capture d'écran* → *Démarrer l'enregistrement*. Contrôle du codec/fps. |
| **ffmpeg** (ligne de commande) | Windows | `ffmpeg -f gdigrab -framerate 25 -i desktop -c:v libx264 -pix_fmt yuv420p rec.mp4` |

Recommandations : **25 fps**, résolution 1920×1080, curseur visible, **sans audio**
(la narration est générée par le SaaS). Enregistrer par courtes séquences (une par
étape) simplifie le montage et les légendes.

> ⚠️ Ne jamais diffuser/enregistrer le bureau ENTIER s'il contient des fenêtres
> sensibles — capturer la fenêtre applicative ciblée uniquement.

---

## 2. Format d'entrée fourni au SaaS

Pour chaque leçon « screencast » :

- **`recording.mp4`** — l'enregistrement d'écran (uploadé).
- **`narrationText`** — le texte à narrer (voix du cours ; voix clonée si `useCustomVoice`).
- **`overlays[]`** — légendes horodatées :

```jsonc
[
  { "text": "Ouvrez le terminal",      "startSec": 0, "endSec": 4, "position": "bottom" },
  { "text": "npm run test",            "startSec": 4, "endSec": 9, "position": "top" }
]
```

`position` ∈ `bottom` (défaut) · `top` · `center`.

---

## 3. Pipeline de composition (SaaS)

Primitif : [`apps/worker/src/media/screencast.ts`](../apps/worker/src/media/screencast.ts)
(`buildScreencastNarrationArgs`, pur et testé — voir `screencast.test.ts`).

Étapes :

1. **Narration** — `media/tts.ts` `synthesizeSlide()` synthétise `narrationText` avec
   la voix du cours (Chatterbox premium si `MODAL_TTS`, voix clonée si
   `Course.useCustomVoice` + échantillon). → `narration.m4a`.
2. **Composition** — `buildScreencastNarrationArgs(recording, narration, overlays, out, font)`
   construit la commande ffmpeg : remplace l'audio de l'enregistrement par la
   narration (`-map 0:v:0 -map 1:a:0`), incruste chaque légende (`drawtext`,
   fenêtre `enable='between(t,start,end)'`, fond semi-transparent), encode H.264/AAC
   `+faststart`, `-shortest`.
3. **Upload** — le MP4 final est stocké/attaché à la leçon comme une vidéo normale.

La police (`fontFile`) est passée explicitement (drawtext l'exige) — sur le worker
Debian : `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` (paquet `fonts-dejavu`).

---

## 4. Branchement de bout en bout (CÂBLÉ — Feature B)

Les trois pièces sont désormais livrées, autour du primitif de composition :

- **Schéma partagé** : [`packages/shared/src/schemas/screencast.ts`](../packages/shared/src/schemas/screencast.ts)
  (`screencastRenderInputSchema` : `narrationText` + `overlays[]`, aligné sur
  l'interface `ScreencastOverlay` du primitif) — validé par la route, typé par le
  worker et l'UI. Clés de stockage additives : `LessonKeys.screencastUpload()`
  (MP4 brut), `screencastOverlays()` (JSON durable), `screencastRender()` (MP4 final).
- **Upload** : `POST /api/courses/[id]/lessons/[lessonId]/screencast` (multipart :
  MP4 + `narrationText` + `overlays` JSON), ownership → 404, rate-limité, upload S3
  puis enqueue. `GET` = polling (statut + URL présignée du rendu + narration/légendes).
  `DELETE` retire la capture.
- **File d'attente** : processor BullMQ `screencast-render`
  ([`apps/worker/src/processors/screencast-render.ts`](../apps/worker/src/processors/screencast-render.ts))
  + worker dédié ([`apps/worker/src/voice/screencast-render-worker.ts`](../apps/worker/src/voice/screencast-render-worker.ts),
  démarré au boot), hors registre `QUEUES`. Enchaîne narration (`synthesizeSlide`,
  voix du cours / clonée) → composition (`buildScreencastNarrationArgs`) → `runFfmpeg`
  → upload. Statut sur `Lesson.assets.screencastStatus` (`pending`→`rendering`→
  `ready`/`failed`) + `screencastRenderKey`.
- **UI** : `ScreencastPanel` monté dans le panneau de leçon (types TP + vidéo) —
  dropzone d'upload, champ de narration, éditeur de légendes chronométrées
  (texte, début, fin, position) et polling de progression. i18n fr/en/ar.

Police drawtext : MÊME configuration que le filigrane (`WATERMARK_FONT_FILE` +
`resolveWatermarkFontFile`) — repli propre si absente (dev Windows) : les légendes
sont omises plutôt que de produire un `drawtext` cassé, le rendu narré reste produit.
Aucune nouvelle dépendance.
