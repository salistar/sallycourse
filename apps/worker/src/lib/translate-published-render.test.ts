import { describe, expect, it } from 'vitest';
import { buildDubbedAudioArgs, groupCuesIntoPhrases } from './translate-published-render.js';
import type { Cue } from '../media/subtitles.js';

describe('groupCuesIntoPhrases', () => {
  it('regroupe les micro-cues jusqu’à une ponctuation de fin', () => {
    const cues: Cue[] = [
      { start: 0, end: 1, text: 'Imaginez un monde' },
      { start: 1, end: 2, text: 'où vos tests se réparent seuls.' },
      { start: 2, end: 3, text: 'C’est la réalité aujourd’hui.' },
    ];
    const phrases = groupCuesIntoPhrases(cues);
    expect(phrases).toHaveLength(2);
    expect(phrases[0]).toEqual({ text: 'Imaginez un monde où vos tests se réparent seuls.', start: 0, end: 2 });
    expect(phrases[1]).toEqual({ text: 'C’est la réalité aujourd’hui.', start: 2, end: 3 });
  });

  it('coupe à ~14 mots même sans ponctuation, et ignore les cues vides', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ start: i, end: i + 1, text: `mot${i}` }));
    const cues: Cue[] = [{ start: -1, end: 0, text: '   ' }, ...many];
    const phrases = groupCuesIntoPhrases(cues);
    expect(phrases.length).toBeGreaterThanOrEqual(2);
    expect(phrases[0]!.text.split(/\s+/).length).toBe(14);
    // La fenêtre du 1er groupe démarre au 1er cue NON vide.
    expect(phrases[0]!.start).toBe(0);
  });

  it('renvoie [] pour des cues tous vides', () => {
    expect(groupCuesIntoPhrases([{ start: 0, end: 1, text: '' }])).toEqual([]);
  });
});

describe('buildDubbedAudioArgs', () => {
  const clips = [
    { path: '/tmp/p0.mp3', startSec: 0.5, tempo: 1 },
    { path: '/tmp/p1.mp3', startSec: 4, tempo: 1.25 },
  ];

  it('un input par clip + sortie AAC 48 kHz stéréo', () => {
    const args = buildDubbedAudioArgs(clips, 12, '/tmp/out.m4a');
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(args).toContain('/tmp/p0.mp3');
    expect(args.at(-1)).toBe('/tmp/out.m4a');
    expect(args).toContain('48000');
    expect(args).toContain('aac');
  });

  it('bed borné à la durée vidéo, amix N+1 (bed + clips), délais et atempo corrects', () => {
    const fc = buildDubbedAudioArgs(clips, 12.5, '/tmp/out.m4a');
    const graph = fc[fc.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('atrim=0:12.500'); // bed = durée vidéo exacte
    expect(graph).toContain('amix=inputs=3:duration=first:normalize=0'); // 1 bed + 2 clips
    expect(graph).toContain('adelay=500:all=1'); // clip 0 à 0,5 s
    expect(graph).toContain('adelay=4000:all=1'); // clip 1 à 4 s
    expect(graph).toContain('atempo=1.250'); // clip 1 accéléré
    expect(graph).not.toMatch(/\[0:a\][^;]*atempo/); // clip 0 (tempo 1) pas d’atempo
    expect(graph).toContain('alimiter'); // garde-fou anti-clipping
  });
});
