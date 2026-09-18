#!/bin/bash
# Scenario 8 - Hygiene de securite

echo "=== AUDIT 1 : aucun mot de passe en clair dans git log ==="
git log --all -S "password" --oneline

echo ""
echo "=== AUDIT 2 : les references 'password' dans le code pointent vers des variables d'env ==="
git grep -r "password" -- '*.ts' '*.py' '*.js' | grep -v "process.env\|os.getenv\|MQTT_PASSWORD\|POSTGRES_PASSWORD\|TEACHER_PASSWORD\|BACKEND_PASSWORD\|SIMULATOR_PASSWORD\|#\|example\|demo" || echo "OK - aucune valeur en clair"

echo ""
echo "=== AUDIT 3 : .env absent du depot ==="
git ls-files | grep "^\.env$" || echo "OK - .env absent de git"

echo ""
echo "=== AUDIT 4 : .env.example present avec valeurs -demo uniquement ==="
cat .env.example
