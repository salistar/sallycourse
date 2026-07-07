# SallyCourse — raccourcis développeur.
# Sous Windows sans make : utilisez les scripts pnpm équivalents (voir README).

.DEFAULT_GOAL := help
COMPOSE := docker compose

.PHONY: help setup up up-full down logs seed clean

help: ## Affiche cette aide
	@echo "Cibles disponibles :"
	@echo "  make setup     Lancement local one-command (prérequis, .env, up core, seed)"
	@echo "  make up        Démarre le profil core (web, worker, mongo, redis, minio)"
	@echo "  make up-full   Démarre le profil full (core + services IA)"
	@echo "  make down      Arrête et supprime les conteneurs"
	@echo "  make logs      Suit les logs de tous les services"
	@echo "  make seed      Exécute le seed de données de démo"
	@echo "  make clean     Arrête et supprime AUSSI les volumes (destructif)"

setup: ## Expérience « ça marche en 5 minutes »
	node scripts/setup.mjs

up: ## Démarre le profil core en arrière-plan
	$(COMPOSE) --profile core up -d

up-full: ## Démarre le profil full (avec IA) en arrière-plan
	$(COMPOSE) --profile full up -d

down: ## Arrête les conteneurs (volumes conservés)
	$(COMPOSE) down

logs: ## Suit les logs
	$(COMPOSE) logs -f

seed: ## Seed de données de démonstration
	pnpm --filter @sallycourse/worker seed

clean: ## Arrêt + suppression des volumes (efface les données locales)
	$(COMPOSE) down -v
