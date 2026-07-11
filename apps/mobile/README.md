# @sallycourse/mobile

Application mobile de suivi SallyCourse (Expo / React Native). Permet de se
connecter avec une clé API, consulter la liste des cours, suivre la
progression d'un cours en génération et lire les notifications.

## Ce que contient ce package

- `App.tsx` — point d'entrée, navigation minimale (state machine, pas de
  react-navigation).
- `src/api/client.ts` — client API pur (`SallyCourseClient`), aucune
  dépendance React Native. Consomme :
  - `GET /api/v1/courses` — liste des cours (auth clé API).
  - `GET /api/v1/courses/[id]` — détail + progression d'un cours.
  - `GET /api/notifications` — notifications in-app (auth clé API).
- `src/api/storage.ts` — persistance locale de la clé API + URL serveur
  (AsyncStorage).
- `src/context/AuthContext.tsx` — état d'auth global (login/logout,
  restauration au démarrage).
- `src/screens/` — `LoginScreen`, `CourseListScreen`, `CourseDetailScreen`
  (polling 5s via `COURSE_POLL_INTERVAL_MS`), `NotificationsScreen`.

## Authentification

Il n'y a pas de flow email/mot de passe côté API publique v1 : l'authentification
se fait par **clé API** (`Authorization: Bearer <clé>`), générée depuis le
dashboard web (Réglages → Clés API). L'écran de connexion demande :

1. L'URL du serveur SallyCourse (ex: `https://app.sallycourse.com`).
2. La clé API (`sk_...`).

La clé est vérifiée par un appel léger (`GET /api/v1/courses`) puis stockée
sur le device (AsyncStorage). Pas de mot de passe stocké ni transmis.

## Lancer l'app avec Expo Go

Prérequis : Node.js installé, l'app **Expo Go** installée sur un téléphone
(iOS/Android), et le téléphone sur le même réseau Wi-Fi que la machine de dev
(ou utiliser le mode tunnel).

```bash
# Depuis la racine du monorepo, installer les dépendances de CE package
# (nouveau package pas encore installé par le pnpm install global) :
pnpm install --filter @sallycourse/mobile

# Puis lancer Expo :
pnpm --filter @sallycourse/mobile start
```

Scanner le QR code affiché avec l'app Expo Go (Android : scanner intégré à
Expo Go ; iOS : appareil photo puis ouvrir dans Expo Go).

Autres commandes utiles :

```bash
pnpm --filter @sallycourse/mobile android   # émulateur/device Android connecté
pnpm --filter @sallycourse/mobile ios       # simulateur iOS (macOS uniquement)
pnpm --filter @sallycourse/mobile web       # preview web (Metro bundler web)
```

## Configuration de l'URL par défaut

`app.json` → `expo.extra.apiBaseUrl` définit l'URL pré-remplie dans l'écran
de connexion. Modifiable directement dans le fichier ou en changeant le champ
à l'écran (persisté après le premier login réussi).

## Tests

Le package ne teste que la logique **pure** du client API (aucun rendu React
Native, pas de jest-expo ni de RN Testing Library) :

```bash
pnpm --filter @sallycourse/mobile test
```

Couvre : construction des URLs/en-têtes, appels `listCourses` /
`getCourse` / `listNotifications`, gestion des erreurs API (`ApiError`),
`verifyCredentials`.

## Limitations connues (mode minimal, Prompt 98)

- Pas de config native générée (pas de dossiers `android/`/`ios/`, pas de
  gradle/xcode) — uniquement le code source Expo managé.
- Pas de push notifications natives : l'écran Notifications lit
  `GET /api/notifications` par polling manuel (pull-to-refresh), pas de
  temps réel.
- Pas de SSE mobile : la progression d'un cours en génération est actualisée
  par polling toutes les 5s (`COURSE_POLL_INTERVAL_MS` dans
  `src/api/client.ts`), tant que le cours n'est pas dans un état terminal
  (`ready`/`failed`/`cancelled`).
- Navigation interne minimale (state machine dans `App.tsx`), pas de
  react-navigation — à introduire si l'app grandit (deep links, gestures,
  historique natif).
- `dependencies` déclarées dans `package.json` mais **jamais installées par
  cet agent** (interdiction d'exécuter `pnpm install`) : lancer
  `pnpm install --filter @sallycourse/mobile` avant le premier `expo start`.
- Pas d'icône/splash réels fournis (`assets/icon.png` référencé dans
  `app.json` mais absent) : Expo utilisera ses valeurs par défaut tant que ces
  fichiers ne sont pas ajoutés.
