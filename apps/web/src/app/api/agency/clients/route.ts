import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { z } from 'zod';
import { connectDb, AgencyClient, PlatformCredential, User } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * Vérifie que l'utilisateur connecté est bien un profil agence (User.isAgency).
 * Requête directe en base : le champ n'est pas porté par la session next-auth
 * (évite de toucher le type Session partagé, potentiellement modifié par
 * d'autres travaux en parallèle).
 */
async function requireAgencyUser(userId: string): Promise<boolean> {
  const doc = await User.findById(userId).select('isAgency').lean();
  return doc?.isAgency === true;
}

/**
 * /api/agency/clients — mode agence (Prompt 150).
 * GET  : liste des clients de l'agence connectée.
 * POST : crée un client d'agence — { clientName, clientEmail, platformCredentials?:[id] }.
 * Réservé aux comptes User.isAgency=true (403 sinon, jamais un utilisateur
 * standard ne peut créer un client d'agence).
 */

// Données par utilisateur : rendu à la requête.
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  clientName: z.string().trim().min(1).max(120),
  clientEmail: z.string().trim().email(),
  platformCredentials: z.array(z.string().trim().min(1)).max(50).optional().default([]),
});

/** Forme exposée au client (aucun secret — juste des ids de credential). */
function toPublicClient(doc: {
  _id: unknown;
  clientName: string;
  clientEmail: string;
  platformCredentials: unknown[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(doc._id),
    clientName: doc.clientName,
    clientEmail: doc.clientEmail,
    platformCredentials: doc.platformCredentials.map(String),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** GET — clients de l'agence connectée. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  if (!(await requireAgencyUser(user.id))) {
    return apiError('agencyOnly');
  }

  const clients = await AgencyClient.find({ agencyUserId: user.id })
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({ clients: clients.map(toPublicClient) });
}

/** POST — crée un client d'agence. */
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

  await connectDb();

  if (!(await requireAgencyUser(user.id))) {
    return apiError('agencyOnly');
  }

  // Les credentials déclarés doivent exister ET appartenir à l'agence : un
  // PlatformCredential est toujours possédé par le userId qui l'a créé (ici
  // l'agence gère les comptes de ses clients sous SON userId). Filtrer par
  // userId ferme une faille cross-tenant (référencer l'ObjectId d'un credential
  // d'un autre compte pour publier via son compte plateforme connecté).
  if (parsed.data.platformCredentials.length > 0) {
    const found = await PlatformCredential.find({
      _id: { $in: parsed.data.platformCredentials },
      userId: user.id,
    })
      .select('_id')
      .lean();
    if (found.length !== parsed.data.platformCredentials.length) {
      return NextResponse.json(
        { error: 'Un ou plusieurs comptes plateforme référencés sont introuvables.', code: 'platformAccountsNotFound' },
        { status: 404 },
      );
    }
  }

  const doc = await AgencyClient.create({
    agencyUserId: user.id,
    clientName: parsed.data.clientName,
    clientEmail: parsed.data.clientEmail,
    platformCredentials: parsed.data.platformCredentials,
  });

  return NextResponse.json({ client: toPublicClient(doc) }, { status: 201 });
}
