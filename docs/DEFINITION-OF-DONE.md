# Definition of Done

Checklist appliquée à **chaque** feature/fix avant de la considérer terminée (et avant
d'ouvrir une PR — voir `.github/PULL_REQUEST_TEMPLATE.md`, qui reprend cette liste).

Chaque item référence l'outil ou le prompt qui l'a mis en place, pour retrouver le
contexte et éviter de re-découvrir "pourquoi on fait ça" à chaque fois.

## 1. Types stricts

- [ ] Pas de `any` implicite ni explicite non justifié (`strict: true` dans
      `tsconfig.base.json`) — si un `any`/`as any` est nécessaire (SDK tiers non typé,
      contournement ESM ponctuel), il est commenté avec la raison.
- [ ] Les schémas Zod dans `packages/shared/src/schemas/` restent la source de vérité
      unique pour toute forme de données partagée (voir "single-source types",
      vague A) — pas de redéfinition d'un type/interface qui duplique un schéma Zod
      existant ailleurs dans le monorepo.
- [ ] `cd <workspace touché> && npx tsc --noEmit` passe sans erreur introduite par le
      changement (les erreurs pré-existantes sur des fichiers non touchés ne bloquent
      pas la PR, mais ne doivent pas être aggravées).

## 2. Zéro duplication

- [ ] `pnpm check:duplication` (jscpd, config `.jscpd.json`, seuil `threshold: 0` —
      voir vague A, audit anti-dup) ne signale pas de nouveau bloc dupliqué introduit
      par la PR (≥ 10 lignes / 50 tokens).
- [ ] Toute logique commune à plusieurs adapters de déploiement passe par
      `BaseDeploymentAdapter` (`apps/worker/src/deploy/`) plutôt que d'être recopiée
      dans un nouvel adapter concret (voir `docs/ADDING-A-PLATFORM-ADAPTER.md`).

## 3. Zéro hardcoding

- [ ] Aucune valeur littérale "magique" (URL, clé de cache, nom de queue, limite,
      code d'erreur, statut) qui existe déjà comme constante dans
      `packages/shared/src/constants.ts` — importer la constante plutôt que de la
      recopier (voir vague A, audit anti-hardcoding).
- [ ] Toute nouvelle constante partagée entre ≥ 2 fichiers/workspaces est ajoutée à
      `packages/shared/src/constants.ts` plutôt que dupliquée localement.
- [ ] Pas de secret, token ou clé API en dur — `pnpm check:secrets` passe (voir
      `SECURITY-AUDIT.md`, renforcement secrets/credentials, vague B).

## 4. Erreurs gérées

- [ ] Toute nouvelle erreur applicative (route API, processor worker) qui doit
      remonter jusqu'à l'utilisateur étend `AppError`
      (`packages/shared/src/errors.ts`, Prompt 119) plutôt que de lancer une
      `Error` brute ou une nouvelle classe ad-hoc — sépare `userMessage` (safe à
      afficher) et `technicalMessage` (logs uniquement).
- [ ] Les erreurs historiques déjà `extends Error` (ClaudeJsonError,
      CircuitOpenError, StorageError, CourseCancelledError, VideoRenderError,
      DockerUnavailableError, UdemyCaptchaError, UdemySessionExpiredError,
      KajabiSessionExpiredError, ScreenshotCaptureError, AvatarGenerationError) ne
      sont pas migrées "pour le principe" dans la même PR — migration au cas par cas
      uniquement si la PR les touche déjà.
- [ ] Toute page/segment Next.js qui peut échouer a un `error.tsx` (error boundary)
      cohérent avec le pattern existant (`apps/web/src/app/(dashboard)/error.tsx`).
- [ ] Les erreurs LLM (sortie tronquée, JSON invalide, contenu hors-format) passent
      par `callClaudeJson` (`apps/worker/src/lib/claude.ts`, retry + validation Zod +
      cache) et/ou `apps/worker/src/lib/llm-output-checks.ts` plutôt que par une
      validation ad-hoc.

## 5. Tests

- [ ] Au moins un test unitaire couvre la nouvelle logique (fichier
      `*.test.ts`/`*.test.tsx` colocalisé, `vitest`).
- [ ] Si la feature traverse une frontière (DB, queue BullMQ, appel HTTP réel,
      pipeline multi-étapes), un test d'intégration existe
      (`*.integration.test.ts` — voir `apps/web/src/lib/create-course.integration.test.ts`
      et `apps/worker/src/media/video-render.integration.test.ts` comme exemples).
- [ ] `npx vitest run` passe sur les fichiers de test ajoutés/modifiés avant de
      conclure la tâche.
- [ ] Si la feature introduit une route Course/Deployment/Lesson (ou toute route
      paramétrée par un id de ressource appartenant à un utilisateur), un test
      IDOR explicite existe (voir section 8 et les tests de référence
      `apps/web/src/app/api/lessons/[id]/route.test.ts`,
      `apps/web/src/app/api/v1/courses/[id]/route.test.ts`).

## 6. i18n AR/FR/EN à jour

- [ ] Toute chaîne visible utilisateur passe par `next-intl` (Prompt 56) — pas de
      texte en dur dans le JSX.
- [ ] Les 3 fichiers de messages sont mis à jour en parallèle et restent
      synchronisés (mêmes clés) : `apps/web/messages/fr.json`,
      `apps/web/messages/en.json`, `apps/web/messages/ar.json`.
- [ ] La traduction arabe n'est pas une simple copie/placeholder — sens vérifié.

## 7. RTL vérifié

- [ ] L'écran est vérifié en `dir="rtl"` (arabe) : propriétés logiques uniquement
      (`start`/`end`, `ps-`/`pe-`, `ms-`/`me-`, jamais `left`/`right`/`pl-`/`pr-` en
      dur), icônes directionnelles inversées, aucune casse de layout.
- [ ] Typo arabe : `font-arabic`, jamais de serif, titres weight ≥ 600, jamais
      d'italique (repris de la checklist design SALISTAR déjà en place dans le
      template PR).

## 8. Dark mode (tokens uniquement)

- [ ] Aucune couleur hex inline ni classe arbitraire Tailwind (`bg-[#...]`,
      `text-[#...]`) — règle appliquée automatiquement par `eslint.config.mjs`
      (`no-restricted-syntax`, voir vague C, ESLint renforcé) ; tout passe par les
      tokens `packages/design/src/tokens.ts` (`bg-primary`, `text-accent-400`,
      `border-border`, `bg-surface`, ...).
- [ ] Dark mode conçu et vérifié en premier (thème par défaut), reste correct en
      light.

## 9. Audit ownership / IDOR sur les nouvelles routes

- [ ] Toute nouvelle route `apps/web/src/app/api/**` paramétrée par un id
      (`[id]`) filtre explicitement par propriétaire (`{ _id, userId }`) ou passe
      par un helper existant qui le fait (`loadOwnedCourse`/`requireOwnedCourse`),
      y compris pour les ressources indirectement rattachées (pattern à deux temps
      `findById` + vérification d'ownership du parent — voir
      `apps/web/src/app/api/lessons/[id]/route.ts`).
      Référence complète : `SECURITY-AUDIT.md`, section "Audit OWASP complémentaire
      (P116)".
- [ ] Un test explicite prouve qu'un utilisateur A ne peut pas lire/modifier/
      supprimer une ressource appartenant à un utilisateur B (403/404 attendu).

## 10. Log structuré

- [ ] Tout log passe par `pino` (déjà en dépendance dans `apps/web` et
      `apps/worker`) — jamais de `console.log`/`console.error` oublié en dehors des
      scripts CLI ponctuels (`packages/cli`) où c'est la sortie attendue.
- [ ] Les logs d'erreur portent le `technicalMessage` d'`AppError` (ou l'équivalent
      pour les erreurs historiques), pas le `userMessage`.

## 11. Documentation à jour

- [ ] Si la feature change un comportement documenté, le doc concerné est mis à
      jour dans le même changement : `docs/DEPLOYMENT.md`, `docs/RUNBOOK.md`,
      `docs/USER-GUIDE.md`, `docs/ADDING-A-PLATFORM-ADAPTER.md`,
      `docs/ZAPIER-INTEGRATION.md`, `docs/LAUNCH-CHECKLIST.md`, `SECURITY-AUDIT.md`,
      `DEPENDENCY-AUDIT.md` selon le cas.
- [ ] Un nouvel adapter de déploiement documente son ajout dans
      `docs/ADDING-A-PLATFORM-ADAPTER.md`.

## Import ESM worker (rappel technique, pas une checklist produit)

- [ ] Tout import de `packages/db` ou `packages/shared` depuis `apps/worker/src/shared.ts`
      porte le pragma `// @ts-ignore TS6059/TS2305` juste au-dessus, et l'import tient
      sur une seule ligne.

---

*Ce document est vivant : si un item devient obsolète (outil retiré) ou qu'un
nouvel outil qualité arrive (Stryker mutation testing, knip une fois exécutés en
continu — actuellement configurés mais non exécutés en CI, voir vague C), mettre à
jour cette liste et `.github/PULL_REQUEST_TEMPLATE.md` dans le même changement.*
