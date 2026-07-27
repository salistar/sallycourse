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
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('design.componentsPage');
  return (
    <Section title={t('sections.buttons')}>
      <div className="flex flex-col gap-6">
        <Example label={t('buttons.examples.variants')}>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">{t('buttons.generate')}</Button>
            <Button variant="secondary">{t('buttons.preview')}</Button>
            <Button variant="ghost">{t('buttons.cancel')}</Button>
            <Button variant="danger">
              <Trash2 aria-hidden="true" /> {t('buttons.delete')}
            </Button>
            <Button variant="gold">
              <Sparkles aria-hidden="true" /> {t('buttons.goPremium')}
            </Button>
          </div>
        </Example>
        <Example label={t('buttons.examples.sizes')}>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">{t('buttons.sizeSm')}</Button>
            <Button size="md">{t('buttons.sizeMd')}</Button>
            <Button size="lg">{t('buttons.sizeLg')}</Button>
            <Button size="icon" aria-label={t('buttons.addModuleAria')}>
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </Example>
        <Example label={t('buttons.examples.states')}>
          <div className="flex flex-wrap items-center gap-3">
            <Button loading>{t('buttons.generating')}</Button>
            <Button disabled>{t('buttons.disabled')}</Button>
            <Button variant="secondary" loading>
              {t('buttons.loading')}
            </Button>
            <Button variant="gold" disabled>
              {t('buttons.premiumDisabled')}
            </Button>
          </div>
        </Example>
      </div>
    </Section>
  );
}

function BadgesSection() {
  const t = useTranslations('design.componentsPage');
  return (
    <Section title={t('sections.badges')}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="draft">{t('badges.draft')}</Badge>
        <Badge variant="generating">{t('badges.generating')}</Badge>
        <Badge variant="ready">{t('badges.ready')}</Badge>
        <Badge variant="failed">{t('badges.failed')}</Badge>
        <Badge variant="published">{t('badges.published')}</Badge>
        <Badge variant="ready" hideDot>
          {t('badges.noDot')}
        </Badge>
      </div>
    </Section>
  );
}

function CardsSection() {
  const t = useTranslations('design.componentsPage');
  return (
    <Section title={t('sections.cards')}>
      <div className="grid gap-6 sm:grid-cols-2">
        <Card interactive>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t('cards.course1Title')}</CardTitle>
              <Badge variant="published">{t('badges.published')}</Badge>
            </div>
            <CardDescription>{t('cards.course1Desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={100} label={t('cards.completeness')} showLabel />
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="secondary">
              {t('cards.open')}
            </Button>
            <Button size="sm" variant="ghost">
              {t('cards.duplicate')}
            </Button>
          </CardFooter>
        </Card>
        <Card interactive>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t('cards.course2Title')}</CardTitle>
              <Badge variant="generating">{t('badges.generating')}</Badge>
            </div>
            <CardDescription>{t('cards.course2Desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={42} label={t('cards.generationLabel')} showLabel />
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="ghost" disabled>
              {t('cards.open')}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </Section>
  );
}

function FormsSection() {
  const t = useTranslations('design.componentsPage');
  const [title, setTitle] = React.useState(t('forms.sampleTitle'));
  return (
    <Section title={t('sections.forms')}>
      <div className="grid gap-6 sm:grid-cols-2">
        <Example label={t('forms.examples.inputEmpty')}>
          <Input label={t('forms.courseTitleLabel')} />
        </Example>
        <Example label={t('forms.examples.inputFilled')}>
          <Input label={t('forms.courseTitleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Example>
        <Example label={t('forms.examples.inputHint')}>
          <Input label={t('forms.audienceLabel')} hint={t('forms.audienceHint')} />
        </Example>
        <Example label={t('forms.examples.inputError')}>
          <Input label={t('forms.courseTitleLabel')} defaultValue="ab" error={t('forms.titleError')} />
        </Example>
        <Example label={t('forms.examples.inputDisabled')}>
          <Input label={t('forms.identifierLabel')} defaultValue="cours-1024" disabled />
        </Example>
        <Example label={t('forms.examples.select')}>
          <Select label={t('forms.levelLabel')} defaultValue="college">
            <option value="primaire">{t('forms.levelPrimary')}</option>
            <option value="college">{t('forms.levelCollege')}</option>
            <option value="lycee">{t('forms.levelLycee')}</option>
            <option value="superieur">{t('forms.levelSuperieur')}</option>
          </Select>
        </Example>
        <Example label={t('forms.examples.selectError')}>
          <Select label={t('forms.languageLabel')} error={t('forms.languageError')} defaultValue="">
            <option value="" disabled>
              —
            </option>
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </Example>
        <Example label={t('forms.examples.textarea')}>
          <Textarea
            label={t('forms.aiInstructionsLabel')}
            hint={t('forms.aiInstructionsHint')}
          />
        </Example>
      </div>
    </Section>
  );
}

function DialogSection() {
  const t = useTranslations('design.componentsPage');
  const [open, setOpen] = React.useState(false);
  return (
    <Section title={t('sections.dialog')}>
      <Dialog open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap gap-3">
          {/* DialogTrigger rend son propre <button> — stylé via buttonVariants */}
          <DialogTrigger className={buttonVariants({ variant: 'secondary' })}>
            {t('dialog.open')}
          </DialogTrigger>
        </div>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialog.title')}</DialogTitle>
            <DialogDescription>{t('dialog.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className={buttonVariants({ variant: 'ghost' })}>{t('buttons.cancel')}</DialogClose>
            <Button variant="danger" onClick={() => setOpen(false)}>
              <Trash2 aria-hidden="true" /> {t('buttons.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function ToastSection() {
  const t = useTranslations('design.componentsPage');
  const { toast } = useToast();
  const fire = (variant: ToastVariant, title: string, description: string) =>
    toast({ variant, title, description });

  return (
    <Section title={t('sections.toasts')}>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() => fire('default', t('toasts.default.title'), t('toasts.default.description'))}
        >
          {t('toasts.buttons.default')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => fire('success', t('toasts.success.title'), t('toasts.success.description'))}
        >
          {t('toasts.buttons.success')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => fire('warning', t('toasts.warning.title'), t('toasts.warning.description'))}
        >
          {t('toasts.buttons.warning')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => fire('danger', t('toasts.danger.title'), t('toasts.danger.description'))}
        >
          {t('toasts.buttons.error')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => fire('info', t('toasts.info.title'), t('toasts.info.description'))}
        >
          {t('toasts.buttons.info')}
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
  const t = useTranslations('design.componentsPage');
  const [value, setValue] = React.useState(35);
  return (
    <Section title={t('sections.progress')}>
      <div className="flex max-w-xl flex-col gap-6">
        <Progress value={value} label={t('progress.courseGeneration')} showLabel />
        <Progress value={80} label={t('progress.review')} showLabel />
        <Example label={t('progress.examples.indeterminate')}>
          <Progress label={t('progress.topicAnalysis')} />
        </Example>
        <div className="flex gap-3">
          <Button size="sm" variant="secondary" onClick={() => setValue((v) => Math.max(0, v - 15))}>
            {t('progress.decrease')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setValue((v) => Math.min(100, v + 15))}>
            {t('progress.increase')}
          </Button>
        </div>
      </div>
    </Section>
  );
}

function TabsSection() {
  const t = useTranslations('design.componentsPage');
  return (
    <Section title={t('sections.tabs')}>
      <Tabs defaultValue="plan" className="max-w-2xl">
        <TabsList>
          <TabsTrigger value="plan">{t('tabs.plan')}</TabsTrigger>
          <TabsTrigger value="contenu">{t('tabs.content')}</TabsTrigger>
          <TabsTrigger value="quiz">{t('tabs.quiz')}</TabsTrigger>
          <TabsTrigger value="exports" disabled>
            {t('tabs.exports')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="plan">
          <p className="text-sm text-muted">{t('tabs.planText')}</p>
        </TabsContent>
        <TabsContent value="contenu">
          <p className="text-sm text-muted">{t('tabs.contentText')}</p>
        </TabsContent>
        <TabsContent value="quiz">
          <p className="text-sm text-muted">{t('tabs.quizText')}</p>
        </TabsContent>
        <TabsContent value="exports">
          <p className="text-sm text-muted">{t('tabs.exportsText')}</p>
        </TabsContent>
      </Tabs>
    </Section>
  );
}

function EmptyStateSection() {
  const t = useTranslations('design.componentsPage');
  return (
    <Section title={t('sections.emptyState')}>
      <div className="max-w-2xl">
        <EmptyState
          title={t('emptyState.title')}
          description={t('emptyState.description')}
          action={
            <>
              <Button>
                <Wand2 aria-hidden="true" /> {t('emptyState.generate')}
              </Button>
              <Button variant="ghost">
                <BookOpen aria-hidden="true" /> {t('emptyState.seeExample')}
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
  const t = useTranslations('design.componentsPage');
  return (
    <Section title={t('sections.rtl')}>
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
  const t = useTranslations('design.componentsPage');
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">{t('header.eyebrow')}</p>
        <h1 className="font-display text-4xl font-bold text-foreground">{t('header.title')}</h1>
        <p className="max-w-2xl text-base text-muted">{t('header.description')}</p>
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
