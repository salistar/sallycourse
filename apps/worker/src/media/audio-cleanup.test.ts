import { describe, expect, it } from 'vitest';
import { buildCleanupFilter, planAudioCleanup } from './audio-cleanup.js';
import type { SilenceGap } from './audio-repair.js';

/**
 * Nettoyage DSP de narration (constaté en réel le 2026-07-21, cours due
 * diligence) : micro-rafale parasite de 73 ms entre deux pauses au milieu
 * d'une slide, reproduite à L'IDENTIQUE par chaque resynthèse (sortie TTS
 * déterministe) — seule une passe DSP la neutralise.
 */
describe('planAudioCleanup — micro-rafales et silences intérieurs', () => {
  it('détecte la rafale réelle du 2026-07-21 (73 ms entre pauses de 1,71 s et 0,58 s)', () => {
    const silences: SilenceGap[] = [
      { start: 31.93, end: 33.64 }, // pause 1,71 s
      { start: 33.72, end: 34.3 }, // pause 0,58 s — île de 73 ms entre les deux
    ];
    const plan = planAudioCleanup(silences, 47.5);
    expect(plan.mutes).toHaveLength(1);
    expect(plan.mutes[0]!.start).toBeCloseTo(33.64 - 0.005, 3);
    expect(plan.mutes[0]!.end).toBeCloseTo(33.72 + 0.005, 3);
    // La pause de 1,71 s dépasse le déclencheur de compression (1,2 s).
    expect(plan.needsSilenceCap).toBe(true);
  });

  it("ne touche PAS une reprise de parole normale (l'île dure plus de 400 ms)", () => {
    const silences: SilenceGap[] = [
      { start: 10, end: 11 },
      { start: 11.5, end: 12.2 }, // île de 500 ms = vraie parole
    ];
    const plan = planAudioCleanup(silences, 30);
    expect(plan.mutes).toHaveLength(0);
  });

  it('cas réel mesuré sur le mp3 fautif : 2 rafales (46 ms et 353 ms) dans un bloc de pauses', () => {
    // Structure exacte de audio/2.mp3 (due diligence, 2026-07-21) :
    // silence 0,326 s | île 46 ms | silence 1,083 s | île 353 ms | silence 0,469 s
    const silences: SilenceGap[] = [
      { start: 31.5264, end: 31.8528 },
      { start: 31.8992, end: 32.9827 },
      { start: 33.336, end: 33.8051 },
    ];
    const plan = planAudioCleanup(silences, 47.472);
    expect(plan.mutes).toHaveLength(2);
    expect(plan.needsSilenceCap).toBe(true); // la pause de 1,083 s > 1,0 s
  });

  it('ne classe pas rafale une île bordée d’un silence trop court (plosive après respiration)', () => {
    const silences: SilenceGap[] = [
      { start: 10, end: 10.2 }, // 200 ms < garde de 350 ms
      { start: 10.3, end: 11 },
    ];
    const plan = planAudioCleanup(silences, 30);
    expect(plan.mutes).toHaveLength(0);
  });

  it('ignore les bords du fichier (amorce et chute ne sont jamais des rafales)', () => {
    const silences: SilenceGap[] = [
      { start: 0, end: 0.5 }, // amorce
      { start: 29.4, end: 30 }, // chute finale
    ];
    const plan = planAudioCleanup(silences, 30);
    expect(plan.mutes).toHaveLength(0);
    // Silences collés aux bords : pas de compression déclenchée.
    expect(plan.needsSilenceCap).toBe(false);
  });

  it('déclenche la compression pour un silence intérieur > 1,2 s sans rafale', () => {
    const silences: SilenceGap[] = [{ start: 12, end: 13.6 }];
    const plan = planAudioCleanup(silences, 40);
    expect(plan.mutes).toHaveLength(0);
    expect(plan.needsSilenceCap).toBe(true);
  });

  it('reste inerte sur un audio propre (pauses naturelles courtes)', () => {
    const silences: SilenceGap[] = [
      { start: 5, end: 5.6 },
      { start: 12, end: 12.9 },
    ];
    const plan = planAudioCleanup(silences, 40);
    expect(plan.mutes).toHaveLength(0);
    expect(plan.needsSilenceCap).toBe(false);
  });
});

describe('buildCleanupFilter', () => {
  it('retourne null quand il n’y a rien à faire (aucun ré-encodage inutile)', () => {
    expect(buildCleanupFilter({ mutes: [], needsSilenceCap: false })).toBeNull();
  });

  it('mute la rafale PUIS compresse (ordre : timeline d’origine avant raccourcissement)', () => {
    const f = buildCleanupFilter({ mutes: [{ start: 33.635, end: 33.725 }], needsSilenceCap: true });
    expect(f).toContain("volume=enable='between(t,33.635,33.725)':volume=0");
    expect(f).toContain('silenceremove=');
    expect(f!.indexOf('volume=')).toBeLessThan(f!.indexOf('silenceremove='));
  });

  it('compresse même sans rafale quand un silence intérieur est trop long', () => {
    const f = buildCleanupFilter({ mutes: [], needsSilenceCap: true });
    expect(f).toBe('silenceremove=stop_periods=-1:stop_duration=0.9:stop_threshold=-40dB');
  });
});
