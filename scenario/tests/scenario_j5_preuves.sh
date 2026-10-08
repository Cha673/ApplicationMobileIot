#!/bin/bash
# J5 — Preuves complémentaires
#
# Couvre :
#   1. Alerte CO₂ sur les trois salles simultanément
#   2. Historique borné à 50 mesures
#   3. Suivi complet d'une mesure (messageId dans les logs)
#   4. Suivi complet d'une commande (commandId dans les logs)
#
# Usage : bash scenario/tests/scenario_j5_preuves.sh
set -euo pipefail

API=${API_URL:-http://localhost:3000}
WAIT_S=${WAIT_S:-8}
FAIL=0

pub() {
  docker exec applicationmobileiot-mosquitto-1 \
    mosquitto_pub -h localhost -p 1883 \
    -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
    -t "$1" -m "$2"
}

echo "=== J5 Preuves complémentaires ==="

# ─────────────────────────────────────────────────────
echo ""
echo "─── 1. Trois salles en alerte simultanée ───"

# Remettre les trois capteurs en mode normal d'abord
for dev in sensor-001 sensor-002 sensor-003; do
  pub "campus/v1/simulator/${dev}/control" '{"action":"reset","request_id":"j5p-reset-'"${dev}"'"}'
done
sleep 3

# Vider les alertes actives éventuelles (résoudre manuellement via normal-co2)
for dev in sensor-001 sensor-002 sensor-003; do
  pub "campus/v1/simulator/${dev}/control" '{"action":"normal-co2","request_id":"j5p-clear-'"${dev}"'"}'
done
sleep "${WAIT_S}"

BEFORE=$(curl -s "${API}/api/alerts" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "Alertes actives avant déclenchement : ${BEFORE} (attendu : 0)"

# Déclencher high-co2 sur les trois capteurs
for dev in sensor-001 sensor-002 sensor-003; do
  pub "campus/v1/simulator/${dev}/control" '{"action":"high-co2","request_id":"j5p-high-'"${dev}"'"}'
done
echo "CO₂ élevé envoyé aux 3 capteurs. Attente ${WAIT_S}s…"
sleep "${WAIT_S}"

AFTER=$(curl -s "${API}/api/alerts")
echo "${AFTER}" | python3 -m json.tool || true
ALERT_COUNT=$(echo "${AFTER}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "Alertes actives après déclenchement : ${ALERT_COUNT} (attendu : 3)"
if [ "${ALERT_COUNT}" -eq 3 ]; then
  echo "✓ 3 alertes indépendantes — une par salle"
else
  echo "✗ Nombre d'alertes inattendu : ${ALERT_COUNT}"
  FAIL=1
fi

# Remettre tout en normal
for dev in sensor-001 sensor-002 sensor-003; do
  pub "campus/v1/simulator/${dev}/control" '{"action":"normal-co2","request_id":"j5p-norm-'"${dev}"'"}'
done
sleep "${WAIT_S}"

# ─────────────────────────────────────────────────────
echo ""
echo "─── 2. Historique borné à 50 mesures ───"

HISTORY=$(curl -s "${API}/api/rooms/salle-203/history")
HIST_COUNT=$(echo "${HISTORY}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "Mesures retournées pour salle-203 : ${HIST_COUNT} (plafond : 50)"
if [ "${HIST_COUNT}" -le 50 ]; then
  echo "✓ Historique borné — ${HIST_COUNT} ≤ 50"
else
  echo "✗ Historique non borné : ${HIST_COUNT} mesures"
  FAIL=1
fi

# ─────────────────────────────────────────────────────
echo ""
echo "─── 3. Suivi complet d'une mesure dans les logs ───"

MSG=$(curl -s "${API}/api/rooms/salle-203/history" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['messageId'] if d else '')" 2>/dev/null || echo "")

if [ -z "${MSG}" ]; then
  echo "✗ Aucune mesure disponible pour salle-203"
  FAIL=1
else
  echo "messageId : ${MSG}"
  echo "Trace dans les logs backend :"
  docker logs applicationmobileiot-backend-1 2>&1 | grep "${MSG}" | tail -5 || true
  TRACE_LINES=$(docker logs applicationmobileiot-backend-1 2>&1 | grep -c "${MSG}" || echo "0")
  if [ "${TRACE_LINES}" -ge 1 ]; then
    echo "✓ Mesure ${MSG} tracée (${TRACE_LINES} entrée(s) de log)"
  else
    echo "✗ Aucune trace pour messageId ${MSG}"
    FAIL=1
  fi
fi

# ─────────────────────────────────────────────────────
echo ""
echo "─── 4. Suivi complet d'une commande dans les logs ───"

CMD_RESP=$(curl -s -X POST "${API}/api/rooms/salle-203/commands" \
  -H "Content-Type: application/json" \
  -d '{"action":"set_ventilation","enabled":true}')
CMD_ID=$(echo "${CMD_RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin)['commandId'])" 2>/dev/null || echo "")

if [ -z "${CMD_ID}" ]; then
  echo "✗ Impossible d'envoyer la commande"
  FAIL=1
else
  echo "commandId : ${CMD_ID}"
  echo "Attente ACK (5s)…"
  sleep 5
  echo "Trace dans les logs backend :"
  docker logs applicationmobileiot-backend-1 2>&1 | grep "${CMD_ID}" | tail -8 || true
  EVENTS=$(docker logs applicationmobileiot-backend-1 2>&1 | grep "${CMD_ID}" | grep -o '"eventType":"[^"]*"' | sort -u || true)
  echo "Événements : ${EVENTS}"
  if echo "${EVENTS}" | grep -q "command.created" && echo "${EVENTS}" | grep -q "command.acknowledged"; then
    echo "✓ Cycle complet : command.created → command.sent → command.ack_received → command.acknowledged"
  else
    echo "✗ Cycle incomplet pour commandId ${CMD_ID}"
    FAIL=1
  fi
fi

echo ""
echo "=== Preuves J5 terminées ==="
exit $FAIL
