# Déploiement Modal — transcription Whisper large-v3 sur GPU (faster-whisper).
# Remplace le faster-whisper 'small' CPU du worker (~4x temps réel, mauvais en
# darija) : large-v3 GPU = sous-titres fiables, dictée vocale P210 (darija/arabe)
# et import vidéo P198 (transcription de longues vidéos) enfin exploitables.
#
# Déploiement :   modal deploy modal/whisper_transcribe.py
# Endpoint (POST, proxy-auth Modal-Key/Modal-Secret) attendu par le worker :
#   POST {url}  JSON { audio_b64, language? }  ->  JSON { text, language,
#     segments: [{ start, end, text }] }
#
# GPU L4, scale-à-zéro après 5 min d'inactivité (coût uniquement à l'usage).
from typing import Optional

import modal
from pydantic import BaseModel

app = modal.App("sallycourse-whisper")


class TranscribeRequest(BaseModel):
    # Audio (n'importe quel format lisible par ffmpeg : webm/mp3/wav/m4a/mp4) en base64.
    audio_b64: str
    # Langue forcée ('fr'|'en'|'ar' ; 'ar' pour la darija). None → auto-détection.
    language: Optional[str] = None


# Image CUDA + cuDNN (faster-whisper/CTranslate2 exige cuDNN pour l'inférence GPU ;
# c'est la source n°1 d'échecs si on part de debian_slim sans les libs CUDA).
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11"
    )
    .apt_install("ffmpeg")
    # requests : faster-whisper 1.1.0 l'importe (utils.py) mais ne le déclare pas
    # toujours en dépendance résolue → sans lui, ModuleNotFoundError au chargement
    # et conteneur en crash-loop (endpoint qui renvoie 303, jamais démarré).
    .pip_install("faster-whisper==1.1.0", "fastapi[standard]", "requests")
)

# Cache des poids HuggingFace (large-v3 ~3 Go) — partagé avec les autres apps,
# téléchargé une seule fois puis persistant entre cold-starts.
hf_cache = modal.Volume.from_name("sallycourse-hf-cache", create_if_missing=True)

MODEL_NAME = "large-v3"


@app.cls(
    image=image,
    gpu="L4",
    volumes={"/root/.cache/huggingface": hf_cache},
    scaledown_window=300,
    timeout=900,
)
class Whisper:
    @modal.enter()
    def load(self):
        from faster_whisper import WhisperModel

        # float16 sur GPU : rapide et précis. Le 1er cold-start télécharge le
        # modèle dans le volume (~1-2 min), ensuite servi depuis le cache.
        self.model = WhisperModel(MODEL_NAME, device="cuda", compute_type="float16")

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def transcribe(self, req: TranscribeRequest):
        import base64
        import os
        import tempfile

        from fastapi import Response

        data = base64.b64decode(req.audio_b64 or "")
        if not data:
            return Response(
                content=b'{"error":"audio vide"}',
                media_type="application/json",
                status_code=400,
            )

        tmp = tempfile.NamedTemporaryFile(suffix=".media", delete=False)
        tmp.write(data)
        tmp.flush()
        tmp.close()
        try:
            language = (req.language or "").strip().lower() or None
            segments, info = self.model.transcribe(
                tmp.name,
                language=language,
                vad_filter=True,  # coupe les silences → moins d'hallucinations
                beam_size=5,
            )
            seg_list = []
            texts = []
            for s in segments:
                t = (s.text or "").strip()
                seg_list.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": t})
                texts.append(t)
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)

        import json

        payload = {
            "text": " ".join(texts).strip(),
            "language": info.language,
            "segments": seg_list,
        }
        return Response(content=json.dumps(payload, ensure_ascii=False), media_type="application/json")


@app.local_entrypoint()
def main():
    print("App Whisper définie. Déploiement : modal deploy modal/whisper_transcribe.py")
