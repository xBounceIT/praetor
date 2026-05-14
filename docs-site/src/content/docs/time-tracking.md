---
title: Time tracking e attività ricorrenti
description: Come registrare ore, consultare la settimana e gestire le attività ripetitive.
sidebar:
  order: 2
---

## Tracker

Usa il tracker per registrare il tempo lavorato su progetto e attività. Ogni registrazione deve indicare periodo, progetto, attività, descrizione e luogo quando richiesto.

Prima di salvare, verifica che le date siano corrette e che l'attività appartenga al progetto selezionato. Questo mantiene coerenti report, consuntivi e costi.

## Vista settimanale

La vista settimanale aiuta a controllare rapidamente le ore distribuite sui giorni. È utile per individuare giornate mancanti, duplicazioni o attività attribuite al progetto sbagliato.

Ogni registrazione esistente occupa una propria riga, così eventuali duplicazioni sulla stessa coppia cliente/progetto/attività restano visibili e modificabili in modo indipendente. La riga "Nuova voce" in alto serve esclusivamente a creare nuove registrazioni.

## Attività ricorrenti

Le attività ricorrenti permettono di generare registrazioni ripetitive, per esempio riunioni settimanali o attività amministrative periodiche.

Quando configuri una ricorrenza, controlla frequenza, data di inizio, eventuale data di fine e descrizione. Se una ricorrenza non serve più, disattivala invece di creare registrazioni manuali duplicate.

### Modello del template

Ogni template ricorrente è definito sull'attività di progetto e include:

- `recurrencePattern`: `daily`, `weekly`, `monthly`, oppure i pattern personalizzati `monthly:first:<dow>`, `monthly:second:<dow>`, `monthly:third:<dow>`, `monthly:fourth:<dow>`, `monthly:last:<dow>` (con `<dow>` = 0 domenica … 6 sabato).
- `recurrenceStart`: data da cui partono le occorrenze.
- `recurrenceEnd` (opzionale): se valorizzata, blocca la generazione oltre tale data.
- `recurrenceDuration`: ore di default per ciascuna registrazione generata.

I giorni che cadono di domenica, di sabato (se l'impostazione _Tratta il sabato come festivo_ è attiva) e quelli che coincidono con festività italiane vengono sempre saltati.

### Generazione lato server

La materializzazione delle registrazioni ricorrenti avviene sul server tramite l'endpoint `POST /api/entries/recurring/generate`. Il body richiede `fromDate` e `toDate` in formato `YYYY-MM-DD`; opzionalmente è possibile passare `userId` (richiede il permesso di gestione dell'utente o `timesheets.tracker_all.create`).

```json
{
  "fromDate": "2026-01-01",
  "toDate": "2026-01-14"
}
```

L'endpoint è idempotente: rieseguirlo con la stessa finestra non crea duplicati, perché le coppie già presenti `(data, progetto, attività)` vengono saltate. La risposta include `generatedCount`, `skippedExistingCount` e l'elenco delle registrazioni create.

Per evitare generazioni accidentalmente troppo ampie, il server limita la finestra a 366 giorni per chiamata.

Il permesso richiesto è `timesheets.recurring.create`.

### Pulizia delle registrazioni generate

La pulizia massiva delle registrazioni ricorrenti usa `DELETE /api/entries` con `projectId`, `task` e, quando necessario, `futureOnly` o `placeholderOnly`. Un ruolo con solo `timesheets.recurring.delete` può eliminare esclusivamente registrazioni segnaposto generate da ricorrenze: il server applica sempre `placeholderOnly=true` per quel caso. Per eliminare registrazioni effettive non segnaposto serve `timesheets.tracker.delete` nell'ambito assegnato, oppure `timesheets.tracker_all.delete` per l'ambito completo.
