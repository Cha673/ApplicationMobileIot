# Décisions prises au cours du projet

## Décisions prises J2

On a choisi de doubler notre base de données. Nous avons ajouté une base de données non relationnelle : **MongoDB**, qui stocke l'ensemble des messages reçus par Mosquitto et MQTT depuis le simulateur. Ensuite, nous avons gardé une base de données **PostgreSQL** qui ne contient que des données vérifiées et sans doublons. Cette base stocke également les données calculées.

La synchronisation des données entre les deux bases se fait par lots toutes les 5 secondes. Cela permet de limiter les appels réseau,de limiter les ralentissements ou les crashs de notre base de données principale.
