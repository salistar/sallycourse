import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth';

export const metadata: Metadata = {
  title: 'Créer un compte — SallyCourse',
  description: 'Rejoignez SallyCourse et générez votre premier cours en quelques minutes.',
};

export default function RegisterPage() {
  return <RegisterForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)} />;
}
