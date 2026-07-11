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

export const schoolBrandingInputSchema = z.object({
  schoolName: z.string().trim().min(1, 'Nom d’école requis.').max(80),
  logoUrl: z.string().trim().url().optional().or(z.literal('')),
  primaryColorHex: hexColorSchema.default(DEFAULT_BRANDING_COLORS.primaryColorHex),
  accentColorHex: hexColorSchema.default(DEFAULT_BRANDING_COLORS.accentColorHex),
});

export type SchoolBrandingInput = z.input<typeof schoolBrandingInputSchema>;
export type SchoolBrandingData = z.output<typeof schoolBrandingInputSchema>;
