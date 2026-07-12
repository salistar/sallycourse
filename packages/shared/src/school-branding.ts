import { z } from 'zod';

// Marque blanche du certificat (Prompt 88, plan Business) — schéma zod
// partagé pour valider le formulaire settings/branding ET la route API.
// Couleurs strictement hex (#RGB ou #RRGGBB) : garde-fou en amont du modèle
// Mongoose (packages/db/src/models/school-branding.ts) qui revalide de toute
// façon (défense en profondeur, cohérent avec le reste du monorepo).

/** Couleur hexadécimale (#RGB ou #RRGGBB), insensible à la casse. */
export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Couleur hexadécimale invalide (attendu #RRGGBB ou #RGB).');

/** Couleurs de marque par défaut (identiques au gabarit certificate.html). */
export const DEFAULT_BRANDING_COLORS = {
  primaryColorHex: '#8E55BE', // violet-500
  accentColorHex: '#D4A017', // gold-500
} as const;

/**
 * Sous-domaine white-label (Prompt 143, plan Business) — ex. "academie-client"
 * pour https://academie-client.sallycourse.com. Règles DNS-safe : minuscules,
 * chiffres, tirets (jamais en tête/fin), 3 à 40 caractères. Liste de réserve
 * pour ne jamais capturer une route système existante (app, www, api, admin…).
 */
export const RESERVED_SUBDOMAINS = [
  'www',
  'app',
  'api',
  'admin',
  'learn',
  'dashboard',
  'mail',
  'ftp',
  'assets',
  'static',
  'cdn',
  'blog',
  'docs',
  'status',
  'support',
] as const;

export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Le sous-domaine doit contenir au moins 3 caractères.')
  .max(40, 'Le sous-domaine doit contenir au plus 40 caractères.')
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'Sous-domaine invalide (minuscules, chiffres et tirets, sans tiret en début/fin).',
  )
  .refine((v) => !(RESERVED_SUBDOMAINS as readonly string[]).includes(v), {
    message: 'Ce sous-domaine est réservé.',
  });

export const schoolBrandingInputSchema = z.object({
  schoolName: z.string().trim().min(1, 'Nom d’école requis.').max(80),
  logoUrl: z.string().trim().url().optional().or(z.literal('')),
  primaryColorHex: hexColorSchema.default(DEFAULT_BRANDING_COLORS.primaryColorHex),
  accentColorHex: hexColorSchema.default(DEFAULT_BRANDING_COLORS.accentColorHex),
  // Additif (P143) : optionnel, chaîne vide acceptée = "retirer le sous-domaine".
  customSubdomain: subdomainSchema.optional().or(z.literal('')),
});

export type SchoolBrandingInput = z.input<typeof schoolBrandingInputSchema>;
export type SchoolBrandingData = z.output<typeof schoolBrandingInputSchema>;
