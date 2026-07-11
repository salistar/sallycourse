# Guide d'import Coursera / edX (export Common Cartridge)

## Pourquoi cet export est manuel

Contrairement à Udemy, Skillshare, Teachable, Thinkific, Podia, Gumroad,
Hotmart, Kajabi ou Moodle, **Coursera et edX n'exposent aucune API publique de
publication de cours** et n'acceptent pas les créateurs individuels :

- **Coursera** ne publie des cours que via des **partenariats institutionnels**
  (universités, écoles, entreprises) signés avec Coursera for Campus / Coursera
  for Business. Le contenu se construit et se publie dans **Coursera Partner
  Studio**, un outil interne réservé aux comptes partenaires validés.
- **edX** (désormais géré par 2U/Axim Collaborative) suit le même modèle : la
  création de cours passe par **edX Studio**, accessible uniquement aux
  organisations enregistrées comme partenaires edX (établissements
  d'enseignement supérieur ou organismes agréés).

Aucun des deux ne propose de clé API, de webhook ou de Playwright-friendly
flow pour créer/publier un cours par un tiers non partenaire. SallyCourse ne
peut donc **pas automatiser** la publication sur ces plateformes — l'adapter
`coursera-edx` s'arrête à la génération d'un **export standard** que
l'utilisateur importe lui-même une fois son statut de partenaire obtenu.

## Ce que produit l'adapter

Un fichier **`common-cartridge.imscc`** (archive ZIP au format **IMS Common
Cartridge 1.3**), archivé dans le stockage du cours
(`courses/{id}/exports/common-cartridge.imscc`). Ce format est reconnu comme
format d'import standard par Coursera Partner Studio et edX Studio (tous deux
s'appuient sur l'écosystème Open edX / IMS Global).

Contenu du paquet :

| Fichier | Rôle |
| --- | --- |
| `imsmanifest.xml` | Table des matières (organizations/items) + déclaration des ressources |
| `NN-slug-lecon.html` | Une page HTML autonome par leçon (article rendu ou lecteur vidéo) |
| `quiz-NN-slug-section.xml` | Quiz de chaque section au format QTI 1.2 simplifié |
| `assets/NN-slug.mp4` | Vidéos des leçons de type vidéo |

## Étapes pour publier réellement le cours

### 1. Devenir partenaire (préalable obligatoire, côté B2B universités)

**Coursera :**
1. Se rendre sur [partner.coursera.org](https://partner.coursera.org) (ou
   contacter l'équipe Coursera for Campus/Business).
2. Soumettre une candidature partenaire : nom de l'institution, accréditation,
   domaine d'expertise, exemples de contenu pédagogique.
3. Attendre la validation par l'équipe partenariats Coursera (délai typique :
   plusieurs semaines à quelques mois selon le dossier).
4. Une fois approuvé, un accès à **Coursera Partner Studio** est fourni.

**edX :**
1. Contacter l'équipe partenariats via
   [edx.org/course/partner-with-edx](https://www.edx.org) ou Axim
   Collaborative (organisation qui gère edX.org depuis 2023).
2. Fournir les mêmes justificatifs institutionnels.
3. Une fois approuvé, un accès **edX Studio** (Open edX Studio) est fourni,
   incluant la création d'un « Organization » et d'un cours (course run).

### 2. Importer le fichier `.imscc`

**Dans Coursera Partner Studio :**
1. Créer un nouveau cours (ou ouvrir un cours existant en brouillon).
2. Utiliser la fonction d'import de contenu (« Import from file » /
   équivalent Common Cartridge selon la version de l'interface fournie par
   Coursera à ses partenaires).
3. Vérifier le rendu de chaque module importé (les pages HTML des leçons
   restent éditables dans l'éditeur Coursera).
4. Réassocier les quiz importés au moteur d'évaluation natif de Coursera si
   le format QTI n'est pas repris tel quel (certains partenaires re-saisissent
   les questions dans l'éditeur natif — le fichier XML sert de référence).

**Dans edX Studio :**
1. Aller dans **Settings → Advanced Settings → Import** (ou **Tools →
   Import**, selon version) du cours cible.
2. Sélectionner le fichier `.imscc` téléchargé depuis SallyCourse.
3. Lancer l'import ; edX Studio crée automatiquement la structure de
   sections/unités à partir de `imsmanifest.xml`.
4. Vérifier les vidéos : edX exige généralement un ré-encodage/upload via son
   propre pipeline vidéo (VEDA) pour bénéficier du CDN — le MP4 embarqué sert
   de source, pas de lien final.
5. Vérifier les quiz : recréer les problèmes graders natifs edX (Problem
   Component) à partir du XML QTI si l'import automatique ne les convertit
   pas tel quel.

### 3. Publier

Chaque plateforme conserve son propre circuit de relecture pédagogique
(peer review interne à l'institution, puis validation Coursera/edX) avant mise
en ligne publique — hors de portée de SallyCourse.

## Statut renvoyé par SallyCourse

Une fois l'export généré, l'adapter marque le déploiement comme
`status: 'published'` avec `externalUrl: undefined` et
`reviewState: 'export_ready'` : cela signifie **« export prêt à être importé
manuellement »**, pas « cours en ligne sur Coursera/edX ». Le lien réel n'existe
qu'après l'import + publication effectués par l'équipe partenaire dans son
propre outil.
