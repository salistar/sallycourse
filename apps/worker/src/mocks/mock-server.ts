// Serveur HTTP de MOCK des APIs payantes (node:http, zéro dépendance).
//
// But : tester le CHEMIN RÉSEAU du worker avec de fausses clés, sans dépenser.
// En temps normal, MOCK_PROVIDERS=true court-circuite déjà tout appel réseau
// (voir claude.ts / tts.ts). Ce serveur sert quand on veut EXERCER le réseau :
//   MOCK_PROVIDERS=false + fausses clés + ANTHROPIC_BASE_URL/ELEVENLABS_BASE_URL
//   pointés sur ce serveur (voir README de ce dossier).
//
// Endpoints simulés :
//   POST /v1/messages                     → Anthropic Messages (JSON depuis fixtures)
//   POST /v1/text-to-speech/:voiceId      → ElevenLabs (mp3 silence minimal)
//   POST /v1/audio/speech                 → OpenAI TTS (mp3 silence minimal)
//   GET  /health                          → sonde de disponibilité
//
// Lancement : pnpm --filter @sallycourse/worker mock-server
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  extractDurationMinFromPrompt,
  extractTitleFromPrompt,
  mockArticle,
  mockMarketing,
  mockOutline,
  mockQuiz,
  mockSlideScript,
  mockTp,
  mockVideoScript,
} from '../lib/mock-fixtures.js';

/** Port d'écoute (surchargable via MOCK_SERVER_PORT). */
const PORT = Number.parseInt(process.env.MOCK_SERVER_PORT ?? '', 10) || 4010;

// ── Fixtures Claude selon l'intention détectée dans le prompt ─────
// On n'a pas le schéma Zod ici (côté réseau) : on infère le type de contenu
// depuis des mots-clés du prompt, avec l'outline comme repli par défaut.
type FixtureKind = 'outline' | 'quiz' | 'video' | 'slides' | 'article' | 'tp' | 'marketing';

function detectKind(user: string): FixtureKind {
  const u = user.toLowerCase();
  if (/\bquiz\b|questions?\b|qcm/.test(u)) return 'quiz';
  if (/marketing|landing|description udemy|titres?\b|promo/.test(u)) return 'marketing';
  if (/travaux pratiques|\btp\b|atelier|exercice/.test(u)) return 'tp';
  if (/article|mémo|memo|markdown/.test(u)) return 'article';
  if (/slides?|diapos?|script.*vid|durée\s+cible/.test(u)) return 'slides';
  if (/vidéo|video|narration/.test(u)) return 'video';
  return 'outline';
}

/** Construit la charge JSON de fixture correspondant à l'intention du prompt. */
function fixtureJson(user: string): unknown {
  const title = extractTitleFromPrompt(user);
  switch (detectKind(user)) {
    case 'quiz':
      return mockQuiz(title);
    case 'marketing':
      return mockMarketing(title);
    case 'tp':
      return mockTp(title);
    case 'article':
      return mockArticle(title);
    case 'slides':
      return mockSlideScript(title, extractDurationMinFromPrompt(user));
    case 'video':
      return mockVideoScript(title);
    case 'outline':
    default:
      return mockOutline(title);
  }
}

// ── mp3 silencieux minimal (une frame MPEG-1 Layer III muette) ───
// Suffisant pour que le client reçoive des octets audio/mpeg plausibles.
// Le worker re-normalise/mesure via ffmpeg de toute façon.
function silentMp3(): Buffer {
  // En-tête de frame MP3 valide (0xFFFB…) suivi de zéros — ~144 octets.
  const header = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  const body = Buffer.alloc(140, 0);
  return Buffer.concat([header, body]);
}

// ── Helpers HTTP ─────────────────────────────────────────────────
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function sendMp3(res: ServerResponse, buffer: Buffer): void {
  res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': buffer.length });
  res.end(buffer);
}

/** Extrait le message utilisateur d'un corps Anthropic Messages (tolérant). */
function userTextFromMessages(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      messages?: { role?: string; content?: unknown }[];
      system?: unknown;
    };
    const parts: string[] = [];
    for (const msg of parsed.messages ?? []) {
      if (msg.role && msg.role !== 'user') continue;
      if (typeof msg.content === 'string') parts.push(msg.content);
      else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block === 'object' && 'text' in block) parts.push(String((block as { text: unknown }).text));
        }
      }
    }
    if (typeof parsed.system === 'string') parts.push(parsed.system);
    return parts.join('\n');
  } catch {
    return raw;
  }
}

// ── Routage ──────────────────────────────────────────────────────
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const { method } = req;

  if (method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', service: 'sallycourse-mock' });
  }

  // Anthropic Messages API → réponse texte contenant le JSON de fixture.
  if (method === 'POST' && url.pathname === '/v1/messages') {
    const user = userTextFromMessages(await readBody(req));
    const json = JSON.stringify(fixtureJson(user), null, 2);
    return sendJson(res, 200, {
      id: `msg_mock_${Date.now().toString(36)}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-mock',
      content: [{ type: 'text', text: json }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 512, output_tokens: 1024 },
    });
  }

  // ElevenLabs TTS → mp3 muet.
  if (method === 'POST' && /^\/v1\/text-to-speech\/[^/]+$/.test(url.pathname)) {
    await readBody(req); // consomme le corps
    return sendMp3(res, silentMp3());
  }

  // OpenAI TTS → mp3 muet.
  if (method === 'POST' && url.pathname === '/v1/audio/speech') {
    await readBody(req);
    return sendMp3(res, silentMp3());
  }

  sendJson(res, 404, { error: { type: 'not_found', message: `Route non mockée : ${method} ${url.pathname}` } });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[mock-server] erreur non gérée', err);
    if (!res.headersSent) sendJson(res, 500, { error: { type: 'internal', message: 'mock-server error' } });
  });
});

server.listen(PORT, () => {
  console.log(
    `[mock-server] SallyCourse mock à l'écoute sur http://localhost:${PORT}\n` +
      `  Anthropic   : ANTHROPIC_BASE_URL=http://localhost:${PORT}\n` +
      `  ElevenLabs  : ELEVENLABS_BASE_URL=http://localhost:${PORT}\n` +
      `  OpenAI TTS  : OPENAI_BASE_URL=http://localhost:${PORT}/v1`,
  );
});

// Arrêt propre.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
