'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  useToast,
} from '@/components/ui';
import { AuthDivider } from './auth-divider';
import { GoogleButton } from './google-button';

interface LoginFormProps {
  /** Bouton Google affiché uniquement si l'OAuth est configuré côté serveur. */
  googleEnabled: boolean;
  /** Destination après connexion (déjà validée côté serveur). */
  callbackUrl: string;
}

/** Formulaire de connexion — Credentials Auth.js + Google optionnel. */
export function LoginForm({ googleEnabled, callbackUrl }: LoginFormProps) {
  const t = useTranslations('auth.loginForm');
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError(t('errorInvalidCredentials'));
        toast({
          title: t('toastRefusedTitle'),
          description: t('toastRefusedDescription'),
          variant: 'danger',
        });
        return;
      }
      toast({ title: t('toastWelcomeBackTitle'), variant: 'success' });
      router.push(callbackUrl);
      router.refresh();
    } catch {
      toast({
        title: t('toastUnexpectedTitle'),
        description: t('toastUnexpectedDescription'),
        variant: 'danger',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            label={t('emailLabel')}
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label={t('passwordLabel')}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
          />
          <Button type="submit" className="w-full" loading={loading}>
            {!loading && <LogIn aria-hidden="true" />}
            {t('submit')}
          </Button>
        </form>

        {googleEnabled && (
          <>
            <AuthDivider />
            <GoogleButton callbackUrl={callbackUrl} />
          </>
        )}

        <p className="text-center text-sm text-muted">
          {t('noAccountPrompt')}{' '}
          <Link
            href="/register"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t('createAccount')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
