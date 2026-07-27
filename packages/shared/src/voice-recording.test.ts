import { describe, expect, it } from 'vitest';
import {
  MIN_VOICE_SAMPLE_SECONDS,
  canSubmitRecording,
  formatRecordingTime,
  remainingSecondsBeforeSubmit,
} from './voice-recording';

describe('formatRecordingTime', () => {
  it('formate les secondes en m:ss avec zéro-padding', () => {
    expect(formatRecordingTime(0)).toBe('0:00');
    expect(formatRecordingTime(5)).toBe('0:05');
    expect(formatRecordingTime(59)).toBe('0:59');
    expect(formatRecordingTime(60)).toBe('1:00');
    expect(formatRecordingTime(75)).toBe('1:15');
    expect(formatRecordingTime(600)).toBe('10:00');
  });

  it('tronque les fractions de seconde', () => {
    expect(formatRecordingTime(61.9)).toBe('1:01');
  });

  it('ramène les valeurs invalides ou négatives à 0:00', () => {
    expect(formatRecordingTime(-3)).toBe('0:00');
    expect(formatRecordingTime(Number.NaN)).toBe('0:00');
    expect(formatRecordingTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('canSubmitRecording', () => {
  it('refuse en dessous du minimum', () => {
    expect(canSubmitRecording(0)).toBe(false);
    expect(canSubmitRecording(59)).toBe(false);
    expect(canSubmitRecording(59.9)).toBe(false);
  });

  it('accepte au minimum et au-dessus', () => {
    expect(canSubmitRecording(60)).toBe(true);
    expect(canSubmitRecording(120)).toBe(true);
  });

  it('respecte un minimum personnalisé', () => {
    expect(canSubmitRecording(30, 30)).toBe(true);
    expect(canSubmitRecording(29, 30)).toBe(false);
  });

  it('refuse les valeurs non finies', () => {
    expect(canSubmitRecording(Number.NaN)).toBe(false);
    expect(canSubmitRecording(Number.POSITIVE_INFINITY)).toBe(false); // non fini → rejeté
  });

  it('utilise le minimum par défaut de 60 s', () => {
    expect(MIN_VOICE_SAMPLE_SECONDS).toBe(60);
    expect(canSubmitRecording(MIN_VOICE_SAMPLE_SECONDS)).toBe(true);
  });
});

describe('remainingSecondsBeforeSubmit', () => {
  it('décompte jusqu’au minimum', () => {
    expect(remainingSecondsBeforeSubmit(0)).toBe(60);
    expect(remainingSecondsBeforeSubmit(45)).toBe(15);
    expect(remainingSecondsBeforeSubmit(59.2)).toBe(1);
  });

  it('renvoie 0 une fois le minimum atteint ou dépassé', () => {
    expect(remainingSecondsBeforeSubmit(60)).toBe(0);
    expect(remainingSecondsBeforeSubmit(90)).toBe(0);
  });

  it('traite les valeurs invalides comme 0 écoulé', () => {
    expect(remainingSecondsBeforeSubmit(Number.NaN)).toBe(60);
    expect(remainingSecondsBeforeSubmit(-10)).toBe(60);
  });
});
