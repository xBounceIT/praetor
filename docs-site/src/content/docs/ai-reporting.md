---
title: AI reporting
description: Come consultare report assistiti dall'intelligenza artificiale e interpretare le risposte.
sidebar:
  order: 5
---

## Disponibilità

Il modulo AI reporting è visibile solo se abilitato dall'amministrazione e se il tuo ruolo ha il permesso di accesso.

Se non vedi il modulo, chiedi a un amministratore di verificare impostazioni AI, chiave API e permessi del ruolo.

## Uso consigliato

Formula richieste specifiche: indica periodo, area aziendale, cliente, progetto o metrica che vuoi analizzare. Domande precise producono risposte più verificabili.

Usa i risultati come supporto all'analisi, non come sostituto dei dati ufficiali. Prima di prendere decisioni operative, confronta le indicazioni con tabelle, documenti e report disponibili in Praetor.

## Buone pratiche

- Non inserire informazioni non necessarie o dati sensibili fuori contesto.
- Controlla sempre importi, date e riferimenti citati nella risposta.
- Riformula la domanda se la risposta è troppo generica.

## Accesso MCP per agenti esterni

Praetor espone un endpoint MCP remoto su `/api/mcp` per agenti compatibili con Model Context Protocol. Gli agenti devono autenticarsi con un token MCP personale, creato da Impostazioni > Token MCP.

Il token viene mostrato una sola volta al momento della creazione. Praetor conserva solo un hash, quindi revoca e ricrea il token se viene perso.

Gli strumenti MCP rispettano sempre i permessi del tuo ruolo corrente. La prima versione include strumenti per utente corrente, clienti, fornitori, progetti, attività, consuntivi, notifiche e dataset di AI reporting.

Configura il client MCP con l'URL dell'endpoint e l'header:

```text
Authorization: Bearer praetor_mcp_...
```

Per collegare un agente esterno:

1. Apri Impostazioni > Token MCP.
2. Crea un token con un nome riconoscibile, ad esempio il nome dell'agente o del dispositivo.
3. Copia subito il token; non verrà più mostrato.
4. Configura il client MCP con `https://host-praetor/api/mcp` e l'header bearer indicato sopra.
5. Revoca i token vecchi o inutilizzati da Impostazioni > Token MCP.

Strumenti supportati:

- `praetor_get_current_user`
- `praetor_list_clients`
- `praetor_list_suppliers`
- `praetor_list_projects`
- `praetor_list_tasks`
- `praetor_list_time_entries`
- `praetor_create_time_entry`
- `praetor_update_time_entry`
- `praetor_delete_time_entry`
- `praetor_list_notifications`
- `praetor_mark_notification_read`
- `praetor_delete_notification`
- `praetor_get_reporting_dataset`

Note di sicurezza:

- I token MCP ereditano i permessi del tuo ruolo corrente al momento della chiamata.
- Conserva i token MCP come password o chiavi API.
- Revoca i token quando un agente viene dismesso, un dispositivo viene perso o l'accesso non serve più.
- Gli strumenti per consuntivi e notifiche possono modificare dati; controlla prompt e automazioni dell'agente prima di abilitarne l'uso non presidiato.
