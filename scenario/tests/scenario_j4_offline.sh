#!/bin/bash
# Anomaly 1 — Device offline / silent → timeout
# The device is placed in no-response mode: it receives the command but
# publishes no ACK. The backend must emit command.timeout after 30 s.
#
# Usage: ROOM=salle-a101 bash scenario/tests/scenario_j4_offline.sh
set -euo pipefail
ROOM=${ROOM:-salle-203}
API=${API_URL:-http://localhost:3000}
DEVICE=${DEVICE:-sensor-001}
TIMEOUT_S=${TIMEOUT_S:-45}

echo "=== J4 Anomalie 1 : objet silencieux → timeout ==="

echo ""
echo "--- Étape 1 : mode no-response (l'objet ne répond plus aux commandes) ---"
docker exec applicationmobileiot-mosquitto-1 \
  mosquitto_pub -h localhost -p 1883 \
  -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
  -t "campus/v1/simulator/${DEVICE}/control" \
  -m '{"action":"no-response","request_id":"j4-offline-test"}'
echo "Contrôle envoyé. Pause 2s…"
sleep 2

echo ""
echo "--- Étape 2 : envoi de la commande depuis le backend ---"
RESPONSE=$(curl -s -X POST "${API}/api/rooms/${ROOM}/commands" \
  -H "Content-Type: application/json" \
  -d '{"action":"set_ventilation","enabled":true}')
echo "Réponse API : $RESPONSE"
COMMAND_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['commandId'])")
echo "commandId : $COMMAND_ID"

echo ""
echo "--- Étape 3 : statut immédiat (doit être SENT) ---"
curl -s "${API}/api/commands/${COMMAND_ID}" | python3 -m json.tool

echo ""
echo "--- Étape 4 : attente du timeout (${TIMEOUT_S}s) ---"
sleep "${TIMEOUT_S}"

echo ""
echo "--- Étape 5 : statut après timeout (doit être TIMEOUT) ---"
curl -s "${API}/api/commands/${COMMAND_ID}" | python3 -m json.tool

echo ""
echo "--- Étape 6 : preuve dans les logs (filtrer sur commandId) ---"
docker logs applicationmobileiot-backend-1 2>&1 | grep "${COMMAND_ID}" | tail -20

echo ""
echo "--- Étape 7 : remettre l'objet en mode normal ---"
docker exec applicationmobileiot-mosquitto-1 \
  mosquitto_pub -h localhost -p 1883 \
  -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
  -t "campus/v1/simulator/${DEVICE}/control" \
  -m '{"action":"respond","request_id":"j4-offline-reset"}'
echo "Objet remis en mode normal."
