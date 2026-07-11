# Guide utilisateur — SallyCourse

Ce guide accompagne un utilisateur final, pas à pas, de la création d'un
compte jusqu'à la publication d'un cours sur une plateforme externe. Les
libellés cités correspondent exactement aux textes affichés dans
l'application (vérifiés dans le code au moment de la rédaction).

## 1. Créer votre compte

1. Ouvrez `/register` (page « Créer un compte — SallyCourse »).
2. Renseignez :
   - **Nom complet**
   - **Adresse email**
   - **Mot de passe**
   - **Confirmer le mot de passe**
3. Cliquez sur **Créer mon compte**. Vous pouvez aussi utiliser
   **S'inscrire avec Google** pour créer votre compte en un clic.
4. Déjà inscrit ? Utilisez le lien **Se connecter** en bas du formulaire pour
   aller sur `/login` (page « Connexion — SallyCourse »), où l'on vous
   demandera votre **Adresse email** et votre **Mot de passe**, avant de
   valider avec **Se connecter**.

Une fois connecté, vous arrivez sur votre tableau de bord (`/dashboard`).

## 2. Créer votre premier cours

1. Depuis le tableau de bord, allez sur **Nouveau cours** (`/dashboard/new`).
2. Écrivez le titre de votre cours dans le grand champ de saisie (exemple
   affiché à titre d'inspiration : *« Ex. Maîtriser Docker en 7 jours »*).
   Un seul titre suffit — SallyCourse compose le reste (plan, vidéos,
   articles, TP, quiz).
3. Choisissez le niveau visé pour vos apprenants — **« Pour quel niveau ? »** :
   - **Débutant**
   - **Intermédiaire**
   - **Avancé**
   Ce choix calibre le ton, le rythme et la difficulté des quiz générés.
4. (Optionnel) Des options avancées vous permettent d'affiner la génération
   (langue, plateformes cibles pressenties, import de matériel source déjà
   existant que SallyCourse peut réutiliser comme base).
5. Cliquez sur **Générer mon cours**. Le bouton affiche brièvement
   « Création du cours… » pendant l'envoi, puis vous êtes redirigé vers la
   page de votre cours.

**Limite de votre offre** : le nombre de cours que vous pouvez créer par mois
dépend de votre plan (voir `/pricing`). Si vous atteignez votre quota, un
message vous l'indique clairement et vous invite à passer à un plan
supérieur.

## 3. Valider le plan de votre cours

Avant de générer tout le contenu (vidéos, articles, quiz), SallyCourse vous
propose d'abord un **plan** (l'organisation des sections et leçons) à
relire — le cours affiche alors le badge **« Plan à valider »**.

1. Sur la page de votre cours, relisez le plan proposé : titres de sections,
   leçons prévues, structure générale.
2. Si le plan ne vous convient pas, cliquez sur **Régénérer le plan** pour en
   obtenir une nouvelle proposition (vous pouvez répéter l'opération autant
   de fois que nécessaire).
3. Une fois satisfait, cliquez sur **Valider et générer le contenu**. C'est
   ce clic qui déclenche la génération complète : vidéos, articles, travaux
   pratiques et quiz.

**Important** : tant que vous n'avez pas cliqué sur « Valider et générer le
contenu », aucune vidéo ni article n'est produit — vous ne consommez pas
inutilement votre quota ou votre budget sur un plan qui ne vous convient pas.

## 4. Suivre la génération de votre cours

Après validation du plan, la page de votre cours affiche une **bannière de
progression** qui avance en temps réel au fur et à mesure que chaque élément
est généré (leçons vidéo, articles, travaux pratiques, quiz, ressources).

- Le badge de statut passe de génération en cours à terminé (ou, en cas de
  souci sur un élément précis, un statut d'échec ciblé — vous pouvez alors
  relancer uniquement l'élément concerné plutôt que tout le cours).
- Une fois la génération terminée, vous accédez à :
  - L'arborescence complète de vos leçons, avec vidéos, articles et quiz
    prêts à être relus.
  - Un panneau **Ressources** listant les fichiers complémentaires générés
    (supports téléchargeables, liens utiles).
  - Un **score qualité** de votre cours, avec le détail des points vérifiés.
  - Un rapport téléchargeable et le pack complet de votre cours (bouton de
    téléchargement du ZIP), utile si vous voulez conserver une copie locale
    ou déployer manuellement ailleurs.

Vous pouvez fermer la page pendant la génération : elle se poursuit côté
serveur et vous retrouverez l'état à jour en revenant sur la page du cours.

## 5. Relire et ajuster le contenu

Avant de déployer, vous pouvez :
- Relire chaque article et chaque script vidéo, et les modifier directement
  si un détail vous semble à corriger.
- Relire les quiz générés (questions, réponses, corrigés) et les ajuster.
- Consulter la galerie de captures d'écran associée aux travaux pratiques,
  pour vérifier qu'elles illustrent bien les étapes attendues.
- Demander une traduction du cours dans une autre langue si vous ciblez un
  public international (panneau de traduction sur la page du cours).

## 6. Connecter vos plateformes

Avant de pouvoir déployer, connectez au moins une plateforme cible :

1. Allez sur **Plateformes** (`/dashboard/settings/platforms`).
2. Choisissez une plateforme dans la liste (Udemy, YouTube, Teachable,
   Thinkific, Podia, Gumroad, Skillshare, Moodle, ou votre propre LMS interne)
   et suivez les instructions de connexion propres à chacune (identifiants,
   jeton d'API, ou autorisation OAuth selon la plateforme).
3. Une fois connectée, la plateforme apparaît comme disponible dans l'écran
   de déploiement de vos cours.

## 7. Déployer votre cours

1. Sur la page de votre cours, ouvrez la section **Déployer le cours**.
2. **Sélectionnez les plateformes cibles**, **choisissez le mode**, puis
   lancez :
   - **Auto** : SallyCourse publie sans intervention de votre part.
   - **Assisté** : SallyCourse prépare tout, mais vous confirmez chaque étape
     sensible (utile pour garder un contrôle total sur ce qui est publié).
   - **Manuel** : SallyCourse prépare les fichiers et instructions, à vous de
     finaliser la publication vous-même sur la plateforme.
3. Un indicateur vous montre le nombre de plateformes sélectionnées et la
   durée estimée du déploiement. Notez que certaines plateformes (par
   exemple Udemy) nécessitent une connexion active pour être déployées avec
   succès — un message vous en informe si la connexion manque.
4. Une fois lancé, un toast **« Déploiement lancé »** confirme la mise en
   file d'attente (avec un nombre maximal de plateformes traitées en
   parallèle). Vous voyez ensuite, plateforme par plateforme, la progression
   étape par étape (par exemple : leçon 3 sur 12), avec des logs détaillables
   en cas de besoin.
5. À la fin, un toast **« Déploiement terminé »** (ou, si un problème est
   survenu sur une plateforme précise, **« Déploiement terminé avec des
   échecs »**, avec un bouton pour relancer uniquement la plateforme en
   échec) vous informe du résultat.
6. Une fois publié avec succès, un lien direct vers votre cours sur chaque
   plateforme externe est disponible — vérifiez-le pour confirmer que tout
   s'affiche correctement aux yeux de vos futurs apprenants.

## 8. Mettre à jour un cours déjà déployé

Si vous modifiez du contenu après un premier déploiement (correction d'un
article, remplacement d'une vidéo), la section déploiement propose
**Mettre à jour les plateformes** : seules les leçons modifiées sont
ré-envoyées, sans tout republier depuis zéro.

## 9. Gérer votre compte

Depuis **Réglages → Compte** (`/dashboard/settings/account`) :
- Exportez l'ensemble de vos données personnelles à tout moment.
- Supprimez définitivement votre compte si vous le souhaitez (action
  irréversible : cours, credentials de plateformes connectées et clés API
  associées sont supprimés).

Pour toute question sur l'usage de vos données, consultez la
**Politique de confidentialité** (`/legal/confidentialite`), les
**Conditions d'utilisation** (`/legal/cgu`) et les **Conditions de vente**
(`/legal/cgv`), accessibles depuis le pied de page du site.

## 10. Besoin d'aller plus loin ?

- **API & Webhooks** (`/dashboard/settings/api-keys`) : générez une clé API
  pour créer et déployer des cours par programmation, si vous voulez
  intégrer SallyCourse à vos propres outils.
- **Génération par lot** (`/dashboard/batch`) : créez plusieurs cours en une
  seule fois si vous gérez un catalogue entier.
- **Recherche de niche** (`/dashboard/niche-research`) : si vous cherchez un
  sujet de cours porteur avant même de choisir votre titre.
- **Programme d'affiliation** (`/dashboard/affiliate`) : suivez vos
  recommandations si vous partagez SallyCourse à d'autres formateurs.
