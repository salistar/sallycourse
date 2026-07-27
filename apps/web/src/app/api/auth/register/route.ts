import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { connectDb, recordAudit, User as UserModel } from '@sallycourse/db';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { verifyAltchaSolution } from '@/lib/altcha';

/** Payload d'inscription — messages en français pour affichage direct. */
const registerSchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères.'),
  email: z.string().trim().toLowerCase().email('Adresse email invalide.'),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.'),
  // Preuve de travail ALTCHA (P159) — anti-bot self-hosted, voir lib/altcha.ts.
  altcha: z.object({
    algorithm: z.string().optional(),
    challenge: z.string(),
    salt: z.string(),
    number: z.number(),
    signature: z.string(),
  }),
});

/** Limite anti-abus (P70) : une IP ne peut créer que 5 comptes / 10 minutes. */
const REGISTER_IP_LIMIT = { limit: 5, windowSec: 600 };

/** POST /api/auth/register — crée un compte (plan free) avec mot de passe hashé. */
export async function POST(request: Request) {
  const ip = extractClientIp(request);
  const ipLimit = await rateLimit(`register:ip:${ip}`, REGISTER_IP_LIMIT);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Trop de tentatives d'inscription depuis cette adresse, réessayez plus tard.", code: 'tooManySignupAttempts' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((ipLimit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { name, email, password, altcha } = parsed.data;

  const altchaResult = verifyAltchaSolution(altcha);
  if (!altchaResult.valid) {
    return NextResponse.json(
      { error: altchaResult.reason ?? 'Vérification anti-robot invalide.' },
      { status: 400 },
    );
  }

  await connectDb();

  const exists = await UserModel.exists({ email });
  if (exists) {
    return apiError('emailAlreadyExists');
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
      return apiError('emailAlreadyExists');
    }
    return apiError('internalError');
  }
}
