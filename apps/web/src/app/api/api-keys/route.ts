import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { z } from 'zod';
import { connectDb, ApiKey } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { generateApiKey } from '@/lib/api-key';

/**
 * /api/api-keys — gestion des clés API de l'utilisateur (UI, session-auth).
 * GET liste les clés SANS secret ; POST en crée une nouvelle et renvoie la clé
 * en clair UNE SEULE FOIS (jamais re-consultable ensuite).
 */

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
});

/** GET — clés de l'utilisateur (préfixe + libellé, jamais le secret). */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const keys = await ApiKey.find({ userId: user.id })
    .select('prefix label lastUsed createdAt')
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({
    keys: keys.map((k) => ({
      id: String(k._id),
      prefix: k.prefix,
      label: k.label,
      lastUsed: k.lastUsed ?? null,
      createdAt: k.createdAt,
    })),
  });
}

/** POST — crée une clé ; renvoie la clé en clair une seule fois. */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { key, hashedKey, prefix } = generateApiKey();

  await connectDb();
  const doc = await ApiKey.create({
    userId: user.id,
    hashedKey,
    prefix,
    label: parsed.data.label,
  });

  // `key` en clair : renvoyé ici et NULLE PART ailleurs.
  return NextResponse.json(
    {
      id: String(doc._id),
      label: doc.label,
      prefix: doc.prefix,
      key,
      createdAt: doc.createdAt,
    },
    { status: 201 },
  );
}
