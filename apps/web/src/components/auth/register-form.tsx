'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { UserPlus } from 'lucide-react';
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
import { AltchaWidget } from './altcha-widget';
import type { AltchaSolvedPayload } from '@/lib/altcha-client';

interface RegisterFormProps {
  googleEnabled: boolean;
}

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

/** Formulaire d'inscription — POST /api/auth/register puis connexion auto. */
export function RegisterForm({ googleEnabled }: RegisterFormProps) {
  const t = useTranslations('auth.registerForm');
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [loading, setLoading] = React.useState(false);
  const [altcha, setAltcha] = React.useState<AltchaSolvedPayload | null>(null);

  /** Validation locale rapide avant l'appel réseau. */
  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (name.trim().length < 2) next.name = t('errorNameTooShort');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = t('errorEmailInvalid');
    if (password.length < 8) next.password = t('errorPasswordTooShort');
    if (confirm !== password) next.confirm = t('errorPasswordMismatch');
    return next;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    if (!altcha) {
      toast({
        title: t('toastCaptchaTitle'),
        description: t('toastCaptchaDescription'),
        variant: 'warning',
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, altcha }),
      });

      if (response.status === 409) {
        setErrors({ email: t('errorEmailTaken') });
        toast({
          title: t('toastEmailTakenTitle'),
          description: t('toastEmailTakenDescription'),
          variant: 'warning',
        });
        return;
      }
      if (!response.ok) {
        toast({
          title: t('toastRegisterFailedTitle'),
          description: t('toastRegisterFailedDescription'),
          variant: 'danger',
        });
        return;
      }

      // Compte créé : connexion automatique puis entrée dans le dashboard.
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        toast({
          title: t('toastAccountCreatedTitle'),
          description: t('toastAccountCreatedDescription'),
          variant: 'success',
        });
        router.push('/login');
        return;
      }
      toast({ title: t('toastWelcome'), variant: 'success' });
      router.push('/dashboard');
      router.refresh();
    } catch {
      toast({
        title: t('toastUnexpectedErrorTitle'),
        description: t('toastUnexpectedErrorDescription'),
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
            label={t('labelName')}
            name="name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />
          <Input
            label={t('labelEmail')}
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <Input
            label={t('labelPassword')}
            type="password"
            name="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint={t('hintPassword')}
          />
          <Input
            label={t('labelConfirmPassword')}
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={errors.confirm}
          />
          <AltchaWidget onSolved={setAltcha} />
          <Button type="submit" className="w-full" loading={loading} disabled={!altcha}>
            {!loading && <UserPlus aria-hidden="true" />}
            {t('submit')}
          </Button>
        </form>

        {googleEnabled && (
          <>
            <AuthDivider />
            <GoogleButton callbackUrl="/dashboard" label={t('googleLabel')} />
          </>
        )}

        <p className="text-center text-sm text-muted">
          {t('alreadyRegistered')}{' '}
          <Link
            href="/login"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t('loginLink')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
