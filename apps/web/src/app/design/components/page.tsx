'use client';

import * as React from 'react';
import { BookOpen, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Input,
  Progress,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toaster,
  ToastProvider,
  useToast,
  type ToastVariant,
} from '@/components/ui';

/**
 * Page de démonstration /design/components — chaque composant de la
 * bibliothèque SALISTAR dans tous ses états (référence visuelle interne).
 */

/** Section titrée de la galerie. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <h2 className="font-display text-2xl font-semibold text-foreground">{title}</h2>
        <div className="h-px flex-1 bg-gradient-to-r from-primary-500/40 to-transparent" />
      </div>
      {children}
    </section>
  );
}

/** Étiquette discrète au-dessus d'un exemple. */
function Example({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-2xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );
}

function ButtonsSection() {
  return (
    <Section title="Boutons">
      <div className="flex flex-col gap-6">
        <Example label="Variantes">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Générer le cours</Button>
            <Button variant="secondary">Prévisualiser</Button>
            <Button variant="ghost">Annuler</Button>
            <Button variant="danger">
              <Trash2 aria-hidden="true" /> Supprimer
            </Button>
            <Button variant="gold">
              <Sparkles aria-hidden="true" /> Passer en Premium
            </Button>
          </div>
        </Example>
        <Example label="Tailles">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Petit</Button>
            <Button size="md">Moyen</Button>
            <Button size="lg">Grand</Button>
            <Button size="icon" aria-label="Ajouter un module">
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </Example>
        <Example label="États (survol/press animés · focus clavier = halo or)">
          <div className="flex flex-wrap items-center gap-3">
            <Button loading>Génération…</Button>
            <Button disabled>Désactivé</Button>
            <Button variant="secondary" loading>
              Chargement
            </Button>
            <Button variant="gold" disabled>
              Premium désactivé
            </Button>
          </div>
        </Example>
      </div>
    </Section>
  );
}

function BadgesSection() {
  return (
    <Section title="Badges de statut">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="draft">Brouillon</Badge>
        <Badge variant="generating">Génération…</Badge>
        <Badge variant="ready">Prêt</Badge>
        <Badge variant="failed">Échec</Badge>
        <Badge variant="published">Publié</Badge>
        <Badge variant="ready" hideDot>
          Sans pastille
        </Badge>
      </div>
    </Section>
  );
}

function CardsSection() {
  return (
    <Section title="Cartes (bordure dégradée violet → or)">
      <div className="grid gap-6 sm:grid-cols-2">
        <Card interactive>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Introduction à l&apos;algèbre</CardTitle>
              <Badge variant="published">Publié</Badge>
            </div>
            <CardDescription>Niveau collège · 8 modules · généré le 12 juin</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={100} label="Complétude" showLabel />
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="secondary">
              Ouvrir
            </Button>
            <Button size="sm" variant="ghost">
              Dupliquer
            </Button>
          </CardFooter>
        </Card>
        <Card interactive>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Histoire du Maroc moderne</CardTitle>
              <Badge variant="generating">Génération…</Badge>
            </div>
            <CardDescription>Niveau lycée · plan en cours de rédaction</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={42} label="Génération" showLabel />
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="ghost" disabled>
              Ouvrir
            </Button>
          </CardFooter>
        </Card>
      </div>
    </Section>
  );
}

function FormsSection() {
  const [title, setTitle] = React.useState('Les fractions au CM2');
  return (
    <Section title="Formulaires (labels flottants)">
      <div className="grid gap-6 sm:grid-cols-2">
        <Example label="Input vide">
          <Input label="Titre du cours" />
        </Example>
        <Example label="Input rempli (contrôlé)">
          <Input label="Titre du cours" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Example>
        <Example label="Input avec aide">
          <Input label="Public cible" hint="Ex. : élèves de 6e, adultes débutants…" />
        </Example>
        <Example label="Input en erreur">
          <Input label="Titre du cours" defaultValue="ab" error="Le titre doit contenir au moins 5 caractères." />
        </Example>
        <Example label="Input désactivé">
          <Input label="Identifiant" defaultValue="cours-1024" disabled />
        </Example>
        <Example label="Select">
          <Select label="Niveau" defaultValue="college">
            <option value="primaire">Primaire</option>
            <option value="college">Collège</option>
            <option value="lycee">Lycée</option>
            <option value="superieur">Supérieur</option>
          </Select>
        </Example>
        <Example label="Select en erreur">
          <Select label="Langue" error="Choisissez une langue de génération." defaultValue="">
            <option value="" disabled>
              —
            </option>
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </Example>
        <Example label="Textarea">
          <Textarea
            label="Consignes pour l'IA"
            hint="Précisez le ton, les prérequis, les exemples souhaités…"
          />
        </Example>
      </div>
    </Section>
  );
}

function DialogSection() {
  const [open, setOpen] = React.useState(false);
  return (
    <Section title="Dialogue (backdrop flouté)">
      <Dialog open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap gap-3">
          {/* DialogTrigger rend son propre <button> — stylé via buttonVariants */}
          <DialogTrigger className={buttonVariants({ variant: 'secondary' })}>
            Ouvrir le dialogue
          </DialogTrigger>
        </div>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce cours ?</DialogTitle>
            <DialogDescription>
              « Introduction à l&apos;algèbre » et ses 8 modules seront définitivement supprimés. Cette action est
              irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className={buttonVariants({ variant: 'ghost' })}>Annuler</DialogClose>
            <Button variant="danger" onClick={() => setOpen(false)}>
              <Trash2 aria-hidden="true" /> Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function ToastSection() {
  const { toast } = useToast();
  const fire = (variant: ToastVariant, title: string, description: string) =>
    toast({ variant, title, description });

  return (
    <Section title="Toasts">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() => fire('default', 'Sally vous informe', 'Un nouveau modèle de cours est disponible.')}
        >
          Défaut
        </Button>
        <Button
          variant="secondary"
          onClick={() => fire('success', 'Cours généré', 'Les 8 modules sont prêts à être relus.')}
        >
          Succès
        </Button>
        <Button
          variant="secondary"
          onClick={() => fire('warning', 'Quota bientôt atteint', 'Il vous reste 2 générations ce mois-ci.')}
        >
          Avertissement
        </Button>
        <Button
          variant="secondary"
          onClick={() => fire('danger', 'Échec de génération', 'Le service IA est momentanément indisponible.')}
        >
          Erreur
        </Button>
        <Button
          variant="secondary"
          onClick={() => fire('info', 'Astuce', 'Ajoutez des consignes pour affiner le ton du cours.')}
        >
          Info
        </Button>
      </div>
    </Section>
  );
}

function SkeletonSection() {
  return (
    <Section title="Skeletons (shimmer violet)">
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <Skeleton className="h-24 w-full rounded-md" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24 rounded-sm" />
              <Skeleton className="h-8 w-16 rounded-sm" />
            </div>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </Section>
  );
}

function ProgressSection() {
  const [value, setValue] = React.useState(35);
  return (
    <Section title="Progression (dégradé animé violet → or)">
      <div className="flex max-w-xl flex-col gap-6">
        <Progress value={value} label="Génération du cours" showLabel />
        <Progress value={80} label="Relecture" showLabel />
        <Example label="Indéterminée">
          <Progress label="Analyse du sujet…" />
        </Example>
        <div className="flex gap-3">
          <Button size="sm" variant="secondary" onClick={() => setValue((v) => Math.max(0, v - 15))}>
            −15 %
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setValue((v) => Math.min(100, v + 15))}>
            +15 %
          </Button>
        </div>
      </div>
    </Section>
  );
}

function TabsSection() {
  return (
    <Section title="Onglets (soulignement animé)">
      <Tabs defaultValue="plan" className="max-w-2xl">
        <TabsList>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="contenu">Contenu</TabsTrigger>
          <TabsTrigger value="quiz">Quiz</TabsTrigger>
          <TabsTrigger value="exports" disabled>
            Exports
          </TabsTrigger>
        </TabsList>
        <TabsContent value="plan">
          <p className="text-sm text-muted">
            Le plan du cours est structuré en 8 modules progressifs, du rappel des prérequis jusqu&apos;à
            l&apos;évaluation finale.
          </p>
        </TabsContent>
        <TabsContent value="contenu">
          <p className="text-sm text-muted">
            Chaque module contient une leçon rédigée, deux exemples corrigés et une synthèse mémorisable.
          </p>
        </TabsContent>
        <TabsContent value="quiz">
          <p className="text-sm text-muted">
            10 questions à choix multiples générées par module, avec explication de chaque réponse.
          </p>
        </TabsContent>
        <TabsContent value="exports">
          <p className="text-sm text-muted">Exports PDF et SCORM (bientôt disponibles).</p>
        </TabsContent>
      </Tabs>
    </Section>
  );
}

function EmptyStateSection() {
  return (
    <Section title="État vide">
      <div className="max-w-2xl">
        <EmptyState
          title="Aucun cours pour l'instant"
          description="Donnez un titre et un niveau : Sally génère le plan, les leçons et les quiz en quelques minutes."
          action={
            <>
              <Button>
                <Wand2 aria-hidden="true" /> Générer mon premier cours
              </Button>
              <Button variant="ghost">
                <BookOpen aria-hidden="true" /> Voir un exemple
              </Button>
            </>
          }
        />
      </div>
    </Section>
  );
}

/** Vérification RTL : mêmes composants, direction inversée, texte arabe. */
function RtlSection() {
  return (
    <Section title="RTL (aperçu arabe)">
      <div dir="rtl" lang="ar" className="flex max-w-2xl flex-col gap-6 font-arabic">
        <div className="flex flex-wrap items-center gap-3">
          <Button>إنشاء الدرس</Button>
          <Button variant="secondary">معاينة</Button>
          <Badge variant="ready">جاهز</Badge>
          <Badge variant="generating">قيد الإنشاء</Badge>
        </div>
        <Input label="عنوان الدرس" hint="مثال: مقدمة في الجبر" />
        <Progress value={64} label="تقدم الإنشاء" showLabel />
      </div>
    </Section>
  );
}

function Gallery() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Design system · D3</p>
        <h1 className="font-display text-4xl font-bold text-foreground">Composants SALISTAR</h1>
        <p className="max-w-2xl text-base text-muted">
          Bibliothèque UI de SallyCourse : chaque composant est présenté dans tous ses états — dark mode par
          défaut, RTL natif, animations sobres.
        </p>
      </header>

      <ButtonsSection />
      <BadgesSection />
      <CardsSection />
      <FormsSection />
      <DialogSection />
      <ToastSection />
      <SkeletonSection />
      <ProgressSection />
      <TabsSection />
      <EmptyStateSection />
      <RtlSection />
    </main>
  );
}

export default function ComponentsPage() {
  return (
    <ToastProvider>
      <Gallery />
      <Toaster />
    </ToastProvider>
  );
}
