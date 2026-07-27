'use client';

import * as React from 'react';
import { FlaskConical, History, Save } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select, Textarea, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { activateVersionAction, listVersionsAction, savePromptAction, testPromptAction, type PromptVersionRow } from './actions';
import { KNOWN_PROMPT_KEYS, findKeyInfo } from './known-keys';
import { useTranslations, useFormatter } from 'next-intl';

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
  const t = useTranslations('admin.playground');
  const format = useFormatter();
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
      toast({ variant: 'danger', title: t('loadFailed'), description: (err as Error).message });
    } finally {
      setLoadingVersions(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void loadVersions(selectedKey);
    setCurrentResult(null);
    setPreviousResult(null);
  }, [selectedKey]);

  async function handleSave() {
    setSaving(true);
    try {
      const { version } = await savePromptAction(selectedKey, draft);
      toast({ variant: 'success', title: t('versionSavedActivated', { version }) });
      await loadVersions(selectedKey);
    } catch (err) {
      toast({ variant: 'danger', title: t('saveFailed'), description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(version: number) {
    try {
      await activateVersionAction(selectedKey, version);
      toast({ variant: 'success', title: t('versionReactivated', { version }) });
      await loadVersions(selectedKey);
    } catch (err) {
      toast({ variant: 'danger', title: t('activationFailed'), description: (err as Error).message });
    }
  }

  async function handleTest() {
    setTesting(true);
    const isSystem = keyInfo?.role === 'system';
    const currentSystem = isSystem ? draft : activeVersion?.content ?? '';
    const currentUser = isSystem ? userMessage : draft;

    setCurrentResult(emptyColumn(t('currentEditingVersion'), draft));
    setPreviousResult(
      previousVersion ? emptyColumn(t('previousVersion', { version: previousVersion.version }), previousVersion.content) : null,
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
      toast({ variant: 'danger', title: t('testFailed'), description: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('editor')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Select
            label={t('promptKeyLabel')}
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
              {t('activeVersionPrefix')} <Badge variant="published">v{activeVersion.version}</Badge> {t('byAuthor')}{' '}
              {activeVersion.createdBy}
            </p>
          ) : (
            <p className="text-xs text-muted">
              {t('noVersionInDb', { generator: keyInfo?.generator ?? '' })}
            </p>
          )}

          <Textarea
            label={t('promptContentLabel')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            disabled={loadingVersions}
            hint={t('contentHint')}
          />

          {keyInfo?.role === 'system' && (
            <Textarea
              label={t('exampleUserMessageLabel')}
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              rows={4}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleSave} disabled={saving || loadingVersions}>
              <Save aria-hidden="true" /> {saving ? t('saving') : t('saveNewVersion')}
            </Button>
            <Button variant="secondary" onClick={handleTest} disabled={testing || draft.trim().length === 0}>
              <FlaskConical aria-hidden="true" /> {testing ? t('testing') : t('test')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(currentResult || previousResult) && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FlaskConical className="size-5 text-accent" aria-hidden="true" />
              <CardTitle className="text-lg">{t('abComparison')}</CardTitle>
            </div>
            <p className="text-sm text-muted">{t('abComparisonDesc')}</p>
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
            <CardTitle className="text-lg">{t('versionsHistory')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted">{t('noVersionsSaved')}</p>
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
                    <span className="text-2xs text-muted">{format.dateTime(new Date(v.createdAt), { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </div>
                  {!v.isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleActivate(v.version)}>
                      {t('reactivate')}
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
  const t = useTranslations('admin.playground');
  if (!result) {
    return <p className="text-sm text-muted">{t('noPreviousToCompare')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{result.label}</p>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-subtle p-3 text-sm text-foreground">
        {result.output ?? t('loading')}
      </pre>
    </div>
  );
}
