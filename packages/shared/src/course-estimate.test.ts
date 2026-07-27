import { describe, expect, it } from 'vitest';
import { estimateCourseVolume, estimateCourseCost } from './course-estimate';

describe('estimateCourseVolume', () => {
  it('dérive le volume depuis approxSections (≈4 leçons/section)', () => {
    const v = estimateCourseVolume({ approxSections: 5 });
    expect(v.sections).toBe(5);
    expect(v.lessons).toBe(20);
    expect(v.videos).toBeGreaterThan(0);
    expect(v.quizzes).toBeGreaterThanOrEqual(5); // ≥ 1 quiz/section
  });

  it('dérive le volume depuis targetHours + avgVideoLength', () => {
    const v = estimateCourseVolume({ targetHours: 6, avgVideoLength: '5-8' });
    // 6h = 360 min de vidéo / 6.5 min ≈ 55 vidéos
    expect(v.videos).toBeGreaterThan(40);
    expect(v.totalVideoMinutes).toBeGreaterThan(300);
    expect(v.ttsChars).toBeGreaterThan(0);
  });

  it('respecte le ratio de types de contenu', () => {
    const v = estimateCourseVolume({ approxSections: 10, contentRatio: { video: 80, article: 10, tp: 5, quiz: 5 } });
    // vidéo dominante
    expect(v.videos).toBeGreaterThan(v.articles);
    expect(v.videos).toBeGreaterThan(v.tps);
  });

  it('la vitesse de narration réduit les caractères TTS', () => {
    const slow = estimateCourseVolume({ approxSections: 5, narrationSpeed: 0.9 });
    const fast = estimateCourseVolume({ approxSections: 5, narrationSpeed: 1.25 });
    expect(fast.ttsChars).toBeLessThan(slow.ttsChars);
  });
});

describe('estimateCourseCost', () => {
  it('LLM gratuit (Gemini) → coût LLM nul, TTS gratuit (edge) → 0', () => {
    const v = estimateCourseVolume({ approxSections: 5 });
    const c = estimateCourseCost(v, { llmModel: 'gemini-flash-latest', ttsProvider: 'edge' });
    expect(c.breakdown.llmUsd).toBe(0);
    expect(c.breakdown.ttsUsd).toBe(0);
    // render + images restent facturés (compute/forfait)
    expect(c.cloudUsd).toBeGreaterThanOrEqual(0);
  });

  it('provider payant → coût cloud > 0 ; fournit toujours un coût OSS', () => {
    const v = estimateCourseVolume({ approxSections: 8 });
    const c = estimateCourseCost(v, { llmModel: 'deepseek-chat', ttsProvider: 'elevenlabs' });
    expect(c.breakdown.llmUsd).toBeGreaterThan(0);
    expect(c.breakdown.ttsUsd).toBeGreaterThan(0);
    expect(c.cloudUsd).toBeGreaterThan(0);
    expect(c.ossUsd).toBeGreaterThan(0);
    expect(c.tokensIn).toBeGreaterThan(0);
  });
});
