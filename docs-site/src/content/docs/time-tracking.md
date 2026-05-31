---
title: Time tracking e attività ricorrenti
description: Come registrare ore, consultare la settimana e gestire le attività ripetitive.
sidebar:
  order: 2
---

## Tracker

Usa il tracker per registrare il tempo lavorato su progetto e attività. Ogni registrazione deve indicare periodo, progetto, attività, descrizione e luogo quando richiesto.

Prima di salvare, verifica che le date siano corrette e che l'attività appartenga al progetto selezionato. Questo mantiene coerenti report, consuntivi e costi.

Praetor non consente di creare una seconda registrazione per lo stesso utente, data, progetto e attività: `POST /api/entries` risponde con `409` se la combinazione esiste già. Aggiorna la registrazione esistente invece di crearne una duplicata.

La durata di una singola registrazione è limitata a 24 ore: sia `POST /api/entries` sia `PUT /api/entries/:id` rifiutano qualsiasi `duration` superiore a `24`. Suddividi il lavoro su più date invece di registrare durate impossibili.

Quando una registrazione viene modificata, Praetor usa il campo `version` restituito dall'API per impedire sovrascritture concorrenti. Se la stessa registrazione è stata salvata altrove nel frattempo, `PUT /api/entries/:id` risponde con `409` e occorre ricaricare la registrazione prima di riprovare.

## Vista settimanale

La vista settimanale aiuta a controllare rapidamente le ore distribuite sui giorni. È utile per individuare giornate mancanti, duplicazioni o attività attribuite al progetto sbagliato.

Ogni registrazione esistente occupa una propria riga, così eventuali dati storici duplicati restano visibili e modificabili in modo indipendente. La riga "Nuova voce" in alto serve esclusivamente a creare nuove registrazioni e rispetta il controllo anti-duplicato.

## RIL

La pagina **RIL** nel modulo Presenze genera un prospetto mensile partendo dalle registrazioni dell'utente selezionato. È disponibile agli utenti con il permesso **timesheets.ril.view**; la migrazione assegna automaticamente questo permesso ai ruoli che già avevano accesso alla vista Time Tracker. È possibile scegliere mese e anno e, per gli utenti gestiti, anche il collaboratore da consultare.

Praetor recupera le registrazioni con `GET /api/entries` usando i filtri inclusivi `fromDate` e `toDate`, quindi costruisce una bozza modificabile: le modifiche fatte nel prospetto restano locali alla pagina e all'esportazione Excel, senza aggiornare le registrazioni originali. Le righe festive marcate automaticamente restano evidenziate e non modificabili; le righe del weekend sono evidenziate per riconoscerle rapidamente.

Per ogni giorno feriale valido, Praetor prepara la bozza con gli orari di entrata e uscita configurati, di default **09:00** e **18:00**, anche quando non ci sono registrazioni tracciate. **Ore** e **PICAP** vengono ricalcolati dai valori modificabili di entrata e uscita, sottraendo la parte dell'intervallo che si sovrappone alla pausa pranzo configurata, a partire dalle **13:00**. Le festività italiane che cadono tra lunedì e venerdì vengono marcate con il codice nota festivo configurato, di default `F`; le festività nel weekend non vengono marcate. Se almeno una registrazione del giorno non è `remote`, la riga usa la prima opzione Trasferta configurata nelle impostazioni RIL, altrimenti usa la seconda.

Nel prospetto, **Note** e **Trasferta** usano le opzioni configurate dagli amministratori nelle impostazioni globali RIL. **Cod** è selezionabile tra `TR` trasferta e `SD` sede disagiata.

Prima dell'esportazione, ogni giorno feriale valido deve avere **Entrata**, **Uscita** e **Trasferta** compilati. Il pulsante **Esporta Excel** crea un file `.xlsx` con un solo foglio, **Prospetto Presenze**, e colonne compatibili con il modello RIL: Giorno, Entrata, Uscita, Ore, PICAP, Reperib. Telef., Note, Trasferta, Cod e Commessa.

## Attività ricorrenti

Le attività ricorrenti permettono di generare registrazioni ripetitive, per esempio riunioni settimanali o attività amministrative periodiche.

Quando configuri una ricorrenza, controlla frequenza, data di inizio, eventuale data di fine e descrizione. Se una ricorrenza non serve più, disattivala invece di creare registrazioni manuali duplicate.

### Modello del template

Ogni template ricorrente è definito sull'attività di progetto e include:

- `recurrencePattern`: `daily`, `weekly`, `monthly`, oppure i pattern personalizzati `monthly:first:<dow>`, `monthly:second:<dow>`, `monthly:third:<dow>`, `monthly:fourth:<dow>`, `monthly:last:<dow>` (con `<dow>` = 0 domenica … 6 sabato).
- `recurrenceStart`: data da cui partono le occorrenze.
- `recurrenceEnd` (opzionale): se valorizzata, blocca la generazione oltre tale data.
- `recurrenceDuration`: ore di default per ciascuna registrazione generata. Limitato a 24 ore, in linea con il tetto applicato alle singole registrazioni.

Per le ricorrenze `monthly`, se il giorno della data di inizio non esiste in un mese più corto, l'occorrenza viene generata nell'ultimo giorno di quel mese.

I giorni che cadono di domenica, di sabato (se l'impostazione _Tratta il sabato come festivo_ è attiva) e quelli che coincidono con festività italiane vengono sempre saltati.

### Generazione lato server

La materializzazione delle registrazioni ricorrenti avviene sul server tramite l'endpoint `POST /api/entries/recurring/generate`. Il body richiede `fromDate` e `toDate` in formato `YYYY-MM-DD`; opzionalmente è possibile passare `userId` (richiede il permesso di gestione dell'utente o `timesheets.tracker_all.create`).

```json
{
  "fromDate": "2026-01-01",
  "toDate": "2026-01-14"
}
```

L'endpoint è idempotente e sicuro anche con richieste di generazione sovrapposte: rieseguirlo con la stessa finestra non crea duplicati, perché le coppie già presenti `(data, progetto, attività)` vengono saltate. La risposta include `generatedCount`, `skippedExistingCount` e l'elenco delle registrazioni create.

Per evitare generazioni accidentalmente troppo ampie, il server limita la finestra a 366 giorni per chiamata.

Il permesso richiesto è `timesheets.recurring.create`.

### Pulizia delle registrazioni generate

La pulizia massiva delle registrazioni ricorrenti usa `DELETE /api/entries` con `projectId`, `task` e, quando necessario, `futureOnly` o `placeholderOnly`. Un ruolo con solo `timesheets.recurring.delete` può eliminare esclusivamente registrazioni segnaposto generate da ricorrenze: il server applica sempre `placeholderOnly=true` per quel caso. Per eliminare registrazioni effettive non segnaposto serve `timesheets.tracker.delete` nell'ambito assegnato, oppure `timesheets.tracker_all.delete` per l'ambito completo.
