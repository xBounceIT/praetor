---
title: Report ore
description: Come filtrare, raggruppare, salvare ed esportare le registrazioni ore.
sidebar:
  order: 6
---

La pagina **Reporting > Report** genera tabelle a partire dalle registrazioni del Time Tracker. Il periodo iniziale è il mese corrente.

## Filtri e campi

Puoi scegliere un periodo relativo (oggi, ieri, settimana, mese o anno corrente/precedente) oppure un intervallo personalizzato. Sono disponibili filtri per cliente, più progetti, attività e testo contenuto nelle note. Le date iniziale e finale sono incluse.

La data è sempre visibile. Puoi aggiungere o rimuovere utente, cliente, progetto, attività, durata, nota e costo. Il costo appare solo con il permesso `reports.cost.view` ed è calcolato usando il costo orario storico salvato sulla registrazione.

## Utenti e visibilità

Il permesso `reports.time_report.view` consente di creare report sulle proprie ore. Il selettore utenti compare con `reports.time_report_all.view`:

- manager e top manager possono selezionare se stessi e gli utenti gestiti;
- chi possiede anche `timesheets.tracker_all.view` può selezionare tutti gli utenti non amministratori;
- lo scope è sempre verificato dal server.

Il ruolo amministratore non può usare questa pagina. I ruoli personalizzati possono ricevere esplicitamente entrambi i permessi.

## Raggruppamenti e totali

Puoi impostare fino a tre raggruppamenti distinti e ordinati fra data, utente, cliente, progetto e attività. Il risultato mostra i dettagli, i subtotali gerarchici e il totale generale. **Solo totali** rimuove le righe di dettaglio ed è disponibile solo quando esiste almeno un raggruppamento.

La durata è mostrata in formato `H:MM`; il costo usa la valuta configurata. Se il risultato supera il limite della tabella, Praetor mostra un avviso: conteggio e totale generale continuano a includere tutte le registrazioni.

La matita sulle righe di dettaglio è disponibile solo con i permessi Timesheet effettivi di lettura e aggiornamento. Dopo il salvataggio, il report corrente viene rigenerato.

## Preferiti personali

Inserisci un nome e usa **Salva** per memorizzare la configurazione. Il nome deve essere univoco fra i tuoi preferiti del report. Selezionare un preferito compila il modulo senza eseguirlo automaticamente.

I periodi relativi vengono ricalcolati quando applichi il preferito; un intervallo personalizzato conserva invece le date assolute. Se un utente o un'entità non è più visibile, Praetor rimuove il filtro e mostra un avviso. Anche il campo costo viene rimosso se il permesso non è più disponibile. I preferiti del report sono personali e non condivisibili.

## Esportazione CSV

**Esporta** usa l'ultima configurazione effettivamente generata, non le modifiche ancora presenti nel modulo. Il CSV include dettagli, subtotali e totale generale, ma non le azioni dell'interfaccia. È codificato UTF-8 con BOM e protegge le celle dall'esecuzione come formule.

L'esportazione completa è limitata a 50.000 registrazioni. Oltre tale limite il server restituisce un errore esplicito: restringi periodo o filtri e riprova.
