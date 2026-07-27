import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RegisterForm } from '@/components/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.registerPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export default function RegisterPage() {
  return <RegisterForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)} />;
}
