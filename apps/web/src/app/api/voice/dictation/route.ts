import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { storageKeys, uploadObject } from '@sallycourse/shared';
import { DICTATION_INPUT_LANGS, type DictationInputLang } from '@sallycourse/shared/voice-intent';
import { VoiceDictation, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { getVoiceIntakeQueue, VOICE_INTAKE_JOB } from '@/lib/queues';

/**
 * POST /api/voice/dictation — création de cours à la VOIX (Prompt 210).
 * L'utilisateur enregistre sa voix (MediaRecorder → audio/webm) décrivant le
 * cours voulu ; on stocke l'audio, on crée un VoiceDictation 'pending' et on
 * enfile un job voice-intake (transcription faster-whisper + interprétation
 * LLM). Le worker n'expose aucun HTTP : le client POLLE ensuite
 * GET /api/voice/dictation/[id]. Rate-limité (Whisper + LLM coûteux), même
 * schéma que les autres appels LLM déclenchés par l'utilisateur.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MB = 25;
const ACCEPTED_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
];

// Rate limit — la dictée déclenche Whisper + un appel LLM : limites serrées.
const DICTATION_USER_LIMIT = { limit: 15, windowSec: 300 };
const DICTATION_IP_LIMIT = { limit: 40, windowSec: 300 };

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`voice-dictation:user:${user.id}`, DICTATION_USER_LIMIT),
    rateLimit(`voice-dictation:ip:${ip}`, DICTATION_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de dictées, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('invalidMultipart');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Enregistrement audio manquant (champ « file »).', code: 'audioRecordingMissing' }, { status: 400 });
  }
  // Pas de court-circuit sur file.type falsy : un Content-Type vide/absent doit
  // être REFUSÉ (sinon un fichier non audio sans type passe le contrôle).
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Format non supporté (WebM, MP3, WAV, OGG ou M4A attendu).', code: 'unsupportedAudioFormatWebm' },
      { status: 415 },
    );
  }
  if (file.size === 0) {
    return apiError('emptyRecording');
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Enregistrement trop lourd (max ${MAX_MB} Mo).`, code: 'dictationRecordingTooLarge', params: { max: MAX_MB } }, { status: 413 });
  }

  const langRaw = form.get('inputLang');
  const inputLang: DictationInputLang =
    typeof langRaw === 'string' && (DICTATION_INPUT_LANGS as readonly string[]).includes(langRaw)
      ? (langRaw as DictationInputLang)
      : 'fr';

  await connectDb();

  // Crée d'abord le document pour disposer de son _id (clé de stockage).
  const dictation = new VoiceDictation({ userId: user.id, inputLang, audioKey: 'pending', status: 'pending' });
  const dictationId = dictation._id.toString();
  dictation.audioKey = storageKeys.voiceDictation(user.id!, dictationId);

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    await uploadObject(dictation.audioKey, buffer, file.type || 'audio/webm');
  } catch {
    return NextResponse.json({ error: 'Échec du stockage de l’enregistrement.', code: 'recordingStorageFailed' }, { status: 502 });
  }
  await dictation.save();

  // Enfile le traitement asynchrone (jobId déterministe : re-poster ne duplique pas).
  try {
    // MOCK_PROVIDERS n'a aucune incidence ici : le worker gère lui-même le repli
    // déterministe. On enfile toujours (le worker doit tourner pour aboutir).
    await getVoiceIntakeQueue().add(
      VOICE_INTAKE_JOB,
      { dictationId },
      { jobId: `${VOICE_INTAKE_JOB}:${dictationId}`, removeOnComplete: 50, removeOnFail: 100 },
    );
  } catch {
    await VoiceDictation.findByIdAndUpdate(dictationId, {
      status: 'failed',
      error: 'Impossible de démarrer le traitement de la dictée.', code: 'cannotStartDictationProcessing',
    }).catch(() => undefined);
    return NextResponse.json(
      { error: 'Impossible de démarrer le traitement, réessayez plus tard.', code: 'cannotStartProcessing' },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: dictationId, status: 'pending' }, { status: 201 });
}
