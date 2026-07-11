import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDb, DemoCourse } from '@sallycourse/db';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { computeDemoExpiresAt, generateDemoCourse } from '@/lib/demo-generate';

/**
 * POST /api/demo/generate (Prompt 96) — programme de démo public. Depuis un
 * titre saisi sur la landing, génère un MINI cours (1 section, 2-3 leçons)
 * TOUJOURS en mode mock déterministe : aucune clé API n'est lue ni utilisée
 * ici, quels que soient ANTHROPIC_API_KEY/MOCK_PROVIDERS en config — la démo
 * publique ne doit jamais déclencher un appel payant pour un visiteur anonyme.
 * Fortement rate-limitée (anti-abus, P70) : 3 requêtes / heure / IP.
 * Stockage temporaire (DemoCourse, TTL 24h via index Mongo natif) — la page
 * publique /demo/[id] affiche l'aperçu avec CTA d'inscription.
 */

const bodySchema = z.object({
  title: z.string().trim().min(4, 'Le titre doit contenir au moins 4 caractères.').max(200),
});

/** Limite anti-abus démo publique : 3 générations / heure / IP (P70). */
const DEMO_IP_LIMIT = { limit: 3, windowSec: 3600 };

export async function POST(request: Request) {
  const ip = extractClientIp(request);
  const ipLimit = await rateLimit(`demo:ip:${ip}`, DEMO_IP_LIMIT);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'Trop de démos générées depuis cette adresse, réessayez plus tard.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((ipLimit.resetAt.getTime() - Date.now()) / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Génération TOUJOURS mock — aucune branche vers un provider payant ici.
  const preview = generateDemoCourse(parsed.data.title);

  await connectDb();

  const demo = await DemoCourse.create({
    title: preview.title,
    requesterIp: ip,
    section: preview.section,
    mock: true,
    expiresAt: computeDemoExpiresAt(),
  });

  return NextResponse.json(
    { id: demo._id.toString(), title: demo.title, expiresAt: demo.expiresAt.toISOString() },
    { status: 201 },
  );
}
