#!/bin/bash
# Anomaly 2 — ACK arrives after timeout
# The device is placed in no-response mode. The backend marks the command TIMEOUT.
# Then the device is restored and manually publishes a late ACK.
# The backend must log command.ack_after_timeout and leave the status as TIMEOUT.
#
# Usage: ROOM=salle-a101 bash scenario/tests/scenario_j4_late_ack.sh
set -euo pipefail
ROOM=${ROOM:-salle-203}
API=${API_URL:-http://localhost:3000}
DEVICE=${DEVICE:-sensor-001}
TIMEOUT_S=${TIMEOUT_S:-45}

echo "=== J4 Anomalie 2 : ACK tardif après timeout ==="

echo ""
echo "--- Étape 1 : mode no-response ---"
docker exec applicationmobileiot-mosquitto-1 \
  mosquitto_pub -h localhost -p 1883 \
  -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
  -t "campus/v1/simulator/${DEVICE}/control" \
  -m '{"action":"no-response","request_id":"j4-late-test"}'
sleep 2

echo ""
echo "--- Étape 2 : envoi de la commande ---"
RESPONSE=$(curl -s -X POST "${API}/api/rooms/${ROOM}/commands" \
  -H "Content-Type: application/json" \
  -d '{"action":"set_ventilation","enabled":true}')
COMMAND_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['commandId'])")
echo "commandId : $COMMAND_ID"
echo "Statut initial :"
curl -s "${API}/api/commands/${COMMAND_ID}" | python3 -m json.tool

echo ""
echo "--- Étape 3 : attente du timeout (${TIMEOUT_S}s) ---"
sleep "${TIMEOUT_S}"

echo ""
echo "--- Étape 4 : statut après timeout ---"
curl -s "${API}/api/commands/${COMMAND_ID}" | python3 -m json.tool

echo ""
echo "--- Étape 5 : remise en mode normal et envoi d'un ACK tardif via teacher ---"
docker exec applicationmobileiot-mosquitto-1 \
  mosquitto_pub -h localhost -p 1883 \
  -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
  -t "campus/v1/devices/${DEVICE}/results" \
  -m "{\"schema_version\":1,\"device_id\":\"${DEVICE}\",\"command_id\":\"${COMMAND_ID}\",\"status\":\"executed\",\"executed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ventilation\":true}"

sleep 2

echo ""
echo "--- Étape 6 : statut après ACK tardif (doit rester TIMEOUT) ---"
curl -s "${API}/api/commands/${COMMAND_ID}" | python3 -m json.tool

echo ""
echo "--- Étape 7 : preuve dans les logs (command.ack_after_timeout) ---"
docker logs applicationmobileiot-backend-1 2>&1 | grep "${COMMAND_ID}" | tail -20

echo ""
echo "--- Étape 8 : remettre l'objet en mode normal ---"
docker exec applicationmobileiot-mosquitto-1 \
  mosquitto_pub -h localhost -p 1883 \
  -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
  -t "campus/v1/simulator/${DEVICE}/control" \
  -m '{"action":"respond","request_id":"j4-late-reset"}'
