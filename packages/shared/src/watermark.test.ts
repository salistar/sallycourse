// Tests purs (P206) : échappement drawtext, expressions d'ancrage, rotation
// temporelle du filigrane et arguments ffmpeg. Aucune I/O.
import { describe, expect, it } from 'vitest';
import {
  WATERMARK_DEFAULTS,
  anchorExpression,
  buildWatermarkDrawtextFilter,
  buildWatermarkFfmpegArgs,
  escapeDrawtext,
} from './watermark';

describe('escapeDrawtext', () => {
  it("échappe les caractères significatifs de drawtext (: \\ ' %)", () => {
    expect(escapeDrawtext('a:b')).toBe('a\\:b');
    expect(escapeDrawtext('a\\b')).toBe('a\\\\b');
    expect(escapeDrawtext("a'b")).toBe("a\\'b");
    expect(escapeDrawtext('100%')).toBe('100\\%');
  });

  it('remplace les retours à la ligne par une espace et trim', () => {
    expect(escapeDrawtext('  a\nb\r\nc  ')).toBe('a b c');
  });

  it('laisse un email standard lisible (@ et . non échappés)', () => {
    expect(escapeDrawtext('jane.doe@example.com')).toBe('jane.doe@example.com');
  });
});

describe('anchorExpression', () => {
  it('positionne chaque ancrage avec la marge', () => {
    expect(anchorExpression('top-left', 40)).toEqual({ x: '40', y: '40' });
    expect(anchorExpression('top-right', 40)).toEqual({ x: 'w-text_w-40', y: '40' });
    expect(anchorExpression('bottom-left', 40)).toEqual({ x: '40', y: 'h-text_h-40' });
    expect(anchorExpression('bottom-right', 40)).toEqual({ x: 'w-text_w-40', y: 'h-text_h-40' });
  });

  it('arrondit et borne la marge à 0', () => {
    expect(anchorExpression('top-left', -5)).toEqual({ x: '0', y: '0' });
    expect(anchorExpression('top-left', 12.7)).toEqual({ x: '13', y: '13' });
  });
});

describe('buildWatermarkDrawtextFilter', () => {
  it('émet un drawtext par ancrage (rotation) avec enable temporel', () => {
    const filter = buildWatermarkDrawtextFilter('jane@example.com');
    const count = filter.split('drawtext=').length - 1;
    expect(count).toBe(WATERMARK_DEFAULTS.anchors.length);
    // Chaque ancrage est gaté sur sa tranche de rotation.
    expect(filter).toContain("enable='eq(mod(floor(t/20)\\,4)\\,0)'");
    expect(filter).toContain("enable='eq(mod(floor(t/20)\\,4)\\,3)'");
  });

  it("intègre l'email échappé et l'opacité faible", () => {
    const filter = buildWatermarkDrawtextFilter('a:b@x.com', { opacity: 0.2 });
    expect(filter).toContain("text='a\\:b@x.com'");
    expect(filter).toContain('fontcolor=white@0.200');
  });

  it('ajoute fontfile quand une police est fournie, sinon fontconfig', () => {
    expect(buildWatermarkDrawtextFilter('a@x.com', { fontFile: '/f/Liberation.ttf' })).toContain(
      "fontfile='/f/Liberation.ttf'",
    );
    expect(buildWatermarkDrawtextFilter('a@x.com')).not.toContain('fontfile=');
  });

  it("borne l'opacité (jamais > 1 ni ~0)", () => {
    expect(buildWatermarkDrawtextFilter('a@x.com', { opacity: 5 })).toContain('fontcolor=white@1.000');
    expect(buildWatermarkDrawtextFilter('a@x.com', { opacity: 0 })).toContain('fontcolor=white@0.020');
  });

  it("sans rotation (un seul ancrage) n'émet pas de clause enable", () => {
    const filter = buildWatermarkDrawtextFilter('a@x.com', { anchors: ['top-left'] });
    expect(filter).not.toContain('enable=');
    expect(filter.split('drawtext=').length - 1).toBe(1);
  });
});

describe('buildWatermarkFfmpegArgs', () => {
  it('construit un re-encode H.264 avec audio copié et faststart', () => {
    const args = buildWatermarkFfmpegArgs('in.mp4', 'out.mp4', 'drawtext=text=x', { crf: 20 });
    expect(args[0]).toBe('-y');
    expect(args).toContain('in.mp4');
    expect(args).toContain('out.mp4');
    expect(args[args.indexOf('-vf') + 1]).toBe('drawtext=text=x,format=yuv420p');
    expect(args[args.indexOf('-crf') + 1]).toBe('20');
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    expect(args).toContain('+faststart');
  });
});
