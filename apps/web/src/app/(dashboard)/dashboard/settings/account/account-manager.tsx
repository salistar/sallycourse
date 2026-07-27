'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';
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
  const t = useTranslations('settings.account');
  const tApiError = useTranslations('apiErrors');
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
        toast({ variant: 'danger', title: t('toast.exportFailedTitle'), description: t('toast.exportFailedDescription') });
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
      toast({ variant: 'success', title: t('toast.exportReadyTitle'), description: t('toast.exportReadyDescription') });
    } catch {
      toast({ variant: 'danger', title: t('toast.networkErrorTitle'), description: t('toast.networkErrorDescription') });
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
        toast({ variant: 'danger', title: t('toast.deleteFailedTitle'), description: errorMessage(data, tApiError) });
        return;
      }
      toast({ variant: 'success', title: t('toast.accountDeletedTitle'), description: t('toast.accountDeletedDescription') });
      await signOut({ redirect: false });
      router.push('/');
    } catch {
      toast({ variant: 'danger', title: t('toast.networkErrorTitle'), description: t('toast.networkErrorDescription') });
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
            {t('export.title')}
          </CardTitle>
          <p className="text-sm text-muted">
            {t('export.description')}
          </p>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" loading={exporting} onClick={() => void handleExport()}>
            {!exporting && <Download aria-hidden="true" />}
            {t('export.button')}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-danger/40">
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2 text-lg text-danger">
            <Trash2 className="size-5" aria-hidden="true" />
            {t('delete.title')}
          </CardTitle>
          <p className="text-sm text-muted">
            {t('delete.description')}
          </p>
        </CardHeader>
        <CardContent>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden="true" />
            {t('delete.button')}
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
              {t('dialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('dialog.description')} <span className="font-medium text-foreground">{email}</span>
            </DialogDescription>
          </DialogHeader>
          <Input
            label={t('dialog.emailLabel')}
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            placeholder={email}
            autoComplete="off"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              {t('dialog.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!confirmMatches}
              loading={deleting}
              onClick={() => void handleDelete()}
            >
              {t('dialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
