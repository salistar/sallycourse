import { afterEach, describe, expect, it, vi } from 'vitest';

// Test de la route de clonage vocal (P81). Aucune connexion Mongo/S3/ElevenLabs
// réelle : tout est mocké. Couvre la validation (consentement, durée min) et le
// chemin mock déterministe (MOCK_PROVIDERS / pas de clé ElevenLabs).

const requireApiUserMock = vi.fn();
vi.mock('@/lib/session', () => ({
  requireApiUser: () => requireApiUserMock(),
}));

const uploadObjectMock = vi.fn().mockResolvedValue(undefined);
const getConfigMock = vi.fn();
vi.mock('@sallycourse/shared', () => ({
  uploadObject: (...args: unknown[]) => uploadObjectMock(...args),
  storageKeys: { voiceSample: (userId: string) => `voice-samples/${userId}.audio` },
  getConfig: () => getConfigMock(),
}));

const findByIdAndUpdateMock = vi.fn().mockResolvedValue({});
const findByIdMock = vi.fn();
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  User: {
    findByIdAndUpdate: (...args: unknown[]) => findByIdAndUpdateMock(...args),
    findById: (...args: unknown[]) => findByIdMock(...args),
  },
}));

// Import APRÈS les mocks (hoisting vi.mock garanti par vitest).
import { DELETE, GET, POST } from './route';

function mockSessionUser(id = 'user-1') {
  requireApiUserMock.mockResolvedValue({ id, email: 'user@example.com' });
}

function mockMockMode() {
  getConfigMock.mockReturnValue({ MOCK_PROVIDERS: true, ELEVENLABS_API_KEY: undefined });
}

function buildForm(opts: {
  file?: File;
  consent?: string;
  durationSeconds?: string;
  label?: string;
}): FormData {
  const form = new FormData();
  if (opts.file !== undefined) form.append('file', opts.file);
  if (opts.consent !== undefined) form.append('consent', opts.consent);
  if (opts.durationSeconds !== undefined) form.append('durationSeconds', opts.durationSeconds);
  if (opts.label !== undefined) form.append('label', opts.label);
  return form;
}

function requestWithForm(form: FormData): Request {
  return new Request('http://localhost/api/account/voice-clone', { method: 'POST', body: form });
}

function sampleFile(sizeBytes = 1024): File {
  return new File([new Uint8Array(sizeBytes)], 'sample.mp3', { type: 'audio/mpeg' });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/account/voice-clone', () => {
  it('refuse sans authentification', async () => {
    requireApiUserMock.mockResolvedValue(Response.json({ error: 'nope' }, { status: 401 }));
    const res = await POST(requestWithForm(buildForm({})));
    expect(res.status).toBe(401);
  });

  it('refuse sans fichier', async () => {
    mockSessionUser();
    const res = await POST(requestWithForm(buildForm({ consent: 'true', durationSeconds: '90' })));
    expect(res.status).toBe(400);
  });

  it('refuse sans consentement explicite', async () => {
    mockSessionUser();
    const res = await POST(
      requestWithForm(buildForm({ file: sampleFile(), durationSeconds: '90' })),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/consentement/i);
    expect(findByIdAndUpdateMock).not.toHaveBeenCalled();
  });

  it('refuse un échantillon trop court (< 60s)', async () => {
    mockSessionUser();
    const res = await POST(
      requestWithForm(buildForm({ file: sampleFile(), consent: 'true', durationSeconds: '30' })),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/trop court/i);
  });

  it('accepte un échantillon >= 60s avec consentement (mock déterministe)', async () => {
    mockSessionUser('user-42');
    mockMockMode();
    const res = await POST(
      requestWithForm(
        buildForm({ file: sampleFile(), consent: 'true', durationSeconds: '75', label: 'Voix instructeur' }),
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; voiceId: string; mock: boolean };
    expect(body.ok).toBe(true);
    expect(body.mock).toBe(true);
    expect(body.voiceId).toMatch(/^mock-voice-[0-9a-f]{24}$/);

    expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
      'user-42',
      expect.objectContaining({ voiceCloneStatus: 'ready', voiceCloneConsent: true, voiceCloneSampleSeconds: 75 }),
    );
    expect(uploadObjectMock).toHaveBeenCalled();
  });

  it('est déterministe pour un même (userId, label)', async () => {
    mockSessionUser('user-42');
    mockMockMode();
    const res1 = await POST(
      requestWithForm(buildForm({ file: sampleFile(), consent: 'true', durationSeconds: '75', label: 'X' })),
    );
    const res2 = await POST(
      requestWithForm(buildForm({ file: sampleFile(), consent: 'true', durationSeconds: '75', label: 'X' })),
    );
    const b1 = (await res1.json()) as { voiceId: string };
    const b2 = (await res2.json()) as { voiceId: string };
    expect(b1.voiceId).toBe(b2.voiceId);
  });
});

describe('GET /api/account/voice-clone', () => {
  it('retourne le statut courant', async () => {
    mockSessionUser('user-1');
    findByIdMock.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve({
            clonedVoiceId: 'mock-voice-abc',
            voiceCloneStatus: 'ready',
            voiceCloneConsent: true,
            voiceCloneSampleSeconds: 90,
          }),
      }),
    });
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      voiceId: 'mock-voice-abc',
      status: 'ready',
      consent: true,
      sampleSeconds: 90,
    });
  });

  it('retourne le statut par défaut si aucune voix', async () => {
    mockSessionUser('user-1');
    findByIdMock.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({}) }),
    });
    const res = await GET();
    const body = (await res.json()) as { voiceId: unknown; status: string };
    expect(body.voiceId).toBeNull();
    expect(body.status).toBe('none');
  });
});

describe('DELETE /api/account/voice-clone', () => {
  it('réinitialise la voix clonée localement', async () => {
    mockSessionUser('user-1');
    findByIdMock.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ clonedVoiceId: 'mock-voice-abc' }) }),
    });
    const res = await DELETE();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, status: 'none' });
    expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ voiceCloneStatus: 'none' }),
    );
  });
});
