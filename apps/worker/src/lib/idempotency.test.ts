// Tests de reprise granulaire (P69) : withCheckpoint doit reprendre EXACTEMENT
// où une boucle multi-items s'est arrêtée après un crash simulé — pas de
// double-traitement des items déjà faits, pas de saut d'item non traité.
import { describe, expect, it, vi } from 'vitest';
import { createMemoryCheckpointStore, withCheckpoint, type CheckpointStore } from './idempotency.js';

/** Store durable simulé par un objet JS externe à la fonction testée : persiste
 * réellement entre deux appels de withCheckpoint (contrairement à une variable
 * locale), ce qui permet de simuler un crash puis une relance dans un NOUVEAU
 * process logique (nouvelle invocation de withCheckpoint sur le même jobId). */
function createDurableStore<R>(): { store: CheckpointStore<R>; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const store = createMemoryCheckpointStore<R>();
  // On garde une référence externe en interceptant save/load/clear pour
  // pouvoir inspecter l'état "persisté" indépendamment de withCheckpoint.
  const wrapped: CheckpointStore<R> = {
    load: (jobId) => store.load(jobId),
    save: async (jobId, entries) => {
      await store.save(jobId, entries);
      raw.set(jobId, entries);
    },
    clear: async (jobId) => {
      await store.clear(jobId);
      raw.delete(jobId);
    },
  };
  return { store: wrapped, raw };
}

describe('withCheckpoint — reprise granulaire après crash simulé', () => {
  it('traite tous les items du premier coup quand rien ne crashe', async () => {
    const { store } = createDurableStore<number>();
    const processed: number[] = [];

    const { results, resumedCount, processedCount } = await withCheckpoint({
      jobId: 'lesson-1',
      steps: [10, 20, 30],
      store,
      runStep: async (n) => {
        processed.push(n);
        return n * 2;
      },
    });

    expect(results).toEqual([20, 40, 60]);
    expect(processed).toEqual([10, 20, 30]);
    expect(resumedCount).toBe(0);
    expect(processedCount).toBe(3);
  });

  it('reprend exactement où un crash au milieu de la boucle s\'est arrêté : pas de double-traitement, pas de saut', async () => {
    const { store } = createDurableStore<{ value: number }>();
    const items = ['a', 'b', 'c', 'd', 'e'];

    // ── Tentative 1 : crash simulé au traitement du 3ᵉ item (index 2, 'c') ──
    const attempt1Processed: string[] = [];
    const CRASH_AT_INDEX = 2;

    await expect(
      withCheckpoint({
        jobId: 'lesson-crash',
        steps: items,
        store,
        runStep: async (item, index) => {
          attempt1Processed.push(item);
          if (index === CRASH_AT_INDEX) {
            throw new Error(`crash simulé sur l'item ${item}`);
          }
          return { value: index };
        },
      }),
    ).rejects.toThrow(/crash simulé sur l'item c/);

    // Seuls les items AVANT le crash ont été réellement traités (checkpointés).
    expect(attempt1Processed).toEqual(['a', 'b', 'c']);

    // ── Tentative 2 (relance, même jobId) : reprise depuis le checkpoint ──
    const attempt2Processed: string[] = [];
    const { results, resumedCount, processedCount } = await withCheckpoint({
      jobId: 'lesson-crash',
      steps: items,
      store,
      runStep: async (item, index) => {
        attempt2Processed.push(item);
        return { value: index };
      },
    });

    // 'a' et 'b' (déjà checkpointés avant le crash) ne sont JAMAIS retraités.
    // 'c' (qui avait jeté, donc jamais checkpointé) EST retraité : pas de saut.
    // 'd' et 'e' (jamais atteints) sont traités normalement.
    expect(attempt2Processed).toEqual(['c', 'd', 'e']);
    expect(resumedCount).toBe(2); // a, b rejoués depuis le checkpoint
    expect(processedCount).toBe(3); // c, d, e réellement exécutés cette fois

    // Le résultat final couvre les 5 items, dans l'ordre, sans doublon ni trou.
    expect(results).toEqual([{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }]);

    // Total de traitements RÉELS sur les deux tentatives : 3 (a,b,c) + 3 (c,d,e) = 6,
    // mais 'a' et 'b' n'apparaissent qu'UNE fois chacun (jamais retraités) — la
    // seule répétition est 'c', qui avait échoué et n'avait donc pas checkpointé.
    const allRuns = [...attempt1Processed, ...attempt2Processed];
    expect(allRuns.filter((x) => x === 'a')).toHaveLength(1);
    expect(allRuns.filter((x) => x === 'b')).toHaveLength(1);
    expect(allRuns.filter((x) => x === 'c')).toHaveLength(2); // échoué puis rejoué
    expect(allRuns.filter((x) => x === 'd')).toHaveLength(1);
    expect(allRuns.filter((x) => x === 'e')).toHaveLength(1);
  });

  it('supporte plusieurs crashes successifs avant d\'aboutir (reprise itérative)', async () => {
    const { store } = createDurableStore<number>();
    const items = [1, 2, 3, 4];
    // Compte les tentatives d'exécution RÉELLE (non rejouées) sur l'item 3 :
    // les deux premières échouent, la troisième aboutit — simule un worker
    // instable qui redémarre plusieurs fois avant de réussir cet item précis.
    let item3RealAttempts = 0;

    const runOnce = () =>
      withCheckpoint({
        jobId: 'lesson-multi-crash',
        steps: items,
        store,
        runStep: async (item) => {
          if (item === 3) {
            item3RealAttempts += 1;
            if (item3RealAttempts <= 2) {
              throw new Error('instabilité simulée');
            }
          }
          return item * 10;
        },
      });

    await expect(runOnce()).rejects.toThrow();
    await expect(runOnce()).rejects.toThrow();
    const final = await runOnce();

    // L'item 3 n'a été réellement (ré)exécuté que 3 fois (2 échecs + 1 succès) ;
    // les items 1 et 2 (avant lui) n'ont jamais été rejoués au-delà de la 1ʳᵉ fois.
    expect(item3RealAttempts).toBe(3);
    expect(final.results).toEqual([10, 20, 30, 40]);
  });

  it('appelle onStep avec resumed=true pour les items rejoués et resumed=false pour les items neufs', async () => {
    const { store } = createDurableStore<string>();
    const onStepMock = vi.fn();

    await expect(
      withCheckpoint({
        jobId: 'lesson-onstep',
        steps: ['x', 'y', 'z'],
        store,
        runStep: async (item, index) => {
          if (index === 1) throw new Error('stop');
          return item.toUpperCase();
        },
      }),
    ).rejects.toThrow();

    await withCheckpoint({
      jobId: 'lesson-onstep',
      steps: ['x', 'y', 'z'],
      store,
      runStep: async (item) => item.toUpperCase(),
      onStep: onStepMock,
    });

    // 'x' (index 0) a été checkpointé avant le crash → rejoué (resumed=true).
    // 'y' et 'z' n'ont jamais été checkpointés → traités (resumed=false).
    expect(onStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0, resumed: true, result: 'X' }),
    );
    expect(onStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, resumed: false, result: 'Y' }),
    );
    expect(onStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: 2, resumed: false, result: 'Z' }),
    );
  });

  it('purge le checkpoint une fois tous les items traités (repli propre pour une régénération complète ultérieure)', async () => {
    const { store, raw } = createDurableStore<number>();

    await withCheckpoint({
      jobId: 'lesson-final',
      steps: [1, 2],
      store,
      runStep: async (n) => n,
    });

    expect(raw.has('lesson-final')).toBe(false);
    expect(await store.load('lesson-final')).toEqual([]);
  });

  it('cas complexe (Prompt 128) : crash au milieu d\'un rendu multi-leçons (2/5), reprend exactement à la leçon 3 sans retraiter les leçons 1 et 2 déjà rendues', async () => {
    const { store } = createDurableStore<{ videoKey: string }>();
    const lessons = ['lecon-1', 'lecon-2', 'lecon-3', 'lecon-4', 'lecon-5'];
    const CRASH_AFTER_LESSON_INDEX = 1; // crash pendant le traitement de la 3ᵉ leçon (index 2)

    // ── Tentative 1 : le worker "crashe" (process killé) pendant le rendu de
    // la leçon 3, APRÈS avoir déjà rendu et checkpointé les leçons 1 et 2. ──
    const attempt1Rendered: string[] = [];
    await expect(
      withCheckpoint({
        jobId: 'course-multi-lecon',
        steps: lessons,
        store,
        runStep: async (lessonId, index) => {
          if (index === CRASH_AFTER_LESSON_INDEX + 1) {
            // Simule un crash worker EN COURS de rendu de la leçon 3 : le
            // segment ffmpeg est en train d'être encodé quand le process meurt
            // (kill -9 simulé), donc runStep jette avant tout retour de résultat.
            throw new Error(`worker tué (kill -9) pendant le rendu de ${lessonId}`);
          }
          attempt1Rendered.push(lessonId);
          return { videoKey: `s3://videos/${lessonId}.mp4` };
        },
      }),
    ).rejects.toThrow(/worker tué/);

    // Seules les leçons 1 et 2 ont été réellement rendues et checkpointées ;
    // la leçon 3 n'a jamais produit de résultat (crash avant tout retour).
    expect(attempt1Rendered).toEqual(['lecon-1', 'lecon-2']);

    // ── Tentative 2 (relance du worker, même courseId/jobId) : reprise ──
    const attempt2Rendered: string[] = [];
    const { results, resumedCount, processedCount } = await withCheckpoint({
      jobId: 'course-multi-lecon',
      steps: lessons,
      store,
      runStep: async (lessonId) => {
        attempt2Rendered.push(lessonId);
        return { videoKey: `s3://videos/${lessonId}.mp4` };
      },
    });

    // Les leçons 1 et 2 (déjà checkpointées avant le crash) NE SONT PAS
    // re-rendues (pas de double coût ffmpeg/S3) — la reprise repart pile à la
    // leçon 3, puis enchaîne 4 et 5 normalement.
    expect(attempt2Rendered).toEqual(['lecon-3', 'lecon-4', 'lecon-5']);
    expect(resumedCount).toBe(2); // lecon-1, lecon-2 rejouées depuis le checkpoint
    expect(processedCount).toBe(3); // lecon-3, lecon-4, lecon-5 réellement rendues cette fois

    // Le résultat final couvre les 5 leçons, dans l'ordre, sans trou ni doublon.
    expect(results).toEqual([
      { videoKey: 's3://videos/lecon-1.mp4' },
      { videoKey: 's3://videos/lecon-2.mp4' },
      { videoKey: 's3://videos/lecon-3.mp4' },
      { videoKey: 's3://videos/lecon-4.mp4' },
      { videoKey: 's3://videos/lecon-5.mp4' },
    ]);

    // Chaque leçon n'a été RÉELLEMENT rendue qu'une seule fois au total (sauf
    // lecon-3, qui a échoué sans checkpoint puis a été retraitée une fois).
    const allRuns = [...attempt1Rendered, ...attempt2Rendered];
    expect(allRuns.filter((x) => x === 'lecon-1')).toHaveLength(1);
    expect(allRuns.filter((x) => x === 'lecon-2')).toHaveLength(1);
    expect(allRuns.filter((x) => x === 'lecon-3')).toHaveLength(1);
    expect(allRuns.filter((x) => x === 'lecon-4')).toHaveLength(1);
    expect(allRuns.filter((x) => x === 'lecon-5')).toHaveLength(1);

    // Le checkpoint est purgé après succès complet (repli propre P69).
    expect(await store.load('course-multi-lecon')).toEqual([]);
  });

  it('ne mélange pas les checkpoints de deux jobId distincts', async () => {
    const { store } = createDurableStore<number>();

    await expect(
      withCheckpoint({
        jobId: 'lesson-A',
        steps: [1, 2],
        store,
        runStep: async (n, i) => {
          if (i === 1) throw new Error('crash A');
          return n;
        },
      }),
    ).rejects.toThrow();

    // 'lesson-B' n'a aucun rapport avec le checkpoint de 'lesson-A' : traité intégralement.
    const processedB: number[] = [];
    const resultB = await withCheckpoint({
      jobId: 'lesson-B',
      steps: [1, 2],
      store,
      runStep: async (n) => {
        processedB.push(n);
        return n;
      },
    });

    expect(processedB).toEqual([1, 2]);
    expect(resultB.resumedCount).toBe(0);
  });
});
