import { describe, expect, it } from 'vitest';
import { hexColorSchema, schoolBrandingInputSchema, subdomainSchema } from './school-branding';

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

  it('accepte customSubdomain valide (P143)', () => {
    const parsed = schoolBrandingInputSchema.safeParse({
      schoolName: 'École Atlas',
      customSubdomain: 'academie-client',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.customSubdomain).toBe('academie-client');
  });

  it('accepte customSubdomain omis ou vide (retrait)', () => {
    expect(schoolBrandingInputSchema.safeParse({ schoolName: 'École Atlas' }).success).toBe(true);
    expect(
      schoolBrandingInputSchema.safeParse({ schoolName: 'École Atlas', customSubdomain: '' }).success,
    ).toBe(true);
  });
});

describe('subdomainSchema (P143)', () => {
  it('accepte un sous-domaine valide et le met en minuscules', () => {
    const parsed = subdomainSchema.safeParse('Academie-Client');
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe('academie-client');
  });

  it('rejette trop court, tiret en tête/fin, caractères invalides', () => {
    expect(subdomainSchema.safeParse('ab').success).toBe(false);
    expect(subdomainSchema.safeParse('-abc').success).toBe(false);
    expect(subdomainSchema.safeParse('abc-').success).toBe(false);
    expect(subdomainSchema.safeParse('abc_def').success).toBe(false);
    expect(subdomainSchema.safeParse('abc.def').success).toBe(false);
  });

  it('rejette les sous-domaines réservés', () => {
    expect(subdomainSchema.safeParse('www').success).toBe(false);
    expect(subdomainSchema.safeParse('api').success).toBe(false);
    expect(subdomainSchema.safeParse('admin').success).toBe(false);
  });
});
