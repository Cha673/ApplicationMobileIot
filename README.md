# Campus connecté — Backend IoT + Mobile

Système de supervision d'un campus connecté : température, CO₂ et commande de ventilation.

## Architecture

```
Simulateur (Python) → Mosquitto (MQTT) → Backend (Node.js/TS) → PostgreSQL
                                                              ↕ API REST :3000
                                                    Application mobile (React Native)
```

Le backend s'abonne aux topics MQTT du simulateur, stocke les mesures et expose une API REST consommée par le mobile.

---

## Lancer le projet

### Prérequis

- Docker Desktop démarré (conteneurs Linux)
- Node.js 20+ et npm
- [Expo Go](https://expo.dev/go) installé sur le téléphone (iOS ou Android), sur le même réseau Wi-Fi que la machine

### 1. Backend et infrastructure

```sh
# Cloner le dépôt
git clone <votre-repo>
cd <votre-repo>

# Démarrer tout le système (Mosquitto + simulateur + PostgreSQL + backend)
docker compose up -d --build --wait

# Vérifier que tout tourne
docker compose ps
```

Les quatre services doivent être `running` :
- `mosquitto` — broker MQTT sur le port **1883** (localhost uniquement)
- `simulator` — produit des mesures toutes les 2 s
- `postgres` — base de données sur le port **5432** (localhost uniquement)
- `backend` — API REST sur le port **3000**

### 2. Application mobile

```sh
cd mobile

# Installer les dépendances
npm install

# Configurer l'adresse du backend
# Copier le fichier d'exemple et renseigner l'IP locale de votre machine
cp .env.local.example .env.local
# Éditer .env.local :
# EXPO_PUBLIC_API_URL=http://<IP-de-votre-machine>:3000
# (trouver l'IP avec : ipconfig getifaddr en0  ou  ip route get 1 | awk '{print $7}')

# Démarrer Expo
npx expo start
```

Scanner le QR code affiché dans le terminal avec **Expo Go** sur le téléphone.

> Le téléphone et la machine doivent être sur le **même réseau Wi-Fi**. L'IP `localhost` ne fonctionne pas depuis un appareil physique.

---

## Tester que ça fonctionne

### 1. Santé du backend

```sh
curl http://localhost:3000/api/health
# → {"status":"ok","timestamp":"2026-09-15T..."}
```

### 2. Liste des salles avec dernières mesures

```sh
curl http://localhost:3000/api/rooms
```

Réponse attendue (extrait) :

```json
[
  {
    "roomId": "salle-203",
    "label": "Salle 203",
    "deviceId": "sensor-001",
    "isOnline": true,
    "latestMeasurement": {
      "temperature": 22.14,
      "co2": 912,
      "observedAt": "2026-09-15T10:00:00.000Z"
    }
  }
]
```

### 3. Détail d'une salle

```sh
curl http://localhost:3000/api/rooms/salle-203
```

### 4. Historique des mesures (50 dernières)

```sh
curl http://localhost:3000/api/rooms/salle-203/history
```

### 5. Voir les logs du backend en temps réel

```sh
docker compose logs -f backend
# → [mqtt] connected to mosquitto:1883
# → [init] seeded 3 devices from /app/devices.json
# → [telemetry] saved: sensor-001 T=22.14°C CO2=912ppm
# → [availability] sensor-001: online
```

---

## Déclencher les incidents du simulateur

Ces commandes permettent de tester le comportement du backend face aux incidents IoT.

```sh
# Mettre sensor-001 en pause (mesures stoppées, connexion maintenue)
docker compose run --rm tools incident sensor-001 pause

# Reprendre
docker compose run --rm tools incident sensor-001 resume

# Injecter un doublon (même message_id)
docker compose run --rm tools incident sensor-001 duplicate

# Injecter une mesure retardée (observed_at - 60 s)
docker compose run --rm tools incident sensor-001 delay

# Injecter une mesure invalide (co2 = texte)
docker compose run --rm tools incident sensor-001 invalid

# Remettre à zéro
docker compose run --rm tools incident sensor-001 reset
```

### Observer les messages MQTT bruts

```sh
# Voir tous les messages (10 derniers)
docker compose run --rm tools watch --count 10

# Filtrer sur la télémétrie uniquement
docker compose run --rm tools watch --topic "campus/v1/devices/+/telemetry" --count 3
```

---

## Comment ça fonctionne

### Trajet d'une mesure

```
1. Simulateur publie sur campus/v1/devices/sensor-001/telemetry (QoS 1)
2. Mosquitto route le message au backend
3. TelemetryService.processTelemetry valide les champs requis
4. Si message_id déjà connu → doublon ignoré (log émis)
5. PgMeasurementRepository.save → INSERT … ON CONFLICT DO NOTHING dans PostgreSQL
6. GET /api/rooms/salle-203 → retourne latestMeasurement depuis PostgreSQL
```

### Déduplication

Le `message_id` est la clé primaire PostgreSQL. Un doublon QoS 1 ou un incident `duplicate` n'insère rien (`ON CONFLICT DO NOTHING`) et produit juste un log `[telemetry] duplicate skipped`.

### Disponibilité vs fraîcheur

- **Disponibilité** : `isOnline` dans l'API — mis à jour par les messages `availability` MQTT.
- **Fraîcheur** : date de `observedAt` dans `latestMeasurement` — un capteur peut être connecté (`isOnline: true`) mais en pause (mesures stoppées).

---

## Structure du projet

```
/
├── backend/                 ← Backend Node.js/TypeScript
│   ├── src/
│   │   ├── domain/          ← types et interfaces (sans dépendances)
│   │   ├── application/     ← logique métier (TelemetryService)
│   │   └── infrastructure/  ← MQTT, PostgreSQL, HTTP (Express)
│   ├── Dockerfile
│   └── package.json
├── mobile/                  ← Application React Native (Expo)
│   ├── src/
│   │   ├── screens/         ← écrans (liste des salles, détail)
│   │   ├── components/      ← composants réutilisables
│   │   └── api.ts           ← client API REST
│   ├── .env.local.example   ← modèle de configuration
│   └── App.tsx
├── docs/
│   ├── architecture.md      ← schéma et décisions d'architecture
│   ├── J1.md                ← journal J1 avec preuves
│   ├── decisions/           ← décisions techniques
│   └── contrat-mqtt.md      ← contrat MQTT du kit
├── mosquitto/               ← configuration du broker
├── simulator/               ← simulateur fourni (Python)
├── compose.yaml             ← stack complète Docker
└── devices.json             ← liste des capteurs et salles
```

---

## Arrêter / Remettre à zéro

```sh
# Arrêter (conserve les données)
docker compose down

# Remettre à zéro complète (efface les mesures stockées)
docker compose down -v
docker compose up -d --build --wait
```

---

## Endpoints API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/health` | Santé du backend |
| GET | `/api/rooms` | Liste des salles avec dernière mesure |
| GET | `/api/rooms/:roomId` | Détail d'une salle |
| GET | `/api/rooms/:roomId/history` | Historique des 50 dernières mesures |
| GET | `/api/devices` | Liste des capteurs avec état de connexion |

---

## Variables d'environnement

Copier `.env.example` en `.env` pour personnaliser :

| Variable | Défaut | Rôle |
|----------|--------|------|
| `MQTT_PORT` | `1883` | Port Mosquitto exposé sur l'hôte |
| `BACKEND_PASSWORD` | `backend-demo` | Mot de passe MQTT du backend |
| `PUBLISH_INTERVAL` | `2` | Intervalle de publication du simulateur (secondes) |
| `POSTGRES_PASSWORD` | `campus-demo` | Mot de passe PostgreSQL |
