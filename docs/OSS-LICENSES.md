# Conformité licences OSS — pipeline IA/media (Prompt 161)

Ce document audite les licences de chaque composant open source IA/media
intégré dans le pipeline SallyCourse (providers `apps/worker/src/providers/`
+ services `docker-compose.yml` profil `ai`) et vérifie, pour chacun,
que l'usage commercial est permis **avant activation par défaut**. Pour la
liste de référence courte (type NOTICE), voir `NOTICE.md` à la racine.

Rappel de contexte projet : tous ces composants sont **mock-friendly** — si
le service local n'est pas démarré, le pipeline retombe sur un mode dégradé
déterministe (jamais un blocage). La conformité licence ci-dessous concerne
le cas où le service EST démarré et réellement utilisé en production.

## Méthode

Pour chaque composant : licence exacte (vérifiée à la source, pas de
supposition), lien officiel, statut usage commercial, seuils/conditions
éventuels, et fichier(s) du repo où il est câblé.

---

## ✅ Checklist — Ollama (runtime LLM local, P152)

| Point | Statut |
|---|---|
| Licence du runtime (`ollama/ollama`) | **MIT** — https://github.com/ollama/ollama/blob/main/LICENSE |
| Usage commercial autorisé | ✅ Oui, sans restriction |
| Seuil/condition | Aucun |
| Fichier(s) | `apps/worker/src/providers/ollama-provider.ts`, `docker-compose.yml` (service `ollama`) |
| Activé par défaut ? | Oui si `OLLAMA_BASE_URL` configurée (sinon repli cloud/mock) |
| **Verdict** | **OK pour activation par défaut** |

### Modèles tirés via Ollama

| Modèle | Licence | Usage commercial | Seuil | Verdict |
|---|---|---|---|---|
| `llama3.3:70b` | Llama 3.3 Community License (propriétaire Meta) | ✅ Oui | Licence expire de plein droit si >700M MAU (Licencié/affiliés) — https://www.llama.com/llama3_3/license/ | OK à l'échelle actuelle ; **attribution obligatoire** dans les mentions légales (« Llama 3.3 is licensed under the Llama 3.3 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved. ») |
| `llama3.2:8b` | Llama 3.2 Community License (propriétaire Meta) | ✅ Oui | Même seuil 700M MAU — https://www.llama.com/llama3_2/license/ | OK à l'échelle actuelle ; même attribution requise |
| `qwen2.5:14b` | **Apache 2.0** | ✅ Oui | Aucun | **OK sans réserve** |
| `qwen2.5:72b` | **Tongyi Qianwen / « Qwen License »** (propriétaire Alibaba, **PAS** Apache 2.0) | ✅ Oui | Licence séparée requise auprès d'Alibaba Cloud si >100M MAU — https://huggingface.co/Qwen/Qwen2.5-72B-Instruct/blob/main/LICENSE | OK à l'échelle actuelle ; **ne pas supposer Apache 2.0 pour ce modèle précis** (contrairement aux autres tailles Qwen2.5, qui le sont) |

**Action requise avant activation en production** : ajouter la mention
d'attribution Llama (3.2/3.3) dans la page mentions légales / CGU du produit
si ces modèles sont réellement tirés côté serveur (`ollama pull`). Aucune
action bloquante pour Ollama lui-même ni pour Qwen2.5-14B.

---

## ✅ Checklist — Piper (TTS OSS par défaut, P153)

| Point | Statut |
|---|---|
| Licence (binaire historique `rhasspy/piper`) | **MIT** — https://github.com/rhasspy/piper/blob/master/LICENSE.md |
| Usage commercial autorisé | ✅ Oui, sans restriction |
| Seuil/condition | Aucun |
| Fichier(s) | `apps/worker/src/providers/piper-provider.ts`, `docker-compose.yml` (services `piper`, `piper-http`) |
| Activé par défaut ? | Oui — voix par défaut du plan Free si `PIPER_BASE_URL` configurée |
| **Verdict** | **OK pour activation par défaut**, avec vigilance ci-dessous |

⚠️ **Point de vigilance daté (2026-07)** : le dépôt historique
`rhasspy/piper` (MIT) est **archivé en lecture seule depuis octobre 2025**.
Le développement actif s'est déplacé vers `OHF-Voice/piper1-gpl`, publié en
**GPL-3.0** — nom du fork explicite (« -gpl »). `docker-compose.yml` épingle
`rhasspy/wyoming-piper:latest` (wrapper Wyoming autour du binaire Piper
historique) et `lscr.io/linuxserver/piper:latest` (wrapper HTTP) : ces deux
images, à la date de rédaction, s'appuient toujours sur le moteur MIT
d'origine, pas sur le nouveau fork GPL. **Avant toute mise à jour de ces
images/tags**, revérifier explicitement quel binaire Piper est embarqué —
un changement silencieux vers `piper1-gpl` changerait le régime de licence.

---

## ✅ Checklist — Kokoro-82M (clonage de voix OSS, remplace XTTS, P153)

| Point | Statut |
|---|---|
| Licence | **Apache 2.0** (confirmé, poids publiés le 25/12/2024) |
| Lien officiel | https://huggingface.co/hexgrad/Kokoro-82M · https://github.com/hexgrad/kokoro |
| Usage commercial autorisé | ✅ Oui, sans restriction |
| Seuil/condition | Aucun |
| Fichier(s) | `apps/worker/src/providers/kokoro-provider.ts`, `docker-compose.yml` (service `kokoro`, image `ghcr.io/remsky/kokoro-fastapi-cpu`) |
| Activé par défaut ? | Oui pour le clonage de voix (remplace XTTS/Coqui) si `KOKORO_BASE_URL` configurée |
| **Verdict** | **OK pour activation par défaut, aucune réserve** |

Kokoro-82M est le remplaçant **explicitement retenu** de XTTS-v2 (Coqui) pour
le clonage de voix, précisément parce que sa licence Apache 2.0 permet un
usage commercial sans restriction — voir confirmation XTTS ci-dessous.

---

## ✅ Checklist — ComfyUI + FLUX.1-schnell (illustrations OSS, P154)

| Point | Statut |
|---|---|
| Licence ComfyUI (orchestrateur) | **GPL-3.0** — https://github.com/comfyanonymous/ComfyUI/blob/master/LICENSE |
| Licence FLUX.1-schnell (modèle, Black Forest Labs) | **Apache 2.0** — https://huggingface.co/black-forest-labs/FLUX.1-schnell |
| Usage commercial autorisé | ✅ Oui pour les deux, sous réserve du mode d'usage (voir ci-dessous) |
| Fichier(s) | `apps/worker/src/providers/comfyui-provider.ts`, `docker-compose.yml` (service `comfyui`) |
| Activé par défaut ? | **Non** — ComfyUI est une amélioration optionnelle (GPU requis) ; le SVG procédural (code propriétaire, zéro dépendance) reste le repli par défaut. |
| **Verdict** | **OK**, avec analyse GPL-3.0 ci-dessous |

**Analyse du mode d'usage ComfyUI (GPL-3.0)** : `comfyui-provider.ts` appelle
ComfyUI **exclusivement via son API HTTP** (`POST /prompt`, `GET /history`,
`GET /view`) depuis un service Docker séparé — le code du worker SallyCourse
ne compile, ne lie et ne redistribue aucun fichier source ComfyUI. Ce mode
« outil auto-hébergé interrogé en réseau » est le cas d'usage GPL le moins
contraignant : il ne crée pas d'œuvre dérivée du code ComfyUI côté worker et
ne déclenche donc pas l'obligation de publier le code propriétaire de
SallyCourse sous GPL. **Règle à ne jamais enfreindre** : ne pas embarquer/
statically-linker du code source ComfyUI dans `apps/worker` — rester sur ce
modèle d'appel HTTP inter-services.

FLUX.1-schnell (le modèle de poids chargé PAR ComfyUI) est Apache 2.0, donc
sans restriction propre — le fichier checkpoint (`flux1-schnell-fp8.safetensors`)
n'est pas embarqué dans l'image (déposé manuellement dans le volume), ce qui
est cohérent avec la licence (pas de redistribution automatique par
SallyCourse).

---

## ✅ Checklist — SadTalker (avatar vidéo OSS, P155)

| Point | Statut |
|---|---|
| Licence (dépôt `OpenTalker/SadTalker`) | **Apache 2.0** (mise à jour confirmée — l'ancienne ambiguïté MIT/README « non-commercial » est résolue) |
| Lien officiel | https://github.com/OpenTalker/SadTalker/blob/main/LICENSE |
| Usage commercial autorisé | ✅ Oui pour le code du dépôt |
| Fichier(s) | `apps/worker/src/providers/sadtalker-provider.ts`, `docker-compose.yml` (service `sadtalker`) |
| Activé par défaut ? | **Non** — nécessite `SADTALKER_HAS_GPU=true` explicite, sinon jamais appelé (repli HeyGen/mock) |
| **Verdict** | **OK avec vigilance checkpoints**, honnêteté requise ci-dessous |

⚠️ **Historique à connaître** : le dépôt SadTalker a longtemps eu une
**contradiction documentée** entre son fichier LICENSE (permissif) et son
README (qui indiquait autrefois « usage recherche/personnel uniquement »),
ce qui a fait dire par le passé — y compris dans une version antérieure de ce
même audit — que SadTalker était potentiellement non-commercial. **Vérifié à
la date de rédaction (2026-07)** : le dépôt est aujourd'hui explicitement
Apache 2.0, la mention non-commerciale du README a été retirée/clarifiée.

**Réserve restante, honnête** : SadTalker dépend de **checkpoints tiers**
(modèles d'expression faciale, audio2pose, souvent réutilisés depuis d'autres
travaux de recherche) qui ne sont **pas embarqués dans l'image Docker** —
ils doivent être déposés manuellement dans le volume
`sadtalker-checkpoints/` (voir commentaire `docker-compose.yml`, service
`sadtalker`). Chaque checkpoint individuel peut porter sa propre licence,
distincte de celle du dépôt principal SadTalker. **Avant la première mise en
production réelle** (déploiement d'un GPU + téléchargement effectif des
checkpoints), il faut revérifier la licence de chaque fichier de poids
téléchargé, pas seulement celle du code orchestrateur.

---

## ✅ Confirmation explicite — XTTS-v2 (Coqui) : ABSENT du repo

**Vérification exhaustive effectuée** :
```
grep -rniE "xtts|coqui" . --include="*.ts" --include="*.tsx" --include="*.md" \
  --include="*.yml" --include="*.yaml" --include="*.json" --exclude-dir=node_modules
```

Résultat : **aucune occurrence de code exécutable, image Docker, endpoint,
checkpoint ou variable d'environnement liée à XTTS/Coqui.** Les seules
occurrences textuelles sont :
- des commentaires expliquant explicitement le choix de NE PAS utiliser XTTS
  (`apps/worker/src/providers/kokoro-provider.ts` lignes 1-6,
  `apps/worker/src/media/tts.ts` ligne 303, `docker-compose.yml` lignes
  120-122, `packages/shared/src/config.ts` ligne 51) ;
- la roadmap `SALLYCOURSE_250_PROMPTS.md` (Prompt 153, 161, 199) qui
  documente ce même arbitrage historique.

**Conclusion** : XTTS-v2 (Coqui Public Model License, non-commerciale) n'est
utilisé nulle part. Kokoro-82M (Apache 2.0) est le remplaçant effectif pour
le clonage de voix ; Piper (MIT) reste le TTS par défaut pour les voix non
clonées. Cette substitution est correcte et suffisante pour un usage
commercial SaaS.

---

## Récapitulatif — feu vert par composant avant activation par défaut

| Composant | Licence | Usage commercial | Activé par défaut aujourd'hui | Action requise |
|---|---|---|---|---|
| Ollama (runtime) | MIT | ✅ | Oui si configuré | Aucune |
| Llama 3.3 70B / 3.2 8B (modèles) | Llama Community License | ✅ (<700M MAU) | Oui si tiré | Attribution légale à ajouter aux CGU |
| Qwen2.5 14B (modèle) | Apache 2.0 | ✅ | Oui si tiré | Aucune |
| Qwen2.5 72B (modèle) | Qwen License (propriétaire) | ✅ (<100M MAU) | Oui si tiré | Ne pas confondre avec Apache 2.0 — RAS sinon |
| Piper (TTS) | MIT | ✅ | Oui (défaut Free) | Revérifier à chaque bump d'image (risque fork GPL) |
| Kokoro-82M (clonage voix) | Apache 2.0 | ✅ | Oui si configuré | Aucune |
| ComfyUI (orchestrateur) | GPL-3.0 (usage service HTTP, non lié) | ✅ | Non (optionnel, GPU) | Ne jamais linker le code dans le worker |
| FLUX.1-schnell (modèle image) | Apache 2.0 | ✅ | Non (optionnel, via ComfyUI) | Aucune |
| SadTalker (code) | Apache 2.0 | ✅ | Non (GPU requis explicite) | Revérifier licence de chaque checkpoint téléchargé |
| XTTS-v2 / Coqui | Coqui Public Model License (non-commerciale) | ❌ | **Non utilisé — confirmé absent** | Aucune (déjà remplacé par Kokoro) |

Tous les composants activables par défaut aujourd'hui (Ollama, Piper, Kokoro)
sont sous licence permissive (MIT/Apache 2.0) sans restriction d'usage
commercial. Les composants nécessitant GPU/config explicite (ComfyUI+FLUX,
SadTalker) sont également compatibles usage commercial, avec une vigilance
documentée sur les checkpoints tiers pour SadTalker. Le seul point d'action
non-bloquant restant est l'ajout d'une mention d'attribution Llama dans les
CGU si les modèles Llama 3.x sont effectivement tirés en production.
