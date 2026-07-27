'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/error-message';

/**
 * « Importer une archive » (P182, anti-lock-in) — re-crée un cours complet
 * depuis une archive maître .zip exportée. La route existait sans aucun point
 * d'entrée UI (audit connectivité 2026-07-17).
 */
export function ImportArchiveButton() {
  const router = useRouter();
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/courses/import-archive', { method: 'POST', body: form });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: 'Import impossible', description: errorMessage(data, tApiError) });
        return;
      }
      toast({ variant: 'success', title: 'Archive importée' });
      if (data?.id) router.push(`/dashboard/courses/${data.id}`);
      else router.refresh();
    } catch {
      toast({ variant: 'danger', title: 'Erreur réseau', description: 'Serveur injoignable.' });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <Button variant="secondary" size="lg" loading={busy} onClick={() => inputRef.current?.click()}>
        {!busy && <Upload aria-hidden="true" />}
        Importer une archive
      </Button>
    </>
  );
}
