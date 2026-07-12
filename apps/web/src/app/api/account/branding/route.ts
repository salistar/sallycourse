import { NextResponse } from 'next/server';
import { presignedGetUrl, storageKeys, uploadObject } from '@sallycourse/shared';
import { schoolBrandingInputSchema } from '@sallycourse/shared';
import { connectDb, SchoolBranding } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

// /api/account/branding — marque blanche du certificat (Prompt 88, plan Business).
//  - GET    : branding courant (logoUrl = URL présignée de lecture, pas la clé
//             stockée) + `locked` si l'utilisateur n'est pas plan business ;
//  - PUT    : met à jour schoolName/couleurs (JSON, zod) ;
//  - POST   : upload multipart du logo (remplace le fichier existant) ;
//  - DELETE : supprime le branding (retombe sur SALISTAR par défaut).
//
// Réservé au plan business : les autres plans reçoivent 403 sur les mutations
// (mais peuvent voir un GET vide/locked pour afficher un mur d'upsell côté UI).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LOGO_MB = 5;
const ACCEPTED_LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** Résout l'URL de lecture présignée du logo à partir de la clé stockée (undefined si absent). */
async function resolveLogoUrl(key: string | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    return await presignedGetUrl(key, 3600);
  } catch {
    return null;
  }
}

/** GET — branding courant de l'utilisateur (logoUrl = URL de lecture présignée). */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const doc = await SchoolBranding.findOne({ userId: user.id }).lean();

  return NextResponse.json({
    locked: user.plan !== 'business',
    branding: doc
      ? {
          schoolName: doc.schoolName,
          logoUrl: await resolveLogoUrl(doc.logoUrl),
          primaryColorHex: doc.primaryColorHex,
          accentColorHex: doc.accentColorHex,
          customSubdomain: doc.customSubdomain ?? null,
        }
      : null,
  });
}

/** PUT — met à jour nom + couleurs (JSON). Ne touche pas le logo. */
export async function PUT(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  if (user.plan !== 'business') {
    return NextResponse.json(
      { error: 'La marque blanche du certificat est réservée au plan Business.' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = schoolBrandingInputSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(' ; ');
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await connectDb();

  // customSubdomain : chaîne vide = retirer le sous-domaine (unset, sinon
  // l'index unique+sparse verrait plusieurs documents "" en conflit).
  const wantsSubdomain = parsed.data.customSubdomain && parsed.data.customSubdomain.length > 0;
  if (wantsSubdomain) {
    const conflict = await SchoolBranding.findOne({
      customSubdomain: parsed.data.customSubdomain,
      userId: { $ne: user.id },
    }).lean();
    if (conflict) {
      return NextResponse.json({ error: 'Ce sous-domaine est déjà utilisé.' }, { status: 409 });
    }
  }

  const setFields: Record<string, string> = {
    schoolName: parsed.data.schoolName,
    primaryColorHex: parsed.data.primaryColorHex,
    accentColorHex: parsed.data.accentColorHex,
  };
  if (wantsSubdomain && parsed.data.customSubdomain) {
    setFields.customSubdomain = parsed.data.customSubdomain;
  }

  const doc = await SchoolBranding.findOneAndUpdate(
    { userId: user.id },
    {
      $set: setFields,
      ...(wantsSubdomain ? {} : { $unset: { customSubdomain: '' as const } }),
    },
    { upsert: true, new: true, runValidators: true },
  );

  return NextResponse.json({
    ok: true,
    branding: {
      schoolName: doc.schoolName,
      logoUrl: await resolveLogoUrl(doc.logoUrl),
      primaryColorHex: doc.primaryColorHex,
      accentColorHex: doc.accentColorHex,
      customSubdomain: doc.customSubdomain ?? null,
    },
  });
}

/** POST — upload multipart du logo (remplace l'existant). */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  if (user.plan !== 'business') {
    return NextResponse.json(
      { error: 'La marque blanche du certificat est réservée au plan Business.' },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Requête multipart invalide.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Logo manquant (champ « file »).' }, { status: 400 });
  }
  const ext = ACCEPTED_LOGO_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: 'Format non supporté (PNG, JPEG, WebP ou SVG attendu).' },
      { status: 415 },
    );
  }
  if (file.size > MAX_LOGO_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Logo trop lourd (max ${MAX_LOGO_MB} Mo).` }, { status: 413 });
  }

  await connectDb();
  const key = storageKeys.schoolBrandingLogo(user.id, ext);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await uploadObject(key, buffer, file.type);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Échec du téléversement : ${message}` }, { status: 502 });
  }

  const doc = await SchoolBranding.findOneAndUpdate(
    { userId: user.id },
    { $set: { logoUrl: key }, $setOnInsert: { schoolName: user.name ?? 'Mon école' } },
    { upsert: true, new: true, runValidators: true },
  );

  return NextResponse.json({
    ok: true,
    branding: {
      schoolName: doc.schoolName,
      logoUrl: await resolveLogoUrl(doc.logoUrl),
      primaryColorHex: doc.primaryColorHex,
      accentColorHex: doc.accentColorHex,
      customSubdomain: doc.customSubdomain ?? null,
    },
  });
}

/** DELETE — supprime le branding (retombe sur SALISTAR par défaut). */
export async function DELETE() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  await SchoolBranding.deleteOne({ userId: user.id });

  return NextResponse.json({ ok: true });
}
