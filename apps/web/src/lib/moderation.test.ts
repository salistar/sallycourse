import { describe, expect, it, vi } from 'vitest';

// Tests de la modération de contenu (P70) — mode MOCK exclusivement (aucun
// appel réseau réel) : mots-clés triviaux de test pour vérifier le chemin de
// refus, et titres normaux pour vérifier l'autorisation par défaut.

vi.mock('@sallycourse/shared', () => ({
  getConfig: () => ({ MOCK_PROVIDERS: true, ANTHROPIC_API_KEY: undefined }),
}));

vi.mock('./logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { moderateCourseTitle } = await import('./moderation');

describe('moderateCourseTitle (mode mock)', () => {
  it('autorise un titre de cours normal', async () => {
    const result = await moderateCourseTitle('Apprendre React de zéro');
    expect(result.allowed).toBe(true);
  });

  it('autorise un titre mentionnant légitimement un logiciel commercial', async () => {
    const result = await moderateCourseTitle('Maîtriser Photoshop pour les débutants');
    expect(result.allowed).toBe(true);
  });

  it('bloque un titre évoquant un logiciel piraté (contrefaçon flagrante)', async () => {
    const result = await moderateCourseTitle('Cours Photoshop CC complet piraté');
    expect(result.allowed).toBe(false);
    expect(result.category).toBe('contrefaçon');
  });

  it('bloque un titre évoquant un logiciel cracké', async () => {
    const result = await moderateCourseTitle('Utiliser Windows cracké gratuitement');
    expect(result.allowed).toBe(false);
  });

  it('bloque un titre médical dangereux', async () => {
    const result = await moderateCourseTitle('Comment guérir le cancer avec des plantes');
    expect(result.allowed).toBe(false);
    expect(result.category).toBe('médical dangereux');
  });

  it('la détection est insensible à la casse', async () => {
    const result = await moderateCourseTitle('LOGICIEL CRACKÉ pour tous');
    expect(result.allowed).toBe(false);
  });
});
