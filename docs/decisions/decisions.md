# Décisions prises au cours du projet

## Décisions prises J2

On a choisi de doubler notre base de données pour améliorer la scalabilité et les performances de l'application en cas de gros volume de données, et vérifier que les données sont correctes.
Nous avons ajouté une base de données non relationnelle : **MongoDB**, qui stocke l'ensemble des messages reçus par Mosquitto et MQTT depuis le simulateur. Ensuite, nous avons gardé une base de données relationnelle **PostgreSQL** qui ne contient que des données vérifiées et sans doublons grâce au backend qui vérifie si l'ID du message est déjà présent dans notre base PostgreSQL. Cette base stocke également les données calculées.

La synchronisation des données entre les deux bases se fait par lots toutes les 5 secondes. Cela permet de limiter les appels réseau, les ralentissements ou les crashs de notre base de données principale.

Nous avons décidé d'utiliser TanStack, une librairie qui nous permet de ne pas recréer le cache manuellement.
Ce cache nous sert lorsque notre application mobile perd la connexion. L'application sans connexion utilise alors les données mises en cache. Dans ce cache, nous avons les dernières données sauvegardées. Pour l'historique des données ainsi que la moyenne des données sur un laps de temps, ces données sont affichées hors ligne seulement si elles ont été consultées et chargées auparavant.

L'application recharge les données toutes les 5 secondes pour les dernières données des salles, et met à jour l'historique toutes les 10 secondes.
