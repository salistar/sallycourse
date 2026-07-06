import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth';

export const metadata: Metadata = {
  title: 'Connexion — SallyCourse',
  description: 'Connectez-vous pour piloter la génération de vos cours.',
};

/** Seuls les chemins internes sont acceptés comme destination post-login. */
function sanitizeCallbackUrl(raw: string | undefined): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/dashboard';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  return (
    <LoginForm
      googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)}
      callbackUrl={sanitizeCallbackUrl(params.callbackUrl)}
    />
  );
}
