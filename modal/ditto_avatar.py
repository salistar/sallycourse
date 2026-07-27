# Déploiement Modal — avatar « talking-head » Ditto (antgroup/ditto-talkinghead).
# Licence Apache-2.0 (code ET poids) : usage commercial OK, aucune clause RAIL.
# À partir d'UNE photo de visage frontale + un WAV (narration Chatterbox), génère
# une vidéo MP4 de tête parlante (mouvements de tête, clignements, lip-sync) —
# incrustée ensuite en « bulle présentateur » sur les slides par le worker.
#
# Déploiement :   modal deploy modal/ditto_avatar.py
# Endpoint (POST, proxy-auth Modal-Key/Modal-Secret) attendu par le worker :
#   POST {url}  JSON { image_b64, audio_b64 }  ->  video/mp4
#
# Backend PyTorch/ONNX (PAS TensorRT) → build déterministe, pas de moteur TRT à
# compiler ni à figer sur un GPU précis. Poids (backend pytorch + cfg seulement)
# TÉLÉCHARGÉS AU BUILD et embarqués dans l'image → cold-start = chargement modèle
# uniquement (~30 s), pas de download bloquant dans la requête (le download dans
# @modal.enter dépassait le timeout de la requête web au 1er appel).
import modal
from pydantic import BaseModel

app = modal.App("sallycourse-avatar")

DITTO_REPO = "https://github.com/antgroup/ditto-talkinghead"
DITTO_DIR = "/opt/ditto"
CKPT_DIR = f"{DITTO_DIR}/checkpoints"
HF_REPO = "digital-avatar/ditto-talkinghead"
DATA_ROOT = f"{CKPT_DIR}/ditto_pytorch"
CFG_PKL = f"{CKPT_DIR}/ditto_cfg/v0.4_hubert_cfg_pytorch.pkl"


class AvatarRequest(BaseModel):
    image_b64: str
    audio_b64: str


# Image : torch CUDA + deps runtime Ditto (opencv/librosa/scikit-image),
# ffmpeg + libgl pour opencv, repo cloné, PUIS poids pytorch+cfg téléchargés et
# embarqués dans l'image (allow_patterns = évite trt/onnx, ~plusieurs Go de moins).
image = (
    modal.Image.debian_slim(python_version="3.10")
    # build-essential : le repo Ditto compile une extension Cython (blend_images_cy)
    # à l'import via pyximport → gcc + headers requis au runtime.
    # libgles2 + libegl1 : mediapipe FaceLandmarker charge libGLESv2.so.2 / libEGL.so.1.
    .apt_install(
        "ffmpeg",
        "libgl1",
        "libglib2.0-0",
        "libgles2",
        "libegl1",
        "git",
        "git-lfs",
        "build-essential",
    )
    .pip_install(
        "torch",
        "torchvision",
        "torchaudio",
        "onnxruntime-gpu",
        "librosa",
        "soundfile",
        "opencv-python-headless",
        "imageio-ffmpeg",
        "scikit-image",
        "mediapipe",  # landmark478 (détection de repères du visage)
        "numpy==2.0.1",
        "cython",  # fournit pyximport (compilation JIT de blend_images_cy)
        "cuda-python",
        "tqdm",
        "filetype",
        "colored",
        "einops",
        "huggingface_hub",
        "fastapi[standard]",
    )
    .run_commands(f"git clone --depth 1 {DITTO_REPO} {DITTO_DIR}")
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download; "
        f"snapshot_download('{HF_REPO}', local_dir='{CKPT_DIR}', "
        "allow_patterns=['ditto_pytorch/**', 'ditto_cfg/**'])\""
    )
)


@app.cls(
    image=image,
    gpu="A10G",
    scaledown_window=300,
    timeout=900,
)
class Ditto:
    @modal.enter()
    def load(self):
        import sys

        # Poids déjà embarqués dans l'image (build) → on charge directement les
        # modèles (coûteux) une seule fois ; l'instance reste chaude tant qu'elle vit.
        sys.path.insert(0, DITTO_DIR)
        from stream_pipeline_offline import StreamSDK  # type: ignore

        self._StreamSDK = StreamSDK
        self.sdk = StreamSDK(CFG_PKL, DATA_ROOT)
        # Importe la fonction run() du repo (argparse ne s'exécute que sous __main__).
        import inference  # type: ignore

        self._run = inference.run

    def _fresh_sdk(self):
        """(Ré)instancie un SDK — repli si la réutilisation d'une instance échoue."""
        return self._StreamSDK(CFG_PKL, DATA_ROOT)

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def avatar(self, req: AvatarRequest):
        import base64
        import os
        import shutil
        import tempfile

        from fastapi import Response

        if not req.image_b64 or not req.audio_b64:
            return Response(
                content=b'{"error":"image_b64 et audio_b64 requis"}',
                media_type="application/json",
                status_code=400,
            )

        tmp = tempfile.mkdtemp(prefix="ditto_")
        img_path = os.path.join(tmp, "face.png")
        wav_path = os.path.join(tmp, "audio.wav")
        out_path = os.path.join(tmp, "out.mp4")
        with open(img_path, "wb") as f:
            f.write(base64.b64decode(req.image_b64))
        with open(wav_path, "wb") as f:
            f.write(base64.b64decode(req.audio_b64))

        try:
            # Réutilise le SDK chaud ; en cas d'état résiduel, repli sur une
            # instance neuve (les modèles restent en cache mémoire du process).
            try:
                self._run(self.sdk, wav_path, img_path, out_path, {})
            except Exception:
                self.sdk = self._fresh_sdk()
                self._run(self.sdk, wav_path, img_path, out_path, {})
            with open(out_path, "rb") as f:
                data = f.read()
        finally:
            # rmtree (pas rmdir) : Ditto/ffmpeg écrivent des fichiers intermédiaires
            # dans tmp → rmdir échouait (« Directory not empty »). ignore_errors :
            # le nettoyage ne doit JAMAIS faire échouer une génération réussie.
            shutil.rmtree(tmp, ignore_errors=True)

        return Response(content=data, media_type="video/mp4")


@app.local_entrypoint()
def main():
    print("App Ditto définie. Déploiement : modal deploy modal/ditto_avatar.py")
