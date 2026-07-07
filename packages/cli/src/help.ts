// Textes d'aide du CLI. Affichés via --help ou en l'absence de commande.

export const USAGE = `sallycourse — pilote l'API SallyCourse depuis le terminal.

Usage :
  sallycourse <commande> [options]

Commandes :
  create "<titre>"              Génère un nouveau cours.
  status <courseId>            Affiche l'état d'un cours et de ses déploiements.
  deploy <courseId>            Déploie un cours sur des plateformes.
  help                         Affiche cette aide.

Configuration (requise) :
  --api-url <url>              URL de base de l'API (défaut : $SALLYCOURSE_API_URL).
  --api-key <clé>              Clé API sk_live_... (défaut : $SALLYCOURSE_API_KEY).

Options globales :
  --json                       Sortie JSON brute (scripting).
  --help, -h                   Aide de la commande.

Exemples :
  sallycourse create "Docker pour DevOps" --level intermediate --deploy udemy,youtube --lang fr
  sallycourse status 665f0a...
  sallycourse deploy 665f0a... --platforms udemy,youtube --mode auto
  sallycourse create --file titres.txt --deploy udemy
`;

export const CREATE_HELP = `sallycourse create — génère un ou plusieurs cours.

Usage :
  sallycourse create "<titre>" [options]
  sallycourse create --file <fichier> [options]

Options :
  --level <niveau>             beginner | intermediate | advanced (défaut beginner).
  --lang <langue>              fr | en | ar (défaut fr).
  --deploy <a,b>               Plateformes cibles à la génération (CSV).
  --sections <n>               Nombre approximatif de sections (3–30).
  --file <chemin>              Batch : un titre par ligne (surcharges "titre | level=… | deploy=a,b").
  --json                       Sortie JSON brute.

Exemple :
  sallycourse create "Docker pour DevOps" --level intermediate --deploy udemy,youtube --lang fr
`;

export const STATUS_HELP = `sallycourse status — état d'un cours.

Usage :
  sallycourse status <courseId> [--json]
`;

export const DEPLOY_HELP = `sallycourse deploy — déploie un cours existant.

Usage :
  sallycourse deploy <courseId> --platforms <a,b> [--mode auto|assisted|manual] [--json]

Options :
  --platforms <a,b>            Plateformes cibles (CSV, obligatoire).
  --mode <mode>                auto (défaut) | assisted | manual.
  --json                       Sortie JSON brute.
`;
