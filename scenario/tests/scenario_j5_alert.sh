#!/bin/bash
# J5 — Alert rule: CO2 high → alert triggered; CO2 normal → alert resolved
#
# Proves: alerts fire once (not per message), and resolve when CO2 drops.
# Usage: ROOM=salle-203 DEVICE=sensor-001 bash scenario/tests/scenario_j5_alert.sh
set -euo pipefail

FAIL=0

ROOM=${ROOM:-salle-203}
API=${API_URL:-http://localhost:3000}
DEVICE=${DEVICE:-sensor-001}
WAIT_S=${WAIT_S:-6}

echo "=== J5 — Alerte CO₂ ==="

echo ""
echo "--- Étape 1 : s'assurer que l'objet est en mode normal ---"
docker exec applicationmobileiot-mosquitto-1 \
  mosquitto_pub -h localhost -p 1883 \
  -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
  -t "campus/v1/simulator/${DEVICE}/control" \
  -m '{"action":"reset","request_id":"j5-reset"}'
sleep 3

echo ""
echo "--- Étape 2 : vérifier état initial des alertes (doit être vide) ---"
echo "GET /api/alerts :"
curl -s "${API}/api/alerts" | python3 -m json.tool || true

echo ""
echo "--- Étape 3 : passer le CO₂ au-dessus du seuil (>1500 ppm) ---"
docker exec applicationmobileiot-mosquitto-1 \
  mosquitto_pub -h localhost -p 1883 \
  -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
  -t "campus/v1/simulator/${DEVICE}/control" \
  -m '{"action":"high-co2","request_id":"j5-high"}'
echo "CO₂ élevé activé. Attente ${WAIT_S}s…"
sleep "${WAIT_S}"

echo ""
echo "--- Étape 4 : alerte attendue (1 alerte active pour ${ROOM}) ---"
ALERTS=$(curl -s "${API}/api/alerts")
echo "$ALERTS" | python3 -m json.tool || true
ALERT_COUNT=$(echo "$ALERTS" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len([a for a in data if a['roomId']=='${ROOM}']))" 2>/dev/null || echo "0")
if [ "$ALERT_COUNT" -ge 1 ]; then
  echo "✓ Alerte déclenchée pour ${ROOM}"
else
  echo "✗ Aucune alerte trouvée pour ${ROOM}"
  FAIL=1
fi

ALERT_ID=$(echo "$ALERTS" | python3 -c "import sys,json; data=json.load(sys.stdin); items=[a for a in data if a['roomId']=='${ROOM}']; print(items[0]['id'] if items else '')" 2>/dev/null || echo "")

echo ""
echo "--- Étape 5 : envoyer un deuxième burst — l'alerte ne doit PAS se dupliquer ---"
for i in 1 2 3; do
  docker exec applicationmobileiot-mosquitto-1 \
    mosquitto_pub -h localhost -p 1883 \
    -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
    -t "campus/v1/simulator/${DEVICE}/control" \
    -m '{"action":"high-co2","request_id":"j5-burst-'"$i"'"}'
  sleep 1
done
sleep "${WAIT_S}"

ALERTS2=$(curl -s "${API}/api/alerts")
ALERT_COUNT2=$(echo "$ALERTS2" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len([a for a in data if a['roomId']=='${ROOM}']))" 2>/dev/null || echo "0")
echo "Nombre d'alertes actives pour ${ROOM} : ${ALERT_COUNT2} (attendu : 1)"
if [ "$ALERT_COUNT2" -eq 1 ]; then
  echo "✓ Pas de duplication — une seule alerte active"
else
  echo "✗ Duplication détectée ou alerte manquante"
  FAIL=1
fi

echo ""
echo "--- Étape 6 : revenir à un CO₂ normal (≤1200 ppm) ---"
docker exec applicationmobileiot-mosquitto-1 \
  mosquitto_pub -h localhost -p 1883 \
  -u teacher -P "${TEACHER_PASSWORD:-teacher-demo}" \
  -t "campus/v1/simulator/${DEVICE}/control" \
  -m '{"action":"normal-co2","request_id":"j5-normal"}'
echo "CO₂ normal activé. Attente ${WAIT_S}s…"
sleep "${WAIT_S}"

echo ""
echo "--- Étape 7 : alerte résolue (liste active doit être vide pour ${ROOM}) ---"
ALERTS3=$(curl -s "${API}/api/alerts")
echo "$ALERTS3" | python3 -m json.tool || true
ALERT_COUNT3=$(echo "$ALERTS3" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len([a for a in data if a['roomId']=='${ROOM}']))" 2>/dev/null || echo "0")
if [ "$ALERT_COUNT3" -eq 0 ]; then
  echo "✓ Alerte résolue — aucune alerte active pour ${ROOM}"
else
  echo "✗ Alerte toujours active pour ${ROOM}"
  FAIL=1
fi

echo ""
if [ -n "${ALERT_ID}" ]; then
  echo "--- Étape 8 : preuve dans les logs ---"
  docker logs applicationmobileiot-backend-1 2>&1 | grep -E "alert\.(triggered|resolved)" | grep "${ROOM}" | tail -10 || true
fi

echo ""
echo "=== Scénario J5 terminé ==="
exit $FAIL
