'use client';

import * as React from 'react';
import { FlaskConical, History, Save } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select, Textarea, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { activateVersionAction, listVersionsAction, savePromptAction, testPromptAction, type PromptVersionRow } from './actions';
import { KNOWN_PROMPT_KEYS, findKeyInfo } from './known-keys';

/**
 * Playground de prompts admin (P93) : éditeur de contenu par clé, versioning
 * incrémental (bouton Enregistrer = nouvelle version), historique avec
 * rollback, et bouton Tester qui appelle Claude et affiche le résultat côte à
 * côte avec la version précédemment active — comparaison A/B visuelle.
 */

const EXAMPLE_USER_MESSAGE =
  'Exemple de message utilisateur : "Génère le plan complet d\'un cours en français.\nTitre du cours : « Introduction à la photographie culinaire »\nNiveau : débutant"';

interface TestColumnResult {
  label: string;
  content: string;
  output: string | null;
  loading: boolean;
  error: string | null;
}

function emptyColumn(label: string, content: string): TestColumnResult {
  return { label, content, output: null, loading: false, error: null };
}

export function PromptPlayground() {
  const { toast } = useToast();
  const [selectedKey, setSelectedKey] = React.useState(KNOWN_PROMPT_KEYS[0]?.key ?? '');
  const [versions, setVersions] = React.useState<PromptVersionRow[]>([]);
  const [draft, setDraft] = React.useState('');
  const [userMessage, setUserMessage] = React.useState(EXAMPLE_USER_MESSAGE);
  const [loadingVersions, setLoadingVersions] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [currentResult, setCurrentResult] = React.useState<TestColumnResult | null>(null);
  const [previousResult, setPreviousResult] = React.useState<TestColumnResult | null>(null);

  const keyInfo = findKeyInfo(selectedKey);
  const activeVersion = versions.find((v) => v.isActive);
  const previousVersion = versions.find((v) => !v.isActive) ?? null;

  const loadVersions = React.useCallback(async (key: string) => {
    setLoadingVersions(true);
    try {
      const rows = await listVersionsAction(key);
      setVersions(rows);
      const active = rows.find((v) => v.isActive);
      setDraft(active?.content ?? '');
    } catch (err) {
      toast({ variant: 'danger', title: 'Chargement impossible', description: (err as Error).message });
    } finally {
      setLoadingVersions(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void loadVersions(selectedKey);
    setCurrentResult(null);
    setPreviousResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  async function handleSave() {
    setSaving(true);
    try {
      const { version } = await savePromptAction(selectedKey, draft);
      toast({ variant: 'success', title: `Version ${version} enregistrée et activée` });
      await loadVersions(selectedKey);
    } catch (err) {
      toast({ variant: 'danger', title: 'Enregistrement impossible', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(version: number) {
    try {
      await activateVersionAction(selectedKey, version);
      toast({ variant: 'success', title: `Version ${version} réactivée` });
      await loadVersions(selectedKey);
    } catch (err) {
      toast({ variant: 'danger', title: 'Activation impossible', description: (err as Error).message });
    }
  }

  async function handleTest() {
    setTesting(true);
    const isSystem = keyInfo?.role === 'system';
    const currentSystem = isSystem ? draft : activeVersion?.content ?? '';
    const currentUser = isSystem ? userMessage : draft;

    setCurrentResult(emptyColumn(`Version en cours d'édition`, draft));
    setPreviousResult(
      previousVersion ? emptyColumn(`Version précédente (v${previousVersion.version})`, previousVersion.content) : null,
    );

    try {
      const currentTest = await testPromptAction(currentSystem, currentUser);
      setCurrentResult((prev) => (prev ? { ...prev, output: currentTest.output, loading: false } : prev));

      if (previousVersion) {
        const prevSystem = isSystem ? previousVersion.content : activeVersion?.content ?? '';
        const prevUser = isSystem ? userMessage : previousVersion.content;
        const prevTest = await testPromptAction(prevSystem, prevUser);
        setPreviousResult((prev) => (prev ? { ...prev, output: prevTest.output, loading: false } : prev));
      }
    } catch (err) {
      toast({ variant: 'danger', title: 'Test impossible', description: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Éditeur</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Select
            label="Clé de prompt"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
          >
            {KNOWN_PROMPT_KEYS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label} ({k.key})
              </option>
            ))}
          </Select>

          {activeVersion ? (
            <p className="text-xs text-muted">
              Version active : <Badge variant="published">v{activeVersion.version}</Badge> — par{' '}
              {activeVersion.createdBy}
            </p>
          ) : (
            <p className="text-xs text-muted">
              Aucune version en base pour cette clé — le pipeline utilise actuellement le prompt en dur du
              générateur ({keyInfo?.generator}.ts).
            </p>
          )}

          <Textarea
            label="Contenu du prompt"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            disabled={loadingVersions}
            hint="Enregistrer crée une nouvelle version incrémentale et l'active immédiatement (le pipeline de génération la lira à la prochaine exécution)."
          />

          {keyInfo?.role === 'system' && (
            <Textarea
              label="Message utilisateur d'exemple (pour le bouton Tester)"
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              rows={4}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleSave} disabled={saving || loadingVersions}>
              <Save aria-hidden="true" /> {saving ? 'Enregistrement…' : 'Enregistrer (nouvelle version)'}
            </Button>
            <Button variant="secondary" onClick={handleTest} disabled={testing || draft.trim().length === 0}>
              <FlaskConical aria-hidden="true" /> {testing ? 'Test en cours…' : 'Tester'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(currentResult || previousResult) && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FlaskConical className="size-5 text-accent" aria-hidden="true" />
              <CardTitle className="text-lg">Comparaison A/B</CardTitle>
            </div>
            <p className="text-sm text-muted">
              Résultat de la version en cours d&apos;édition à gauche, version précédemment active à droite.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <ResultColumn result={currentResult} />
              <ResultColumn result={previousResult} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="size-5 text-accent" aria-hidden="true" />
            <CardTitle className="text-lg">Historique des versions</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted">Aucune version enregistrée pour cette clé.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {versions.map((v) => (
                <li
                  key={v.version}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2 text-sm',
                    v.isActive && 'border-primary/50 bg-primary-soft',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={v.isActive ? 'published' : 'generating'}>v{v.version}</Badge>
                    <span className="text-muted">{v.createdBy}</span>
                    <span className="text-2xs text-muted">{new Date(v.createdAt).toLocaleString('fr-FR')}</span>
                  </div>
                  {!v.isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleActivate(v.version)}>
                      Réactiver
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ResultColumn({ result }: { result: TestColumnResult | null }) {
  if (!result) {
    return <p className="text-sm text-muted">Aucune version précédente à comparer.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{result.label}</p>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-subtle p-3 text-sm text-foreground">
        {result.output ?? 'Chargement…'}
      </pre>
    </div>
  );
}
