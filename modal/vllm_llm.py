"""Endpoint LLM GPU serverless (Modal) — la 3e option de « Moteur de rédaction »
à côté d'Ollama (local CPU) et des providers cloud.

Sert Qwen2.5-7B-Instruct via vLLM sur GPU (même famille que l'Ollama qwen2.5
utilisé en local, pour une qualité cohérente), mais des dizaines de fois plus
rapide que le CPU. Autoscale Modal → tient de nombreuses générations en
parallèle. Auth par proxy Modal (Modal-Key / Modal-Secret), comme les autres
endpoints (chatterbox_tts.py, image_gen.py…).

Contrat d'appel (worker : lib/claude.ts, branche « modal ») :
  POST {system?, user, temperature?, max_tokens?}  ->  {"text": "..."}
Le worker extrait ensuite le JSON de `text` (extractJsonPayload).

Déploiement :  modal deploy modal/vllm_llm.py
"""
from typing import Optional

import modal
from pydantic import BaseModel

app = modal.App("sallycourse-llm")

# Cache des poids partagé avec les autres apps (image_gen, whisper…) — évite de
# re-télécharger le modèle à chaque cold-start de conteneur.
hf_cache = modal.Volume.from_name("sallycourse-hf-cache", create_if_missing=True)

MODEL = "Qwen/Qwen2.5-7B-Instruct"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "vllm==0.6.6.post1",
        "fastapi[standard]",
        "pydantic>=2",
        "hf-transfer",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "VLLM_DO_NOT_TRACK": "1"})
)


class ChatRequest(BaseModel):
    user: str
    system: Optional[str] = None
    temperature: float = 0.4
    max_tokens: int = 4096


@app.cls(
    image=image,
    gpu="L4",  # 24 Go — Qwen2.5-7B fp16 (~15 Go) + KV cache tiennent large.
    volumes={"/root/.cache/huggingface": hf_cache},
    scaledown_window=300,  # garde le conteneur chaud 5 min après le dernier appel
    timeout=600,
)
class LLM:
    @modal.enter()
    def load(self):
        from vllm import LLM as VLLM
        from transformers import AutoTokenizer

        self.tok = AutoTokenizer.from_pretrained(MODEL)
        self.llm = VLLM(
            model=MODEL,
            max_model_len=8192,
            gpu_memory_utilization=0.90,
            enforce_eager=True,  # démarrage plus rapide (pas de capture CUDA graph)
            disable_log_stats=True,
        )

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def chat(self, req: ChatRequest):
        from vllm import SamplingParams

        messages = []
        if req.system:
            messages.append({"role": "system", "content": req.system})
        messages.append({"role": "user", "content": req.user})
        prompt = self.tok.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        params = SamplingParams(
            temperature=max(0.0, min(req.temperature, 1.5)),
            top_p=0.9,
            max_tokens=max(64, min(req.max_tokens, 8192)),
            repetition_penalty=1.05,
        )
        outputs = self.llm.generate([prompt], params)
        text = outputs[0].outputs[0].text if outputs and outputs[0].outputs else ""
        return {"text": text, "model": MODEL}


@app.local_entrypoint()
def main():
    """Test rapide en local : modal run modal/vllm_llm.py"""
    print("Déploie avec : modal deploy modal/vllm_llm.py")
