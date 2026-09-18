#!/bin/bash
# Scenario 7d - Messages retained (state vs telemetry)

echo "=== SUBSCRIBER state : doit recevoir immediatement un message retained ==="
docker exec applicationmobileiot-mosquitto-1 mosquitto_sub -h localhost -p 1883 -u teacher -P teacher-demo -t campus/v1/devices/sensor-001/state -C 1 -v 2>/dev/null
echo "(message recu immediatement = retained=true)"

echo ""
echo "=== SUBSCRIBER telemetry : doit attendre le prochain tick (~2s) ==="
echo "En attente du prochain tick..."
docker exec applicationmobileiot-mosquitto-1 mosquitto_sub -h localhost -p 1883 -u teacher -P teacher-demo -t campus/v1/devices/sensor-001/telemetry -C 1 -v 2>/dev/null
echo "(message recu apres delai = retained=false)"
