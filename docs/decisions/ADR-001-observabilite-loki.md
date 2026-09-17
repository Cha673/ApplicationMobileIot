# ADR-001 — Observabilité : Loki + Promtail + Grafana

**Date :** 2026-09-17  
**Statut :** Accepté

## Contexte

L'équipe a d'abord implémenté une table `rejected_events` dans PostgreSQL pour stocker les
messages MQTT rejetés. Cette approche mélangeait des données d'infrastructure avec le schéma
métier, et chaque nouveau type d'événement (duplicate, reconnexion MQTT, etc.) nécessitait
une migration de schéma. Le backend émettait déjà tous ses événements sous forme de JSON
structuré sur stdout via pino — cette sortie n'était pas exploitée.

## Décision

L'équipe remplace la table `rejected_events` par la pile Loki 2.9.8 + Promtail 2.9.8 +
Grafana 10.4.2, déployée dans Docker Compose. Promtail collecte les logs des conteneurs via
`/var/run/docker.sock` et les pousse dans Loki ; Grafana interroge Loki avec LogQL. Aucune
modification du code backend n'est nécessaire : Loki consomme le stdout existant tel quel.

## Alternatives envisagées

- **Table `rejected_events` dans PostgreSQL** — rejetée : pollue le schéma métier, impose des
  migrations pour chaque nouveau type d'événement, et duplique des données déjà présentes dans
  les logs.
- **Fichiers de log rotatifs sur disque** — rejetée : pas de surface de recherche unifiée,
  difficulté d'agrégation multi-conteneurs, sans valeur ajoutée par rapport à Loki dans un
  environnement Docker Compose.
- **Elasticsearch + Kibana** — rejetée : complexité opérationnelle et empreinte mémoire
  disproportionnées pour un prototype.

## Conséquences

- PostgreSQL reste exclusivement réservé aux données métier (`devices`, `telemetry`) ; le
  schéma ne contient aucune table d'infrastructure.
- LogQL permet d'interroger n'importe quel type d'événement (`telemetry.saved`,
  `telemetry.rejected`, `telemetry.duplicate`, `mqtt.reconnecting`, `availability.updated`)
  sans migration.
- L'ajout d'un nouveau type d'événement dans le backend ne requiert aucune modification de
  l'infrastructure d'observabilité.
- Grafana est provisionné automatiquement depuis `observability/grafana/provisioning/`,
  éliminant la configuration manuelle.
- Loki n'est pas une base de données relationnelle : les agrégations complexes sur les données
  métier doivent rester dans PostgreSQL.
