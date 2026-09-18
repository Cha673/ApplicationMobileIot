#!/bin/sh
set -eu
# Un répertoire dédié évite les restrictions Linux sur les fichiers d'autrui
# dans les répertoires temporaires partagés lors d'un second démarrage.
mkdir -p /run/campus-auth
chmod 755 /run/campus-auth
mosquitto_passwd -b -c /run/campus-auth/passwords sensor-001 "$SIMULATOR_PASSWORD"
mosquitto_passwd -b /run/campus-auth/passwords sensor-002 "$SIMULATOR_PASSWORD"
mosquitto_passwd -b /run/campus-auth/passwords sensor-003 "$SIMULATOR_PASSWORD"
mosquitto_passwd -b /run/campus-auth/passwords backend "$BACKEND_PASSWORD"
mosquitto_passwd -b /run/campus-auth/passwords teacher "$TEACHER_PASSWORD"
chown mosquitto:mosquitto /run/campus-auth/passwords
chmod 600 /run/campus-auth/passwords
exec /docker-entrypoint.sh /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
