import { describe, expect, it } from 'vitest';
import { buildPresetDeployJobs } from './deploy-presets';

// Logique pure de construction des jobs à enqueuer depuis un preset (P109).
// Aucun accès DB/queue : uniquement le mapping plateformes → jobs.

describe('buildPresetDeployJobs', () => {
  it('construit un job par plateforme connue, sans credential si accountLabel absent', () => {
    const { jobs, skipped } = buildPresetDeployJobs(
      [
        { platform: 'youtube', mode: 'auto' },
        { platform: 'gumroad', mode: 'auto' },
      ],
      [],
    );

    expect(skipped).toEqual([]);
    expect(jobs).toEqual([
      { platform: 'youtube', mode: 'auto' },
      { platform: 'gumroad', mode: 'auto' },
    ]);
  });

  it('résout accountLabel vers le credentialId de l’utilisateur COURANT', () => {
    const { jobs, skipped } = buildPresetDeployJobs(
      [{ platform: 'udemy', mode: 'assisted', accountLabel: 'Udemy FR' }],
      [
        { id: 'cred-1', platform: 'udemy', accountLabel: 'Udemy FR' },
        { id: 'cred-2', platform: 'udemy', accountLabel: 'Udemy EN' },
      ],
    );

    expect(skipped).toEqual([]);
    expect(jobs).toEqual([
      { platform: 'udemy', mode: 'assisted', credentialId: 'cred-1' },
    ]);
  });

  it("n'assigne aucun credentialId si l'accountLabel du preset n'existe pas chez l'utilisateur courant", () => {
    // Cas clé du partage public : le preset référence un libellé qui n'appartient
    // pas à l'utilisateur qui applique le preset — jamais de fuite vers un
    // credential d'autrui, le worker retombera sur le compte le plus récent.
    const { jobs, skipped } = buildPresetDeployJobs(
      [{ platform: 'udemy', mode: 'auto', accountLabel: 'Compte du créateur' }],
      [{ id: 'cred-9', platform: 'udemy', accountLabel: 'Mon propre compte' }],
    );

    expect(skipped).toEqual([]);
    expect(jobs).toEqual([{ platform: 'udemy', mode: 'auto' }]);
  });

  it('écarte les plateformes sans adapter connu (jamais silencieux)', () => {
    const { jobs, skipped } = buildPresetDeployJobs(
      [
        { platform: 'youtube', mode: 'auto' },
        { platform: 'plateforme-inconnue', mode: 'auto' },
      ],
      [],
    );

    expect(jobs).toEqual([{ platform: 'youtube', mode: 'auto' }]);
    expect(skipped).toEqual([{ platform: 'plateforme-inconnue', reason: 'unknown_platform' }]);
  });

  it('retourne une liste vide si toutes les plateformes sont inconnues', () => {
    const { jobs, skipped } = buildPresetDeployJobs(
      [{ platform: 'inconnue-1', mode: 'auto' }],
      [],
    );

    expect(jobs).toEqual([]);
    expect(skipped).toEqual([{ platform: 'inconnue-1', reason: 'unknown_platform' }]);
  });
});
