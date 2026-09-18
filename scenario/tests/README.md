# Instructions screenshots J3

Depuis le dossier ~/ApplicationMobileIot, lancez chaque script puis prenez le screenshot.

## Commande de base
```
bash scenario/tests/scenarioX.sh
```

## Ordre des scenarios

| Script | Scenario |
|--------|---------------|
| scenario2.sh | Usurpation          |
| scenario3.sh | Payload invalide    |
| scenario4.sh | Deduplication       |
| scenario5.sh | Ordre temporel      |   
| scenario6.sh | Capteur silencieux  |
| scenario7a.sh | Broker down        |
| scenario7b.sh | Backend down       |
| scenario7c.sh | QoS 0 vs 1         |
| scenario7d.sh | Retained           |
| scenario8.sh | Secrets             |
| scenario9_10.sh | Logs JSON        |
| scenario12.sh | Tracabilite        |
| scenario13.sh | Montee charge      |


### Scenario 3 - rejets
```
{service_name="backend"} |= "telemetry.rejected"
```

### Scenario 4 - doublons
```
{service_name="backend"} |= "raw.duplicate"
```

### Scenario 11 - schema evenement
```
{service_name="backend"} |= "telemetry.rejected"
```
Cliquer sur un evenement -> deplier les champs reason, field, value, min, max

### Scenario 12 - tracabilite
Remplacer <ID> par le messageId affiche par scenario12.sh :
```
{service_name="backend"} |= "<ID>"
```

### Scenario 13 - montee en charge
```
{service_name="backend"} |= "sync.batch_ok"
```
