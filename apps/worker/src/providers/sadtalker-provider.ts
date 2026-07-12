// Avatar vidéo OSS SadTalker (Prompt 155) — anime une photo fixe de
// l'instructeur sur l'audio TTS déjà généré (lip-sync + micro-mouvements
// tête/yeux). Choisi plutôt qu'EchoMimic : SadTalker (CVPR 2023, dépôt
// OpenTalker/SadTalker) est le plus documenté/mature des deux pour un usage
// « photo + audio → vidéo » simple, avec une API Gradio/REST bien connue et
// plusieurs images Docker communautaires prêtes à l'emploi.
//
// Déploiement (documenté ici, AUCUN service réel ajouté sans le justifier —
// voir docker-compose.yml, service `sadtalker` du profil `ai`, commenté GPU) :
//   - Image type `vinthony/sadtalker` ou wrapper REST communautaire (ex.
//     camenduru/sadtalker-docker) exposant `POST /api/generate` (multipart :
//     champ `source_image` + `driven_audio` → renvoie le MP4 rendu, ou un
//     job_id pollable selon le wrapper choisi — ici on modélise l'API la plus
//     simple, synchrone, cohérente avec le reste du worker qui préfère éviter
//     les webhooks).
//   - GPU NVIDIA REQUIS pour un temps de rendu raisonnable (~1-2 min de calcul
//     par seconde de vidéo en CPU, largement trop lent pour un pipeline de
//     production ; sur GPU (T4/RTX), on tombe à un ratio proche du temps réel
//     ×2-4). D'où le flag SADTALKER_HAS_GPU (même convention que
//     OLLAMA_HAS_GPU) : sans GPU détecté/déclaré, on ne tente même pas l'appel
//     réseau et on retombe directement sur le mock (carte titre animée),
//     plutôt que de lancer un rendu CPU qui ferait exploser les délais du
//     pipeline BullMQ.
//
// LIMITES DE QUALITÉ (honnêteté requise, cf. commentaire miroir dans
// advanced-options-panel.tsx) : par rapport à HeyGen (avatar premium,
// entraîné spécifiquement, lip-sync et expressions très soignées),
// SadTalker produit un rendu correct mais perceptiblement plus rigide
// (mouvements de tête limités, lip-sync approximatif sur les phonèmes
// rapides, artefacts visibles en zoom sur le bas du visage). Recommandé pour
// le plan Free / prototypage ; HeyGen reste conseillé pour un rendu final
// « premium » (plans payants).
//
// MOCK_PROVIDERS, SADTALKER_BASE_URL absente, SADTALKER_HAS_GPU=false, ou
// aucune photo source fournie → aucun appel réseau, c'est l'appelant
// (avatar.ts) qui retombe sur le mock existant (carte titre animée) : ce
// fichier ne fait que l'appel provider (ou lever une erreur explicite),
// jamais son propre repli silencieux (même contrat que piper-provider.ts).
import { getConfig } from '../shared.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { PLANS, type PlanId } from '@sallycourse/shared';

/** URL de base du service SadTalker, surchargeable (.env / mock-server en test). */
function sadTalkerBaseUrl(): string | undefined {
  const raw = getConfig().SADTALKER_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, '') : undefined;
}

/**
 * true si un endpoint SadTalker est configuré, qu'un GPU est déclaré
 * disponible, ET que le mode mock global n'est pas actif. Sans GPU, on ne
 * tente jamais l'appel (rendu CPU inexploitable en pipeline, cf. en-tête).
 */
export function isSadTalkerConfigured(): boolean {
  const cfg = getConfig();
  return !cfg.MOCK_PROVIDERS && Boolean(sadTalkerBaseUrl()) && cfg.SADTALKER_HAS_GPU;
}

/** Provider avatar effectivement sélectionnable pour une génération. */
export type AvatarProvider = 'sadtalker' | 'heygen' | 'mock';

/**
 * HeyGen (premium) réservé aux plans payants — même convention que
 * isElevenLabsAllowedForPlan (kokoro-provider.ts) : `free` n'a accès qu'à
 * l'option OSS (SadTalker) ou au repli mock, jamais à HeyGen même si
 * HEYGEN_API_KEY est configurée globalement.
 */
export function isHeyGenAllowedForPlan(plan: PlanId | string | null | undefined): boolean {
  const resolved: PlanId = plan && plan in PLANS ? (plan as PlanId) : 'free';
  return resolved !== 'free';
}

export interface SelectAvatarProviderInput {
  /** Plan de l'utilisateur propriétaire du cours (gate HeyGen). */
  plan: PlanId | string | null | undefined;
  /** Clé HeyGen configurée globalement (cf. cfg.HEYGEN_API_KEY). */
  heygenConfigured: boolean;
  /** SadTalker joignable (endpoint + GPU + non-mock, cf. isSadTalkerConfigured). */
  sadTalkerConfigured: boolean;
  /** Photo source de l'instructeur fournie (SadTalker ne peut rien animer sans elle). */
  hasSourcePhoto: boolean;
  /** Identifiant d'avatar HeyGen choisi (vide = aucun avatar sélectionné). */
  avatarId: string | undefined;
}

/**
 * Sélection PURE du provider avatar — priorité à SadTalker (OSS, option PAR
 * DÉFAUT, cf. Prompt 155) s'il est configuré et qu'une photo source existe ;
 * HeyGen reste l'option PREMIUM, disponible seulement si le plan le permet ET
 * qu'un avatarId est choisi ; sinon repli mock (carte titre animée, jamais
 * d'échec bloquant). Fonction sans I/O, testable sans réseau ni GPU réel.
 */
export function selectAvatarProvider(input: SelectAvatarProviderInput): AvatarProvider {
  if (input.sadTalkerConfigured && input.hasSourcePhoto) return 'sadtalker';
  if (isHeyGenAllowedForPlan(input.plan) && input.heygenConfigured && input.avatarId) return 'heygen';
  return 'mock';
}

/** Résultat d'un rendu SadTalker réussi. */
export interface SadTalkerRenderResult {
  /** Buffer MP4 du rendu (téléchargé/renvoyé directement par l'API synchrone). */
  videoBuffer: Buffer;
}

/**
 * Lance un rendu SadTalker synchrone : photo source + audio narré (déjà
 * synthétisé par tts.ts) → MP4 « talking head ». Jette une erreur explicite
 * en cas d'échec HTTP — c'est l'appelant (avatar.ts) qui décide du repli
 * (mock), SadTalker n'a pas de connaissance de la chaîne de repli globale
 * (même contrat que synthesizePiper/synthesizeKokoro).
 */
export async function renderSadTalkerAvatar(photoUrl: string, audioBuffer: Buffer): Promise<SadTalkerRenderResult> {
  const base = sadTalkerBaseUrl();
  if (!base) {
    throw new Error('SadTalker : SADTALKER_BASE_URL non configurée');
  }

  const form = new FormData();
  form.append('source_image_url', photoUrl);
  form.append('driven_audio', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }), 'narration.mp3');

  const res = await fetch(`${base}/api/generate`, { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`SadTalker ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const videoBuffer = Buffer.from(await res.arrayBuffer());
  return { videoBuffer };
}
