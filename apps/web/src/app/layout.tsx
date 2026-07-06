import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SallyCourse',
  description: 'Génération automatique de cours — titre + niveau → cours complet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
