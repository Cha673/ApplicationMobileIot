# Association par scan QR

L’objet existe déjà dans le simulateur. Le scan propose son association à une salle dans votre backend ; il n’effectue ni appairage Bluetooth ni configuration réseau.

Contenus exacts à encoder dans les QR codes de démonstration :

```text
campus-device:v1:sensor-001
campus-device:v1:sensor-002
campus-device:v1:sensor-003
```

Un QR code contient uniquement l’identifiant public. Il ne confère aucun droit. Le backend valide le format, l’existence de l’objet, les droits de l’utilisateur et les règles de réaffectation. Les salles de `devices.json` donnent le contexte initial ; l’affectation métier peut ensuite diverger de cette indication du simulateur.

Pour la recette : encoder aussi `campus-device:v1:sensor-999` (format valide, objet inconnu) et `ceci-n-est-pas-un-objet` (format invalide). Prévoir un parcours lorsque la caméra est refusée. Les QR peuvent être générés à partir de ces textes avec l’outil de votre choix ; aucun service externe n’est nécessaire au kit MQTT.
