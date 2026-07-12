#!/usr/bin/env bash
# Génération de la paire de clés DKIM + enregistrements DNS (SPF/DMARC) pour un
# email auto-hébergé (Prompt 156, voir docs/EMAIL-SELFHOSTED.md).
#
# 100% LOCAL — aucun accès réseau, aucune modification DNS : ce script génère
# les clés via openssl et affiche les enregistrements TXT à ajouter manuellement
# chez votre registrar/DNS (Cloudflare, etc.).
#
# Usage :
#   ./scripts/setup-dkim.sh <domaine> [sélecteur]
#   ./scripts/setup-dkim.sh sallycourse.app mail
#
# Sortie :
#   dkim-<domaine>/<sélecteur>.private.pem  — clé privée (à charger dans
#                                              Stalwart/Postfix/OpenDKIM)
#   dkim-<domaine>/<sélecteur>.public.pem   — clé publique (informatif)
#   Enregistrements TXT DKIM + SPF + DMARC affichés dans le terminal.

set -euo pipefail

DOMAIN="${1:-}"
SELECTOR="${2:-mail}"

if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domaine> [sélecteur=mail]" >&2
  echo "Exemple: $0 sallycourse.app mail" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "✗ openssl introuvable — requis pour générer la paire de clés DKIM." >&2
  exit 1
fi

OUT_DIR="dkim-${DOMAIN}"
mkdir -p "$OUT_DIR"

PRIVATE_KEY="${OUT_DIR}/${SELECTOR}.private.pem"
PUBLIC_KEY="${OUT_DIR}/${SELECTOR}.public.pem"

# Clé RSA 2048 bits — recommandation courante DKIM (2048 = bon compromis
# compatibilité/sécurité ; 1024 est déprécié, 4096 dépasse parfois la limite
# de longueur d'un enregistrement TXT DNS sans découpage).
if [ -f "$PRIVATE_KEY" ]; then
  echo "! ${PRIVATE_KEY} existe déjà — réutilisation (supprimer le dossier pour régénérer)."
else
  openssl genrsa -out "$PRIVATE_KEY" 2048 2>/dev/null
  echo "✓ Clé privée générée : ${PRIVATE_KEY}"
fi

openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY" 2>/dev/null
echo "✓ Clé publique générée : ${PUBLIC_KEY}"

# Extrait la clé publique en base64 sans les en-têtes PEM (format attendu par
# l'enregistrement TXT DKIM : p=<base64 sans saut de ligne>).
PUBKEY_B64=$(grep -v -- '-----' "$PUBLIC_KEY" | tr -d '\n')

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Enregistrements DNS à ajouter (${DOMAIN})"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "1) DKIM — signature des emails sortants"
echo "   Type : TXT"
echo "   Nom  : ${SELECTOR}._domainkey.${DOMAIN}"
echo "   Valeur :"
echo "   v=DKIM1; k=rsa; p=${PUBKEY_B64}"
echo ""
echo "2) SPF — autorise ce serveur à envoyer pour le domaine"
echo "   Type : TXT"
echo "   Nom  : ${DOMAIN}"
echo "   Valeur :"
echo "   v=spf1 mx a:${SELECTOR}.${DOMAIN} -all"
echo "   (adapter 'a:${SELECTOR}.${DOMAIN}' à l'hôte réel du relai SMTP si différent)"
echo ""
echo "3) DMARC — politique de rejet/quarantaine + rapports"
echo "   Type : TXT"
echo "   Nom  : _dmarc.${DOMAIN}"
echo "   Valeur :"
echo "   v=DMARC1; p=quarantine; rua=mailto:dmarc@${DOMAIN}"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "Vérification après propagation DNS (quelques minutes à 24h) :"
echo "  dig TXT ${SELECTOR}._domainkey.${DOMAIN} +short"
echo "  dig TXT ${DOMAIN} +short"
echo "  dig TXT _dmarc.${DOMAIN} +short"
echo ""
echo "Charger ${PRIVATE_KEY} dans votre serveur mail (Stalwart/Postfix/OpenDKIM)"
echo "— voir docs/EMAIL-SELFHOSTED.md. Ce fichier ne doit JAMAIS être commité."
