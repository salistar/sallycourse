import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { connectDb, recordAudit, User as UserModel } from '@sallycourse/db';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';

/** Payload d'inscription — messages en français pour affichage direct. */
const registerSchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères.'),
  email: z.string().trim().toLowerCase().email('Adresse email invalide.'),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.'),
});

/** Limite anti-abus (P70) : une IP ne peut créer que 5 comptes / 10 minutes. */
const REGISTER_IP_LIMIT = { limit: 5, windowSec: 600 };

/** POST /api/auth/register — crée un compte (plan free) avec mot de passe hashé. */
export async function POST(request: Request) {
  const ip = extractClientIp(request);
  const ipLimit = await rateLimit(`register:ip:${ip}`, REGISTER_IP_LIMIT);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Trop de tentatives d'inscription depuis cette adresse, réessayez plus tard." },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((ipLimit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { name, email, password } = parsed.data;

  await connectDb();

  const exists = await UserModel.exists({ email });
  if (exists) {
    return NextResponse.json({ error: 'Un compte existe déjà avec cet email.' }, { status: 409 });
  }

  const passwordHash = await hash(password, 12);

  try {
    const user = await UserModel.create({ email, name, passwordHash, plan: 'free' });
    void recordAudit({
      action: 'register',
      userId: user._id.toString(),
      targetType: 'user',
      targetId: user._id.toString(),
      ip,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
    return NextResponse.json(
      { id: user._id.toString(), email: user.email, name: user.name, plan: user.plan },
      { status: 201 },
    );
  } catch (err) {
    // Course entre le exists() et le create() : l'index unique tranche.
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: number }).code === 11000) {
      return NextResponse.json({ error: 'Un compte existe déjà avec cet email.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Erreur interne, réessayez plus tard.' }, { status: 500 });
  }
}
