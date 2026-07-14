---
title: AI reporting
description: Come consultare report assistiti dall'intelligenza artificiale e interpretare le risposte.
sidebar:
  order: 6
---

## Disponibilità

Il modulo AI reporting è visibile solo se abilitato dall'amministrazione e se il tuo ruolo ha il permesso di accesso.

Se non vedi il modulo, chiedi a un amministratore di verificare impostazioni AI, configurazione del provider e permessi del ruolo.

Praetor supporta Gemini, OpenRouter e Ollama. Con Ollama i dati usati per generare la risposta vengono inviati esclusivamente all'endpoint configurato dall'amministratore. L'URL deve essere raggiungibile dal container backend di Praetor: `localhost` indica il container stesso, quindi in Docker può essere necessario usare il nome del servizio Ollama o un hostname accessibile dalla rete del backend.

## Uso consigliato

Formula richieste specifiche: indica periodo, area aziendale, cliente, progetto o metrica che vuoi analizzare. Domande precise producono risposte più verificabili.

Usa i risultati come supporto all'analisi, non come sostituto dei dati ufficiali. Prima di prendere decisioni operative, confronta le indicazioni con tabelle, documenti e report disponibili in Praetor.

## Buone pratiche

- Non inserire informazioni non necessarie o dati sensibili fuori contesto.
- Controlla sempre importi, date e riferimenti citati nella risposta.
- Riformula la domanda se la risposta è troppo generica.

## Costi nei report

Praetor calcola il costo di ogni voce di consuntivo come `durata * costo orario` con la stessa precisione decimale usata per le fatture. Il costo orario salvato sulla voce è quello in vigore al momento dell'inserimento, quindi le modifiche retroattive al costo orario di un dipendente non riscrivono lo storico.

Gli aggregati di costo per progetto, cliente, utente e periodo sono inclusi nei dataset di AI reporting solo se il tuo ruolo ha il permesso `reports.cost`. Senza questo permesso:

- Il campo `cost` viene rimosso dalle voci di consuntivo restituite dall'API.
- I totali e i top per costo vengono omessi dai dataset di AI reporting; restano disponibili le ore e il numero di voci.

Per concedere o revocare la visibilità dei costi, modifica il ruolo in Amministrazione > Ruoli e abilita o disabilita la voce "Reports > Cost reports".

## Accesso MCP per agenti esterni

Praetor espone un endpoint MCP remoto su `/api/mcp` per agenti compatibili con Model Context Protocol. Gli agenti devono autenticarsi con un token MCP personale, creato da Impostazioni > MCP.

Il token viene mostrato una sola volta al momento della creazione. Praetor conserva solo un hash, quindi revoca e ricrea il token se viene perso.

> Nota di aggiornamento: la release che introduce la separazione delle chiavi crittografiche (issue #416) cambia la chiave HMAC usata per gli hash dei token MCP. Dopo l'aggiornamento i token MCP esistenti smettono di funzionare e vanno rigenerati da Impostazioni > MCP.

Gli strumenti MCP rispettano sempre i permessi del tuo ruolo corrente. La prima versione include strumenti per utente corrente, utenti e gerarchie, clienti, fornitori, progetti, attività, preventivi, offerte, ordini, fatture, consuntivi e notifiche.

Ogni token MCP viene creato con un **ambito**:

- **Accesso completo** — il token può richiamare qualsiasi strumento concesso dal tuo ruolo, inclusi gli strumenti di scrittura (create / update / delete).
- **Sola lettura** — il token può richiamare solo gli strumenti corrispondenti ai permessi `*.view`. Gli strumenti di scrittura restituiscono "Insufficient permissions" anche se il tuo ruolo ha accesso in scrittura.

Configura il client MCP con l'URL dell'endpoint e l'header:

```text
Authorization: Bearer praetor_mcp_...
```

Per collegare un agente esterno:

1. Apri Impostazioni > MCP.
2. Crea un token con un nome riconoscibile, ad esempio il nome dell'agente o del dispositivo. Scegli **Sola lettura** se l'agente deve solo leggere dati; scegli **Accesso completo** se deve creare o aggiornare voci.
3. Copia subito il token; non verrà più mostrato.
4. Usa il campo URL server MCP mostrato nella pagina per l'endpoint esatto, di solito `https://host-praetor/api/mcp`.
5. Copia il prompt di configurazione agente se vuoi far configurare automaticamente il server a un agente AI.
6. Configura il client MCP con l'URL dell'endpoint e l'header bearer indicato sopra.
7. Revoca i token vecchi o inutilizzati da Impostazioni > MCP.

Strumenti supportati:

- `praetor_get_current_user`
- `praetor_get_users_hierarchy`
- `praetor_list_clients`
- `praetor_list_suppliers`
- `praetor_list_projects`
- `praetor_list_tasks`
- `praetor_list_quotes`
- `praetor_list_offers`
- `praetor_list_orders`
- `praetor_list_invoices`
- `praetor_list_time_entries`
- `praetor_create_time_entry`
- `praetor_update_time_entry`
- `praetor_delete_time_entry`
- `praetor_bulk_create_time_entries`
- `praetor_bulk_update_time_entries`
- `praetor_bulk_delete_time_entries`
- `praetor_list_notifications`
- `praetor_mark_notification_read`
- `praetor_delete_notification`

Gli strumenti bulk per i consuntivi accettano fino a 100 elementi per chiamata. Elaborano ogni elemento in modo indipendente e restituiscono un riepilogo con successi ed errori per singolo elemento.

Gli strumenti di aggiornamento dei consuntivi richiedono il campo `version` restituito da `praetor_list_time_entries`. Se la registrazione è stata modificata dopo la lettura, l'aggiornamento restituisce un errore di conflitto e l'agente deve rileggere i dati prima di riprovare.

Note di sicurezza:

- I token MCP ereditano i permessi del tuo ruolo corrente al momento della chiamata, filtrati dall'ambito del token (completo o sola lettura).
- I token scadono automaticamente dopo 30 giorni di inattività. Gli operatori possono modificare la finestra tramite la variabile d'ambiente `MCP_IDLE_TIMEOUT_MS` (millisecondi).
- Il cambio password del tuo account invalida anche tutti i token MCP precedentemente emessi. Dopo una rotazione della password devi ricreare i token e reimpostare gli agenti.
- L'endpoint MCP è limitato alla soglia standard delle route autenticate (600 richieste/minuto per IP client); le richieste in eccesso ricevono una risposta 429.
- Conserva i token MCP come password o chiavi API.
- Revoca i token quando un agente viene dismesso, un dispositivo viene perso o l'accesso non serve più.
- Gli strumenti per consuntivi e notifiche possono modificare dati; controlla prompt e automazioni dell'agente prima di abilitarne l'uso non presidiato.
