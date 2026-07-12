import { NextResponse } from 'next/server';
import { createAltchaChallenge } from '@/lib/altcha';

/**
 * GET /api/altcha — émet un challenge ALTCHA (P159) pour le formulaire
 * d'inscription. Pas d'auth requise (appelé avant la création de compte),
 * pas de garde CSRF nécessaire (GET, aucune mutation).
 */
export async function GET() {
  const challenge = createAltchaChallenge();
  return NextResponse.json(challenge);
}
