import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { getConfig, storageKeys, uploadObject } from '@sallycourse/shared';
import { User as UserModel, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

// /api/account/voice-clone — voix clonée de l'instructeur (Prompt 81).
//  - POST (multipart) : uploade l'échantillon audio de l'utilisateur, valide
//    consentement + durée min (>= 60s recommandé), crée la voix ElevenLabs
//    (ou un id mock déterministe) et la stocke sur User.clonedVoiceId ;
//  - GET : statut courant (voiceId, statut, durée de l'échantillon) ;
//  - DELETE : supprime la voix clonée (best-effort côté ElevenLabs + reset local).
//
// L'appel ElevenLabs (fetch REST, multipart) est dupliqué ici en miniature —
// volontairement : le web et le worker ne partagent pas de code runtime hors
// @sallycourse/shared|db, et cette route est un flux interactif utilisateur
// (upload → résultat immédiat), pas une étape du pipeline BullMQ.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_SAMPLE_SECONDS = 60;
const MAX_MB = 50;
const ACCEPTED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/mp4'];

function elevenLabsBaseUrl(): string {
  const raw = process.env.ELEVENLABS_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : 'https://api.elevenlabs.io').replace(/\/+$/, '');
}

/** Id de voix fictif déterministe (mock) — même recette que le worker (voir apps/worker/src/media/voice-clone.ts). */
async function mockVoiceId(userId: string, label: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(`voice-clone:${userId}:${label}`).digest('hex');
  return `mock-voice-${hash.slice(0, 24)}`;
}

async function createClonedVoiceRemote(
  apiKey: string,
  sample: Buffer,
  label: string,
): Promise<string> {
  const form = new FormData();
  form.append('name', label);
  form.append('files', new Blob([new Uint8Array(sample)], { type: 'audio/mpeg' }), 'sample.mp3');

  const res = await fetch(`${elevenLabsBaseUrl()}/v1/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status} : ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { voice_id?: string };
  if (!data.voice_id) throw new Error('ElevenLabs voices/add : réponse sans voice_id');
  return data.voice_id;
}

/**
 * POST — upload de l'échantillon + création de la voix clonée.
 * Champs multipart attendus :
 *  - file : audio (mp3/wav/webm/mp4), >= 60 s recommandé
 *  - durationSeconds : durée mesurée côté client (HTMLAudioElement.duration —
 *    aucune lib d'analyse audio côté serveur disponible dans ce workspace)
 *  - consent : "true" — consentement explicite obligatoire, bloque sinon
 *  - label : nom de la voix (optionnel, défaut "Ma voix")
 */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('invalidMultipart');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Échantillon audio manquant (champ « file »).', code: 'missingAudioSample' }, { status: 400 });
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Format non supporté (MP3, WAV, WebM ou M4A attendu).', code: 'unsupportedAudioFormat' },
      { status: 415 },
    );
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Échantillon trop lourd (max ${MAX_MB} Mo).`, code: 'voiceCloneSampleTooLarge', params: { max: MAX_MB } }, { status: 413 });
  }

  const consentRaw = form.get('consent');
  const consent = consentRaw === 'true' || consentRaw === 'on' || consentRaw === '1';
  if (!consent) {
    return NextResponse.json(
      { error: 'Consentement explicite requis (case « voiceCloneConsent ») avant tout clonage vocal.', code: 'voiceCloneConsentRequired' },
      { status: 400 },
    );
  }

  const durationRaw = form.get('durationSeconds');
  const durationSeconds = typeof durationRaw === 'string' ? Number.parseFloat(durationRaw) : NaN;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return NextResponse.json(
      { error: 'Durée de l’échantillon manquante ou invalide.', code: 'invalidSampleDuration' },
      { status: 400 },
    );
  }
  if (durationSeconds < MIN_SAMPLE_SECONDS) {
    return NextResponse.json(
      { error: `Échantillon trop court : ${Math.round(durationSeconds)}s (minimum recommandé : ${MIN_SAMPLE_SECONDS}s).`, code: 'voiceCloneSampleTooShort', params: { seconds: Math.round(durationSeconds), minSeconds: MIN_SAMPLE_SECONDS } },
      { status: 400 },
    );
  }

  const labelRaw = form.get('label');
  const label = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim().slice(0, 80) : 'Ma voix';

  await connectDb();
  const cfg = getConfig();
  const mock = cfg.MOCK_PROVIDERS || !cfg.ELEVENLABS_API_KEY;

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    // Conserve l'échantillon (traçabilité / conformité), best-effort.
    await uploadObject(storageKeys.voiceSample(user.id), buffer, file.type || 'audio/mpeg').catch(() => undefined);

    const voiceId = mock
      ? await mockVoiceId(user.id, label)
      : await createClonedVoiceRemote(cfg.ELEVENLABS_API_KEY!, buffer, label);

    await UserModel.findByIdAndUpdate(user.id, {
      clonedVoiceId: voiceId,
      voiceCloneStatus: 'ready',
      voiceCloneConsent: true,
      voiceCloneSampleSeconds: Math.round(durationSeconds),
      // Active AUSSI le clonage Chatterbox/Modal : l'échantillon vient d'être
      // stocké à voiceSample(userId) ; ce timestamp sert de drapeau de présence
      // + version dans la clé de cache TTS (voir tts-generation.ts / Course.useCustomVoice).
      voiceSampleUploadedAt: new Date(),
    });

    return NextResponse.json(
      { ok: true, voiceId, status: 'ready', mock, sampleSeconds: Math.round(durationSeconds) },
      { status: 201 },
    );
  } catch (err) {
    await UserModel.findByIdAndUpdate(user.id, { voiceCloneStatus: 'failed' }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Échec du clonage vocal : ${message}`, code: 'voiceCloneFailed', params: { message: message } }, { status: 502 });
  }
}

/** GET — statut courant de la voix clonée. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const dbUser = await UserModel.findById(user.id)
    .select('clonedVoiceId voiceCloneStatus voiceCloneConsent voiceCloneSampleSeconds')
    .lean();
  if (!dbUser) {
    return apiError('userNotFound');
  }

  return NextResponse.json({
    voiceId: dbUser.clonedVoiceId ?? null,
    status: dbUser.voiceCloneStatus ?? 'none',
    consent: Boolean(dbUser.voiceCloneConsent),
    sampleSeconds: dbUser.voiceCloneSampleSeconds ?? null,
  });
}

/** DELETE — supprime la voix clonée (best-effort provider + reset local). */
export async function DELETE() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const dbUser = await UserModel.findById(user.id).select('clonedVoiceId').lean();
  const voiceId = dbUser?.clonedVoiceId;

  if (voiceId && !voiceId.startsWith('mock-voice-')) {
    const cfg = getConfig();
    if (cfg.ELEVENLABS_API_KEY) {
      await fetch(`${elevenLabsBaseUrl()}/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': cfg.ELEVENLABS_API_KEY },
      }).catch(() => undefined);
    }
  }

  await UserModel.findByIdAndUpdate(user.id, {
    clonedVoiceId: undefined,
    voiceCloneStatus: 'none',
    voiceCloneSampleSeconds: undefined,
    voiceSampleUploadedAt: undefined,
  });

  return NextResponse.json({ ok: true, status: 'none' });
}
