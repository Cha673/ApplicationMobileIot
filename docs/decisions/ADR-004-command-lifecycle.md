# ADR-004 — Cycle de vie des commandes, timeouts et idempotence

**Date :** 2026-10-07  
**Statut :** Accepté

---

## Contexte

En J4, on introduit le flux descendant : le mobile envoie une commande vers l'objet via le backend et MQTT. L'objet répond par un ACK. On doit décider comment représenter l'état de la commande à chaque étape, comment gérer l'absence de réponse, et comment éviter qu'une commande répétée soit exécutée deux fois.

---

## Contrat de commande

Le backend génère un `commandId` (UUID v4) à la création. Ce champ est le seul lien entre la commande publiée et l'ACK reçu.

Le payload publié sur `campus/v1/devices/{deviceId}/commands` :

```json
{
  "schema_version": 1,
  "command_id": "550e8400-e29b-41d4-a716-446655440000",
  "action": "set_ventilation",
  "enabled": true,
  "expires_at": "2026-10-07T12:00:30Z"
}
```

L'objet recopie le `command_id` dans sa réponse sur `campus/v1/devices/{deviceId}/results`.

---

## Topics MQTT

| Direction | Topic |
|---|---|
| Backend → Device | `campus/v1/devices/{deviceId}/commands` |
| Device → Backend | `campus/v1/devices/{deviceId}/results` |

QoS 1 dans les deux sens. Pas de retained sur les commandes (une commande expirée ne doit pas être rejouée au redémarrage d'un subscriber).

---

## Cycle de vie

On représente l'état d'une commande par cinq valeurs :

```
PENDING → SENT → ACKNOWLEDGED
                → FAILED
        → TIMEOUT
```

- **PENDING** : la commande est créée en base mais pas encore publiée.
- **SENT** : publiée sur MQTT, en attente de réponse.
- **ACKNOWLEDGED** : l'objet a répondu `status: "executed"`.
- **FAILED** : l'objet a répondu `status: "rejected"` (commande expirée ou mal formée).
- **TIMEOUT** : `expires_at` dépassé sans réponse.

---

## Timeout

`expires_at` vaut `now + COMMAND_TIMEOUT_MS` au moment de la création (défaut 30 s, configurable via variable d'environnement). Le backend vérifie toutes les 10 secondes si des commandes `PENDING` ou `SENT` ont dépassé leur date d'expiration et les passe en `TIMEOUT`.

**ACK arrivé après le timeout :** on logge `command.ack_after_timeout` et on laisse l'état à `TIMEOUT`. L'objet a peut-être exécuté la commande, mais on ne peut plus garantir que c'était au bon moment. On préfère déclarer l'incertitude plutôt que de basculer silencieusement en `ACKNOWLEDGED`.

---

## Idempotence

Le simulateur stocke `results[commandId]` en mémoire. Un même `commandId` reçu une deuxième fois retourne le résultat mis en cache sans ré-exécuter l'action. Si le même `commandId` arrive avec un contenu différent, l'objet lève une erreur et répond `rejected`.

Côté backend, si un ACK arrive pour une commande déjà en état terminal (`ACKNOWLEDGED` ou `FAILED`), on logge `command.ack_duplicate` et on ignore l'ACK. Le statut ne change pas.

---

## Conséquences

- Le mobile ne peut jamais supposer qu'une commande `SENT` est exécutée : il doit attendre l'état `ACKNOWLEDGED`.
- Un objet qui répond après le timeout laisse une trace dans les logs sans modifier l'état perçu par l'utilisateur.
- Une commande rejouée avec le même `commandId` ne provoque pas de double exécution, ni côté objet, ni côté backend.
- Le `commandId` permet de filtrer les logs et de reconstruire l'historique complet d'une commande de bout en bout.
