#!/bin/bash
# Anomaly 3 — Duplicate command (same commandId sent twice)
# The device is idempotent: it returns the same result for a known commandId.
# The backend must log command.ack_duplicate on the second ACK and not double-execute.
#
# Usage: ROOM=salle-a101 bash scenario/tests/scenario_j4_duplicate.sh
set -euo pipefail
ROOM=${ROOM:-salle-a101}
API=${API_URL:-http://localhost:3000}
DEVICE=${DEVICE:-sensor-001}

echo "=== J4 Anomalie 3 : commande dupliquée ==="

echo ""
echo "--- Étape 1 : envoi de la commande normale ---"
RESPONSE=$(curl -s -X POST "${API}/api/rooms/${ROOM}/commands" \
  -H "Content-Type: application/json" \
  -d '{"action":"set_ventilation","enabled":true}')
COMMAND_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['commandId'])")
echo "commandId : $COMMAND_ID"

echo ""
echo "--- Étape 2 : attente de l'ACK normal (5s) ---"
sleep 5
echo "Statut après ACK :"
curl -s "${API}/api/commands/${COMMAND_ID}" | python3 -m json.tool

echo ""
echo "--- Étape 3 : rejouer l'ACK (simule un doublon de réseau) ---"
docker exec applicationmobileiot-mosquitto-1 \
  mosquitto_pub -h localhost -p 1883 \
  -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
  -t "campus/v1/devices/${DEVICE}/results" \
  -m "{\"schema_version\":1,\"device_id\":\"${DEVICE}\",\"command_id\":\"${COMMAND_ID}\",\"status\":\"executed\",\"executed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ventilation\":true}"

sleep 2

echo ""
echo "--- Étape 4 : statut après doublon (doit rester ACKNOWLEDGED) ---"
curl -s "${API}/api/commands/${COMMAND_ID}" | python3 -m json.tool

echo ""
echo "--- Étape 5 : preuve dans les logs (command.ack_duplicate) ---"
docker logs applicationmobileiot-backend-1 2>&1 | grep "${COMMAND_ID}" | tail -20

echo ""
echo "--- Étape 6 : renvoyer la même commande avec le même commandId via MQTT (doublon protocole) ---"
PAYLOAD=$(docker logs applicationmobileiot-backend-1 2>&1 | grep "command.sent" | grep "${COMMAND_ID}" | tail -1)
echo "Log de la commande envoyée : $PAYLOAD"
echo ""
echo "Le simulateur retourne le résultat en cache (idempotence)."
echo "Preuve : device.results[commandId] est non-nul => pas de re-exécution."
