# Architecture J1 - Du capteur au téléphone

┌──────────────────────────┐
│ Capteurs simulés │
│ Simulator Kit (Python) │
└────────────┬─────────────┘
│ MQTT v1 : telemetry, state, availability
▼
┌──────────────────────────┐
│ Broker MQTT │
│ Mosquitto │
└────────────┬─────────────┘
│ MQTT / abonnement
▼
┌──────────────────────────┐
│ Backend │
│ Node.js + TypeScript │
│ Client MQTT (mqtt) │
└────────────┬─────────────┘
│ Requêtes SQL (driver pg)
▼
┌──────────────────────────┐
│ Stockage │
│ PostgreSQL │
│ mesures + capteurs │
└────────────▲─────────────┘
│ Lecture des mesures et de l'état
│
┌────────────┴─────────────┐
│ API REST │
│ Express.js │
│ http://localhost:3000 │
└────────────▲─────────────┘
│ HTTP / JSON
▼
┌──────────────────────────┐
│ Application mobile │
│ React Native │
└──────────────────────────┘

# Architecture J2 — Du capteur au téléphone

```
┌──────────────────────────┐
│   Capteurs simulés       │
│   Simulator Kit (Python) │
└────────────┬─────────────┘
             │  MQTT QoS 1 : telemetry, state, availability
             ▼
┌──────────────────────────┐
│   Broker MQTT            │
│   Mosquitto        │
└────────────┬─────────────┘
             │  abonnement MQTT
             ▼
┌──────────────────────────────────────────────────────┐
│   Backend — Node.js + TypeScript                     │
│                                                      │
│   Chemin d'écriture :                                │
│   1. Validation du message (parseTelemetry)          │
│   2. Déduplication par message_id dans MongoDB       │
│      (existsById → $setOnInsert + index unique)      │
│   3. Sauvegarde dans MongoDB (synced: false)         │
│   4. Sync par lots (≤ 500 msgs, toutes les 5 s)     │
│      MongoDB → PostgreSQL (ON CONFLICT DO NOTHING)   │
│                                                      │
│   Chemin de lecture :                                │
│   FallbackMeasurementRepository :                    │
│     → PostgreSQL (source de vérité)                  │
│     → MongoDB si PostgreSQL indisponible             │
└──────┬────────────────────────────┬──────────────────┘
       │ driver pg                  │ driver mongodb
       ▼                            ▼
┌─────────────────┐      ┌──────────────────────────┐
│   PostgreSQL 16 │      │   MongoDB 7              │
│   port 5432     │      │   port 27017             │
│   tables :      │      │   collection :           │
│   measurements  │      │   measurements           │
│   devices       │      │   (champ synced: bool)   │
│   données       │      │   tous les messages bruts│
│   vérifiées     │      │   reçus                  │
└────────┬────────┘      └──────────────────────────┘
         │  lecture via FallbackMeasurementRepository
         ▼
┌──────────────────────────┐
│   API REST               │
│   Express.js             │
│   port 3000              │
└────────────▲─────────────┘
             │  HTTP / JSON
             ▼
┌──────────────────────────┐
│   Application mobile     │
│   React Native (Expo)    │
│   TanStack Query v5      │
│   Cache persistant :     │
│   AsyncStorage (24 h)    │
│   Mode hors ligne :      │
│  networkMode offlineFirst│
└──────────────────────────┘
```

## Règles de flux

- **Écriture** : MongoDB reçoit tous les messages en premier. La déduplication y est garantie par un index unique sur `message_id` et l'opération `$setOnInsert`. PostgreSQL ne reçoit les données que via le batch de synchronisation.
- **Lecture** : l'API lit PostgreSQL. Si PostgreSQL est indisponible, `FallbackMeasurementRepository` bascule automatiquement sur MongoDB.
- **Cache mobile** : TanStack Query conserve les données en mémoire (24 h de `gcTime`) et les persiste sur disque via `@tanstack/react-query-persist-client` + `AsyncStorage`. En cas d'échec réseau, les données mises en cache restent affichées avec un bandeau « Mode hors ligne ».

Schéma de notre nouvelle architecture
![Schéma de notre architecture](images/architecture_J2.png)
