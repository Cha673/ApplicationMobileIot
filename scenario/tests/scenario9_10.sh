#!/bin/bash
# Scenario 9 - Observabilite (Grafana accessible)
# Scenario 10 - Logs structures

echo "=== SCENARIO 9 : Grafana accessible ==="
curl -s http://localhost:3001 | grep -o "<title>.*</title>" || echo "Grafana repond sur http://localhost:3001"

echo ""
echo "Pour le screenshot Grafana :"
echo "  1. Ouvrez http://localhost:3001 dans votre navigateur"
echo "  2. Allez dans Explore (icone boussole)"
echo "  3. Selectionnez Loki comme source"
echo "  4. Tapez cette requete : {service_name=\"backend\"} |= \"telemetry.saved\""
echo "  5. Cliquez Run query"
echo "  Screenshot : montrer les resultats avec deviceId, temperature, co2 visibles"

echo ""
echo "=== SCENARIO 10 : Logs JSON valides ==="
echo "--- Backend (5 dernieres lignes) ---"
docker compose logs --since 10s backend 2>/dev/null | tail -5

echo ""
echo "--- Validation : 0 ligne non-JSON ---"
docker compose logs --since 60s backend 2>/dev/null | python3 -c "
import sys, json
errors = 0
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    # strip docker prefix (container-1  | {json})
    if ' | ' in line:
        line = line.split(' | ', 1)[1]
    if not line.startswith('{'): continue
    try:
        json.loads(line)
    except Exception:
        print('INVALIDE:', line[:80])
        errors += 1
if errors == 0:
    print('OK - 0 ligne invalide')
"
