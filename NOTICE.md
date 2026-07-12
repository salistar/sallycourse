# NOTICE — Composants tiers (open source)

SallyCourse intègre les logiciels et modèles open source suivants. Ce fichier
liste chaque composant OSS effectivement câblé dans le pipeline (providers
`apps/worker/src/providers/`, services `docker-compose.yml` profil `ai`),
sa licence et un lien vers le texte officiel. Voir `docs/OSS-LICENSES.md` pour
la checklist de conformité détaillée (usage commercial par composant).

Cette liste ne couvre PAS les dépendances npm classiques (voir
`pnpm-lock.yaml` / `DEPENDENCY-AUDIT.md` pour celles-ci) — uniquement les
outils/modèles IA et media auto-hébergés (LLM, TTS, image, avatar vidéo).

---

## LLM (génération de texte)

### Ollama (runtime d'inférence)
- Licence : **MIT**
- Dépôt : https://github.com/ollama/ollama
- Texte : https://github.com/ollama/ollama/blob/main/LICENSE
- Usage commercial : autorisé sans restriction.

### Llama 3.3 (70B) / Llama 3.2 (8B) — modèles (Meta)
- Licence : **Llama Community License** (licence propriétaire Meta, pas OSI ;
  souvent qualifiée « source-available »).
- Texte : https://www.llama.com/llama3_3/license/ (Llama 3.3) et
  https://www.llama.com/llama3_2/license/ (Llama 3.2)
- Usage commercial : **autorisé**, MAIS licence expirée de plein droit et
  nouvel accord requis auprès de Meta si les produits/services de SallyCourse
  (ou de ses affiliés) dépassent **700 millions d'utilisateurs actifs
  mensuels** au cours du mois précédent. Attribution obligatoire
  (« Llama 3.x is licensed under the Llama 3.x Community License, Copyright ©
  Meta Platforms, Inc. »). Sans objet à l'échelle actuelle de SallyCourse ; à
  ré-auditer si le produit approche ce seuil.

### Qwen2.5-14B / Qwen2.5-8B — modèles (Alibaba)
- Licence : **Apache 2.0**
- Texte : https://huggingface.co/Qwen/Qwen2.5-14B-Instruct/blob/main/LICENSE
- Usage commercial : autorisé sans restriction (tous les seuils Apache 2.0
  standards).

### Qwen2.5-72B — modèle (Alibaba)
- Licence : **Tongyi Qianwen / « Qwen License » (licence propriétaire
  Alibaba)**, PAS Apache 2.0 (contrairement aux autres tailles Qwen2.5).
- Texte : https://huggingface.co/Qwen/Qwen2.5-72B-Instruct/blob/main/LICENSE
- Usage commercial : autorisé en dessous de **100 millions d'utilisateurs
  actifs mensuels** ; au-delà, licence séparée requise auprès d'Alibaba Cloud.
  Sans objet à l'échelle actuelle de SallyCourse.

---

## TTS (synthèse vocale)

### Piper (moteur, via rhasspy/wyoming-piper)
- Licence : **MIT** (version pinnée dans `docker-compose.yml`, image
  `rhasspy/wyoming-piper:latest` — s'appuie sur le binaire Piper historique
  `rhasspy/piper`, publié MIT).
- Texte : https://github.com/rhasspy/piper/blob/master/LICENSE.md
- Point de vigilance : le dépôt historique `rhasspy/piper` (MIT) est archivé
  (lecture seule) depuis octobre 2025 ; le développement actif a repris sous
  `OHF-Voice/piper1-gpl`, publié en **GPL-3.0**. `docker-compose.yml`
  n'épingle PAS ce nouveau fork — voir checklist `docs/OSS-LICENSES.md` pour
  la vérification à refaire avant tout changement de tag/image.
- Usage commercial : autorisé (MIT), tant que l'image reste celle du binaire
  historique. Ne PAS migrer vers `piper1-gpl` sans revalider ce point (une
  dépendance GPL-3.0 change les obligations si le binaire est redistribué).

### Kokoro-82M (clonage de voix, remplace XTTS)
- Licence : **Apache 2.0**
- Dépôt : https://github.com/hexgrad/kokoro · Poids :
  https://huggingface.co/hexgrad/Kokoro-82M
- Usage commercial : autorisé sans restriction.

### ElevenLabs / OpenAI TTS
- Services cloud propriétaires (pas des composants OSS) — soumis à leurs
  conditions d'utilisation API respectives, pas à une licence de code source.
  Mentionnés ici pour mémoire uniquement (option premium/repli du pipeline).

---

## Image (illustrations de slides)

### ComfyUI (orchestrateur d'inférence)
- Licence : **GPL-3.0**
- Dépôt : https://github.com/comfyanonymous/ComfyUI
- Texte : https://github.com/comfyanonymous/ComfyUI/blob/master/LICENSE
- Usage commercial : ComfyUI est utilisé ici exclusivement comme **service
  auto-hébergé interrogé via son API HTTP** (`comfyui-provider.ts` : POST
  `/prompt`, GET `/history`, GET `/view`) — le code SallyCourse ne lie ni ne
  redistribue le code ComfyUI, il l'appelle en réseau comme un service tiers.
  Ce mode d'usage ne déclenche pas les obligations de copyleft du GPL-3.0 sur
  le code propriétaire de SallyCourse (pas de distribution d'œuvre dérivée).
  Vigilance : ne jamais embarquer/statically-linker du code ComfyUI dans le
  worker.

### FLUX.1-schnell (modèle, Black Forest Labs)
- Licence : **Apache 2.0**
- Poids : https://huggingface.co/black-forest-labs/FLUX.1-schnell
- Texte : https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-schnell
- Usage commercial : autorisé sans restriction.

### SVG procédural (design system, `packages/design`)
- Code propriétaire SallyCourse — pas un composant OSS tiers, mentionné pour
  mémoire (c'est le repli par défaut, zéro dépendance externe).

---

## Avatar vidéo

### SadTalker
- Licence : **Apache 2.0** (dépôt `OpenTalker/SadTalker`, CVPR 2023).
- Dépôt : https://github.com/OpenTalker/SadTalker
- Texte : https://github.com/OpenTalker/SadTalker/blob/main/LICENSE
- Point de vigilance : le projet a longtemps eu une **ambiguïté documentée**
  entre le fichier LICENSE (historiquement MIT-like) et le README (qui
  indiquait autrefois un usage « recherche/personnel uniquement »). Cette
  contradiction a depuis été résolue : le dépôt est aujourd'hui explicitement
  Apache 2.0, MAIS SadTalker dépend de composants tiers (checkpoints
  d'expression/audio2pose, souvent dérivés de modèles de recherche externes)
  qui peuvent porter des licences distinctes de celle du dépôt principal — à
  revérifier au moment de télécharger les checkpoints réels (non embarqués
  dans l'image Docker, cf. `docker-compose.yml`).
- Usage commercial : autorisé pour le code du dépôt ; vérifier individuellement
  la licence de chaque checkpoint de modèle déposé dans le volume
  `sadtalker-checkpoints/` avant mise en production (voir checklist).

### HeyGen
- Service cloud propriétaire (option premium, plans payants) — pas un
  composant OSS, soumis aux conditions d'utilisation API HeyGen.

---

## Confirmation explicite — XTTS-v2 (Coqui)

**XTTS-v2 (Coqui), publié sous Coqui Public Model License (licence NON
commerciale), n'est utilisé NULLE PART dans ce dépôt.** Vérifié par recherche
exhaustive (`grep -rniE "xtts|coqui"` sur tout le repo hors `node_modules`) :
les seules occurrences sont (a) des commentaires de code expliquant
explicitement pourquoi XTTS a été écarté au profit de Kokoro (`kokoro-provider.ts`,
`media/tts.ts`, `docker-compose.yml`, `packages/shared/src/config.ts`), et (b)
la roadmap `SALLYCOURSE_250_PROMPTS.md` qui documente ce même choix. Aucun
appel réseau, aucune image Docker, aucun checkpoint XTTS/Coqui n'est présent
dans le pipeline. Le remplaçant retenu (clonage de voix OSS) est **Kokoro-82M
(Apache 2.0)** ; le TTS par défaut (voix non clonées) reste **Piper (MIT)**.

---

## Autres services d'infrastructure (mention, hors périmètre IA/media)

MongoDB, Redis, MinIO, mongo-express, redis-commander, mailpit, uptime-kuma :
composants d'infrastructure standard, chacun sous sa propre licence OSS
publique (SSPL pour MongoDB au-delà d'un certain usage packagé en service
géré, BSD-3-Clause pour Redis pré-fork, AGPL pour MinIO côté serveur, etc.) —
hors du périmètre IA/media de ce Prompt 161 ; voir `DEPENDENCY-AUDIT.md` pour
l'audit des dépendances npm et `docs/DEPLOYMENT.md` pour le détail infra.
