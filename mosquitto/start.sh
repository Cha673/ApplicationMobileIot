#!/bin/sh
set -eu
mosquitto_passwd -b -c /tmp/passwords simulator "$SIMULATOR_PASSWORD"
mosquitto_passwd -b /tmp/passwords backend "$BACKEND_PASSWORD"
mosquitto_passwd -b /tmp/passwords teacher "$TEACHER_PASSWORD"
chown mosquitto:mosquitto /tmp/passwords
chmod 600 /tmp/passwords
exec /docker-entrypoint.sh /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
