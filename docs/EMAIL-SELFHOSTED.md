# Email auto-hébergé (SMTP OSS) — Prompt 156

SallyCourse envoie ses emails transactionnels (notifications, séquences
marketing) via `packages/db/src/email/send.ts`. Le canal **SMTP** est le
**défaut open-source** ; Resend (cloud) reste une **option**, activée selon
`PROVIDER_MODE` (voir `docs/PROVIDERS.md`) :

| `PROVIDER_MODE` | Canal choisi |
|---|---|
| `oss` | SMTP toujours (ignore `RESEND_API_KEY`). |
| `cloud` | Resend si `RESEND_API_KEY` présente, sinon repli SMTP. |
| `auto` (défaut) | Resend **seulement si** `RESEND_API_KEY` présente **ET** plan destinataire pro/business ; sinon SMTP. |
| — | Ni `RESEND_API_KEY` ni `SMTP_URL` → mode mock (log, aucun envoi réseau). |

En développement, `docker-compose.yml` (profil `debug`) démarre déjà
**Mailpit** (`SMTP_URL=smtp://mailpit:1025`, UI web sur `:8025`) — aucune
configuration DNS nécessaire, les emails restent en local.

## Référence de déploiement auto-hébergé (production)

Ce document est une **référence de configuration**, pas un déploiement
exécuté par ce projet : il documente comment pointer `SMTP_URL` vers un relai
SMTP auto-hébergé réel, avec deux options équivalentes.

### Option A — Stalwart Mail Server (recommandé, tout-en-un)

[Stalwart](https://stalw.art/) est un serveur mail OSS moderne (Rust) qui gère
SMTP + IMAP + DKIM/SPF/DMARC nativement, avec une image Docker officielle.

```yaml
# Extrait docker-compose (déploiement séparé de l'infra SallyCourse — pas
# ajouté au docker-compose.yml du monorepo : ce service tourne sur un host
# dédié avec un nom de domaine et des ports 25/587 exposés publiquement).
services:
  stalwart:
    image: stalwartlabs/mail-server:latest
    ports:
      - "25:25"     # SMTP entrant/relai
      - "587:587"   # Soumission (STARTTLS)
      - "8080:8080" # Admin web
    volumes:
      - stalwart-data:/opt/stalwart-mail
```

Puis dans `.env` de SallyCourse :

```
SMTP_URL=smtp://sallycourse:MOT_DE_PASSE@mail.sallycourse.app:587
```

### Option B — Postfix (minimal, relai sortant seulement)

Pour un simple relai sortant (pas de boîtes de réception), un Postfix
classique suffit :

```bash
apt-get install postfix
postconf -e 'smtpd_tls_security_level=may'
postconf -e 'myhostname=mail.sallycourse.app'
```

```
SMTP_URL=smtp://mail.sallycourse.app:25
```

## DKIM / SPF / DMARC

La délivrabilité (ne pas finir en spam) dépend de trois enregistrements DNS.
Le script `scripts/setup-dkim.sh` génère la paire de clés DKIM et affiche les
trois enregistrements à ajouter chez votre registrar/DNS (Cloudflare, etc.) —
il ne modifie AUCUN DNS lui-même (aucun accès réseau), il produit juste les
valeurs à copier-coller.

```bash
./scripts/setup-dkim.sh sallycourse.app mail
```

Produit :
- `dkim-sallycourse.app/mail.private.pem` — clé privée DKIM (à charger dans
  Stalwart/Postfix/OpenDKIM, **jamais commitée**, déjà couverte par
  `.gitignore` du dossier `dkim-*`).
- `dkim-sallycourse.app/mail.public.pem` — clé publique (informatif).
- Un enregistrement **TXT DKIM** (`mail._domainkey.sallycourse.app`).
- Un enregistrement **TXT SPF** (`sallycourse.app`).
- Un enregistrement **TXT DMARC** (`_dmarc.sallycourse.app`).

Exemple de sortie DNS à ajouter :

```
Type  Nom                              Valeur
TXT   mail._domainkey.sallycourse.app  v=DKIM1; k=rsa; p=MIGfMA0GCSq...
TXT   sallycourse.app                  v=spf1 mx a:mail.sallycourse.app -all
TXT   _dmarc.sallycourse.app           v=DMARC1; p=quarantine; rua=mailto:dmarc@sallycourse.app
```

Après propagation DNS (quelques minutes à 24h), vérifier avec :

```bash
dig TXT mail._domainkey.sallycourse.app +short
dig TXT sallycourse.app +short
dig TXT _dmarc.sallycourse.app +short
```

## Basculer vers Resend (cloud)

Aucune action DNS ci-dessus n'est requise si vous préférez rester 100% cloud :
renseignez `RESEND_API_KEY` et laissez `PROVIDER_MODE=auto` (défaut) — les
utilisateurs pro/business passeront automatiquement par Resend, les
utilisateurs free resteront sur SMTP (ou mock si `SMTP_URL` est aussi absente).
Pour forcer Resend pour tout le monde : `PROVIDER_MODE=cloud`.
