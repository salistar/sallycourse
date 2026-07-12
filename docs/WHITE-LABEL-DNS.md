# Sous-domaines white-label — configuration DNS/reverse-proxy (Prompt 143)

Ce document décrit ce qu'il faut configurer **en production** pour que
`https://<sous-domaine>.sallycourse.com` affiche le catalogue white-label du
client (plan Business), en plus du routage applicatif déjà en place
(`apps/web/src/middleware.ts` + `apps/web/src/app/school/[subdomain]`).

## 1. Fonctionnement applicatif (déjà implémenté)

1. Le client configure son sous-domaine dans **Réglages → Marque blanche**
   (`SchoolBranding.customSubdomain`, ex. `academie-client`).
2. Le middleware Next (`apps/web/src/middleware.ts`) lit le header `Host` de
   chaque requête. S'il se termine par `.sallycourse.com` (hors `www`), il
   réécrit (rewrite interne, transparent pour le navigateur) l'URL vers
   `/school/<sous-domaine>/...`.
3. La page `apps/web/src/app/school/[subdomain]/page.tsx` résout le
   `SchoolBranding` correspondant et affiche uniquement les cours publiés
   (`LmsListing`) dont le `userId` est celui du propriétaire du branding.
4. Aucun `SchoolBranding` trouvé pour ce sous-domaine → 404.

Ce mécanisme fonctionne dès que le trafic HTTP pour
`*.sallycourse.com` **atteint effectivement l'application Next** avec le bon
`Host` — c'est le rôle du DNS + reverse-proxy décrit ci-dessous.

## 2. DNS — wildcard obligatoire

Chez le registrar / la zone DNS (ex. Cloudflare) de `sallycourse.com` :

```
Type   Nom                         Valeur                          Proxy
A      *.sallycourse.com           <IP publique du serveur/LB>     ⛔ ou ✅ (voir §4)
A      sallycourse.com             <IP publique du serveur/LB>     ⛔ ou ✅
CNAME  www.sallycourse.com         sallycourse.com                 ⛔ ou ✅
```

- Le wildcard `*.sallycourse.com` route **tout** sous-domaine (existant ou
  non) vers la même IP/reverse-proxy. C'est voulu : la 404 applicative (côté
  Next, cf. §1.4) gère les sous-domaines non configurés — pas la peine de
  gérer un enregistrement DNS par client.
- TTL bas (300s) recommandé le temps de valider la configuration.

## 3. Reverse-proxy — certificat wildcard + routage vers l'app

Le reverse-proxy doit :
1. Terminer TLS avec un **certificat wildcard** `*.sallycourse.com` (+ apex
   `sallycourse.com`) — un certificat par sous-domaine n'est pas praticable
   (nombre de clients non borné, ACME rate-limits Let's Encrypt).
2. Router **tout** `Host` se terminant par `sallycourse.com` vers le même
   backend Next (`apps/web`) — pas de routage par sous-domaine ici, c'est le
   middleware applicatif qui distingue.

### Option Caddy (recommandé — ACME wildcard intégré via plugin DNS)

Caddy ne peut obtenir un certificat wildcard qu'en challenge **DNS-01**
(nécessite un plugin DNS provider, ex. `caddy-dns/cloudflare`) :

```caddyfile
# Caddyfile — nécessite le module caddy-dns/cloudflare (ou équivalent)
*.sallycourse.com, sallycourse.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    reverse_proxy apps-web:3000
}
```

- `CLOUDFLARE_API_TOKEN` : token scope "Zone:DNS:Edit" sur la zone
  `sallycourse.com` (permet à Caddy de poser le enregistrement TXT du
  challenge DNS-01, jamais de modifier le trafic).
- `apps-web:3000` : le service Docker/interne exposant `apps/web` (Next).

### Option Traefik (alternative)

```yaml
# docker-compose labels sur le service apps-web
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.sallycourse.rule=HostRegexp(`{subdomain:.+}.sallycourse.com`) || Host(`sallycourse.com`)"
  - "traefik.http.routers.sallycourse.tls.certresolver=dnschallenge"
  - "traefik.http.services.sallycourse.loadbalancer.server.port=3000"
```

Le `certresolver` `dnschallenge` doit être configuré (dans la config statique
Traefik) avec le provider DNS (Cloudflare, OVH, etc.) et le challenge DNS-01
pour supporter le wildcard.

## 4. Cloudflare — proxy (orange cloud) vs DNS-only

Si Cloudflare est déjà utilisé comme CDN/WAF devant l'app (proxy activé,
"orange cloud") :
- Cloudflare gère lui-même le certificat périphérique (Universal SSL couvre
  `*.sallycourse.com` en 1 niveau via son "Advanced Certificate Manager" ou
  équivalent) — le reverse-proxy origin (Caddy/Traefik) peut alors utiliser
  un certificat "origin" Cloudflare au lieu d'un vrai wildcard public.
- Le header `Host` transmis à l'origin reste celui du sous-domaine demandé
  (comportement par défaut) — aucun changement côté middleware Next.

## 5. Variable d'application

`apps/web/src/lib/white-label.ts` lit `NEXT_PUBLIC_ROOT_DOMAIN` (optionnelle,
défaut `sallycourse.com`) pour reconnaître le domaine racine. À définir dans
l'environnement de prod si le domaine diffère (staging, ex.
`staging.sallycourse.app`) :

```
NEXT_PUBLIC_ROOT_DOMAIN=sallycourse.com
```

## 6. Domaine custom du client (amélioration future — non implémentée)

Au-delà du sous-domaine `*.sallycourse.com`, un client Business pourrait
vouloir son propre domaine (`cours.academie-client.com`). Ceci n'est **pas**
implémenté par le Prompt 143 ; flow prévu pour une itération future :

1. **Ajout du domaine côté client** : le client entre `cours.academie-client.com`
   dans les réglages (nouveau champ `SchoolBranding.customDomain`, additif —
   distinct de `customSubdomain`).
2. **Vérification de propriété (avant activation)** : générer un jeton
   unique et demander au client de poser soit :
   - un enregistrement **TXT** `_sallycourse-verify.cours.academie-client.com`
     contenant le jeton (ne redirige rien, sert uniquement à prouver le
     contrôle DNS) ; ou
   - un enregistrement **CNAME** `cours.academie-client.com → verify.sallycourse.com`
     temporaire, si l'hébergeur DNS du client ne permet pas les TXT sur un
     sous-chemin.
3. **Job de vérification** (worker BullMQ, poll périodique ou déclenché par
   le client via un bouton "Vérifier") : résout le DNS (TXT ou CNAME) et
   confirme la correspondance avec le jeton attendu.
4. **Une fois vérifié** : le client pointe son domaine (CNAME définitif) vers
   `proxy.sallycourse.com` (ou l'IP du reverse-proxy) ; le reverse-proxy émet
   alors un certificat **par domaine custom** via HTTP-01 (pas de wildcard
   nécessaire ici puisque chaque domaine custom est individuel) — Caddy fait
   cela automatiquement "on-demand TLS" à condition de whitelister uniquement
   les domaines vérifiés (`ask` endpoint interrogeant l'app pour confirmer
   que ce domaine correspond bien à un `SchoolBranding.customDomain` vérifié
   — sécurité anti-abus obligatoire, sinon n'importe qui peut demander un
   certificat pour un domaine arbitraire pointé vers votre IP).
5. Le middleware Next devrait alors résoudre le `Host` custom directement
   (recherche `SchoolBranding.findOne({ customDomain: host })`) en plus de la
   résolution par sous-domaine déjà en place.

Cette partie custom-domain reste à construire (modèle, job de vérification,
config Caddy "on-demand TLS" avec endpoint `ask`, UI de statut de
vérification) — documentée ici pour ne pas bloquer l'itération actuelle.
