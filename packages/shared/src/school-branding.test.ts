import { describe, expect, it } from 'vitest';
import { hexColorSchema, schoolBrandingInputSchema } from './school-branding';

// Validation zod du branding (Prompt 88) : couleurs hex + défauts.

describe('hexColorSchema', () => {
  it('accepte #RRGGBB et #RGB', () => {
    expect(hexColorSchema.safeParse('#8E55BE').success).toBe(true);
    expect(hexColorSchema.safeParse('#fff').success).toBe(true);
  });

  it('rejette une couleur invalide', () => {
    expect(hexColorSchema.safeParse('violet').success).toBe(false);
    expect(hexColorSchema.safeParse('8E55BE').success).toBe(false);
    expect(hexColorSchema.safeParse('#12345').success).toBe(false);
  });
});

describe('schoolBrandingInputSchema', () => {
  it('applique les couleurs de marque par défaut si omises', () => {
    const parsed = schoolBrandingInputSchema.parse({ schoolName: 'École Atlas' });
    expect(parsed.primaryColorHex).toBe('#8E55BE');
    expect(parsed.accentColorHex).toBe('#D4A017');
  });

  it('rejette un nom d’école vide', () => {
    expect(schoolBrandingInputSchema.safeParse({ schoolName: '' }).success).toBe(false);
  });

  it('rejette une couleur invalide fournie explicitement', () => {
    const result = schoolBrandingInputSchema.safeParse({
      schoolName: 'École Atlas',
      primaryColorHex: 'not-a-color',
    });
    expect(result.success).toBe(false);
  });
});
