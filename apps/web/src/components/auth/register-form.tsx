'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
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
    if (name.trim().length < 2) next.name = 'Le nom doit contenir au moins 2 caractères.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Adresse email invalide.';
    if (password.length < 8) next.password = 'Au moins 8 caractères.';
    if (confirm !== password) next.confirm = 'Les mots de passe ne correspondent pas.';
    return next;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fieldErrors = validate();
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    if (!altcha) {
      toast({
        title: 'Vérification anti-robot en cours',
        description: 'Patientez quelques instants puis réessayez.',
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
        setErrors({ email: 'Un compte existe déjà avec cet email.' });
        toast({
          title: 'Email déjà utilisé',
          description: 'Connectez-vous ou utilisez une autre adresse.',
          variant: 'warning',
        });
        return;
      }
      if (!response.ok) {
        toast({
          title: 'Inscription impossible',
          description: 'Vérifiez vos informations puis réessayez.',
          variant: 'danger',
        });
        return;
      }

      // Compte créé : connexion automatique puis entrée dans le dashboard.
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        toast({
          title: 'Compte créé',
          description: 'Connectez-vous avec vos nouveaux identifiants.',
          variant: 'success',
        });
        router.push('/login');
        return;
      }
      toast({ title: 'Bienvenue sur SallyCourse !', variant: 'success' });
      router.push('/dashboard');
      router.refresh();
    } catch {
      toast({
        title: 'Erreur inattendue',
        description: 'Réessayez dans un instant.',
        variant: 'danger',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Créer un compte</CardTitle>
        <CardDescription>Votre premier cours généré en quelques minutes.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            label="Nom complet"
            name="name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />
          <Input
            label="Adresse email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <Input
            label="Mot de passe"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint="8 caractères minimum."
          />
          <Input
            label="Confirmer le mot de passe"
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
            Créer mon compte
          </Button>
        </form>

        {googleEnabled && (
          <>
            <AuthDivider />
            <GoogleButton callbackUrl="/dashboard" label="S'inscrire avec Google" />
          </>
        )}

        <p className="text-center text-sm text-muted">
          Déjà inscrit ?{' '}
          <Link
            href="/login"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Se connecter
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
