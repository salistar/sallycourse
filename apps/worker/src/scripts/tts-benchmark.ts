// Benchmark manuel des providers TTS (Prompt 153) — PAS un test bloquant :
// génère un échantillon avec chaque provider disponible (Piper, Kokoro,
// ElevenLabs, OpenAI) et logue durée d'appel + taille du fichier produit, pour
// une comparaison manuelle de qualité/latence. Providers non configurés (pas
// de clé/URL) sont simplement ignorés (pas d'échec).
//
// Exécution : `pnpm --filter @sallycourse/worker exec tsx src/scripts/tts-benchmark.ts`
import { getConfig } from '../shared.js';
import { isPiperConfigured, resolvePiperVoice, synthesizePiper } from '../providers/piper-provider.js';
import { isKokoroConfigured, resolveKokoroVoice, synthesizeKokoro } from '../providers/kokoro-provider.js';

const SAMPLE_TEXT_FR =
  "Bienvenue dans ce cours. Cette phrase sert d'échantillon pour comparer la qualité et la latence des différents moteurs de synthèse vocale.";
const LOCALE = 'fr';
const SPEED = 1;

interface BenchmarkResult {
  provider: string;
  ok: boolean;
  ms?: number;
  bytes?: number;
  error?: string;
}

async function timeIt(provider: string, fn: () => Promise<Buffer>): Promise<BenchmarkResult> {
  const start = Date.now();
  try {
    const buf = await fn();
    return { provider, ok: true, ms: Date.now() - start, bytes: buf.byteLength };
  } catch (err) {
    return { provider, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function synthesizeElevenLabsRaw(apiKey: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent('ThT5KcBeYPX3keUQqHPh')}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: SAMPLE_TEXT_FR, model_id: 'eleven_multilingual_v2' }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function synthesizeOpenAiRaw(apiKey: string): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: SAMPLE_TEXT_FR, response_format: 'mp3' }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Lance le benchmark sur tous les providers configurés, retourne les résultats bruts (exporté pour tests). */
export async function runTtsBenchmark(): Promise<BenchmarkResult[]> {
  const cfg = getConfig();
  const results: BenchmarkResult[] = [];

  if (isPiperConfigured()) {
    results.push(
      await timeIt('piper', () => synthesizePiper(SAMPLE_TEXT_FR, LOCALE, resolvePiperVoice(LOCALE), SPEED)),
    );
  }
  if (isKokoroConfigured()) {
    results.push(
      await timeIt('kokoro', () => synthesizeKokoro(SAMPLE_TEXT_FR, LOCALE, resolveKokoroVoice(LOCALE), SPEED)),
    );
  }
  if (cfg.ELEVENLABS_API_KEY) {
    results.push(await timeIt('elevenlabs', () => synthesizeElevenLabsRaw(cfg.ELEVENLABS_API_KEY!)));
  }
  if (cfg.OPENAI_API_KEY) {
    results.push(await timeIt('openai', () => synthesizeOpenAiRaw(cfg.OPENAI_API_KEY!)));
  }

  return results;
}

/** Point d'entrée CLI — n'exécute que si le fichier est lancé directement (pas importé en test). */
async function main(): Promise<void> {
  const results = await runTtsBenchmark();
  if (results.length === 0) {
    console.log('Aucun provider TTS configuré (PIPER_BASE_URL / KOKORO_BASE_URL / ELEVENLABS_API_KEY / OPENAI_API_KEY) — rien à comparer.');
    return;
  }
  console.log('\n── Benchmark TTS (comparaison manuelle) ──');
  for (const r of results) {
    if (r.ok) {
      console.log(`  ${r.provider.padEnd(12)} ok    ${String(r.ms).padStart(6)} ms   ${String(r.bytes).padStart(8)} octets`);
    } else {
      console.log(`  ${r.provider.padEnd(12)} échec ${r.error}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error('Benchmark TTS : erreur inattendue', err);
  process.exitCode = 1;
});
