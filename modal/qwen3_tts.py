# Déploiement Modal — voix premium Qwen3-TTS (Alibaba, Apache-2.0, commercial
# OK). Ajout ADDITIF suite à l'audit qualité modèles du 2026-07-22 : Qwen3-TTS
# surpasse Chatterbox sur les benchmarks publics et — surtout — n'a PAS produit
# les défauts constatés en réel sur Chatterbox (chunks dégénérés, voix qui
# change de timbre, cf. audit ESG 2026-07-19/20 dans chatterbox_tts.py). Ce
# fichier ne modifie ni ne remplace chatterbox_tts.py : les deux endpoints
# coexistent, le worker choisit via Course.ttsEngine / le bouton « switch »
# (voir media/tts.ts, providers/qwen3-tts-provider.ts).
#
# Déploiement :   modal deploy modal/qwen3_tts.py
# Endpoint (POST, proxy-auth Modal-Key/Modal-Secret) — MÊME CONTRAT que
# Chatterbox pour un branchement trivial côté worker :
#   POST {url}  JSON { text, language, audio_prompt_b64?, context? }  ->  audio/wav
#
# GPU L4, scale-à-zéro après 5 min d'inactivité (coût uniquement à l'usage).
#
# ── Deux checkpoints, un seul conteneur ───────────────────────────────────────
# L'API Qwen3-TTS sépare la synthèse en familles de checkpoints (contrairement
# à Chatterbox, un seul modèle pour les deux usages) :
#   - VoiceDesign (`generate_voice_design`) : voix STANDARD décrite en langage
#     naturel (`instruct`) — pas de banque de voix prédéfinie à connaître,
#     chargé EAGER (chemin le plus emprunté, cold-start payé une fois).
#   - Base (`generate_voice_clone`) : CLONAGE depuis un échantillon audio —
#     chargé PARESSEUX (au premier appel avec audio_prompt_b64), pour ne pas
#     payer son cold-start sur le chemin standard, largement majoritaire.
# Les deux checkpoints sont des 1.7B en bf16 (~3,4 Go cumulés) : tient
# largement sur un L4 (24 Go) même chargés simultanément.
#
# Clonage : notre pipeline ne capture qu'un ÉCHANTILLON AUDIO (pas de
# transcript associé) — `generate_voice_clone` exige `ref_text` par défaut
# pour une qualité optimale ; on utilise donc `x_vector_only_mode=True`
# (embedding de locuteur seul, sans texte de référence). Qualité de clonage
# légèrement inférieure à un ref_text fourni — compromis assumé, cohérent avec
# ce que Chatterbox offrait déjà (échantillon audio seul).
from typing import Optional

import modal
from pydantic import BaseModel

app = modal.App("sallycourse-qwen3-tts")


class TTSRequest(BaseModel):
    text: str
    language: str = "fr"
    audio_prompt_b64: Optional[str] = None
    # Traçabilité uniquement (journalisation) — même convention que Chatterbox.
    context: Optional[str] = None


# Correspondance locale ISO -> nom de langue attendu par l'API Qwen3-TTS (elle
# prend des noms complets, ex. "French", pas des codes ISO — vérifié sur les
# exemples officiels du dépôt). Repli "French" : SallyCourse est français en
# premier (Course.locale par défaut 'fr' dans tout le reste du code).
LANGUAGE_NAMES = {
    "fr": "French",
    "en": "English",
    "ar": "Arabic",
}
DEFAULT_LANGUAGE_NAME = "French"

# `instruct` par langue pour la voix STANDARD (VoiceDesign) — décrit la voix en
# langage naturel, dans la langue cible (comme l'exemple officiel du dépôt).
# Pas de sélection de style par l'auteur pour l'instant (parité minimale avec
# la voix standard Chatterbox) — un futur panneau pourrait exposer ce champ.
VOICE_DESIGN_INSTRUCT = {
    "fr": "Voix de narrateur professionnel, chaude et claire, articulation nette, débit calme et posé, ton pédagogique.",
    "en": "Warm, clear professional narrator voice, crisp articulation, calm steady pace, instructional tone.",
    "ar": "صوت راوٍ محترف، دافئ وواضح، نطق دقيق، وتيرة هادئة، نبرة تعليمية.",
}

# Garde-fou de longueur (PAS un correctif à un défaut observé — Qwen3-TTS n'a
# pas la limite dure ~300 caractères mesurée sur Chatterbox) : au-delà, on
# découpe simplement sur les frontières de phrase pour éviter un appel unique
# sur un texte arbitrairement long. Concaténation simple (petit silence entre
# morceaux) — pas de crossfade/QA par chunk : aucun défaut de ce type n'a été
# constaté sur ce modèle, inutile de reproduire l'échafaudage de Chatterbox
# sans preuve qu'il soit nécessaire ici.
QWEN3_MAX_CHARS = 600
CHUNK_GAP_SECONDS = 0.15


def _split_text(text: str, max_chars: int = QWEN3_MAX_CHARS):
    import re

    parts = re.split(r"(?<=[.!?…؟\n])\s+", text.strip())
    chunks, cur = [], ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if len(cur) + len(part) + 1 <= max_chars:
            cur = (cur + " " + part).strip()
        else:
            if cur:
                chunks.append(cur)
            cur = part
    if cur:
        chunks.append(cur)
    return chunks or [text.strip()]



# Base debian_slim (PAS nvidia/cuda+cudnn) — corrigé après échec de déploiement
# 2026-07-22 : contrairement à Chatterbox/Whisper (faster-whisper/CTranslate2,
# qui EXIGENT cuDNN système), Qwen3-TTS n'utilise que torch, dont les wheels
# PyPI embarquent déjà leur propre runtime CUDA — aucune base cuDNN nécessaire.
# La base cuDNN pointe par défaut vers les miroirs apt Ubuntu externes
# (archive.ubuntu.com/security.ubuntu.com), injoignables depuis le réseau de
# build Modal au moment du déploiement (2 échecs identiques) ; debian_slim
# utilise le miroir pip/apt interne de Modal, qui fonctionne (vérifié : c'est
# la base de modal/image_gen.py et modal/zimage_turbo.py, déployés sans souci).
# `ffmpeg`/`git` retirés : ce fichier n'invoque ni l'un ni l'autre (soundfile
# embarque déjà libsndfile dans ses wheels manylinux — aucun paquet apt requis).
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("qwen-tts", "soundfile", "fastapi[standard]", "numpy", "torch", "accelerate")
)

# Même volume que chatterbox_tts.py/whisper_transcribe.py : cache HF partagé
# entre déploiements Modal, poids téléchargés une seule fois.
hf_cache = modal.Volume.from_name("sallycourse-hf-cache", create_if_missing=True)

VOICE_DESIGN_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
CLONE_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"


@app.cls(
    image=image,
    gpu="L4",
    volumes={"/root/.cache/huggingface": hf_cache},
    scaledown_window=300,
    timeout=600,
)
class Qwen3Tts:
    @modal.enter()
    def load(self):
        import time

        import torch
        from qwen_tts import Qwen3TTSModel

        t0 = time.time()
        self.voice_design_model = Qwen3TTSModel.from_pretrained(
            VOICE_DESIGN_REPO,
            device_map="cuda:0",
            dtype=torch.bfloat16,
        )
        print(f"[qwen3-tts] VoiceDesign chargé en {time.time() - t0:.1f}s")
        # Clonage : chargé PARESSEUX au premier appel avec audio_prompt_b64
        # (voir _get_clone_model) — ne paie pas son cold-start sur le chemin
        # standard, très majoritaire.
        self.clone_model = None

    def _get_clone_model(self):
        import time

        import torch
        from qwen_tts import Qwen3TTSModel

        if self.clone_model is None:
            t0 = time.time()
            self.clone_model = Qwen3TTSModel.from_pretrained(
                CLONE_REPO,
                device_map="cuda:0",
                dtype=torch.bfloat16,
            )
            print(f"[qwen3-tts] Base (clonage) chargé en {time.time() - t0:.1f}s")
        return self.clone_model

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def tts(self, req: TTSRequest):
        import base64
        import io
        import os
        import tempfile
        import time

        import numpy as np
        import soundfile as sf
        from fastapi import Response

        ctx = req.context or "?"
        log_prefix = f"[qwen3-tts:{ctx}]"

        t_start = time.time()
        text = (req.text or "").strip()
        if not text:
            print(f"{log_prefix} requête rejetée : texte vide")
            return Response(content=b'{"error":"text vide"}', media_type="application/json", status_code=400)

        locale = (req.language or "fr").lower()
        language_name = LANGUAGE_NAMES.get(locale, DEFAULT_LANGUAGE_NAME)
        chunks = _split_text(text)
        use_clone = bool(req.audio_prompt_b64)
        print(
            f"{log_prefix} requête reçue : {len(text)} caractères, langue={language_name}, "
            f"clone_voix={use_clone}, {len(chunks)} chunk(s)"
        )

        tmp_ref_path = None
        try:
            if use_clone:
                model = self._get_clone_model()
                tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                tmp.write(base64.b64decode(req.audio_prompt_b64))
                tmp.flush()
                tmp.close()
                tmp_ref_path = tmp.name

            pieces = []
            sr = None
            for idx, chunk_text in enumerate(chunks):
                t_chunk = time.time()
                if use_clone:
                    wavs, chunk_sr = model.generate_voice_clone(
                        text=chunk_text,
                        language=language_name,
                        ref_audio=tmp_ref_path,
                        # Pas de transcript de l'échantillon dans notre pipeline
                        # (voir doc d'en-tête) : embedding de locuteur seul.
                        ref_text=None,
                        x_vector_only_mode=True,
                    )
                else:
                    instruct = VOICE_DESIGN_INSTRUCT.get(locale, VOICE_DESIGN_INSTRUCT["fr"])
                    wavs, chunk_sr = self.voice_design_model.generate_voice_design(
                        text=chunk_text,
                        language=language_name,
                        instruct=instruct,
                    )
                sr = chunk_sr
                seg = np.asarray(wavs[0], dtype=np.float32)
                pieces.append(seg)
                print(f"{log_prefix} chunk {idx} généré en {time.time() - t_chunk:.1f}s ({seg.size / chunk_sr:.1f}s audio)")
        finally:
            if tmp_ref_path and os.path.exists(tmp_ref_path):
                os.unlink(tmp_ref_path)

        if not pieces or sr is None:
            print(f"{log_prefix} aucun audio produit")
            return Response(content=b'{"error":"synthese vide"}', media_type="application/json", status_code=502)

        gap = np.zeros(int(sr * CHUNK_GAP_SECONDS), dtype=np.float32)
        sequence = []
        for i, seg in enumerate(pieces):
            if i > 0:
                sequence.append(gap)
            sequence.append(seg)
        audio = np.concatenate(sequence) if sequence else pieces[0]

        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV")
        print(
            f"{log_prefix} terminé : {len(chunks)} chunk(s), {audio.size / sr:.1f}s audio, "
            f"{time.time() - t_start:.1f}s écoulées"
        )
        return Response(content=buf.getvalue(), media_type="audio/wav")


@app.local_entrypoint()
def main():
    print("App Qwen3-TTS définie. Déploiement : modal deploy modal/qwen3_tts.py")
