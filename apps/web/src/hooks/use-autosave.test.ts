import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createAutosaveScheduler } from './use-autosave';

describe('createAutosaveScheduler (debounce)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("n'appelle pas saveFn avant l'expiration du délai", () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const onSaving = vi.fn();
    const scheduler = createAutosaveScheduler(5000, {
      saveFn,
      onSaving,
      onSaved: vi.fn(),
      onError: vi.fn(),
    });

    scheduler.schedule('a');
    vi.advanceTimersByTime(4999);

    expect(saveFn).not.toHaveBeenCalled();
    expect(onSaving).not.toHaveBeenCalled();
  });

  it('appelle saveFn avec la dernière valeur une fois le délai écoulé', () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = createAutosaveScheduler(5000, {
      saveFn,
      onSaving: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
    });

    scheduler.schedule('a');
    vi.advanceTimersByTime(5000);

    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('a');
  });

  it('redémarre le compte à rebours à chaque nouvel appel (débounce réel)', () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = createAutosaveScheduler(5000, {
      saveFn,
      onSaving: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
    });

    scheduler.schedule('a');
    vi.advanceTimersByTime(3000);
    scheduler.schedule('b'); // Nouvelle frappe : le timer précédent est annulé.
    vi.advanceTimersByTime(3000);

    expect(saveFn).not.toHaveBeenCalled(); // Seulement 3s écoulées depuis 'b'.

    vi.advanceTimersByTime(2000); // Total 5s depuis 'b'.
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('b'); // Seule la dernière valeur est sauvegardée.
  });

  it('notifie onSaving puis onSaved en cas de succès', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const onSaving = vi.fn();
    const onSaved = vi.fn();
    const scheduler = createAutosaveScheduler(1000, {
      saveFn,
      onSaving,
      onSaved,
      onError: vi.fn(),
    });

    scheduler.schedule('x');
    vi.advanceTimersByTime(1000);
    expect(onSaving).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('notifie onError si saveFn rejette', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('network'));
    const onError = vi.fn();
    const onSaved = vi.fn();
    const scheduler = createAutosaveScheduler(1000, {
      saveFn,
      onSaving: vi.fn(),
      onSaved,
      onError,
    });

    scheduler.schedule('x');
    vi.advanceTimersByTime(1000);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('cancel() empêche tout déclenchement ultérieur', () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const scheduler = createAutosaveScheduler(1000, {
      saveFn,
      onSaving: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
    });

    scheduler.schedule('x');
    scheduler.cancel();
    vi.advanceTimersByTime(5000);

    expect(saveFn).not.toHaveBeenCalled();
  });

  it("une résolution tardive d'un run annulé n'écrase pas le statut du run suivant", async () => {
    // Simule : schedule('a') se déclenche, sa Promise met du temps à
    // résoudre ; entre-temps un nouveau schedule('b') est déclenché et
    // résout plus vite. Le onSaved final doit correspondre à 'b', et l'appel
    // tardif de 'a' ne doit pas redéclencher onSaved/onError après coup.
    let resolveA: () => void = () => {};
    const saveFn = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => Promise.resolve());

    const onSaved = vi.fn();
    const scheduler = createAutosaveScheduler(1000, {
      saveFn,
      onSaving: vi.fn(),
      onSaved,
      onError: vi.fn(),
    });

    scheduler.schedule('a');
    vi.advanceTimersByTime(1000); // Déclenche le run 'a' (Promise en attente).

    scheduler.schedule('b');
    vi.advanceTimersByTime(1000); // Déclenche le run 'b', qui résout immédiatement.
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    resolveA(); // Résolution tardive du run obsolète 'a'.
    await Promise.resolve();
    expect(onSaved).toHaveBeenCalledTimes(1); // Pas de second appel dû à 'a'.
  });
});
