# Validation du kit

Recette exécutée le 8 septembre 2026 sur Windows avec Docker Desktop (moteur Linux) et Docker Compose.

## Vérifications

- Six tests du modèle : identités et unités, effet de la ventilation, expiration, booléens stricts, commandes mal formées, répétition d’une commande et conflit d’identifiant.
- Sept tests d’intégration MQTT : mesures et état retained, commande et résultat stable, commande invalide et absence de réponse, doublon et retard, message invalide et silence/reprise, montée/retour du CO₂, restrictions du compte backend.
- Recette Docker : démarrage sur un projet temporaire, commande via le diagnostic, refus d’un client anonyme, reprise après interruption du broker, Last Will après suspension, reprise après suspension, arrêt propre et redémarrage des trois objets.

Commande reproductible : `python tests/acceptance.py`. Elle utilise les trois objets par défaut. Le workflow GitHub Actions reprend cette commande.

Ces vérifications portent sur le kit fourni. Les scénarios métier, le stockage, les droits des utilisateurs applicatifs et les parcours mobiles restent à tester dans la réalisation étudiante.

## Versions utilisées

- Python 3.12 dans `python:3.12-slim`.
- Eclipse Mosquitto 2.0.22.
- Eclipse Paho MQTT Python 2.1.0.
- Docker Engine 29.2.1 et Docker Compose 5.1.0 pour la validation locale.

Le tag Python et les versions des outils de CI peuvent évoluer ; relancer la recette lors d’une mise à jour de l’environnement.
