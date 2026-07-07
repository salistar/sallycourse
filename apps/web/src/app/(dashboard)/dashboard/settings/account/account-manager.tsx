'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from '@/components/ui';

interface AccountManagerProps {
  email: string;
}

/**
 * Actions RGPD en self-service (P66) : export (téléchargement direct du ZIP)
 * et suppression définitive (confirmation forte — retaper l'email exact —
 * dans un dialogue dédié, pour éviter tout clic accidentel).
 */
export function AccountManager({ email }: AccountManagerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [exporting, setExporting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [confirmValue, setConfirmValue] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch('/api/account/export');
      if (!res.ok) {
        toast({ variant: 'danger', title: 'Export impossible', description: 'Réessayez plus tard.' });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sallycourse-export.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ variant: 'success', title: 'Export prêt', description: 'Le téléchargement a démarré.' });
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau', description: 'Serveur injoignable.' });
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: confirmValue }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: 'Suppression impossible', description: data?.error });
        return;
      }
      toast({ variant: 'success', title: 'Compte supprimé', description: 'Toutes vos données ont été effacées.' });
      await signOut({ redirect: false });
      router.push('/');
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau', description: 'Serveur injoignable.' });
    } finally {
      setDeleting(false);
    }
  }

  const confirmMatches = confirmValue.trim().toLowerCase() === email.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="size-5 text-accent" aria-hidden="true" />
            Exporter mes données
          </CardTitle>
          <p className="text-sm text-muted">
            Téléchargez une archive ZIP contenant votre profil, vos cours, vos plateformes
            connectées (métadonnées uniquement, jamais les secrets) et votre historique
            d’utilisation.
          </p>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" loading={exporting} onClick={() => void handleExport()}>
            {!exporting && <Download aria-hidden="true" />}
            Télécharger mes données (.zip)
          </Button>
        </CardContent>
      </Card>

      <Card className="border-danger/40">
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2 text-lg text-danger">
            <Trash2 className="size-5" aria-hidden="true" />
            Supprimer mon compte
          </CardTitle>
          <p className="text-sm text-muted">
            Suppression définitive et immédiate de votre compte, de tous vos cours, de leurs
            médias et de vos connexions plateformes. Cette action est irréversible.
          </p>
        </CardHeader>
        <CardContent>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden="true" />
            Supprimer définitivement mon compte
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setConfirmValue('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
              Confirmer la suppression
            </DialogTitle>
            <DialogDescription>
              Cette action supprime définitivement votre compte, vos cours, vos médias et vos
              connexions plateformes. Aucune restauration n’est possible. Pour confirmer, retapez
              votre email : <span className="font-medium text-foreground">{email}</span>
            </DialogDescription>
          </DialogHeader>
          <Input
            label="Confirmez votre email"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            placeholder={email}
            autoComplete="off"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Annuler
            </Button>
            <Button
              variant="danger"
              disabled={!confirmMatches}
              loading={deleting}
              onClick={() => void handleDelete()}
            >
              Supprimer définitivement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
