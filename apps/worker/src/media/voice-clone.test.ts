// Tests du clonage de voix (Prompt 81) : chemin mock déterministe (aucune clé
// ElevenLabs en test), sans appel réseau. Les chemins réels ElevenLabs
// (fetch multipart) ne sont pas exercés ici (dépendance externe).
import { beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '../shared.js';
import { createClonedVoice, mockVoiceId, MIN_SAMPLE_SECONDS } from './voice-clone.js';

/** Environnement complet et valide pour getConfig (aucun accès réseau, pas de clé ElevenLabs → mock). */
function setTestEnv(): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    MONGO_URI: 'mongodb://localhost:27017/test',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    S3_BUCKET: 'test',
    S3_REGION: 'us-east-1',
    AUTH_SECRET: 'secret-de-test-suffisamment-long',
    CREDENTIALS_MASTER_KEY: 'a'.repeat(64),
  });
  delete process.env.ELEVENLABS_API_KEY;
  resetConfigCache();
}

beforeEach(() => {
  setTestEnv();
});

describe('mockVoiceId', () => {
  it('est déterministe pour un même (userId, label)', () => {
    const a = mockVoiceId('user1', 'Ma voix');
    const b = mockVoiceId('user1', 'Ma voix');
    expect(a).toBe(b);
    expect(a).toMatch(/^mock-voice-[0-9a-f]{24}$/);
  });

  it('distingue deux utilisateurs ou deux labels différents', () => {
    expect(mockVoiceId('user1', 'Ma voix')).not.toBe(mockVoiceId('user2', 'Ma voix'));
    expect(mockVoiceId('user1', 'Voix A')).not.toBe(mockVoiceId('user1', 'Voix B'));
  });
});

describe('createClonedVoice (mock — aucune clé ElevenLabs en test)', () => {
  it('retourne un voiceId fictif déterministe sans appel réseau', async () => {
    const sample = Buffer.from('audio-fictif');
    const result = await createClonedVoice('user42', sample, 'Voix instructeur');
    expect(result.live).toBe(false);
    expect(result.voiceId).toBe(mockVoiceId('user42', 'Voix instructeur'));
  });

  it('est stable entre deux appels identiques', async () => {
    const sample = Buffer.from('audio-fictif');
    const r1 = await createClonedVoice('user42', sample, 'Voix instructeur');
    const r2 = await createClonedVoice('user42', sample, 'Voix instructeur');
    expect(r1.voiceId).toBe(r2.voiceId);
  });
});

describe('MIN_SAMPLE_SECONDS', () => {
  it('vaut 60s (durée minimale recommandée)', () => {
    expect(MIN_SAMPLE_SECONDS).toBe(60);
  });
});
