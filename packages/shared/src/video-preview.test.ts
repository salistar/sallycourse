import { describe, expect, it } from 'vitest';
import {
  isEligibleForFinal,
  nextVideoQualityStatus,
  presetForMode,
  selectLessonsForMode,
  ttsVoiceForMode,
} from './video-preview';

describe('video-preview — sélection du preset selon le mode', () => {
  it("'quick-preview' → preset ffmpeg 'draft'", () => {
    expect(presetForMode('quick-preview')).toBe('draft');
  });

  it("'final' → preset ffmpeg 'final'", () => {
    expect(presetForMode('final')).toBe('final');
  });
});

describe('video-preview — voix TTS selon le mode', () => {
  it('quick-preview force la voix standard (undefined) même si le cours a une voix clonée', () => {
    expect(ttsVoiceForMode('quick-preview', 'cloned-voice-id')).toBeUndefined();
  });

  it('quick-preview reste undefined si le cours n\'a pas de voix configurée', () => {
    expect(ttsVoiceForMode('quick-preview', undefined)).toBeUndefined();
  });

  it('final conserve la voix du cours telle quelle (clonée ou non)', () => {
    expect(ttsVoiceForMode('final', 'cloned-voice-id')).toBe('cloned-voice-id');
    expect(ttsVoiceForMode('final', undefined)).toBeUndefined();
  });
});

describe('video-preview — transitions de statut (approbation draft→final)', () => {
  it('draft-rendered amène toujours à draft-ready, quel que soit le statut de départ', () => {
    expect(nextVideoQualityStatus('none', 'draft-rendered')).toBe('draft-ready');
    expect(nextVideoQualityStatus('approved', 'draft-rendered')).toBe('draft-ready');
  });

  it('approved ne fonctionne que depuis draft-ready', () => {
    expect(nextVideoQualityStatus('draft-ready', 'approved')).toBe('approved');
  });

  it('approved est un no-op depuis un autre statut (none, approved, final-ready)', () => {
    expect(nextVideoQualityStatus('none', 'approved')).toBe('none');
    expect(nextVideoQualityStatus('approved', 'approved')).toBe('approved');
    expect(nextVideoQualityStatus('final-ready', 'approved')).toBe('final-ready');
  });

  it('final-rendered amène toujours à final-ready', () => {
    expect(nextVideoQualityStatus('approved', 'final-rendered')).toBe('final-ready');
    expect(nextVideoQualityStatus('none', 'final-rendered')).toBe('final-ready');
  });

  it('reset ramène toujours à none', () => {
    expect(nextVideoQualityStatus('final-ready', 'reset')).toBe('none');
  });

  it('un évènement inconnu ne modifie jamais le statut (garde-fou)', () => {
    // @ts-expect-error — évènement volontairement invalide pour le test du garde-fou
    expect(nextVideoQualityStatus('approved', 'unknown-event')).toBe('approved');
  });
});

describe('video-preview — éligibilité à la version finale', () => {
  it('approved et final-ready sont éligibles', () => {
    expect(isEligibleForFinal('approved')).toBe(true);
    expect(isEligibleForFinal('final-ready')).toBe(true);
  });

  it('none et draft-ready ne sont PAS éligibles', () => {
    expect(isEligibleForFinal('none')).toBe(false);
    expect(isEligibleForFinal('draft-ready')).toBe(false);
  });
});

describe('video-preview — sélection des leçons selon le mode', () => {
  const lessons = [
    { lessonId: 'l1', videoQualityStatus: 'none' as const },
    { lessonId: 'l2', videoQualityStatus: 'draft-ready' as const },
    { lessonId: 'l3', videoQualityStatus: 'approved' as const },
    { lessonId: 'l4', videoQualityStatus: 'final-ready' as const },
  ];

  it("mode 'quick-preview' sélectionne TOUTES les leçons, quel que soit leur statut", () => {
    expect(selectLessonsForMode(lessons, 'quick-preview')).toEqual(['l1', 'l2', 'l3', 'l4']);
  });

  it("mode 'final' ne sélectionne QUE les leçons approuvées ou déjà livrées en HD", () => {
    expect(selectLessonsForMode(lessons, 'final')).toEqual(['l3', 'l4']);
  });

  it("mode 'final' renvoie un tableau vide si aucune leçon n'est approuvée", () => {
    const none = [{ lessonId: 'l1', videoQualityStatus: 'draft-ready' as const }];
    expect(selectLessonsForMode(none, 'final')).toEqual([]);
  });

  it('videoQualityStatus absent est traité comme "none" (jamais éligible en mode final)', () => {
    const missing = [{ lessonId: 'l1' }];
    expect(selectLessonsForMode(missing, 'quick-preview')).toEqual(['l1']);
    expect(selectLessonsForMode(missing, 'final')).toEqual([]);
  });
});
