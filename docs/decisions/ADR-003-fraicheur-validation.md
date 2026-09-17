# ADR-003 — Fraîcheur des données et stratégie de validation

**Date :** 2026-09-17  
**Statut :** Accepté

## Contexte

Les messages MQTT peuvent être malformés, physiquement incohérents, ou retransmis en double
(QoS 1). Accepter aveuglément tous les messages polluerait MongoDB et PostgreSQL avec des
données corrompues ou redondantes, rendant l'historique non fiable. Il faut définir
précisément ce qui constitue un message valide, frais et non dupliqué, et garantir que tout
rejet est tracé.

## Décision

`parseTelemetry` applique trois couches de validation en séquence : (1) validation structurelle
via Zod (`message_id`, `device_id`, `room_id`, `observed_at`, `temperature.value`,
`co2.value`), (2) plausibilité physique (température entre -50°C et 100°C, CO2 entre 0 et
5000 ppm), (3) `observed_at` doit être une date ISO valide. La déduplication utilise
`message_id` : MongoDB applique `$setOnInsert` en premier filtre, PostgreSQL applique
`ON CONFLICT DO NOTHING` en second. `updateTelemetrySeen(deviceId, receivedAt)` met à jour
`last_seen_at` à chaque télémétrie acceptée. Tout rejet émet un log `telemetry.rejected`
structuré avec un champ `reason`, indexé par Loki.

## Alternatives envisagées

- **Accepter tous les messages, filtrer à la lecture** — rejetée : les données invalides
  s'accumulent dans MongoDB et dégradent la fiabilité de l'historique d'audit.
- **Valider uniquement la structure Zod, ignorer les bornes physiques** — rejetée : un capteur
  défectueux renvoyant 999°C passerait silencieusement et corromprait l'historique.
- **Déduplication côté broker (retain flag)** — rejetée : Mosquitto ne garantit pas
  l'unicité sur `message_id` applicatif, seulement sur le dernier message retenu par topic.

## Conséquences

- MongoDB et PostgreSQL ne contiennent que des données structurellement valides,
  physiquement plausibles et non dupliquées.
- Chaque rejet est observable dans Grafana via LogQL sur `telemetry.rejected` avec filtrage
  par `reason`, sans modifier le schéma de base de données.
- `last_seen_at` reflète la dernière télémétrie acceptée, indépendamment des messages
  `availability` — la fraîcheur du device est ainsi toujours à jour.
- L'ajout d'une nouvelle borne physique (ex. humidité) impose une modification de
  `parseTelemetry` et de ses tests unitaires, mais aucun changement d'infrastructure.
- La double déduplication MongoDB + PostgreSQL est idempotente : une retransmission QoS 1
  ne produit aucun effet de bord visible côté métier.
