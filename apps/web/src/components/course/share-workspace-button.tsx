'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import { errorMessage } from '@/lib/error-message';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from '@/components/ui';

/**
 * « Partager avec mon équipe » (P138) — crée un Workspace et y rattache ce
 * cours, avec invitation optionnelle d'un relecteur. Formulaire dans un Dialog
 * du design system (les window.prompt natifs ont été remplacés — audit design).
 */
export function ShareWorkspaceButton({ courseId, courseTitle }: { courseId: string; courseTitle: string }) {
  const router = useRouter();
  const t = useTranslations('course.share');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState(t('defaultWorkspaceName', { title: courseTitle.slice(0, 40) }));
  const [email, setEmail] = React.useState('');

  const share = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast({ variant: 'danger', title: t('nameRequired') });
      return;
    }
    const trimmedEmail = email.trim();
    setBusy(true);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          courseId,
          members: trimmedEmail ? [{ email: trimmedEmail, role: 'reviewer' }] : [],
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; unknownEmails?: string[] }
        | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('shareFailed'), description: errorMessage(data, tApiError) });
        return;
      }
      if (data?.unknownEmails?.length) {
        toast({
          variant: 'warning',
          title: t('workspaceCreatedInviteIgnored'),
          description: t('unknownEmails', { emails: data.unknownEmails.join(', ') }),
        });
      } else {
        toast({ variant: 'success', title: t('workspaceCreated'), description: trimmedName });
      }
      setOpen(false);
      router.refresh();
    } catch {
      toast({ variant: 'danger', title: t('networkError'), description: t('serverUnreachable') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Users aria-hidden="true" />
        {t('shareButton')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={share} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{t('dialogTitle')}</DialogTitle>
              <DialogDescription>{t('dialogDescription')}</DialogDescription>
            </DialogHeader>
            <Input
              label={t('nameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
            <Input
              label={t('reviewerEmailLabel')}
              type="email"
              placeholder={t('reviewerEmailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button type="submit" loading={busy}>
                {t('createWorkspace')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
