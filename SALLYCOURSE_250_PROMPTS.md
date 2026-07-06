# SallyCourse — 250 Prompts de Développement Ordonnés
## SaaS de Génération Automatique de Cours Udemy (Titre + Niveau → Cours Complet)

**Stack :** Next.js 15 (App Router) · MongoDB · Docker/Docker Compose · BullMQ + Redis · Claude API · ElevenLabs TTS · FFmpeg · Playwright · Whisper
**Entrée :** Titre du cours + Niveau de difficulté (Débutant / Intermédiaire / Avancé)
**Sortie :** Vidéos ordonnées + Articles + TPs avec captures d'écran + Quiz avec solutions
**Branding :** SALISTAR (violet #5B2A86, or #D4A017) · Support AR/FR/EN + RTL

---

## PHASE 0 — Design Premium : Interface SaaS ET Rendus Générés (Prompts D1–D12)

> Cette phase se fait EN PREMIER : le design system produit ici est consommé par tous les prompts suivants (l'UI du SaaS ET les templates de slides/vidéos/PDF/certificats générés). Aucune couleur ni police ne sera décidée ailleurs.

**Prompt D1 — Design system fondation (tokens)**
Crée le design system SallyCourse complet dans `packages/design` : tokens exportés en 3 formats (Tailwind config, CSS variables, JSON pour les templates de rendu). Palette premium SALISTAR : violet profond #5B2A86 (primaire), or #D4A017 (accent, usage parcimonieux — CTA et détails seulement), avec échelles complètes 50→950 générées, neutres chauds (pas de gris froids), sémantiques (success/warning/danger/info) harmonisés à la palette. Typographie : une display serif élégante pour les titres (ex. Fraunces ou Playfair adaptée), une sans géométrique lisible pour le corps (ex. Inter/Figtree), et une police arabe premium assortie (ex. IBM Plex Sans Arabic ou Cairo) avec règles de fallback et d'appariement FR/AR. Échelle typographique modulaire (1.25), espacements 4px-grid, rayons (8/12/16), ombres subtiles à teinte violette (jamais de noir pur), durées/courbes d'animation standardisées. Documente chaque token avec son usage.

**Prompt D2 — Direction artistique & moodboard codé**
Produis une page `/design` interne (styleguide vivant) qui matérialise la direction artistique : ambiance « studio de production haut de gamme » — fonds sombres profonds (#0D0714 teinté violet, jamais #000), verre dépoli discret sur les surfaces élevées, dégradés violet→or utilisés UNIQUEMENT en fins liserés et halos (jamais en fond pleine page), grain photographique très léger en option, iconographie fine (Lucide, stroke 1.5), illustrations abstraites géométriques générées en SVG (formes de « flux » évoquant la transformation prompt→cours). Chaque composant y est montré en light/dark/RTL.

**Prompt D3 — Bibliothèque de composants premium**
Construis la bibliothèque UI sur shadcn/ui fortement personnalisée (pas l'apparence par défaut) : boutons avec états micro-animés (scale 0.98 au press, halo or au focus), cards avec élévation au survol et bordure dégradée 1px, inputs avec labels flottants, selects/combobox stylés, toasts, modals avec backdrop blur, skeletons shimmer violets, badges de statut (generating = pulse animé, ready = or), progress bars avec dégradé animé, tabs soulignées animées (layoutId Framer Motion), empty states illustrés. Storybook ou page de démo pour chaque composant, props typées, dark mode et RTL natifs.

**Prompt D4 — Micro-interactions & motion design**
Ajoute Framer Motion avec un système de motion cohérent : page transitions douces (fade+slide 200ms), stagger sur les listes de cours, la timeline de génération qui « se remplit » organiquement étape par étape, confettis discrets or/violet à la fin d'une génération réussie, nombre animés (count-up) sur les stats, hover 3D subtil (tilt 2°) sur les cartes de cours, `prefers-reduced-motion` respecté partout. Aucune animation gratuite : chaque mouvement communique un état.

**Prompt D5 — Dashboard « mission control » premium**
Redesigne le dashboard comme un centre de contrôle de studio : header avec salutation contextuelle et stats clés en compteurs animés, grille de cours en cards riches (miniature du cours générée, anneau de progression, badges plateformes avec logos, menu contextuel), timeline de génération en direct spectaculaire (visualisation des étapes avec l'étape active qui pulse, logs qui défilent dans un terminal stylé, aperçu de la slide en cours de rendu en temps réel), vue vide (premier cours) avec une illustration animée et un CTA impossible à rater.

**Prompt D6 — Formulaire de création « expérience produit »**
Le formulaire titre+niveau devient un moment signature : plein écran épuré, champ titre en très grande typographie (l'utilisateur « écrit le titre de son cours » comme sur une couverture), suggestions de titres qui apparaissent en dessous pendant la frappe, sélecteur de niveau en 3 grandes cartes illustrées avec descriptions, transition cinématique vers l'écran de génération (le titre se transforme en en-tête de la timeline). Options avancées dans un panneau latéral discret.

**Prompt D7 — Templates de slides vidéo premium (les rendus générés)**
Conçois 8 templates de slides 1920×1080 de qualité studio dans `packages/design/render-templates` (HTML/CSS rendus par Playwright) : Titre de leçon (grande serif, numéro de leçon en or, motif géométrique de fond), Contenu (hiérarchie typographique nette, bullets custom en losanges or, max 5 points), Code (fenêtre macOS-like, Shiki thème custom violet, numéros de ligne, badge du langage), Comparaison (2 colonnes), Citation/À retenir (encadré liseré or), Schéma (zone Mermaid stylée aux couleurs du DS), Récap (checklist animée), Transition de section (plein violet, respiration). Chaque template : version FR/EN et version AR RTL avec la police arabe, footer discret (titre du cours + progression), espace négatif généreux — le rendu doit ressembler à un cours Apple/Stripe, pas à du PowerPoint.

**Prompt D8 — Habillage vidéo motion**
Ajoute la couche motion aux rendus vidéo (via templates HTML animés capturés en séquence ou filtres FFmpeg) : intro de leçon 3s (logo du cours qui se dessine, titre en cascade), lower-thirds pour les définitions importantes, transitions entre slides variées mais sobres (fade, slide, zoom léger — jamais de spirales), surlignage progressif des bullets synchronisé avec la narration (le point dont on parle s'illumine), outro avec carte « leçon suivante ». Le résultat doit être indistinguable d'un motion designer junior.

**Prompt D9 — Design des captures d'écran annotées**
Standardise l'annotation des captures TP pour un rendu éditorial : cadre avec ombre portée douce et coins arrondis sur fond subtil, flèches courbes élégantes (pas de flèches Paint rouges), numéros d'étape en pastilles violettes, zones importantes en surbrillance or translucide, légende typographiée sous la capture, zoom-inset (loupe) pour les petits détails d'interface. Bibliothèque d'annotation réutilisable (sharp/SVG overlay) avec les tokens du DS.

**Prompt D10 — Documents PDF premium**
Templates WeasyPrint haut de gamme pour tous les PDF générés : page de couverture du cours (grande serif, motif géométrique, or en détail), workbook TP (en-têtes de section, encadrés d'étapes, espaces de réponse lignés élégants), quiz+solutions (solutions dans une section séparée avec onglet visuel), cheat sheet (grille dense mais aérée, hiérarchie couleur), certificat de complétion (format paysage, bordure guillochée fine, sceau SALISTAR, QR discret, calligraphie du nom). Pagination, en-têtes/pieds de page, support AR RTL complet.

**Prompt D11 — Miniatures & assets marketing générés**
Templates automatiques de qualité pro : image de cours Udemy 750×422 (titre en grande typo sur composition géométrique violette, variation de motif par catégorie de sujet, jamais deux cours identiques grâce à un seed), miniature YouTube 1280×720 (contraste fort, 4 mots max), bannières réseaux sociaux (1200×630 OG, formats stories), tous générés depuis le titre avec équilibrage automatique de la taille du texte (algorithme de fit) et vérification de contraste.

**Prompt D12 — Audit design & cohérence continue**
Mets en place le garde-fou : tests de régression visuelle (Playwright screenshots + comparaison pixel sur le styleguide et 1 exemple de chaque template de rendu), règle ESLint interdisant les classes Tailwind de couleur arbitraire (`bg-[#...]` banni — tokens uniquement), checklist design dans le template de PR (dark mode, RTL, mobile, reduced-motion, contraste AA), et une revue Claude en CI qui compare chaque nouvel écran au styleguide et signale les écarts.

---

## PHASE 1 — Fondations & Infrastructure (Prompts 1–12)

**Prompt 1 — Initialisation du monorepo**
Crée un monorepo pnpm avec la structure suivante : `apps/web` (Next.js 15 App Router + TypeScript + Tailwind), `apps/worker` (Node.js worker BullMQ pour la génération), `packages/shared` (types TypeScript partagés, schémas Zod), `packages/db` (modèles Mongoose). Configure tsconfig paths, ESLint, Prettier. Ajoute un README avec l'architecture.

**Prompt 2 — Docker Compose complet**
Crée le `docker-compose.yml` de développement avec les services : `web` (Next.js, port 3000), `worker` (générateur), `mongo` (MongoDB 7 avec volume persistant + healthcheck), `redis` (BullMQ), `minio` (stockage S3-compatible pour vidéos/images, ports 9000/9001). Ajoute `docker-compose.prod.yml` avec restart policies, limites mémoire, et un réseau interne. Le worker doit avoir FFmpeg, Chromium (Playwright) et Python/Whisper installés dans son image — écris le Dockerfile multi-stage correspondant.

**Prompt 3 — Modèles MongoDB**
Crée les schémas Mongoose dans `packages/db` : `User` (email, hash, plan, quota, locale), `Course` (title, difficulty, status: draft|generating|ready|published, outline, targetPlatforms[], langue), `Section` (courseId, order, title), `Lesson` (sectionId, order, type: video|article|tp|quiz, status, assets{videoUrl, articleMd, screenshots[], srtUrl}), `Quiz` (lessonId, questions[{question, choices[], correctIndex, explanation}]), `GenerationJob` (courseId, step, progress, logs[], error), `Deployment` (courseId, platform, status, externalUrl, logs). Ajoute les index nécessaires (courseId+order, userId+createdAt).

**Prompt 4 — Authentification**
Implémente l'auth avec Auth.js (NextAuth v5) : credentials + Google OAuth. Sessions JWT, middleware de protection des routes `/dashboard/*` et `/api/*`. Page login/register avec le design SALISTAR (violet #5B2A86, or #D4A017). Rôles : user, admin.

**Prompt 5 — Configuration & secrets**
Crée un module de config centralisé avec validation Zod des variables d'environnement : `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `MONGO_URI`, `REDIS_URL`, `S3_*`, `UDEMY_EMAIL/PASSWORD` (chiffrés), clés des autres plateformes. Fichier `.env.example` complet. Les credentials de plateformes des utilisateurs sont chiffrés en base avec AES-256-GCM (clé maître en env).

**Prompt 6 — File de jobs BullMQ**
Configure BullMQ avec les queues : `outline-generation`, `content-generation`, `tts-generation`, `screenshot-capture`, `video-render`, `subtitle-generation`, `packaging`, `deployment`. Chaque queue a retry (3 tentatives, backoff exponentiel), concurrence configurable, et publie sa progression dans un canal Redis pub/sub que le front écoute via SSE.

**Prompt 7 — API de progression temps réel**
Crée la route Next.js `/api/courses/[id]/progress` en Server-Sent Events qui relaie la progression Redis (étape courante, % global, logs). Côté front, un hook `useCourseProgress(courseId)` avec reconnexion automatique.

**Prompt 8 — Stockage S3/MinIO**
Module `packages/shared/storage` : upload/download vers MinIO avec URLs pré-signées, organisation `courses/{courseId}/sections/{n}/lessons/{n}/{video.mp4, article.md, screenshots/, captions.srt, quiz.json}`. Nettoyage automatique des cours supprimés.

**Prompt 9 — Dashboard principal**
Page `/dashboard` : liste des cours de l'utilisateur en cartes (titre, statut avec badge coloré, progression, plateformes déployées avec icônes, date). Bouton « Nouveau cours ». Filtres par statut. Design SALISTAR, dark mode, responsive, RTL-ready.

**Prompt 10 — Formulaire de création (l'entrée unique)**
Page `/dashboard/new` : formulaire minimaliste avec seulement **Titre du cours** et **Niveau** (Débutant/Intermédiaire/Avancé, sélecteur visuel à 3 cartes). Options avancées repliées : langue (FR/EN/AR), voix TTS, plateformes cibles (checkboxes Udemy, Teachable, YouTube…), nombre approximatif de sections. Validation Zod, soumission → création du Course en `generating` + enqueue du job outline.

**Prompt 11 — Page détail du cours**
Page `/dashboard/courses/[id]` : arborescence sections → leçons avec statut par leçon, player vidéo intégré, prévisualisation des articles (Markdown rendu), galerie des captures, quiz interactif de prévisualisation. Boutons : régénérer une leçon, éditer, télécharger le pack, déployer.

**Prompt 12 — Health & observabilité**
Endpoints `/api/health` (Mongo, Redis, MinIO, worker heartbeat). Logging structuré avec pino (web + worker), corrélation par jobId. Page admin `/admin/jobs` listant les jobs en cours/échoués avec bouton retry.

---

## PHASE 2 — Moteur de Génération : Plan & Contenu (Prompts 13–30)

**Prompt 13 — Générateur de plan (outline)**
Worker `outline-generation` : appelle Claude avec un prompt système qui, à partir de {titre, niveau, langue}, retourne un JSON strict : `{title, subtitle, description, learningObjectives[4-6], prerequisites[], targetAudience[], sections[{title, lessons[{title, type: video|article|tp|quiz, durationMin, summary}]}]}`. Règles imposées dans le prompt : minimum 5 sections, minimum 30 min de vidéo totale (exigence Udemy), alternance vidéo/article/TP, un quiz par section, progression pédagogique adaptée au niveau. Validation Zod de la sortie, retry avec message d'erreur si JSON invalide. Sauvegarde en base (Course.outline + création des Sections/Lessons).

**Prompt 14 — Écran de validation du plan**
Après génération du plan, statut `outline-review` : l'utilisateur voit le plan en éditeur drag-and-drop (réordonner sections/leçons, renommer, ajouter/supprimer, changer le type). Bouton « Valider et générer le contenu » qui enqueue la suite. Option « Régénérer le plan » avec instructions supplémentaires.

**Prompt 15 — Générateur de scripts vidéo**
Worker `content-generation` (type video) : pour chaque leçon vidéo, génère via Claude un script de narration structuré en JSON : `{slides: [{title, bullets[], narration, notes}]}`. Contraintes : narration ~140 mots/min pour tenir la durée cible, ton instructeur naturel (pas de « dans cette vidéo nous allons »), exemples concrets, transitions fluides, adapté au niveau. Le script référence les slides une à une pour la synchronisation.

**Prompt 16 — Générateur d'articles**
Pour chaque leçon de type article : génère un article Markdown complet (800–1500 mots) avec titres H2/H3, blocs de code si technique, encadrés « À retenir », images placeholder référencées `{{screenshot:description}}` qui seront remplacées par de vraies captures. Ton pédagogique, adapté au niveau.

**Prompt 17 — Générateur de TPs (travaux pratiques)**
Pour chaque leçon TP : génère un document structuré JSON : `{objective, environment[], steps[{instruction, command?, expectedResult, screenshotSpec{url?, actions[], caption}}], validation[], troubleshooting[]}`. Chaque étape qui se passe sur ordinateur inclut une `screenshotSpec` décrivant exactement quoi capturer (URL à ouvrir, actions à faire, élément à cadrer) — c'est le contrat pour le module de capture automatique.

**Prompt 18 — Générateur de quiz avec solutions**
Pour chaque section : génère 8–12 questions QCM en JSON : `{question, choices[4], correctIndex, explanation, difficulty}`. Mix de niveaux, distracteurs plausibles, explication détaillée de la bonne réponse ET pourquoi les autres sont fausses. Export double : format interactif (base) + document « Quiz + Solutions » en Markdown pour les ressources téléchargeables.

**Prompt 19 — Cohérence inter-leçons**
Ajoute au générateur de contenu un contexte de continuité : chaque appel Claude reçoit le résumé des leçons précédentes (générés et stockés) pour éviter les répétitions et assurer les rappels (« comme vu dans la leçon précédente »). Implémente un résumé automatique de chaque leçon après génération.

**Prompt 20 — Génération des slides visuelles**
Convertis les slides JSON en images 1920×1080 : template HTML/CSS SALISTAR (fond sombre élégant, violet/or, numéro de leçon, barre de progression) rendu avec Playwright → PNG. Un template par type de slide : titre, contenu bullets, code (avec coloration syntaxique Shiki), citation, récap. Gère l'arabe RTL.

**Prompt 21 — Module de capture d'écran automatique (le cœur des TPs)**
Worker `screenshot-capture` : lit chaque `screenshotSpec` et exécute avec Playwright : ouvre l'URL (ou un environnement local dockerisé), exécute les actions (click, fill, scroll), attend la stabilité, capture en 1920×1080 ou l'élément ciblé. Annote automatiquement avec sharp : flèches rouges, encadrés, numéros d'étape, légende en bas. Stocke dans MinIO et remplace les placeholders dans articles/TPs.

**Prompt 22 — Environnements TP dockerisés**
Pour les TPs techniques (terminal, VS Code, app web), crée des conteneurs éphémères de démonstration : image `code-server` pour les captures VS Code, `ttyd` pour les captures terminal (exécute les vraies commandes du TP et capture la sortie), navigateur pour les apps web. Le worker lance le conteneur, joue le scénario, capture, détruit.

**Prompt 23 — TTS multilingue**
Worker `tts-generation` : envoie chaque narration à ElevenLabs (voix configurable par cours, modèle multilingue pour AR/FR/EN). Découpe par slide pour obtenir les timestamps de synchronisation. Fallback OpenAI TTS si quota ElevenLabs dépassé. Normalisation audio (loudnorm FFmpeg, -16 LUFS — standard Udemy). Cache par hash du texte pour ne pas régénérer à l'identique.

**Prompt 24 — Rendu vidéo FFmpeg**
Worker `video-render` : assemble slides PNG + audio par slide en MP4 H.264 1080p (concat demuxer, chaque slide affichée pendant la durée de son audio + crossfade 0.4s). Intro de 3s avec le titre de la leçon animé (template), outro avec récap. Sortie : `video.mp4` conforme Udemy (1080p, AAC, débit correct). Vérification automatique ffprobe (durée, résolution, audio présent).

**Prompt 25 — Sous-titres Whisper**
Worker `subtitle-generation` : transcrit chaque vidéo avec faster-whisper → `.srt` + `.vtt`. Pour l'arabe/français, force la langue. Corrige avec le script original comme référence (alignement). Stocke à côté de la vidéo.

**Prompt 26 — Contrôle qualité automatique**
Après génération complète, un job QA vérifie : durée vidéo totale ≥ 30 min, ≥ 5 sections, chaque vidéo lisible (ffprobe), audio non silencieux, tous les placeholders de captures remplacés, quiz valides (1 seule bonne réponse), pas de leçon vide. Génère un rapport QA stocké sur le cours ; bloque la publication si échec avec liste des problèmes.

**Prompt 27 — Conformité Udemy (checklist automatisée)**
Implémente un module `udemy-compliance` qui vérifie les règles de review Udemy : titre ≤ 60 caractères sans mots interdits (« gratuit », majuscules abusives), sous-titre ≤ 120, description ≥ 200 mots, objectifs d'apprentissage 4+, audio clair, pas de contenu promotionnel dans les leçons, image de cours 750×422. Score de conformité affiché avant déploiement avec corrections suggérées auto-applicables.

**Prompt 28 — Landing page marketing du cours**
Génère via Claude : description Udemy optimisée SEO, message de bienvenue, message de félicitations, texte promotionnel, 5 idées de titres alternatifs avec scores. Génère l'image de cours 750×422 (template HTML SALISTAR → PNG) et la miniature YouTube 1280×720.

**Prompt 29 — Éditeur de contenu**
Permets l'édition manuelle post-génération : éditeur Markdown pour articles (avec preview), éditeur de script par slide pour les vidéos (bouton « régénérer cette vidéo » qui relance TTS + rendu uniquement pour la leçon), éditeur de quiz. Chaque édition invalide et re-régénère uniquement les assets concernés.

**Prompt 30 — Packaging export**
Job `packaging` : construit un ZIP structuré prêt pour upload manuel : `/01-section-name/01-lesson-name.mp4`, `.srt`, articles en `.html` et `.pdf` (WeasyPrint), quiz en CSV format Udemy bulk + PDF solutions, dossier `marketing/` (description, image). Bouton téléchargement sur la page cours.

---

## PHASE 3 — Déploiement Automatique Multi-Plateformes (Prompts 31–52)

**Prompt 31 — Architecture du module de déploiement**
Crée l'abstraction `DeploymentAdapter` (interface : `authenticate()`, `createCourse()`, `uploadLesson()`, `setLandingPage()`, `submitForReview()`, `getStatus()`) dans `apps/worker/deploy/`. Chaque plateforme = un adapter. Queue `deployment` avec un job par (courseId, platform), statuts granulaires dans la collection `Deployment`, reprise sur échec au milieu d'un upload (checkpoint par leçon).

**Prompt 32 — Gestionnaire de credentials plateformes**
Page `/dashboard/settings/platforms` : l'utilisateur connecte ses comptes (email/mot de passe chiffrés AES-256-GCM pour les plateformes sans API, clés API/OAuth pour les autres). Test de connexion par plateforme avec feedback. Jamais de credentials en clair dans les logs.

**Prompt 33 — Adapter Udemy (Playwright) — connexion**
Udemy n'a pas d'API de création de cours : implémente l'adapter en automation Playwright. Module de connexion : login avec gestion du captcha (pause + notification à l'utilisateur pour résolution manuelle via session VNC/screenshot interactif), persistance du storageState chiffré pour réutiliser la session, détection de session expirée. Ajoute un avertissement clair dans l'UI que l'automation du compte Udemy est à l'utilisateur d'assumer (CGU).

**Prompt 34 — Adapter Udemy — création du cours**
Automatise le flow « Create Course » : type Course, titre, catégorie (mapping automatique depuis le sujet via Claude), objectifs du curriculum. Sélecteurs robustes (data-purpose attributes d'Udemy), attentes explicites, screenshots de debug à chaque étape stockés dans les logs du Deployment.

**Prompt 35 — Adapter Udemy — curriculum et upload vidéos**
Automatise la création des sections et leçons dans le course builder, l'upload de chaque MP4 (input file + attente du processing Udemy avec polling), l'upload des `.srt`, l'ajout des articles (éditeur riche : injection du HTML converti), et les ressources téléchargeables (PDF TPs/solutions). Checkpoint après chaque leçon pour reprise.

**Prompt 36 — Adapter Udemy — quiz et landing page**
Automatise la création des quiz (questions/choix/bonne réponse/explication) dans le builder, le remplissage de la landing page (description, objectifs, prérequis, audience, image de cours 750×422), le pricing, et le bouton « Submit for Review ». Récupère l'URL du cours et le statut de review, mis à jour par un job de polling quotidien.

**Prompt 37 — Adapter YouTube (API officielle)**
Via YouTube Data API v3 (OAuth) : crée une playlist par cours, uploade chaque vidéo (titre = numéro + titre leçon, description générée avec chapitres, tags), sous-titres via captions API, miniature générée, visibilité configurable (public/non répertorié — utile pour cours gratuits en lead magnet). Gestion du quota API (10 000 unités/jour → étalement des uploads).

**Prompt 38 — Adapter Teachable (API)**
Via l'API Teachable : création du cours, sections, leçons avec vidéos (upload), texte des articles, quiz. Mapping des statuts, publication automatique. Fallback Playwright pour les fonctionnalités absentes de l'API.

**Prompt 39 — Adapter Thinkific (API)**
Idem avec l'API Thinkific : cours, chapitres, contenus vidéo/texte/quiz, page de vente avec la description générée, prix.

**Prompt 40 — Adapter Podia & Gumroad**
Podia (Playwright, pas d'API complète) : produit cours, sections, upload. Gumroad (API) : produit digital avec le ZIP packagé + vidéos en contenu, description, prix. Idéal pour vendre le cours en direct sans review.

**Prompt 41 — Adapter Skillshare**
Automation Playwright : création de classe, upload des vidéos (Skillshare = format vidéo uniquement, les articles sont convertis en vidéos « lecture » simples ou joints en ressources), description de classe, projet de classe généré depuis le TP principal.

**Prompt 42 — Export SCORM / Moodle**
Génère un paquet SCORM 1.2/2004 (manifest imsmanifest.xml, leçons HTML avec player vidéo, quiz SCORM avec tracking du score) pour import direct dans Moodle, ou n'importe quel LMS d'entreprise. Bonus : adapter Moodle direct via ses Web Services API (création de cours + sections + ressources) pour les instances self-hosted.

**Prompt 43 — Adapter LMS SallyCourse (self-hosted)**
Déploiement vers ta propre plateforme : module `platform-lms` dans le même monorepo — pages publiques de catalogue, page cours avec player, inscription/paiement CMI Maroc, progression des étudiants, certificats PDF de complétion. Ton propre Udemy sans review.

**Prompt 44 — Orchestrateur multi-déploiement**
UI « Déployer » : sélection multi-plateformes avec estimation de durée, lancement en parallèle (limité à 2 simultanés), tableau de bord de déploiement temps réel (une ligne par plateforme : étape courante, leçon X/Y, logs dépliables, bouton retry par plateforme). Notification email + in-app à la fin.

**Prompt 45 — Adaptation du contenu par plateforme**
Chaque plateforme a ses contraintes : module de transformation qui adapte automatiquement (YouTube : concatène les leçons courtes en vidéos de 10 min+ avec chapitres ; Skillshare : tout en vidéo ; Gumroad : tout en ZIP ; Udemy : tel quel). Descriptions reformulées par plateforme via Claude (ton YouTube ≠ ton Udemy).

**Prompt 46 — Gestion des mises à jour**
Quand une leçon est régénérée après édition, propose la mise à jour ciblée sur les plateformes déjà déployées (re-upload de la seule vidéo modifiée via l'adapter). Historique des versions par leçon.

**Prompt 47 — File d'attente review & alerting**
Job cron quotidien : vérifie le statut de review Udemy (et autres), notifie l'utilisateur (approuvé 🎉 / rejeté avec les raisons scrapées), et en cas de rejet, envoie les raisons à Claude pour générer un plan de correction automatique appliqué au cours.

**Prompt 48 — Mode "compliance maximale" Udemy**
Option qui applique automatiquement toutes les bonnes pratiques anti-rejet : ajoute une vidéo d'introduction avec présentation de l'instructeur (slot pour uploader une vraie vidéo webcam de 60s — fortement recommandé car les cours 100% synthétiques sont scrutés), vérifie l'absence de liens externes/promo dans les leçons, watermark discret, audio -16 LUFS, pas de slides texte-seul de plus de 45s consécutives (insère des captures/schémas).

**Prompt 49 — Multi-comptes & espaces**
Support de plusieurs comptes par plateforme et par utilisateur (ex : un compte Udemy FR, un compte EN), sélection du compte au déploiement, isolation des sessions Playwright par compte.

**Prompt 50 — Rapports de déploiement**
Génère un rapport PDF par déploiement (plateformes, URLs publiées, durées, statuts review, checklist conformité) avec branding SALISTAR, archivé sur le cours.

**Prompt 51 — Webhooks & API publique**
Expose une API REST (clé API par utilisateur) : `POST /api/v1/courses` (titre + niveau + plateformes) → génération + déploiement complet en un appel, webhooks sur les événements (outline_ready, generation_complete, deployed, review_approved). Documentation OpenAPI/Swagger.

**Prompt 52 — CLI**
Crée un CLI `sallycourse` (npm) : `sallycourse create "Docker pour DevOps" --level intermediate --deploy udemy,youtube --lang fr` qui pilote l'API publique. Pratique pour générer des cours en batch.

---

## PHASE 4 — SaaS : Monétisation, Admin, i18n (Prompts 53–68)

**Prompt 53 — Plans & quotas**
Modèle d'abonnement : Free (1 cours, watermark), Pro (10 cours/mois, toutes plateformes), Business (illimité, API, multi-comptes). Middleware de quota sur la création et le déploiement. Page pricing.

**Prompt 54 — Paiement CMI Maroc + fallback international**
Intègre CMI pour le Maroc (redirection 3D Secure, callback de confirmation, gestion des échecs) et Paddle/Lemon Squeezy pour l'international. Webhooks → activation du plan. Factures PDF automatiques.

**Prompt 55 — Suivi des coûts de génération**
Tracke le coût réel par cours : tokens Claude (input/output par appel), caractères ElevenLabs, minutes de rendu. Dashboard admin des marges par plan, alerte si un cours dépasse un seuil de coût.

**Prompt 56 — i18n complète**
next-intl avec AR (RTL complet), FR, EN sur toute l'interface. Le contenu généré suit la langue choisie par cours indépendamment de la langue de l'UI.

**Prompt 57 — Admin panel**
`/admin` : liste utilisateurs (plan, usage, coûts), tous les cours, jobs échoués avec retry en masse, gestion des templates de slides, bannissement, statistiques globales (cours générés/jour, taux d'approbation Udemy, plateforme la plus utilisée).

**Prompt 58 — Onboarding & templates de cours**
Wizard de premier cours avec exemples de titres qui marchent bien par catégorie. Bibliothèque de templates de niche (DevOps, bureautique, langues, business) qui pré-configurent la structure du plan.

**Prompt 59 — Notifications**
Système complet : in-app (cloche + liste), email (Resend, templates React Email SALISTAR) pour : génération terminée, déploiement terminé, review approuvée/rejetée, quota atteint.

**Prompt 60 — Prévisualisation étudiante**
Mode « aperçu étudiant » : parcours du cours comme un étudiant Udemy le verrait (player, articles, quiz interactifs avec score et solutions révélées après soumission).

**Prompt 61 — Analytics des cours publiés**
Pour Udemy (Instructor API officielle en lecture) et YouTube (Analytics API) : récupère inscriptions, notes, revenus, vues, et affiche un dashboard consolidé multi-plateformes par cours.

**Prompt 62 — Feedback loop qualité**
Récupère les reviews Udemy (Instructor API), les envoie à Claude pour analyse thématique, et propose des améliorations ciblées du cours (« 3 étudiants trouvent la section 4 trop rapide → régénérer avec plus de détails »).

**Prompt 63 — Génération en batch**
Interface pour lancer N cours d'un coup depuis un CSV (titre, niveau, langue, plateformes), avec ordonnancement intelligent (limite les jobs vidéo concurrents), suivi groupé.

**Prompt 64 — Duplication & déclinaison**
Bouton « décliner ce cours » : même cours régénéré dans une autre langue (traduction + nouveau TTS + slides re-rendues) ou à un autre niveau de difficulté, en réutilisant le plan.

**Prompt 65 — Ressources téléchargeables enrichies**
Génère automatiquement par cours : cheat sheet PDF (1 page récap), workbook des TPs avec espaces de réponse, glossaire, liste de ressources pour aller plus loin. Attachés comme ressources dans les adapters.

**Prompt 66 — RGPD & légal**
Pages CGU/CGV/confidentialité, suppression de compte avec purge des données et médias, export des données utilisateur, mentions sur le contenu généré par IA (Udemy exige la transparence sur l'usage d'IA — case à cocher automatique dans le flow de publication).

**Prompt 67 — Tests**
Suite de tests : unitaires (générateurs, validation Zod, compliance checker) avec Vitest, intégration API avec supertest + mongodb-memory-server, E2E du flow complet avec Playwright (mock des APIs externes), test de rendu vidéo sur une mini-leçon en CI.

**Prompt 68 — CI/CD**
GitHub Actions : lint + tests + build des images Docker + push registry + déploiement sur Hetzner (docker compose pull/up via SSH), avec environnement staging. Healthcheck post-déploiement et rollback automatique.

---

## PHASE 5 — Robustesse & Scale (Prompts 69–80)

**Prompt 69 — Reprise sur erreur granulaire**
Chaque étape de génération est idempotente et checkpointée : si le worker crashe au rendu de la leçon 12/40, la reprise repart de la leçon 12. Implémente les checkpoints en base et les tests de reprise.

**Prompt 70 — Rate limiting & anti-abus**
Rate limiting par IP et par utilisateur (upstash-style avec Redis), détection de contenus interdits dans les titres (modération Claude avant génération : pas de contenu médical dangereux, haineux, contrefaçon de marques), blocage des sujets protégés par copyright (« Cours complet Photoshop CC » → avertissement marques).

**Prompt 71 — Scaling des workers**
Sépare les workers par type de charge : `worker-cpu` (FFmpeg, réplicable), `worker-api` (Claude/TTS, limité par les rate limits), `worker-browser` (Playwright, 1 session par compte). Docker Compose scale + variables de concurrence. Documente le passage à k3s.

**Prompt 72 — Cache intelligent**
Cache par hash de prompt pour les appels Claude (mêmes leçons re-demandées), cache TTS par hash de texte+voix, réutilisation des captures identiques entre cours. Économie estimée affichée en admin.

**Prompt 73 — Files prioritaires**
Priorité des jobs par plan (Business > Pro > Free), estimation du temps d'attente affichée à l'utilisateur, possibilité d'annuler un job en cours proprement (kill FFmpeg, cleanup).

**Prompt 74 — Backups**
Backup automatique quotidien : mongodump vers stockage externe (Hetzner Storage Box), rétention 30 jours, script de restauration testé, backup MinIO incrémental avec rclone.

**Prompt 75 — Monitoring production**
Uptime Kuma ou Grafana+Prometheus : métriques (jobs/heure, durée moyenne de génération, taux d'échec par étape, coût/cours), alertes Telegram/email sur échec répété ou queue bloquée.

**Prompt 76 — Sécurité**
Audit : headers de sécurité Next.js, CSRF, sanitization du Markdown rendu (XSS), scan des dépendances (npm audit en CI), secrets jamais loggés, isolation réseau des conteneurs TP éphémères (pas d'accès au réseau interne).

**Prompt 77 — Mode dégradé**
Si ElevenLabs down → bascule OpenAI TTS avec notification. Si Claude rate-limité → file d'attente avec backoff. Si une plateforme de déploiement échoue → les autres continuent. Circuit breakers avec états visibles en admin.

**Prompt 78 — Optimisation vidéo**
Preset FFmpeg optimisé (x264 veryfast CRF 21 pour le draft, slow CRF 19 pour le final), rendu 2 passes optionnel, parallélisation par leçon, GPU optionnel (NVENC) si disponible, estimation de durée de rendu avant lancement.

**Prompt 79 — Stockage des coûts médias**
Politique de rétention : les assets intermédiaires (PNG slides, audio par slide) supprimés après rendu final réussi, vidéos finales conservées, archivage à froid des cours inactifs 90 jours (avec régénération possible depuis les sources JSON).

**Prompt 80 — Documentation technique**
Génère la documentation complète du projet : README architecture avec diagrammes Mermaid, guide de déploiement Hetzner pas à pas, guide d'ajout d'un nouvel adapter de plateforme, runbook des incidents courants.

---

## PHASE 6 — Différenciateurs & Croissance (Prompts 81–100)

**Prompt 81 — Voix clonée de l'instructeur**
Intégration ElevenLabs Voice Cloning : l'utilisateur uploade 2 min de sa voix, tous ses cours utilisent sa voix clonée (consentement explicite requis, watermark de traçabilité). Différenciateur majeur pour passer les reviews et humaniser.

**Prompt 82 — Avatar vidéo optionnel**
Intégration HeyGen/D-ID API en option : génère des segments « talking head » pour l'intro et la conclusion de chaque section, incrustés dans les vidéos. Fortement recommandé pour Udemy.

**Prompt 83 — Slides enrichies par type de contenu**
Détection automatique du type de contenu par slide et templates adaptés : diagrammes Mermaid rendus pour les architectures, tableaux comparatifs, timelines, code avec exécution simulée ligne par ligne (animations de highlight).

**Prompt 84 — TP interactifs web**
Pour les cours de code : génère en plus des sandboxes StackBlitz/CodeSandbox pré-configurées liées dans les ressources, avec le code de départ et la solution dans deux projets distincts.

**Prompt 85 — Démo screencasts réels**
Extension du module de capture : enregistre des screencasts vidéo (pas seulement des captures) des TPs joués par Playwright (screen recording du navigateur/terminal), avec zoom automatique sur les zones d'action et narration TTS synchronisée. Les leçons TP deviennent de vraies vidéos de démonstration.

**Prompt 86 — Recherche de niche intégrée**
Outil « Trouver un sujet » : analyse les catégories Udemy (scraping des résultats de recherche : nombre de cours, notes moyennes, prix), croise avec les tendances, et suggère des titres de cours à fort potentiel avec score demande/concurrence.

**Prompt 87 — A/B testing des landing pages**
Génère 3 variantes de titre/sous-titre/description, permet de les faire tourner (mise à jour périodique via l'adapter) et compare les taux de conversion depuis les analytics.

**Prompt 88 — Certificats & branding école**
Pour le LMS self-hosted : certificats PDF personnalisés avec QR de vérification, page publique de vérification, branding école configurable par utilisateur (white-label pour le plan Business).

**Prompt 89 — Communauté & affiliation**
Programme d'affiliation (liens trackés, commission sur abonnements), page publique de showcase des cours créés (opt-in), témoignages.

**Prompt 90 — Import de contenu existant**
L'utilisateur peut uploader ses supports existants (PDF, PPTX, Markdown) : le plan et le contenu sont générés EN PARTANT de son matériel (RAG simple : extraction + chunks en contexte), pour des cours plus authentiques et uniques — gros plus pour la review Udemy.

**Prompt 91 — Mise à jour automatique des cours**
Job trimestriel : détecte si le sujet a évolué (recherche web sur les nouveautés du sujet), propose les leçons à mettre à jour, régénère et redéploie. Argument marketing fort (« vos cours restent à jour »).

**Prompt 92 — Traduction des cours publiés**
Pipeline de localisation complet d'un cours déployé : sous-titres traduits dans 10 langues (upload auto sur Udemy/YouTube), version doublée optionnelle (TTS dans la langue cible).

**Prompt 93 — Prompt playground admin**
Interface admin pour éditer/tester/versionner tous les prompts système (plan, scripts, articles, quiz) avec comparaison A/B des sorties, sans redéploiement. Les prompts sont en base, pas en dur.

**Prompt 94 — Score de qualité pédagogique**
Évaluateur automatique via Claude : chaque cours généré reçoit un score (clarté, progression, exemples, engagement) avec rubrique détaillée. Seuil minimum avant autorisation de déploiement Udemy.

**Prompt 95 — Landing page marketing SallyCourse**
Landing publique du SaaS : hero avec démo vidéo, comparatif avant/après (40h de travail → 40 min), pricing, FAQ, témoignages, SEO complet, en AR/FR/EN. Design SALISTAR premium.

**Prompt 96 — Programme de démo automatique**
Génère un mini-cours de démo gratuit (1 section) pour tout visiteur qui entre un titre sur la landing (rate-limité), avec aperçu de la première vidéo — le meilleur argument de vente possible.

**Prompt 97 — Intégration Zapier/Make**
Triggers et actions Zapier : « nouveau cours généré », « review approuvée » → automatisations marketing (post LinkedIn automatique, email à sa liste, etc.).

**Prompt 98 — Application mobile de suivi**
App React Native/Expo minimale : suivi des générations et déploiements en temps réel, notifications push, statistiques des cours publiés. Réutilise l'API publique.

**Prompt 99 — Tableau de bord revenus consolidé**
Agrège les revenus de toutes les plateformes (Udemy Instructor API, YouTube, Gumroad, Teachable, LMS interne) en un dashboard unique avec conversion MAD/EUR/USD, graphiques mensuels, export comptable.

**Prompt 100 — Audit final & lancement**
Checklist de lancement complète : audit sécurité, test de charge (k6 : 50 générations simultanées), vérification RGPD, test du flow complet de bout en bout (titre → cours déployé sur 3 plateformes), plan de lancement (Product Hunt, communautés DevOps/formateurs MENA), et documentation utilisateur finale avec vidéos tutorielles (générées par SallyCourse lui-même 🎯).

---

## PROMPTS BONUS — Déploiement Plateformes Supplémentaires (101–110)

**Prompt 101 — Adapter Coursera / edX (export)**
Export au format Common Cartridge + guide d'import, car ces plateformes n'acceptent que les partenaires institutionnels — utile pour les clients B2B universités.

**Prompt 102 — Adapter LinkedIn Learning (pitch pack)**
LinkedIn Learning fonctionne sur candidature instructeur : génère automatiquement le dossier de candidature (pitch du cours, plan, vidéo d'échantillon, bio instructeur) prêt à soumettre.

**Prompt 103 — Adapter Hotmart (marché lusophone/hispanophone)**
API + automation Hotmart : produit, modules, vidéos, checkout. Pertinent pour l'expansion Brésil/Amérique latine.

**Prompt 104 — Adapter Systeme.io**
API Systeme.io : cours + tunnel de vente complet auto-généré (page de capture, séquence email de 5 jours générée par Claude, page de vente).

**Prompt 105 — Adapter Kajabi**
Automation Playwright Kajabi : produit cours, modules, upload, page d'offre.

**Prompt 106 — Adapter TikTok/Instagram/Shorts (repurposing)**
Découpe automatique de chaque cours en 15–30 clips verticaux 9:16 (extraits les plus denses détectés via le script, recadrage, sous-titres stylés karaoke, hook généré) + upload programmé via les APIs (TikTok Content Posting API, Instagram Graph API, YouTube Shorts). Machine à trafic vers les cours.

**Prompt 107 — Adapter Discord/Telegram (cours communautaire)**
Publie le cours dans un serveur Discord (un salon par section, vidéos hébergées + drip content) ou canal Telegram privé avec bot d'accès payant — populaire au MENA.

**Prompt 108 — Adapter WordPress/LearnDash & Tutor LMS**
Via l'API REST WordPress + LearnDash : crée le cours complet sur le site WordPress du client (marché énorme des formateurs indépendants).

**Prompt 109 — Marketplace de préconfiguration**
« Deploy presets » partageables : un formateur configure son mix de plateformes + pricing + templates une fois, l'applique à tous ses cours en un clic.

**Prompt 110 — Orchestration cross-platform intelligente**
Stratégie de publication automatique recommandée par Claude selon le sujet : ex. « cours DevOps FR → Udemy (payant) + YouTube 3 premières leçons (gratuit, funnel) + LinkedIn posts + clips TikTok », avec calendrier de publication échelonné et tracking UTM unifié.

---

## PHASE 7 — Qualité Zéro-Défaut : Anti-Doublons, Anti-Hardcoding, Sécurité, Anti-Bugs (Prompts 111–130)

**Prompt 111 — Audit anti-duplication du code**
Passe sur TOUT le monorepo avec jscpd (seuil : 0% de duplication tolérée au-dessus de 10 lignes) : identifie chaque bloc dupliqué entre `apps/web`, `apps/worker` et les adapters, extrais-les en fonctions/hooks/utilitaires dans `packages/shared`. Ajoute jscpd en CI avec échec du build si duplication détectée. Liste chaque refactoring effectué.

**Prompt 112 — Factorisation des adapters de déploiement**
Analyse les 15+ adapters de plateformes : extrais tout le code commun (login Playwright, upload de fichier avec retry, polling de statut, gestion de checkpoint, logs) dans une classe abstraite `BaseDeploymentAdapter` et des mixins (`PlaywrightAuthMixin`, `ApiAuthMixin`, `ChunkedUploadMixin`). Chaque adapter final ne doit contenir QUE sa logique spécifique (sélecteurs, endpoints, mapping). Aucune fonction d'upload ou de retry dupliquée.

**Prompt 113 — Élimination totale du hardcoding**
Scanne tout le code à la recherche de valeurs en dur et migre-les : URLs → config env, textes UI → fichiers i18n next-intl (aucune chaîne visible en dur dans le JSX), constantes métier (durées min Udemy, tailles d'images 750×422, LUFS -16, limites de quiz, prix des plans) → `packages/shared/constants.ts` typé et documenté, sélecteurs Playwright → fichiers `selectors/{platform}.ts` versionnés, prompts Claude → base de données (déjà prévu au Prompt 93, vérifie qu'AUCUN prompt n'est resté dans le code), couleurs → design tokens Tailwind (jamais de #5B2A86 inline). Ajoute une règle ESLint custom qui interdit les littéraux magiques (`no-magic-numbers`, `no-hardcoded-strings` sur le JSX).

**Prompt 114 — Single source of truth des types**
Vérifie que chaque entité (Course, Lesson, Quiz, Deployment…) a UN seul schéma Zod source dans `packages/shared` dont dérivent : le type TypeScript (z.infer), le schéma Mongoose (via zod-to-mongoose ou mapping documenté), la validation API, et les types du front. Supprime toute interface redéfinie localement. Test CI qui échoue si un type est défini deux fois.

**Prompt 115 — Déduplication des contenus générés**
Côté produit : implémente la détection de doublons dans le contenu généré lui-même — embeddings (Voyage/OpenAI) de chaque leçon stockés en base, similarité cosinus entre leçons d'un même cours (>0.92 = alerte « ces deux leçons se répètent » avec régénération automatique de la seconde avec instruction d'angle différent), et entre cours d'un même utilisateur (éviter de publier deux cours quasi identiques, motif de rejet Udemy).

**Prompt 116 — Audit sécurité OWASP complet**
Passe l'application au crible OWASP Top 10 : injection (toutes les requêtes Mongo paramétrées, jamais de `$where`, sanitization des inputs avec les schémas Zod en entrée de CHAQUE route API), XSS (sanitize le Markdown rendu avec rehype-sanitize, CSP stricte), CSRF (tokens sur toutes les mutations), IDOR (middleware qui vérifie l'ownership `userId` sur CHAQUE accès à un Course/Deployment — écris le test qui tente d'accéder au cours d'un autre utilisateur), SSRF (les URLs de screenshotSpec passent par une allowlist de domaines + blocage des IPs privées/metadata), upload (validation MIME réelle par magic bytes, pas l'extension), rate limiting sur login (anti-bruteforce + lockout progressif). Produis un rapport d'audit avec chaque vulnérabilité trouvée/corrigée.

**Prompt 117 — Sécurité des secrets et credentials**
Audit dédié : vérifie qu'AUCUN secret n'apparaît dans les logs (redaction pino automatique des champs password/token/key), le storageState Playwright chiffré au repos, rotation de la clé maître AES documentée avec script de re-chiffrement, les clés API utilisateur hashées (jamais stockées en clair, affichées une seule fois), scan git history avec gitleaks + hook pre-commit, headers `Cache-Control: no-store` sur les routes sensibles.

**Prompt 118 — Sécurité des conteneurs**
Durcis toutes les images Docker : utilisateurs non-root partout, images distroless/alpine minimales, `read_only: true` + tmpfs où possible, capabilities drop ALL, scan Trivy en CI (échec sur CVE critical/high), pas de socket Docker monté dans les workers, réseau des conteneurs TP éphémères totalement isolé (network none ou réseau dédié sans route vers mongo/redis), limites CPU/RAM sur chaque service, secrets via Docker secrets et non variables d'environnement en prod.

**Prompt 119 — Gestion d'erreurs exhaustive**
Standardise TOUTE la gestion d'erreur : classe `AppError` typée (code, message utilisateur, message technique, retryable, httpStatus), aucune promesse non catchée (règle ESLint `no-floating-promises` en error), error boundaries React sur chaque section du dashboard avec fallback UI, handler global worker qui marque le job en échec avec l'erreur structurée (jamais de crash silencieux), toutes les erreurs FFmpeg/Playwright/API externes wrappées avec contexte (courseId, lessonId, étape). Vérifie qu'aucun `catch` vide ou `console.log` d'erreur n'existe dans le code.

**Prompt 120 — Chasse aux bugs de concurrence**
Audite les race conditions : deux jobs qui modifient le même Course (verrous optimistes Mongoose avec versionKey + retry), double-clic sur « Générer » (idempotency keys sur les mutations), webhooks de paiement dupliqués (déduplication par event ID), SSE qui fuit (cleanup des listeners), jobs BullMQ dupliqués après restart (jobId déterministe `{courseId}-{step}`). Écris un test de charge qui déclenche 10 générations simultanées du même cours et vérifie l'état final cohérent.

**Prompt 121 — Validation systématique des sorties LLM**
Blinde chaque appel Claude : schéma Zod strict sur CHAQUE sortie JSON avec safeParse, retry avec le message d'erreur de validation injecté (max 3), détection de troncature (finish_reason), détection d'hallucination structurelle (leçon qui référence une section inexistante, quiz avec deux bonnes réponses, correctIndex hors limites), fallback documenté par type de génération, log de chaque échec de validation pour améliorer les prompts.

**Prompt 122 — Tests de mutation et couverture**
Monte la couverture de test à 80%+ sur `packages/shared` et les modules critiques (compliance, paiement, quotas, adapters de base) : ajoute Stryker (mutation testing) sur la logique métier pour vérifier que les tests détectent vraiment les bugs, tests de propriété (fast-check) sur les fonctions de découpage/synchronisation vidéo, snapshot tests des templates de slides.

**Prompt 123 — Linting maximal & hooks**
Configuration ESLint stricte finale : typescript-eslint strict-type-checked, no-explicit-any en error, exhaustive-deps, import/no-cycle (aucune dépendance circulaire), sonarjs (bugs et code smells), unicorn. Husky + lint-staged : impossible de commit du code non conforme. `tsc --noEmit` en CI sur tout le monorepo.

**Prompt 124 — Audit des dépendances**
Automatise : Renovate bot (PRs de mise à jour groupées hebdo), npm audit + Snyk en CI (échec sur high), vérification des licences (pas de GPL contaminante), lockfile obligatoire, `overrides` documentés pour les CVE transitives, alerte sur les packages non maintenus.

**Prompt 125 — Nettoyage du code mort**
Passe knip sur le monorepo : supprime tous les exports inutilisés, fichiers orphelins, dépendances non utilisées dans les package.json, routes API jamais appelées, feature flags obsolètes. Ajoute knip en CI en mode warning puis error.

**Prompt 126 — Revue sécurité Playwright/automation**
Spécifique aux adapters navigateur : jamais d'`eval` de contenu distant, contexts isolés par utilisateur (aucun cookie partagé entre comptes), timeout maximal par étape (pas de browser zombie — reaper qui tue les sessions >30 min), screenshots de debug purgés après 7 jours (peuvent contenir des données de compte), détection de page de phishing (vérification du domaine avant de saisir les credentials).

**Prompt 127 — Contrats d'API et tests de non-régression**
Génère le contrat OpenAPI depuis les schémas Zod (zod-to-openapi), tests de contrat en CI (le front est buildé contre le contrat), versioning `/api/v1` avec politique de dépréciation, tests de non-régression sur les formats d'export (ZIP, SCORM, CSV quiz Udemy) avec fixtures golden files.

**Prompt 128 — Chaos testing du pipeline**
Écris des tests de résilience : tue le worker au milieu d'un rendu (vérifie la reprise), coupe Redis 30s (vérifie la reconnexion), fais échouer ElevenLabs 5 fois (vérifie le fallback), corrompt un PNG de slide (vérifie la détection QA), remplis le disque à 95% (vérifie l'alerte et le refus propre de nouveaux jobs).

**Prompt 129 — Revue finale automatisée par IA**
Mets en place un job de revue de code par Claude en CI sur chaque PR : détection de duplication sémantique (même logique écrite différemment), hardcoding résiduel, gestion d'erreur manquante, faille de sécurité évidente, avec commentaires postés sur la PR. Configuration du prompt de revue versionnée.

**Prompt 130 — Definition of Done & checklist qualité**
Rédige la Definition of Done du projet appliquée à chaque feature : types stricts, zéro duplication jscpd, zéro hardcoding, erreurs gérées, test unitaire + intégration, i18n AR/FR/EN, RTL vérifié, dark mode, audit ownership/IDOR, log structuré, documentation. Transforme-la en template de PR GitHub avec checklist obligatoire.

---

## PHASE 8 — Features Oubliées (Prompts 131–150)

**Prompt 131 — Sauvegarde/brouillon automatique**
Auto-save de toutes les éditions (plan, scripts, quiz) toutes les 5s avec indicateur visuel, historique des versions par leçon avec diff et restauration, protection contre la perte (beforeunload + récupération de brouillon local).

**Prompt 132 — Recherche globale**
Recherche full-text (Atlas Search ou index Mongo) sur tous les cours/leçons/scripts de l'utilisateur : « où ai-je parlé de kubectl ? » → résultats avec surlignage et lien direct vers la leçon.

**Prompt 133 — Prévisualisation vidéo rapide (draft mode)**
Avant le rendu final coûteux : mode brouillon qui génère une vidéo basse résolution (720p, TTS standard, veryfast) en 5× moins de temps pour validation, puis rendu final HD à l'approbation. Économise du compute et de l'ElevenLabs.

**Prompt 134 — File d'attente de génération visible et estimations**
Estimation du temps total AVANT lancement (basée sur l'historique : X leçons ≈ Y minutes), position dans la file, notification « votre cours sera prêt vers 14h30 », possibilité de programmer la génération la nuit (heures creuses).

**Prompt 135 — Musique et habillage sonore**
Bibliothèque de musiques libres de droits (intro/outro, fond léger -28dB sous la voix), jingle SALISTAR ou personnalisé par utilisateur, effets de transition sonores discrets. Mixage automatique FFmpeg avec sidechain ducking (la musique baisse quand la voix parle).

**Prompt 136 — Table des matières et chapitrage**
Chapitres intégrés dans les MP4 (metadata), timestamps cliquables générés pour les descriptions YouTube, sommaire interactif en début de chaque vidéo (slide animée), table des matières PDF du cours complet.

**Prompt 137 — Accessibilité du contenu généré**
Transcriptions texte complètes téléchargeables, contraste vérifié sur les slides (WCAG AA), option gros texte, audio-description optionnelle des captures d'écran dans les articles (alt text généré par Claude vision), vitesse de narration configurable.

**Prompt 138 — Gestion d'équipe (plan Business)**
Workspaces multi-utilisateurs : rôles (owner, éditeur, relecteur), workflow de validation (le relecteur doit approuver avant déploiement), commentaires sur les leçons, activité d'équipe, facturation centralisée.

**Prompt 139 — Coupons et promotions**
Génération automatique des coupons Udemy via l'adapter (campagnes de lancement), pages de promo trackées, calendrier promotionnel suggéré (les périodes de soldes Udemy), codes promo pour le LMS interne.

**Prompt 140 — Email marketing intégré**
Séquences email générées par cours : annonce de lancement, nurturing 5 emails, relance des étudiants inactifs (LMS interne). Intégration Resend/Brevo avec les listes de l'utilisateur, templates SALISTAR.

**Prompt 141 — Détection de plagiat sortant**
Avant publication : vérifie que le contenu généré ne reproduit pas de contenu existant (recherche de phrases distinctives sur le web), score d'originalité, régénération des passages trop proches d'une source. Protège contre les rejets Udemy pour plagiat.

**Prompt 142 — Mode hors-ligne / export complet**
Export « cours portable » : site HTML statique auto-contenu (player, articles, quiz JS fonctionnels hors-ligne) sur clé USB — très demandé pour les formations en entreprise/zones à faible connectivité au Maroc et en Afrique.

**Prompt 143 — Sous-domaines white-label**
Plan Business : chaque client a son LMS sur `academie-client.sallycourse.com` (ou domaine custom avec vérification DNS + certificat auto via Caddy/Traefik), branding complet, ses cours uniquement.

**Prompt 144 — Statistiques d'apprentissage (LMS interne)**
Tracking granulaire : complétion par leçon, temps passé, scores de quiz, points d'abandon (heatmap : « 60% abandonnent à la leçon 3.2 » → suggestion de régénération), export xAPI/SCORM pour les clients entreprise.

**Prompt 145 — Générateur d'exercices supplémentaires à la demande**
Bouton étudiant « plus d'exercices » (LMS interne) : génère des variantes de quiz/TP personnalisées selon les erreurs de l'étudiant, correction détaillée instantanée. Différenciateur pédagogique majeur.

**Prompt 146 — Assistant de cours (chatbot par cours)**
Chatbot intégré au LMS interne, contexte = le contenu du cours (RAG sur les scripts/articles) : l'étudiant pose ses questions, réponses sourcées avec lien vers la leçon. Widget embarquable pour Teachable/WordPress.

**Prompt 147 — Import/export inter-utilisateurs et marketplace de cours**
Marketplace interne : un créateur peut vendre son cours généré (ou son template de plan) à d'autres utilisateurs, revenue share, licence claire sur le contenu.

**Prompt 148 — Conformité fiscale Maroc**
Facturation conforme (ICE, IF, TVA 20%), export comptable compatible avec les logiciels marocains, gestion auto-entrepreneur vs société, reçus en AR/FR — synergie directe avec SallyFiscal.

**Prompt 149 — Journal d'audit complet**
Audit log immuable de toutes les actions sensibles (connexions, changements de credentials, déploiements, suppressions, accès admin) avec IP/user-agent, consultable par l'utilisateur (transparence) et l'admin, rétention 12 mois, export CSV.

**Prompt 150 — Mode agence / génération pour clients**
Profil « agence » : gère des clients (chacun avec ses comptes de plateformes), génère et déploie au nom du client, rapports de livraison brandés, facturation par client — ouvre le marché B2B des agences de formation qui veulent industrialiser.

---

## PHASE 9 — Priorité Gratuit & Open Source (Prompts 151–162)

> Objectif : coût marginal par cours proche de zéro. Chaque service payant a une alternative open source par défaut ; le payant devient une option premium.

**Prompt 151 — Stratégie open-source-first & abstraction des providers**
Crée une couche d'abstraction `providers/` avec interfaces : `LLMProvider`, `TTSProvider`, `TranscriptionProvider`, `ImageProvider`, `StorageProvider`, `EmailProvider`. Chaque interface a au moins une implémentation open source auto-hébergée (par défaut) et une implémentation cloud payante (option). La sélection se fait par config par utilisateur/plan, avec fallback en cascade documenté. Tableau comparatif généré dans la doc : qualité / coût / vitesse / langues supportées par provider.

**Prompt 152 — LLM local avec Ollama**
Implémente `OllamaProvider` : service Ollama dans le docker-compose (support GPU optionnel), modèles recommandés par tâche (Llama 3.3 70B ou Qwen 2.5 72B pour le plan et les scripts si GPU dispo ; versions quantisées 8B–14B pour les tâches simples : résumés, tags, descriptions), prompts adaptés aux modèles locaux (plus directifs, exemples few-shot), détection automatique de qualité insuffisante (validation Zod échouée 3×) → escalade vers Claude uniquement pour cette tâche. Mode hybride économique : plan+scripts sur Claude (qualité critique), tout le reste en local.

**Prompt 153 — TTS open source : Piper & XTTS/Kokoro**
Implémente `PiperProvider` (ultra-rapide, CPU, bon FR/EN — voix par défaut du plan Free) et un provider de clonage de voix open source (XTTS-v2 ou Kokoro selon la licence commerciale, arabe supporté, GPU recommandé) dans des conteneurs dédiés. Benchmark automatique de qualité (échantillons comparés), mapping des voix par langue, normalisation identique (-16 LUFS). ElevenLabs devient l'option premium des plans payants uniquement.

**Prompt 154 — Transcription et images 100% open source**
Whisper est déjà open source (faster-whisper, garde-le). Ajoute la génération d'images d'illustration en local : FLUX.1-schnell / Stable Diffusion via ComfyUI dockerisé (GPU) pour les illustrations de slides et miniatures alternatives, avec styles verrouillés sur le design system. Fallback zéro-GPU : illustrations SVG géométriques procédurales (déjà prévues en D2, zéro coût).

**Prompt 155 — Avatars open source**
Remplace HeyGen/D-ID par défaut : intègre SadTalker ou EchoMimic (open source, GPU) pour animer une photo de l'instructeur sur l'audio TTS des intros. Qualité moindre mais gratuite ; HeyGen reste l'option premium. Documente les limites honnêtement dans l'UI.

**Prompt 156 — Emails et notifications open source**
Remplace Resend par défaut : serveur SMTP auto-hébergé (Stalwart/Maddy ou SMTP Hetzner) avec DKIM/SPF/DMARC configurés par script, templates MJML compilés. Resend/Brevo restent des options. Notifications push web via VAPID (gratuit, sans Firebase).

**Prompt 157 — Analytics et monitoring open source**
Plausible ou Umami auto-hébergé (analytics web, RGPD-friendly), stack Grafana + Prometheus + Loki consolidé (fusionne avec le Prompt 75), Sentry remplacé par GlitchTip (open source, API compatible).

**Prompt 158 — Paiements : CMI + options zéro commission**
CMI reste incontournable au Maroc. Pour l'international, ajoute à côté de Paddle une option virement/paiement manuel avec validation admin (zéro commission), et documente les coûts réels par méthode dans l'admin.

**Prompt 159 — Captcha, recherche et services open source**
Captcha → ALTCHA ou Cap (self-hosted, sans tracking). Recherche full-text (Prompt 132) → Meilisearch dockerisé (support arabe). Audit final : vérifie que RIEN dans le projet ne dépend d'un SaaS non remplaçable par une alternative auto-hébergée.

**Prompt 160 — Comparateur de coût réel par cours**
Étends le tracker de coûts (Prompt 55) : mode « full OSS » où le coût = compute Hetzner uniquement, comparateur en admin (« ce cours : 0,80€ en OSS vs 24€ en cloud »), recommandation automatique du mix optimal qualité/prix par type de cours, affichage du mix utilisé sur chaque cours généré.

**Prompt 161 — Licences et conformité open source**
Audit des licences de tous les outils intégrés (Piper MIT ✓, XTTS licence Coqui NON-commerciale — à remplacer par Kokoro Apache 2.0 pour un SaaS, vérifie chaque cas), fichier NOTICE généré automatiquement, vérification que l'usage commercial est permis pour chaque composant du pipeline avant intégration.

**Prompt 162 — Dimensionnement matériel & GPU à la demande**
Documente et script le dimensionnement : config minimale CPU-only (Piper + LLM 8B quantisé + FFmpeg — quel CPX Hetzner suffit), config GPU (pour XTTS + images + 70B), comparatif GPU Hetzner dédié vs location à la demande (RunPod/Vast) pour les bursts, script d'autoscaling de workers GPU éphémères (provision → jobs → destroy) pour ne payer le GPU qu'à l'usage réel.

---

## PHASE 10 — Paramètres de Génération Avancés (Prompts 163–174)

> L'entrée reste minimale (titre + niveau) mais un panneau « Paramètres avancés » optionnel donne le contrôle total.

**Prompt 163 — Panneau de paramètres avancés (UX)**
Étends le formulaire de création : le mode simple (titre+niveau) reste l'écran principal ; un bouton « Personnaliser » ouvre un panneau en onglets (Structure, Contenu, Voix & Vidéo, Style, Public). Chaque paramètre a une valeur par défaut intelligente, un tooltip, et un aperçu d'impact (« +20 min de génération »). Presets sauvegardables (« mes réglages DevOps »).

**Prompt 164 — Paramètres de structure**
Contrôles : durée totale cible (1h/3h/6h/10h+), nombre de sections (auto ou fixe), durée moyenne par vidéo (3-5/5-8/8-12 min), ratio des types de contenu (curseurs vidéo/article/TP/quiz), position des quiz (par section/mi-parcours/final), examen final avec note de passage, projet fil rouge (un TP qui évolue sur tout le cours) vs TPs indépendants.

**Prompt 165 — Paramètres pédagogiques**
Contrôles : ton (académique/conversationnel/énergique), densité (synthétique/normal/très détaillé), approche (théorie d'abord/exemples d'abord/full pratique), analogies et storytelling on/off, répétition espacée des concepts clés, public cible en texte libre (« comptables marocains qui découvrent Excel » — injecté dans tous les prompts), objectif (certification/reconversion/montée en compétence) qui oriente les TPs.

**Prompt 166 — Paramètres de domaine expert**
Contrôles : mots-clés à couvrir obligatoirement, sujets à exclure, outils/versions imposés (« Terraform 1.9, pas 1.5 »), OS des TPs (Windows/Linux/macOS/web), documents de référence uploadés (le RAG du Prompt 90 devient un paramètre), conventions de code et langue des commentaires, glossaire imposé (terminologie client).

**Prompt 167 — Paramètres voix & vidéo**
Contrôles : provider TTS (auto/Piper/XTTS/ElevenLabs selon plan), voix (galerie avec écoute d'échantillons), vitesse de narration (0.9×–1.15×), musique de fond (aucune/discrète/genre), template de slides (galerie D7 + variantes de palette), génération additionnelle 9:16 (versions shorts), langue des slides ≠ langue de narration (slides EN + voix FR).

**Prompt 168 — Mode préparation certification**
Paramètre « certification cible » (AWS SAA, ISTQB, PSM I, PMP… base extensible) : plan aligné sur le syllabus officiel, quiz au format réel de l'examen (nombre d'options, style, durée), examen blanc chronométré complet avec score par domaine du syllabus. Synergie directe avec tes banques ISTQB/PSM existantes.

**Prompt 169 — Multi-voix dialogue**
Paramètre « dialogue » : alternance de deux voix (instructeur + voix apprenant qui pose les questions — format très engageant), scripts générés en dialogue, mixage des deux TTS, slides adaptées (question en encadré).

**Prompt 170 — Points de validation configurables**
Mode « validation par étape » vs full-auto : points d'arrêt optionnels — après le plan (déjà au 14), après les scripts (relecture avant TTS, économise les régénérations audio), après le draft 720p (avant rendu HD). Configurables dans les presets.

**Prompt 171 — Régénération ciblée avec instructions**
Sur chaque leçon/section : « régénérer avec instructions » (champ libre : « plus d'exemples marocains », « simplifie le vocabulaire ») qui régénère uniquement l'élément avec l'instruction ajoutée, en préservant la cohérence (résumés des leçons adjacentes injectés).

**Prompt 172 — Contraintes par plateforme dès le plan**
Selon les plateformes cochées, le générateur applique leurs contraintes DÈS le plan : Udemy (30 min min, déclaration IA), YouTube (regroupement 10 min+), Skillshare (projet de classe obligatoire), affichées dans le panneau comme contraintes actives.

**Prompt 173 — Écran de confirmation avec estimations**
Avant lancement : récapitulatif de tous les paramètres, estimation du temps de génération, du coût (selon le mix providers), du volume produit (leçons/vidéos/quiz) et de la durée totale du cours, ajustables avant de confirmer.

**Prompt 174 — Presets communautaires**
Bibliothèque de presets partagés (opt-in) : meilleurs réglages par catégorie votés par la communauté (« Preset certification IT », « Preset bureautique MENA »), import en un clic, stats d'utilisation.

---

## PHASE 11 — Déploiement Manuel OU Automatique par Plateforme (Prompts 175–182)

**Prompt 175 — Sélecteur de mode par plateforme**
Refonds l'écran de déploiement : pour CHAQUE plateforme, choix du mode — **Automatique** (adapter API/Playwright), **Assisté** (semi-auto), ou **Manuel** (pack guidé). Choix mémorisé par plateforme, modifiable par déploiement. Matrice affichée : quelles plateformes supportent quels modes, avec les risques (badge « automation navigateur — CGU » sur Udemy auto).

**Prompt 176 — Mode manuel guidé (le pack parfait)**
Pour chaque plateforme en manuel : ZIP spécifique au format d'import de LA plateforme (ex. CSV quiz bulk Udemy) + guide d'upload pas-à-pas HTML/PDF avec captures d'écran de l'interface de la plateforme (générées par ton propre module de capture !), checklist interactive, et tous les textes à copier-coller en blocs avec bouton copier. L'upload manuel devient 20 min sans réflexion.

**Prompt 177 — Mode assisté (semi-automatique)**
Playwright ouvre un navigateur VISIBLE côté utilisateur (extension Chrome MV3 SallyCourse ou session locale via CLI) et pré-remplit chaque formulaire ; l'utilisateur vérifie et clique lui-même les validations finales (dont Submit for Review). Zéro risque CGU côté serveur, 90% du temps gagné. Implémente l'extension correspondante qui tire les contenus depuis l'API.

**Prompt 178 — Suivi unifié des trois modes**
Le tableau de déploiement (Prompt 44) suit les trois modes : en manuel, l'utilisateur coche la checklist et colle l'URL finale (statut → published) ; en assisté, l'extension remonte la progression ; en auto, comme avant. Rapports (50) et polling de review (47) fonctionnent dans tous les cas dès qu'une URL existe.

**Prompt 179 — Bascule et reprise entre modes**
Si un déploiement auto échoue à mi-parcours (captcha, sélecteur cassé) : bascule proposée en assisté ou manuel EN REPRENANT où l'auto s'est arrêté — le guide manuel généré ne contient que les étapes restantes, l'état déjà fait clairement indiqué.

**Prompt 180 — Santé des adapters (canary)**
Job hebdomadaire de canary test par adapter (parcours à blanc sur compte de test jusqu'à l'avant-dernière étape), alerte admin si sélecteur cassé, mise à jour des sélecteurs à chaud (fichiers selectors en base, poussés sans redéploiement), bascule automatique des utilisateurs en mode assisté tant que l'adapter est cassé.

**Prompt 181 — Déploiements programmés (drip)**
Planificateur : « Udemy maintenant, YouTube 3 leçons/semaine, TikTok 1 clip/jour pendant 30 jours » — calendrier visuel, exécution cron BullMQ, pause/reprise.

**Prompt 182 — Archive maître anti-lock-in**
Export « archive maître » : toutes les sources JSON, scripts, médias dans un format documenté et re-importable — garantie anti-lock-in et base de tout futur adapter.

---

## PHASE 12 — Testing, QA & Lancement Local Docker (Prompts 183–196)

**Prompt 183 — Lancement local one-command**
Expérience « ça marche en 5 minutes » : `make setup` qui vérifie les prérequis (Docker, RAM), copie `.env.example` → `.env` avec génération auto des secrets locaux, lance `docker compose up` avec profils (`--profile core` = web+mongo+redis+minio ; `--profile ai` = +ollama+piper ; `--profile full` = tout), seed de la base (admin + 1 cours de démo), affiche les URLs. README quickstart de 10 lignes.

**Prompt 184 — Environnement de dev optimisé**
Hot reload partout (Next.js + worker en tsx watch, volumes montés), Mongo Express + Redis Commander en `--profile debug`, Mailpit pour capturer les emails, console MinIO, et **mock des APIs payantes** : serveur de mock qui simule Claude/ElevenLabs avec des fixtures pour développer sans consommer un seul token (`MOCK_PROVIDERS=true`).

**Prompt 185 — Jeu de données de test**
Fixtures : 3 cours à différents stades (draft/generating/published), utilisateurs de chaque plan, un cours « golden » complet pré-généré (vidéos de 10s, léger) pour tester l'UI et les exports sans lancer de génération, script de seed/reset idempotent.

**Prompt 186 — Tests unitaires exhaustifs**
Complète le Prompt 67 : chaque provider (mocké), chaque fonction de `packages/shared`, le compliance checker (cas limites : titre 61 caractères, 29 min de vidéo), quotas et coûts, transformations par plateforme, logique de checkpoint. Cible 85% sur shared, badge de couverture en CI.

**Prompt 187 — Test d'intégration du pipeline réel**
Suite qui teste le pipeline RÉEL en local avec les providers open source : génère un micro-cours (2 sections, 3 leçons, slides réelles, TTS Piper réel, rendu FFmpeg réel) en CI, vérifie chaque artefact (ffprobe des vidéos, SRT valides, ZIP ouvrable, SCORM parsable). Durée cible < 10 min en CI.

**Prompt 188 — Tests E2E utilisateur**
Playwright E2E des parcours critiques : inscription → création (mode mock) → validation plan → suivi génération → prévisualisation → export ZIP → déploiement manuel avec checklist. Idem : paiement (webhook simulé), régénération d'une leçon, parcours admin. En CI sur chaque PR, traces/vidéos en artefacts.

**Prompt 189 — Tests des adapters sans toucher les vrais sites**
Fixtures HTML des pages de chaque plateforme (snapshots versionnés du DOM du course builder Udemy, etc.) servies localement ; les adapters sont testés contre ces fixtures (les sélecteurs matchent-ils ?) + le canary hebdo (180) pour le réel. Test de reprise sur checkpoint pour chaque adapter.

**Prompt 190 — Banc de test qualité du contenu généré**
20 titres de référence (technique, soft skills, AR/FR/EN) régénérés à chaque changement de prompts système, scorés automatiquement (rubrique du Prompt 94 + métriques objectives), comparaison avant/après dans le playground (93), rapport de non-régression qualité.

**Prompt 191 — Performance et charge**
k6 : 100 utilisateurs simultanés sur le dashboard, 20 créations simultanées, P95 mesurés, saturation propre des queues (refus élégant au-delà de la capacité), profiling FFmpeg, Lighthouse CI (LCP < 2s, score > 90 sur les pages clés).

**Prompt 192 — Accessibilité et i18n automatisés**
axe-core sur toutes les pages (zéro violation critique), screenshots RTL AR comparés, clé i18n manquante = échec du build, parcours E2E principaux joués dans les 3 langues.

**Prompt 193 — Plan de QA manuelle (Gherkin)**
Plan de QA pré-lancement : matrice navigateurs/devices, les 25 scénarios critiques rédigés en Gherkin (réutilisables en Robot Framework — ton domaine), grille de test d'un cours généré de bout en bout (regarder réellement 3 vidéos, faire les TPs, passer les quiz), template de rapport de bug.

**Prompt 194 — Staging miroir de prod**
Staging complet sur Hetzner (docker-compose.staging.yml, staging.sallycourse.com, données anonymisées), smoke tests post-déploiement (pipeline complet sur un micro-cours), promotion staging→prod par tag git uniquement si les smoke tests passent.

**Prompt 195 — Runbook de mise en production**
Checklist ordonnée : DNS, TLS (Caddy/Traefik auto), secrets prod dans un vault, backups activés et TESTÉS par une restauration réelle, monitoring avec alertes vérifiées, rate limits actifs, page de statut publique, plan de rollback répété. Répétition générale documentée.

**Prompt 196 — Beta fermée & critères de lancement**
Programme beta : 10-20 formateurs marocains invités (feature flags), formulaire de feedback intégré (capture d'écran auto + contexte), analytics des frictions (où abandonnent-ils ?), itération hebdo documentée, critères de sortie chiffrés (X cours générés, Y publiés avec succès, NPS > Z) avant ouverture publique.

---

## PHASE 13 — Features Complémentaires (Prompts 197–210)

**Prompt 197 — Bande-annonce automatique du cours**
Génère un trailer de 60–90s par cours (obligatoire sur Udemy, décisif pour la conversion) : script d'accroche généré (problème → promesse → aperçu du programme → CTA), montage automatique des meilleurs extraits des leçons (détection des passages les plus denses via le script), musique montante, titres animés, fin sur l'image de cours. Uploadé comme promo video par les adapters.

**Prompt 198 — Import inversé : vidéo/YouTube existante → cours structuré**
Le chemin inverse de la génération : l'utilisateur colle une URL YouTube (sa propre chaîne) ou uploade ses vidéos existantes → transcription Whisper → Claude reconstruit un plan structuré, découpe les vidéos par chapitre (FFmpeg aux timestamps), génère les articles/quiz/TPs manquants autour, et le tout devient un cours déployable. Transforme 5 ans de contenu YouTube en catalogue Udemy.

**Prompt 199 — Parcours d'apprentissage (bundles)**
Learning paths : chaîne plusieurs cours en un parcours diplômant (« Zéro → DevOps Junior » = 4 cours ordonnés), prérequis entre cours, progression globale, certificat de parcours distinct, prix bundle sur le LMS interne, page de vente du parcours générée.

**Prompt 200 — Gamification du LMS interne**
Points XP par leçon/quiz, streaks quotidiens avec rappels, badges (premier TP, quiz parfait, cours terminé), niveaux d'apprenant, leaderboard optionnel par cours, célébrations animées (design D4). Impact direct sur la complétion — argument de vente B2B.

**Prompt 201 — Export ebook & Kindle**
Chaque cours exportable en ebook : EPUB et PDF print-ready (articles + transcriptions des vidéos réécrites en prose par Claude + captures + quiz en annexe avec solutions), couverture générée, table des matières, prêt pour Kindle Direct Publishing et Google Books — un canal de revenus de plus depuis le même contenu.

**Prompt 202 — Export podcast**
Version audio du cours : concatène les narrations par section en épisodes, ajoute intro/outro jingle, génère le flux RSS conforme (hébergé sur le LMS) pour soumission Spotify/Apple Podcasts, descriptions d'épisodes générées. Le cours devient découvrable sur un canal totalement gratuit.

**Prompt 203 — Flashcards & répétition espacée**
Génère automatiquement 30–80 flashcards par cours (concept → définition, question → réponse) : export Anki (.apkg), et module de révision intégré au LMS avec algorithme SM-2, rappels par email/push (« 12 cartes à réviser aujourd'hui »). Augmente la rétention et le retour des étudiants.

**Prompt 204 — Blog SEO automatique par cours**
Machine à trafic organique : pour chaque cours publié, génère 5–10 articles de blog SEO (un par sous-sujet, 1200+ mots, maillage interne, schema.org Course/FAQ) publiés sur le blog du LMS ou WordPress de l'utilisateur, chacun avec CTA vers le cours. Calendrier de publication étalé, suivi des positions (intégration Search Console).

**Prompt 205 — Page instructeur publique (portfolio)**
Chaque utilisateur a une page publique `sallycourse.com/@instructeur` : bio générée, catalogue de tous ses cours avec liens multi-plateformes, avis agrégés, stats (X étudiants, Y cours), lien unique pour sa bio réseaux sociaux, thème personnalisable, SEO optimisé.

**Prompt 206 — Anti-piratage & watermarking**
Protection du contenu sur le LMS interne : watermark dynamique invisible et visible (email de l'étudiant en filigrane discret sur la vidéo, rotation de position), URLs vidéo signées à durée courte (pas de hotlink), détection de partage de compte (connexions simultanées anormales), DMCA kit (recherche périodique des cours sur les sites de piratage + templates de plainte générés).

**Prompt 207 — SSO & offre entreprise (B2B)**
Pour vendre le LMS aux entreprises : SSO SAML/OIDC (Azure AD, Google Workspace), provisioning SCIM des employés, groupes/départements avec assignation de cours obligatoires, échéances et relances, rapports de conformité formation (export RH), facturation par siège.

**Prompt 208 — Marketplace de relecture humaine**
Option « validation par un expert » : réseau de relecteurs experts par domaine (rémunérés à la mission) qui relisent le cours généré avant publication, corrigent via l'éditeur, apposent un badge « Vérifié par un expert » — l'argument massue contre l'objection « contenu IA » et pour la review Udemy. Workflow complet : commande, assignation, révision, paiement du relecteur.

**Prompt 209 — Veille concurrentielle & pricing dynamique**
Module de veille : suit les cours concurrents sur le même sujet (prix, notes, nombre d'étudiants, dernière mise à jour), alerte sur les opportunités (« le cours leader n'est plus mis à jour depuis 2 ans »), suggestion de prix optimal par plateforme, et ajustement automatique optionnel des prix du LMS interne selon la demande.

**Prompt 210 — Création vocale & assistant Darija**
Création de cours à la voix : l'utilisateur dicte son idée en Darija/arabe/français (« bghit ndir cours 3la Docker l les débutants ») → transcription + compréhension → formulaire pré-rempli, et un assistant conversationnel dans le dashboard pour piloter toute la plateforme en langage naturel (« relance la génération de la section 3 », « déploie le cours Excel sur YouTube en mode assisté »). Différenciateur MENA unique.

---

## PHASE 14 — Extension Complète : Pédagogie, Étudiant, Business & Ops (Prompts 211–238)

### Expérience étudiant avancée (LMS)

**Prompt 211 — Questions interactives dans la vidéo**
Quiz incrustés dans le player aux timestamps clés (générés automatiquement depuis le script) : la vidéo se met en pause, l'étudiant répond, feedback immédiat, reprise. Les résultats alimentent les stats de la leçon. Export possible vers les plateformes qui le supportent.

**Prompt 212 — Exercices de code auto-corrigés**
Pour les cours de programmation : exercices avec test runners dans des sandboxes isolées (conteneurs éphémères par langage : Node, Python, Go, Java), l'étudiant code dans un éditeur Monaco intégré, soumission → tests exécutés → feedback détaillé généré par Claude sur les erreurs. Barème automatique.

**Prompt 213 — Correction IA des devoirs libres**
Devoirs à réponse ouverte (essais, études de cas) : rubrique de correction générée avec le devoir, correction automatique par Claude avec justification par critère, note + commentaires personnalisés, révision humaine optionnelle (workflow instructeur), détection de plagiat entre soumissions d'étudiants.

**Prompt 214 — Validation des TPs par capture d'écran**
L'étudiant soumet une capture de son écran comme preuve de TP accompli → modèle vision (Claude) vérifie que le résultat attendu est présent (« le conteneur Docker tourne bien », « le tableau croisé est correct »), feedback ciblé si échec. Badge de TP validé.

**Prompt 215 — Notes et surlignages dans le player**
Prise de notes horodatées liée à la vidéo (clic sur la note → saut au timestamp), surlignage dans les articles, export de toutes les notes en Markdown/PDF, recherche dans ses notes.

**Prompt 216 — Planificateur d'étude personnel**
L'étudiant définit son objectif (« finir en 3 semaines, 30 min/jour ») → plan d'étude généré, événements ICS exportables (Google/Outlook Calendar), rappels adaptatifs, replanification automatique en cas de retard.

**Prompt 217 — Forum et Q&A par cours**
Espace de discussion par leçon : questions/réponses avec votes, réponse suggérée automatiquement par le chatbot RAG (Prompt 146) validable par l'instructeur, modération automatique (toxicité), FAQ auto-générée depuis les questions récurrentes et injectée dans le cours.

**Prompt 218 — App mobile étudiant (Expo)**
App React Native/Expo du LMS : lecture des cours avec téléchargement hors-ligne (vidéos chiffrées localement), quiz et flashcards, notifications de streak, synchronisation de progression, deep links. Publication App Store/Play Store avec EAS Build.

**Prompt 219 — Cours par WhatsApp (MENA)**
Canal de diffusion WhatsApp (approche WAHA, comme SallyPMFlow) : micro-leçons quotidiennes (extrait vidéo/audio + résumé + question du jour), réponses aux quiz par message, progression trackée, upsell vers le cours complet. Format ultra-adapté au marché marocain.

**Prompt 220 — Cohortes et sessions live**
Mode cohorte : un cours démarre à date fixe pour un groupe, drip hebdomadaire synchronisé, deadlines de devoirs, sessions live intégrées (Jitsi self-hosted ou Zoom) avec rappels, enregistrement automatiquement ajouté au cours comme leçon bonus, certificat de cohorte.

### Pédagogie & qualité de contenu

**Prompt 221 — Analyse qualité de l'audio généré**
QA automatique du TTS : détection des prononciations ratées (mots techniques, acronymes — dictionnaire de prononciation par domaine éditable), silences anormaux, vitesse irrégulière, artefacts ; re-synthèse ciblée des seuls segments défectueux avec la prononciation corrigée (SSML/phonèmes).

**Prompt 222 — Adaptation culturelle régionale**
Paramètre « localisation culturelle » : exemples, prénoms, monnaies, contextes adaptés au marché cible (exemples en dirhams et entreprises marocaines pour le public MENA, références locales), vérification de sensibilité culturelle avant publication, variantes par région pour le même cours.

**Prompt 223 — Sous-titres incrustés et vidéos verticales accessibles**
Option de sous-titres burned-in stylés (design system, karaoke word-level via les timestamps Whisper) pour les plateformes sans support SRT et les shorts, choix de style, position safe-zone par plateforme.

**Prompt 224 — Miniatures de chapitres et prévisualisation**
Génération de sprites de prévisualisation (hover sur la barre de progression = aperçu image, standard VTT thumbnails), miniature par chapitre dans la table des matières, storyboard du cours visualisable d'un coup d'œil par l'instructeur.

**Prompt 225 — Co-écriture entre instructeurs**
Cours à plusieurs auteurs : sections assignées par instructeur, voix TTS différente par section (ou voix clonées respectives), page de cours multi-instructeurs, partage des revenus configuré, historique des contributions.

**Prompt 226 — Marketplace de templates de slides**
Les designers peuvent créer et vendre des packs de templates de slides/certificats/miniatures conformes au système de tokens (D1) : éditeur de template avec preview live, validation automatique (contraste, zones de texte), revenue share, installation en un clic sur ses cours.

### Business & croissance

**Prompt 227 — Pages d'attente et pré-lancement**
Page « coming soon » par cours avant sa génération/publication : capture d'emails, compteur d'inscrits affiché, notification automatique au lancement avec coupon early-bird, mesure de la demande AVANT de générer le cours (validation de niche à coût zéro).

**Prompt 228 — Moteur de recommandation**
Recommandations sur le LMS : « les étudiants de ce cours ont aussi suivi… » (co-occurrence + embeddings de contenu), suggestion du prochain cours à la complétion, email hebdo personnalisé, section « pour vous » sur le catalogue.

**Prompt 229 — Prédiction de churn et winback**
Détection des étudiants qui décrochent (modèle simple sur l'activité : jours d'inactivité, progression stagnante) → séquences de réengagement automatiques (email « il ne vous reste que 2 leçons ! », flashcards de rappel), et côté SaaS : détection des créateurs inactifs avant la fin d'abonnement → campagne de rétention.

**Prompt 230 — Tests A/B de prix**
Framework d'expérimentation pricing sur le LMS : variantes de prix par segment/géo, mesure de conversion et revenu par variante, significativité statistique, application automatique du gagnant, garde-fous éthiques (pas de discrimination individuelle).

**Prompt 231 — TVA internationale et conformité fiscale globale**
Au-delà du Maroc (148) : calcul TVA UE (OSS), taxes UK/US sales tax via une table de règles maintenue, factures conformes par juridiction, seuils d'enregistrement surveillés avec alertes, export pour comptable par pays. Paddle en merchant of record reste l'option simple documentée en comparaison.

**Prompt 232 — Gestion des remboursements**
Politique de remboursement configurable (14 jours, conditions), workflow automatisé : demande → vérification d'usage (a-t-il consommé 80% du cours ?) → approbation auto ou revue manuelle → remboursement CMI/Paddle → révocation d'accès propre, stats des motifs de remboursement remontées comme signal qualité du cours.

**Prompt 233 — Certificats LinkedIn et vérification employeur**
Intégration « Ajouter à mon profil LinkedIn » en un clic (format Certification LinkedIn), page publique de vérification par ID/QR (déjà 88 — étends avec API de vérification pour les employeurs, en masse pour les RH), notification à l'instructeur quand un certificat est partagé (social proof).

**Prompt 234 — Importateurs de migration**
Outils d'import depuis les concurrents : Teachable/Thinkific/Podia → LMS SallyCourse (scraping authentifié de son propre compte ou import d'export officiel), mapping automatique de la structure, migration des étudiants avec emails d'invitation, argument commercial de switching massif.

### Ops & plateforme

**Prompt 235 — Support client intégré**
Chatwoot self-hosted intégré (chat widget sur le SaaS et le LMS), bot de premier niveau branché sur la base de connaissances, escalade humaine, tickets liés au contexte (cours/job en erreur automatiquement attaché), SLA par plan.

**Prompt 236 — Base de connaissances auto-générée du SaaS**
La documentation utilisateur de SallyCourse est générée… par SallyCourse : chaque feature livrée déclenche la génération de son article d'aide (avec captures automatiques de l'UI par le module Playwright), centre d'aide searchable (Meilisearch), vidéos tutorielles générées par le pipeline lui-même, versionnées avec les releases.

**Prompt 237 — BI et entrepôt de données**
Metabase self-hosted branché sur des vues Mongo agrégées (jamais la prod en direct — réplica dédié) : dashboards direction (MRR, CAC, LTV, cours générés/publiés/approuvés par plateforme, coûts par provider), rapports programmés par email, accès lecture seule pour les analyses ad hoc.

**Prompt 238 — Résidence des données et conformité régionale**
Options de résidence : données UE (Hetzner Allemagne) vs Maroc (option datacenter local documentée) par workspace, chiffrement au repos Mongo (CSFLE sur les champs sensibles), registre des traitements RGPD généré, DPA téléchargeable pour les clients B2B, journal des transferts de données.

---

## ⚠️ Notes Importantes

1. **Udemy n'a pas d'API d'upload de cours** — l'adapter Udemy repose sur Playwright (automation navigateur). C'est techniquement fonctionnel mais c'est à l'utilisateur d'assumer le risque vis-à-vis des CGU Udemy. Le mode « export ZIP + upload manuel » (Prompt 30) reste l'option 100% sûre.

2. **"Accepté à 100% par Udemy" n'existe pas** — la review est humaine et Udemy scrute les cours générés par IA. Les prompts 26, 27, 48, 81, 82, 90, 94 et 141 maximisent les chances (conformité technique + voix clonée + avatar + contenu original + anti-plagiat + score qualité), mais une intro avec ta vraie voix/webcam reste la meilleure assurance-vie du cours. Udemy exige aussi de déclarer l'usage d'IA.

3. **Ordre d'exécution MVP recommandé** : D1–D12 (design) → 1–30 (génération + export ZIP) → 183–185 (env local + mocks, en réalité à faire dès le début) → publie UN cours manuellement sur Udemy pour valider → 151–162 (bascule open source pour réduire les coûts) → 31–52 + 175–182 (déploiement avec les 3 modes) → le reste. La Phase 7 (qualité) et la Phase 12 (tests) s'appliquent en continu, pas à la fin.

4. **Coût estimé par cours** (10h de contenu) : ~15–40$ en full cloud (Claude + ElevenLabs) vs ~1–3$ en mode open source (Phase 9), à intégrer dans le pricing dès le Prompt 53.

5. **Attention licences OSS** : XTTS-v2 (Coqui) est en licence non-commerciale — pour un SaaS, utilise Kokoro TTS (Apache 2.0) ou Piper (MIT) à la place. Le Prompt 161 verrouille ce point.

---
*SALISTAR Technologies — SallyCourse v1.5 — 250 Prompts (D1–D12 + 1–238) — Juillet 2026*
