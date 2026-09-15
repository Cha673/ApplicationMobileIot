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
