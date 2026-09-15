# Architecture — Campus connecté

## Schéma de la chaîne complète

```
Simulateur Python
      │  MQTT QoS 1 (campus/v1/devices/+/telemetry)
      ▼
 Mosquitto 2.0
      │  MQTT QoS 1
      ▼
 Backend Node.js/TypeScript (port 3000)
      │  INSERT ON CONFLICT DO NOTHING
      ▼
 PostgreSQL 16 (port 5432)
      │  SELECT
      ▼
 API REST Express
      │  HTTP GET /api/rooms, /api/rooms/:id, /api/rooms/:id/history
      ▼
 Application mobile React Native / Expo
```

## Technologies retenues

| Couche | Technologie | Justification |
|--------|-------------|---------------|
| Broker MQTT | Mosquitto 2.0 | Fourni dans le kit, référence du protocole |
| Backend | Node.js 20 + TypeScript | Compétences de l'équipe, écosystème MQTT/HTTP mature |
| Stockage | PostgreSQL 16 | ACID, déduplication native par PRIMARY KEY, requêtes historique simples |
| API | Express 4 | Minimaliste, compatible Node.js natif |
| Mobile | React Native (Expo SDK 51) | Multiplateforme iOS/Android, développement rapide avec Expo Go |

## Flux d'une mesure (trajet complet)

```
1. Simulateur publie sur campus/v1/devices/sensor-001/telemetry (toutes les 2 s)
2. Mosquitto route le message au backend (abonné avec QoS 1)
3. TelemetryService.processTelemetry() valide les champs requis
   └─ si message_id déjà connu → doublon ignoré (log émis, aucune écriture)
4. PgMeasurementRepository.save() → INSERT … ON CONFLICT DO NOTHING
5. Mobile appelle GET /api/rooms toutes les 5 s
6. Backend lit latestMeasurement depuis PostgreSQL
7. L'écran affiche température, CO₂ et horodatage
```

## Disponibilité vs fraîcheur

- **isOnline** : mis à jour par les messages MQTT `availability`. Un capteur peut être `online` mais avoir stoppé ses mesures (incident `pause`).
- **observedAt** : date de la mesure côté capteur, stockée dans PostgreSQL. À comparer avec l'heure courante pour évaluer la fraîcheur.

## Paramètres système

| Paramètre | Valeur | Description |
|-----------|--------|-------------|
| `PUBLISH_INTERVAL` | 2 s | Cadence du simulateur |
| Rafraîchissement mobile | 5 s | Intervalle de polling GET /api/rooms |
| Historique borné | 50 mesures | Limite de /api/rooms/:id/history |
| Déduplication | message_id PRIMARY KEY | ON CONFLICT DO NOTHING, pas de fenêtre temporelle |

## Structure des services Docker

```
compose.yaml
├── mosquitto     → broker, port 1884 (hôte)
├── simulator     → publie mesures toutes les 2 s
├── postgres      → stockage, port 5432 (hôte)
├── backend       → API REST, port 3000 (hôte)
├── tools         → profil "tools" : incidents, probe MQTT
└── tests         → profil "test" : tests d'intégration Python
```
