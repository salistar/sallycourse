'use client';

import * as React from 'react';
import { Plus, Trash2, UserCheck, UserX, Receipt } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Badge,
  EmptyState,
  useToast,
} from '@/components/ui';

/** Clé localStorage du client actif (contexte de travail courant). */
const ACTIVE_CLIENT_KEY = 'sc_agency_active_client';

export interface AgencyClientSummary {
  id: string;
  clientName: string;
  clientEmail: string;
  platformCredentials: string[];
}

interface AgencyBillingRow {
  agencyClientId: string;
  clientName: string;
  clientEmail: string;
  courseCount: number;
  totalUsd: number;
  byCourse: Array<{ courseId: string; totalUsd: number }>;
}

interface AgencyManagerProps {
  initialClients: AgencyClientSummary[];
}

/**
 * Gestionnaire du mode agence : liste des clients, création, switch de
 * contexte « travailler pour ce client » (persisté localStorage — lu par
 * create-course-experience.tsx au moment de la création), et rapport de
 * facturation agrégé par client.
 */
export function AgencyManager({ initialClients }: AgencyManagerProps) {
  const { toast } = useToast();
  const [clients, setClients] = React.useState(initialClients);
  const [activeClientId, setActiveClientId] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [billing, setBilling] = React.useState<AgencyBillingRow[] | null>(null);
  const [loadingBilling, setLoadingBilling] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    setActiveClientId(window.localStorage.getItem(ACTIVE_CLIENT_KEY));
  }, []);

  function switchContext(clientId: string | null) {
    if (clientId) {
      window.localStorage.setItem(ACTIVE_CLIENT_KEY, clientId);
    } else {
      window.localStorage.removeItem(ACTIVE_CLIENT_KEY);
    }
    setActiveClientId(clientId);
    const client = clients.find((c) => c.id === clientId);
    toast({
      variant: 'success',
      title: clientId ? `Contexte : ${client?.clientName ?? 'client'}` : 'Contexte agence désactivé',
      description: clientId
        ? 'Les prochains cours créés seront rattachés à ce client.'
        : 'Les prochains cours créés seront rattachés à votre compte agence.',
    });
  }

  async function handleDelete(client: AgencyClientSummary) {
    setBusy(`del:${client.id}`);
    try {
      const res = await fetch(`/api/agency/clients/${client.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setClients((prev) => prev.filter((c) => c.id !== client.id));
      if (activeClientId === client.id) switchContext(null);
      toast({ variant: 'success', title: 'Client supprimé', description: client.clientName });
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Suppression impossible.' });
    } finally {
      setBusy(null);
    }
  }

  async function loadBilling() {
    setLoadingBilling(true);
    try {
      const res = await fetch('/api/agency/billing');
      const json = (await res.json()) as { reports?: AgencyBillingRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Erreur');
      setBilling(json.reports ?? []);
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Facturation indisponible.' });
    } finally {
      setLoadingBilling(false);
    }
  }

  function handleCreated(client: AgencyClientSummary) {
    setClients((prev) => [client, ...prev]);
    setShowForm(false);
    toast({ variant: 'success', title: 'Client créé', description: client.clientName });
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Contexte actif */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Contexte de travail</CardTitle>
          <p className="text-sm text-muted">
            Choisissez pour quel client vous travaillez : les nouveaux cours créés et leurs
            déploiements seront rattachés à ce client.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            variant={activeClientId === null ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => switchContext(null)}
          >
            <UserX aria-hidden="true" /> Mon compte agence
          </Button>
          {clients.map((c) => (
            <Button
              key={c.id}
              variant={activeClientId === c.id ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => switchContext(c.id)}
            >
              <UserCheck aria-hidden="true" /> {c.clientName}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Liste des clients */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-foreground">Mes clients</h2>
          <Button variant="primary" size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus aria-hidden="true" /> Nouveau client
          </Button>
        </div>

        {showForm && <ClientForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />}

        {clients.length === 0 && !showForm ? (
          <EmptyState
            title="Aucun client pour le moment"
            description="Créez votre premier client pour générer des cours en son nom."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {clients.map((client) => (
              <Card key={client.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{client.clientName}</CardTitle>
                    <Badge variant={client.platformCredentials.length > 0 ? 'published' : 'draft'}>
                      {client.platformCredentials.length} compte(s)
                    </Badge>
                  </div>
                  <p className="text-sm text-muted">{client.clientEmail}</p>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === `del:${client.id}`}
                    onClick={() => handleDelete(client)}
                  >
                    <Trash2 aria-hidden="true" /> Supprimer
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Facturation par client */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-foreground">
            Facturation par client
          </h2>
          <Button variant="secondary" size="sm" loading={loadingBilling} onClick={loadBilling}>
            <Receipt aria-hidden="true" /> Calculer les coûts
          </Button>
        </div>

        {billing !== null && (
          billing.length === 0 ? (
            <EmptyState
              title="Aucun coût à facturer"
              description="Aucun cours généré au nom d'un client n'a encore engendré de coût."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {billing.map((row) => (
                <Card key={row.agencyClientId}>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">{row.clientName}</CardTitle>
                      <span className="font-display text-lg font-semibold text-foreground">
                        {row.totalUsd.toFixed(2)} $
                      </span>
                    </div>
                    <p className="text-sm text-muted">
                      {row.clientEmail} · {row.courseCount} cours facturé(s)
                    </p>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formulaire de création de client                                    */
/* ------------------------------------------------------------------ */

interface ClientFormProps {
  onCreated: (client: AgencyClientSummary) => void;
  onCancel: () => void;
}

function ClientForm({ onCreated, onCancel }: ClientFormProps) {
  const { toast } = useToast();
  const [clientName, setClientName] = React.useState('');
  const [clientEmail, setClientEmail] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/agency/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: clientName.trim(), clientEmail: clientEmail.trim() }),
      });
      const json = (await res.json()) as { client?: AgencyClientSummary; error?: string };
      if (!res.ok || !json.client) {
        toast({ variant: 'danger', title: 'Création impossible', description: json.error });
        return;
      }
      onCreated(json.client);
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Réseau indisponible.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input
            label="Nom du client"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Académie Dupont"
            required
          />
          <Input
            label="Email de contact"
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="contact@academie-dupont.fr"
            required
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              Créer
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Annuler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
