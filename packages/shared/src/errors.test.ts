import { describe, expect, it } from 'vitest';
import { AppError, isAppError, toAppError } from './errors';

describe('AppError', () => {
  it('sépare userMessage (affichable) et technicalMessage (logs)', () => {
    const err = new AppError('VALIDATION_ERROR', 'Le titre est invalide.', {
      technicalMessage: 'zod: title.length < 3',
    });
    expect(err.userMessage).toBe('Le titre est invalide.');
    expect(err.technicalMessage).toBe('zod: title.length < 3');
    expect(err.message).toBe('zod: title.length < 3');
  });

  it('déduit httpStatus/retryable par défaut selon le code', () => {
    const notFound = new AppError('NOT_FOUND', 'Cours introuvable.');
    expect(notFound.httpStatus).toBe(404);
    expect(notFound.retryable).toBe(false);

    const external = new AppError('EXTERNAL_SERVICE_ERROR', 'Service indisponible.', { retryable: true });
    expect(external.httpStatus).toBe(502);
    expect(external.retryable).toBe(true);
  });

  it('accepte un httpStatus explicite qui prime sur le défaut', () => {
    const err = new AppError('INTERNAL_ERROR', 'Oups.', { httpStatus: 418 });
    expect(err.httpStatus).toBe(418);
  });

  it('chaîne la cause si fournie', () => {
    const cause = new Error('boom');
    const err = new AppError('INTERNAL_ERROR', 'Oups.', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('isAppError', () => {
  it('reconnaît une AppError et rejette une Error standard', () => {
    expect(isAppError(new AppError('NOT_FOUND', 'x'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('x')).toBe(false);
  });
});

describe('toAppError', () => {
  it('retourne une AppError telle quelle', () => {
    const original = new AppError('CONFLICT', 'Déjà existant.');
    expect(toAppError(original)).toBe(original);
  });

  it('enveloppe une Error native en INTERNAL_ERROR avec le message technique préservé', () => {
    const wrapped = toAppError(new Error('ECONNREFUSED'));
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.technicalMessage).toBe('ECONNREFUSED');
    expect(wrapped.userMessage).toBe('Une erreur est survenue.');
  });

  it('enveloppe une valeur non-Error en stringifiant', () => {
    const wrapped = toAppError('chaîne brute');
    expect(wrapped.technicalMessage).toBe('chaîne brute');
  });

  it('accepte un message utilisateur de repli personnalisé', () => {
    const wrapped = toAppError(new Error('x'), 'Réessayez plus tard.');
    expect(wrapped.userMessage).toBe('Réessayez plus tard.');
  });
});
