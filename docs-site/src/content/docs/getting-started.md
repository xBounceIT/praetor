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
- **HR** per profili dipendente, dati operativi e Competence Center.
- **Report** per analisi e AI reporting.
- **Amministrazione** per configurazioni e audit.

## Viste tabella e condivisione

La maggior parte degli elenchi in Praetor (progetti, attività, clienti, fornitori, documenti contabili, utenti) usa una tabella comune con cui puoi mostrare o nascondere colonne, ordinare e applicare filtri. Puoi salvare una combinazione come **vista con nome** per richiamarla in seguito.

La maniglia nell'intestazione permette di trascinare le colonne nella posizione desiderata; con la tastiera puoi usare le frecce sinistra e destra sulla stessa maniglia. Puoi modificare l'ordine anche nell'elenco delle colonne quando aggiungi o modifichi una vista, trascinando la maniglia oppure usando le frecce su e giù. **Ripristina colonne** ripristina sia la visibilità sia l'ordine predefinito. L'ordine manuale non salvato è temporaneo, mentre una vista con nome conserva e condivide anche l'ordine delle colonne insieme a visibilità, ordinamento dei dati e filtri.

Le viste con nome sono memorizzate sul server e appartengono a chi le crea, quindi restano disponibili da qualsiasi dispositivo e possono essere condivise. Il proprietario può **condividere** una vista con utenti specifici assegnando a ciascuno il permesso **lettura** (può solo applicarla) o **scrittura** (può modificarla, rinominarla e risalvarla, e la modifica diventa effettiva per tutti coloro con cui è condivisa). Solo il proprietario può **eliminare** una vista o gestirne la condivisione; chi ha accesso in sola lettura può comunque **duplicarla** in una copia propria e modificabile. Le viste condivise con te mostrano un'etichetta con l'autore e il livello di accesso, e le modifiche di chi ha accesso in scrittura si propagano al successivo caricamento o applicazione della vista, non in tempo reale.

Restano invece locali al browser, e quindi privati per ciascun dispositivo, le preferenze di sola visualizzazione come densità delle righe, dimensione del testo, larghezza delle colonne e quale vista è attiva.

Le viste condivise sono gestite dagli endpoint `GET/POST/PUT/DELETE /api/views/*` documentati nella sezione **API**. Lato sviluppo, una tabella abilita la modalità con server e condivisione solo quando riceve una `viewKey` stabile (per esempio `projects.directory`): la chiave definisce lo spazio dei nomi della vista ed evita collisioni tra tabelle diverse; le tabelle senza `viewKey` continuano a salvare le viste solo nel browser.

## Impostazioni personali

Dal menu utente puoi aprire le impostazioni, cambiare ruolo se hai più profili disponibili, consultare questa documentazione e uscire dall'applicazione.

La scheda **Sicurezza** contiene il cambio password e il token di accesso personale per usare le API. Quando cambi la password, tutte le altre sessioni attive del tuo utente vengono revocate immediatamente *e* anche tutti i token di accesso personale e i token MCP precedentemente emessi vengono invalidati: solo il dispositivo da cui hai effettuato il cambio resta connesso, ogni integrazione API deve essere reimpostata con un nuovo token, e l'operazione viene registrata nei log di audit. Il token eredita i permessi del tuo utente; copialo quando viene creato o rinnovato, perché in seguito verrà mostrato solo in forma mascherata. Il token viene inoltre rifiutato dopo 30 giorni di inattività — rinnovalo prima che scada o chiedi a un amministratore di regolare la finestra di inattività tramite la variabile d'ambiente `PAT_IDLE_TIMEOUT_MS` lato server.

Controlla sempre di lavorare con il ruolo corretto prima di modificare dati amministrativi o contabili.
