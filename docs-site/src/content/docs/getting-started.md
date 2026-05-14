---
title: Primi passi
description: Accesso, navigazione e impostazioni iniziali per iniziare a lavorare in Praetor.
sidebar:
  order: 1
---

## Accesso

Accedi con le credenziali fornite dall'amministratore. Se l'azienda usa LDAP o single sign-on, potresti essere reindirizzato al provider aziendale prima di entrare nella piattaforma.

Se la sessione resta inattiva troppo a lungo, Praetor richiede un nuovo accesso. Questa protezione evita che una sessione lasciata aperta venga usata da altri.

## Navigazione

La barra laterale raggruppa i moduli principali. Le voci disponibili dipendono dal ruolo assegnato:

- **Presenze** per registrare ore e attività ricorrenti.
- **CRM** per clienti e fornitori.
- **Catalogo** per il listino interno.
- **Vendite** per preventivi e offerte.
- **Contabilità** per ordini e fatture.
- **Progetti** per attività, clienti e avanzamento.
- **HR** per dipendenti e unità di lavoro.
- **Report** per analisi e AI reporting.
- **Amministrazione** per configurazioni e audit.

## Impostazioni personali

Dal menu utente puoi aprire le impostazioni, cambiare ruolo se hai più profili disponibili, consultare questa documentazione e uscire dall'applicazione.

La scheda **Sicurezza** contiene il cambio password e il token di accesso personale per usare le API. Quando cambi la password, tutte le altre sessioni attive del tuo utente vengono revocate immediatamente: solo il dispositivo da cui hai effettuato il cambio resta connesso, e l'operazione viene registrata nei log di audit. Il token eredita i permessi del tuo utente; copialo quando viene creato o rinnovato, perché in seguito verrà mostrato solo in forma mascherata. Il token viene inoltre rifiutato dopo 30 giorni di inattività — rinnovalo prima che scada o chiedi a un amministratore di regolare la finestra di inattività tramite la variabile d'ambiente `PAT_IDLE_TIMEOUT_MS` lato server.

Controlla sempre di lavorare con il ruolo corretto prima di modificare dati amministrativi o contabili.
