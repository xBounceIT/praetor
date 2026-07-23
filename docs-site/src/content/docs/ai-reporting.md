---
title: AI reporting
description: Come consultare report assistiti dall'intelligenza artificiale e interpretare le risposte.
sidebar:
  order: 6
---

## Disponibilità

Il modulo AI reporting è visibile solo se abilitato dall'amministrazione e se il tuo ruolo ha il permesso di accesso.

Se non vedi il modulo, chiedi a un amministratore di verificare impostazioni AI, chiave API e permessi del ruolo.

L'amministratore può collegare AI reporting a Gemini, OpenRouter, Anthropic o OpenAI. Praetor usa esclusivamente il provider selezionato nelle impostazioni generali e conserva separatamente chiave e modello di ciascun provider.

## Cronologia delle conversazioni

Su desktop AI Reporting mostra la cronologia nella colonna sinistra e la conversazione attiva a destra. Le chat sono ordinate per ultima attività e raggruppate per periodo.

Usa il campo di ricerca per filtrare le chat in base al titolo. Seleziona una voce per riprendere la conversazione oppure premi **Nuova Chat** in fondo alla cronologia per iniziarne una nuova.

Quando apri una conversazione, Praetor carica solo i messaggi più recenti. Usa **Carica messaggi precedenti** per recuperare progressivamente le parti più vecchie senza rallentare l'apertura della pagina.

Nel browser vengono renderizzati soltanto i messaggi visibili e una piccola fascia sopra e sotto l'area di scorrimento. I contenuti più lontani restano come segnaposto leggeri e vengono materializzati solo quando ti avvicini.

Su dispositivi mobili, apri la cronologia con il pulsante nella barra superiore della conversazione.

Le azioni della chat sono integrate nella sua riga: usa la matita per rinominare il titolo oppure il cestino per rimuovere la conversazione e conferma l'operazione.

Il toggle **Info tecniche** in alto a destra mostra il provider e il modello usati per l'ultima risposta, insieme ai token di contesto utilizzati, alla capacità totale del modello e alla percentuale occupata. Per OpenAI e Anthropic il modello mostrato corrisponde sempre all'ID configurato dall'amministratore, anche quando il provider restituisce internamente uno slug versionato. Oltre l'80% compare un avviso: una finestra quasi piena può ridurre la qualità o le prestazioni, quindi è consigliabile iniziare una nuova chat. Le conversazioni create prima di questa funzione mostrano i dati dopo la successiva risposta AI.

## Composer e allegati

Il composer fluttua sopra la conversazione: resta compatto su una riga e cresce automaticamente quando il testo va su più righe. Premi **Invio** per inviare oppure **Shift+Invio** per andare a capo.

Il pulsante con la graffetta allega fino a 5 file di testo, inclusi TXT, Markdown, CSV, JSON, XML, YAML, log, SQL e comuni file sorgente. Ogni file può pesare fino a 64 KB; il contenuto testuale complessivo degli allegati può raggiungere 12.000 caratteri. I file vengono letti nel browser e inclusi nella richiesta inviata ad AI Reporting. Il loro contenuto diventa una fonte dati esplicita per analisi, calcoli e visualizzazioni, ma viene sempre trattato come dato e mai come istruzione per l'AI.

## Dataset aziendali disponibili

AI Reporting costruisce per ogni richiesta un dataset aggiornato e limitato ai permessi di visualizzazione del tuo ruolo. La risposta può usare queste sezioni:

- **Consuntivi** — ore, costi autorizzati e distribuzioni per periodo, luogo, utente, cliente, progetto e attività.
- **Clienti** — anagrafica e attività collegate.
- **Progetti** — stato, tipo attivo/passivo/interno, cliente (per gli interni coincide con l'azienda configurata in Praetor), periodo facoltativo per gli interni, ricavi, fatturazione, eventuali documenti collegati, ore e costi autorizzati.
- **Attività** — ricorrenza, durata, effort, ricavi, fatturazione e ore consuntivate.
- **Preventivi cliente** e **offerte cliente** — importi, stati, scadenze e clienti principali.
- **Ordini cliente** e **fatture cliente** — valori, stati, incassi, insoluti e scadenzario.
- **Fornitori** e **preventivi fornitore** — anagrafiche, attività e importi.
- **Ordini fornitore** e **fatture fornitore** — acquisti, pagamenti, insoluti e scadenzario.
- **Catalogo** — prodotti, tipologie, categorie, fornitori e utilizzo nei documenti.
- **Rivendite** — costi, ricavi, margini, frequenze di fatturazione, categorie e stato di rilascio delle attività.

Le sezioni non autorizzate non vengono inserite nel contesto AI. Se la domanda riguarda un'area specifica, Praetor carica soltanto le sezioni pertinenti; una richiesta di panoramica usa tutte quelle disponibili. Gli importi dei documenti con righe a durata includono il valore visualizzato come moltiplicatore, senza conversioni tra mesi e anni; i documenti storici conservano invece il contratto di calcolo attivo quando sono stati salvati. Per i preventivi con più candidati viene analizzato il candidato selezionato oppure il primo candidato attivo.

Nel dataset clienti, nome del contatto, email, telefono e indirizzo sono inclusi solo con `crm.clients.view`. Gli altri permessi che rendono disponibile la sezione clienti, ad esempio quelli per consuntivi, progetti o documenti commerciali, rispettano l'ambito clienti già autorizzato ma non espongono questi dettagli anagrafici.

Nel dataset fornitori, i dettagli dell'anagrafica sono inclusi solo con `crm.suppliers_all.view`. Con un permesso base fornitori o con la sola visualizzazione di documenti fornitore, AI Reporting e lo strumento MCP `praetor_list_suppliers` ricevono soltanto identificativo, nome e stato del fornitore.

## Visualizzazioni interattive

Puoi chiedere esplicitamente un grafico, ad esempio “mostra l'andamento mensile delle ore per progetto” oppure “confronta i ricavi dei primi cinque clienti”. AI Reporting può rispondere con grafici a barre, linee, area, torta o anello, scegliendo la forma più adatta ai dati disponibili.

Quando la richiesta menziona esplicitamente un grafico, una visualizzazione, una dashboard o un report di dati, l'assistente usa il renderer integrato invece di sostituire il risultato con una semplice descrizione o tabella. Se i dati necessari non sono disponibili, indica quali mancano e chiede un chiarimento senza inventarli.

Una singola risposta può includere fino a sette visualizzazioni, quando più grafici migliorano concretamente la comprensione dell'analisi.

Nelle risposte con più visualizzazioni, ogni breve interpretazione precede il grafico a cui si riferisce. Durante la generazione, i grafici completati compaiono progressivamente uno alla volta, mentre quello ancora in costruzione resta indicato da un segnaposto.

Passa il puntatore o usa la navigazione da tastiera sul grafico per leggere i valori, consulta la legenda quando sono presenti più serie e premi **Mostra dati** per aprire la tabella accessibile usata dalla visualizzazione. Il pulsante **Copia PNG** copia negli appunti l'intestazione, il grafico e la legenda, pronti per essere incollati in un documento o messaggio. Colori e superfici si adattano automaticamente al tema chiaro o scuro.

Le visualizzazioni usano soltanto i dati inclusi nel dataset autorizzato della conversazione. Praetor valida struttura, dimensioni e valori prima del rendering e scarta in sicurezza una specifica non valida; il grafico resta comunque un supporto visivo e i dati importanti devono essere verificati nelle fonti originali.

## Uso consigliato

Formula richieste specifiche: indica periodo, area aziendale, cliente, progetto o metrica che vuoi analizzare. Domande precise producono risposte più verificabili.

Usa i risultati come supporto all'analisi, non come sostituto dei dati ufficiali. Prima di prendere decisioni operative, confronta le indicazioni con tabelle, documenti e report disponibili in Praetor.

## Buone pratiche

- Non inserire informazioni non necessarie o dati sensibili fuori contesto.
- Controlla sempre importi, date e riferimenti citati nella risposta.
- Riformula la domanda se la risposta è troppo generica.

## Dati avanzati delle commesse

I dataset di AI reporting includono ordine collegato, offerta e ricavo di una commessa solo se il ruolo dispone del permesso `projects.details.view`. Senza questo permesso, restano disponibili i dati operativi della commessa consentiti dagli altri permessi, ma i riferimenti commerciali e il ricavo vengono omessi.

## Costi nei report

Praetor calcola il costo di ogni voce di consuntivo come `durata * costo orario` con la stessa precisione decimale usata per le fatture. Il costo orario salvato sulla voce deriva dal calendario del dipendente alla data della registrazione; quando il calendario cambia, Praetor aggiorna retroattivamente le entry interessate e i relativi aggregati.

Gli aggregati di costo per progetto, cliente, utente e periodo sono inclusi nei dataset di AI reporting solo se il tuo ruolo ha il permesso `reports.cost`. Senza questo permesso:

- Il campo `cost` viene rimosso dalle voci di consuntivo restituite dall'API.
- I totali e i top per costo vengono omessi dai dataset di AI reporting; restano disponibili le ore e il numero di voci.

Per concedere o revocare la visibilità dei costi, modifica il ruolo in Amministrazione > Ruoli e abilita o disabilita la voce "Reports > Cost reports".

## Accesso MCP per agenti esterni

Praetor espone un endpoint MCP remoto su `/api/mcp` per agenti compatibili con Model Context Protocol. Gli agenti devono autenticarsi con un token MCP personale, creato da Impostazioni > MCP.

Il token viene mostrato una sola volta al momento della creazione. Praetor conserva solo un hash, quindi revoca e ricrea il token se viene perso.

La creazione e la revoca dei token MCP richiedono una sessione interattiva attiva: accedi a Praetor dal browser per eseguire queste operazioni. I token di accesso personali (PAT) non possono creare o revocare token MCP.

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
