# Checklist de lancement — SallyCourse (P100)

Ce document est la checklist opérationnelle finale avant l'ouverture publique
de SallyCourse. Il ne contient aucune nouvelle fonctionnalité : uniquement des
vérifications, des références vers l'existant, et un plan de lancement.

Statut au 2026-07-11 : plateforme fonctionnellement complète (250 prompts
livrés, cf. `SALLYCOURSE_250_PROMPTS.md`). Ce qui reste = validation finale.

---

## 1. Sécurité

Référence complète : [`SECURITY-AUDIT.md`](../SECURITY-AUDIT.md) (audit P76,
daté du 2026-07-11). Ne pas dupliquer l'analyse ici — cocher que chaque point
a bien été traité avant l'ouverture publique :

- [ ] **En-têtes HTTP** — `apps/web/src/lib/security-headers.ts` posé sur
      toutes les réponses de `middleware.ts` (CSP, X-Frame-Options,
      X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS prod).
      Vérifier en prod avec `curl -sI https://<domaine>/` que les en-têtes
      sont bien présents (HSTS ne sort qu'en HTTPS/prod).
- [ ] **CSRF** — `apps/web/src/lib/csrf.ts` câblé dans `middleware.ts` pour
      tout POST/PUT/PATCH/DELETE sur `/api/*`. Vérifier que les 3 exemptions
      documentées (`/api/auth/*`, `/api/payments/paddle/webhook`,
      `/api/payments/cmi/callback`) sont toujours les seules.
- [ ] **Sanitization Markdown** — `article-view.tsx` reste le SEUL point de
      rendu Markdown généré par IA (`rehypeSanitize` actif). Si un nouveau
      composant de rendu Markdown est ajouté avant le lancement, refaire ce
      grep : `grep -rn "ReactMarkdown\|dangerouslySetInnerHTML" apps/web/src`.
- [ ] **`pnpm audit`** — re-lancer à la racine juste avant le lancement (les
      CVE évoluent). Au moment de l'audit P76 : 9 vulnérabilités, toutes
      devDependencies (`vitest`/`vite`/`esbuild`, jamais embarquées en build
      standalone) sauf `next-auth@5.0.0-beta.25` (dans la plage vulnérable,
      correctif en beta.30) et `postcss@8.4.31` vendorisé par `next` (corrigé
      par un futur bump de Next). Décision de lancement : accepter le risque
      documenté OU monter `next-auth` avant l'ouverture (nécessite validation
      explicite, hors périmètre additif de ce prompt).
- [ ] **Secrets dans les logs** — redaction pino déjà en place côté web
      (`apps/web/src/lib/logger.ts`) et corrigée côté worker
      (`apps/worker/src/queues/index.ts`). Vérifier par un grep rapide sur un
      run de production qu'aucun `Authorization:`, `hashedKey`, ou token
      déchiffré n'apparaît en clair dans les logs agrégés.
- [ ] **Rate limiting** — confirmer que les limites restent actives en prod :
      `POST /api/courses` = 20 req/min par IP + 10 req/min par utilisateur
      (`apps/web/src/app/api/courses/route.ts`). Le générateur d'IP
      (`extractClientIp`, `apps/web/src/lib/rate-limit.ts`) lit
      `x-forwarded-for` / `x-real-ip` : vérifier que le reverse-proxy prod
      (Caddy/nginx) écrase bien ces en-têtes plutôt que de les faire confiance
      aveuglément depuis l'extérieur (sinon un client peut usurper son IP et
      contourner la limite).
- [ ] **Modération de contenu** — `apps/web/src/lib/moderation.ts` actif sur
      la création de cours (`moderateCourseTitle`), à re-tester manuellement
      avec 2-3 titres volontairement limites avant l'ouverture publique.
- [ ] **Clés/secrets d'environnement** — vérifier en prod (pas seulement en
      dev) : `AUTH_SECRET`, `CREDENTIALS_MASTER_KEY` (chiffrement
      `PlatformCredential`), clés S3/MinIO, `ANTHROPIC_API_KEY`, ne sont PAS
      les valeurs générées par `make setup` en local. Un secret de dev qui
      fuite en prod invalide tout le chiffrement des credentials de
      plateformes stockées.

## 2. RGPD

Pages légales déjà livrées (P66), à relire une dernière fois avant
publication pour vérifier qu'aucun texte ne mentionne une fonctionnalité
absente du produit réel :

- [ ] `/legal/confidentialite` — politique de confidentialité
      (`apps/web/src/app/(marketing)/legal/confidentialite/page.tsx`,
      dernière mise à jour affichée : 7 juillet 2026 — **mettre à jour cette
      date si le texte est retouché avant le lancement**).
- [ ] `/legal/cgu` et `/legal/cgv` — conditions d'utilisation / de vente
      (`apps/web/src/app/(marketing)/legal/cgu/page.tsx`,
      `.../cgv/page.tsx`).
- [ ] **Droit d'accès / portabilité** — `POST /api/account/export`
      (`apps/web/src/app/api/account/export/route.ts`) accessible depuis
      `/dashboard/settings/account`. Tester manuellement : un export doit
      renvoyer les données réelles de l'utilisateur (cours, profil), pas une
      coquille vide.
- [ ] **Droit à l'effacement** — `POST /api/account/delete`
      (`apps/web/src/app/api/account/delete/route.ts`). Tester sur un compte
      de test : vérifier que les cours, credentials de plateformes, clés API
      et jobs associés sont bien purgés (pas seulement le document `User`).
- [ ] **Sous-traitants** — vérifier que la liste des sous-traitants tiers
      citée dans `/legal/confidentialite` (hébergeur, Anthropic pour la
      génération, ElevenLabs/OpenAI pour l'audio, Paddle/CMI pour les
      paiements) est à jour avec les intégrations réellement actives en prod.
- [ ] **Cookies** — si un bandeau de consentement cookies existe côté
      marketing, vérifier qu'il ne bloque que les cookies non essentiels
      (la session NextAuth reste nécessaire au fonctionnement du service).

## 3. Test du flow complet bout-en-bout (titre → cours déployé sur 3 plateformes)

À exécuter manuellement sur un environnement proche de la prod (staging ou
`pnpm up` + `pnpm --filter @sallycourse/web dev` + `pnpm --filter
@sallycourse/worker dev`), avec un compte réel (pas de mock) pour valider le
vrai parcours utilisateur. Référence détaillée des libellés : `docs/USER-GUIDE.md`.

1. **Créer un compte** — `/register` (« Créer un compte — SallyCourse »),
   puis se connecter via `/login` (« Connexion — SallyCourse »).
2. **Créer un cours** — `/dashboard/new`. Saisir un titre (champ avec
   placeholder « Ex. Maîtriser Docker en 7 jours »), choisir un niveau
   (Débutant / Intermédiaire / Avancé), cliquer « Générer mon cours ».
   → Vérifier la redirection vers `/dashboard/courses/[id]`.
3. **Valider le plan** — le cours passe au statut `outline-review` (badge
   « Plan à valider »). Relire le plan puis cliquer soit
   « Régénérer le plan » (si insatisfaisant, `POST
   /api/courses/[id]/regenerate-outline`) soit « Valider et générer le
   contenu » (`POST /api/courses/[id]/approve-outline`).
4. **Suivre la génération** — la page `/dashboard/courses/[id]` affiche la
   bannière de progression (`progress-banner.tsx`, statut `generating` →
   `done`/`failed`) ; SSE ou polling sur `GET /api/courses/[id]/progress`.
   Vérifier que la progression avance réellement (pas bloquée à 0 %) et que
   le job worker correspondant apparaît dans `/admin/jobs` (vue admin,
   `apps/web/src/app/(dashboard)/admin/jobs`).
5. **Vérifier le contenu généré** — une fois `status: completed`, ouvrir
   l'arborescence de leçons (`lesson-tree.tsx`), vérifier qu'au moins une
   leçon vidéo, un article et un quiz sont bien remplis (pas de placeholder
   `[GÉNÉRATION EN COURS]` résiduel). Vérifier aussi le panneau Ressources
   (`resources-panel.tsx`) et le score qualité (`quality-score-panel.tsx`).
6. **Connecter au moins une plateforme réelle** (hors mode mock) —
   `/dashboard/settings/platforms`, connecter par ex. YouTube (OAuth, pas de
   navigateur headless requis) pour un test qui ne dépend pas de Playwright.
   Si l'on veut tester Udemy/Teachable/Podia (adapters `needsBrowser: true`),
   prévoir que le worker ait accès à Playwright en environnement cible.
7. **Déployer sur 3 plateformes** — section « Déployer le cours »
   (`deploy-panel.tsx`), sélectionner 3 plateformes cibles parmi
   `udemy, youtube, teachable, thinkific, podia, gumroad, skillshare,
   moodle, internal` (catalogue : `apps/web/src/lib/deploy-catalog.ts`),
   choisir un mode (`auto` recommandé pour un premier test), lancer.
   Vérifier le toast « Déploiement lancé » puis, plateforme par plateforme,
   la progression jusqu'à « Déploiement terminé » (ou "... avec des échecs" —
   dans ce cas, ouvrir les logs dépliables de la ligne de déploiement en
   échec avant de conclure).
8. **Vérifier la publication réelle** — pour chaque plateforme déployée avec
   succès, ouvrir le lien externe généré (URL de cours Udemy/YouTube/etc.)
   et confirmer que le contenu est bien visible côté plateforme tierce, pas
   seulement `status: published` en base.
9. **Télécharger le pack** — `DownloadPackButton` (ZIP complet du cours) et
   `DownloadReportButton` (rapport PDF de déploiement) : vérifier que les
   deux téléchargements aboutissent et contiennent des fichiers non vides.
10. **Nettoyage** — si ce test est fait sur un environnement partagé,
    supprimer le cours de test et déconnecter les credentials de plateformes
    de test utilisées, pour ne pas polluer les métriques de lancement.

Si une étape échoue : consulter `docs/RUNBOOK.md` (incidents courants) avant
d'escalader.

## 4. Plan de lancement

### Product Hunt

- **Date cible** : un mardi ou mercredi (meilleur volume de vote historique
  sur PH), à éviter la semaine des grandes conférences tech US/EU pour ne pas
  être noyé.
- **Titre du post** : « SallyCourse — Turn one title into a full Udemy-ready
  course, auto-deployed » (variante courte : « AI course factory: title in,
  published course out »).
- **Tagline** : mettre en avant le différenciateur réel du produit — un seul
  titre + niveau suffit à générer vidéos, articles, TP et quiz, puis à
  déployer directement sur Udemy/YouTube/Teachable et 15+ plateformes sans
  ré-upload manuel.
- **Visuels** : captures d'écran réelles de `/dashboard/new` (moment
  signature titre → génération) et du panneau de déploiement multi-plateforme
  (`deploy-panel.tsx`) — pas de mockups, le produit existe et fonctionne.
  Prévoir une démo vidéo courte (60-90s) du flow bout-en-bout du §3.
- **Premier commentaire (maker comment)** : expliquer en 3-4 phrases le
  pourquoi (créateurs de contenu/formateurs qui perdent des heures sur le
  packaging plutôt que la pédagogie), le mode mock/démo si le lecteur veut
  tester sans carte bancaire, et un lien direct vers `/pricing`.
- **Créneau d'astreinte** : prévoir 1-2 personnes disponibles pendant les
  premières 6h (fenêtre US) pour répondre aux commentaires et surveiller
  `/admin/jobs` + `/api/health` en cas de pic de charge (voir §5, load test).
- **Offre de lancement** : envisager un code promo limité dans le temps
  (ex. -30% le premier mois plan `pro`) annoncé uniquement dans le post PH,
  pour mesurer la conversion spécifique au canal.

### Communautés DevOps / formateurs MENA

- **Canaux ciblés** :
  - Groupes Facebook/LinkedIn de formateurs indépendants MENA (Maroc,
    Tunisie, Algérie, Golfe) qui publient déjà sur Udemy en français/arabe.
  - Communautés DevOps francophones (Slack/Discord « DevOps Maroc »,
    « Tunisia DevOps », meetups Casablanca/Tunis/Rabat) — angle : générer
    rapidement un cours technique (Docker, Kubernetes, CI/CD) à partir d'un
    simple titre, avec déploiement automatisé vers Udemy en marque blanche.
  - r/Udemy, r/InstructionalDesign, r/onlinecourses sur Reddit — angle
    packaging/déploiement plutôt que génération IA brute (éviter le ton
    « remplace les formateurs », préférer « libère du temps de packaging »).
  - Newsletters françaises spécialisées formation en ligne / edtech.
- **Message adapté par canal** :
  - DevOps : mettre en avant les templates techniques déjà couverts par le
    moteur de niches (`niche-research.ts`) et la précision du contenu
    généré (TP avec captures d'écran réelles, `screenshot-gallery.tsx`).
  - Formateurs MENA : mettre en avant le support multilingue (locale `fr`
    par défaut, traduction de cours publiés via `translate-published.ts`) et
    le marquage blanc (branding d'école, `SchoolBranding` + `/verify`).
- **Rythme** : poster sur Product Hunt en premier (pic de trafic qualifié un
  seul jour), puis diffuser dans les communautés ciblées dans les 48h qui
  suivent en réutilisant les retours/preuves sociales du lancement PH
  (« Top 5 du jour sur Product Hunt » etc.) comme accroche.
- **Suivi** : instrumenter un paramètre UTM distinct par canal
  (`?utm_source=producthunt`, `?utm_source=devops-maroc`, etc.) sur les liens
  partagés, pour distinguer les canaux qui convertissent réellement en
  comptes créés (mesurable via `/admin/users` et `CourseAnalytics`).

## 5. Test de charge

Voir [`scripts/load-test.k6.js`](../scripts/load-test.k6.js) — 50 générations
simultanées sur `POST /api/courses`, mesure P95. **Forcer `MOCK_PROVIDERS=true`
côté worker et web avant d'exécuter ce test** (sinon chaque génération
déclenche de vrais appels Claude/ElevenLabs/OpenAI facturés). Instructions
d'installation de k6 et de lancement dans l'en-tête du script.

- [ ] Lancer le test de charge sur un environnement de staging (pas en prod)
      avec `MOCK_PROVIDERS=true` des deux côtés (web ET worker — le web valide
      la requête et enqueue, le worker traite réellement le job).
- [ ] Noter le P95 obtenu et le comparer à un budget cible raisonnable pour
      une route qui ne fait qu'enqueue (quelques centaines de ms, pas
      plusieurs secondes — la génération elle-même est asynchrone côté
      worker, cf. §3 étape 4).
- [ ] Si le P95 est dégradé, vérifier en premier lieu Mongo (index sur
      `Course.userId`) et Redis (latence BullMQ), avant de suspecter le code
      applicatif.
