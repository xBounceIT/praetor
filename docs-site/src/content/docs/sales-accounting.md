---
title: Vendite e contabilità
description: Flussi per preventivi, offerte, ordini, fatture clienti e documenti fornitori.
sidebar:
  order: 5
---

## Preventivi e offerte clienti

I preventivi e le offerte raccolgono prodotti, quantità, prezzi, sconti e condizioni. Usa il catalogo per partire da dati coerenti e controlla sempre totali, margini e validità prima di inviare il documento.

La lista dei preventivi mostra codice, data di inserimento, cliente, subtotale, sconto percentuale, sconto assoluto, totale scontato, margine, MOL, termini di pagamento, scadenza e stato per controllare rapidamente i valori principali senza aprire ogni record.

Nel riepilogo delle offerte, la riga **Sconto** mostra sempre la percentuale equivalente tra parentesi, anche quando lo sconto globale è inserito come importo fisso. L'importo dello sconto resta visibile in valuta sulla destra.

Nella lista **Offerte Clienti**, la data visibile è la **Data Invio**: viene valorizzata quando l'offerta passa allo stato inviata e non rappresenta più la data tecnica di creazione del record. La tabella mostra anche subtotale, sconto percentuale, sconto assoluto, totale scontato, margine, MOL e termini di pagamento per confrontare le offerte senza aprire ogni scheda.

Quando un documento viene accettato, prosegui creando l'ordine o il documento collegato invece di reinserire manualmente le stesse righe.

Le offerte clienti in stato **Accettata** o **Rifiutata** possono essere riportate in **Bozza** dal menu azioni solo da Top Manager o admin. Praetor richiede conferma, permette di indicare un motivo e registra il cambio nello storico/audit; l'azione non è disponibile se dall'offerta è già nato un ordine di vendita.

## Preventivi fornitori

I preventivi fornitori aiutano a confrontare costi e condizioni d'acquisto. Associa le righe ai prodotti corretti quando possibile, così i dati restano tracciabili nei flussi successivi.

La tabella **Articoli** rende esplicita la catena di prezzo d'acquisto con le colonne **Prodotto**, **Prezzo listino**, **Sconto a noi (%)**, **Costo unitario**, **Qtà** e **Totale**. Inserisci il prezzo di listino del fornitore e la percentuale di sconto che ti concede: Praetor calcola il **Costo unitario** come `Prezzo listino × (1 − Sconto a noi / 100)`, mentre il **Totale** di riga resta `Costo unitario × Qtà`. Il campo Costo unitario è in sola lettura perché derivato. Il **Riepilogo** continua a sommare i totali di riga in **Subtotale** e **Totale**.

## Ordini

Gli ordini clienti e fornitori consolidano le informazioni operative. Prima di confermare, verifica anagrafica, righe, sconti, condizioni di pagamento e collegamenti con documenti precedenti.

Un ordine di vendita creato da un'offerta accettata nasce in stato **Bozza** e resta completamente modificabile (cliente, righe, sconti, note e condizioni di pagamento) finché è in bozza. Passa in sola lettura solo dopo essere stato **Confermato** o **Rifiutato**.

Le righe che hanno generato automaticamente un **ordine fornitore** (contrassegnate dal badge *Ordine fornitore*) restano bloccate anche in bozza: non possono essere rimosse né modificate nel prodotto o nella quantità, così l'ordine di approvvigionamento collegato non resta disallineato. Puoi comunque aggiornarne il prezzo di vendita, aggiungere altre righe e modificare i campi di testata.

## Fatture

Le fatture clienti e fornitori devono riflettere ordini e consegne effettive. Controlla imponibili, IVA, totale e riferimenti al documento collegato.

Quando una fattura esce dallo stato bozza diventa in sola lettura: non può essere riportata in bozza o eliminata. Elimina solo le bozze create per errore, prima dell'emissione.

L'importo pagato non può superare il totale della fattura. Quando una fattura viene impostata su **pagata**, l'importo pagato deve coprire almeno l'intero totale; in caso contrario Praetor respinge il salvataggio per mantenere coerenti scadenziari, saldi e report.

Praetor arrotonda imponibili, IVA, costi e totali alla precisione monetaria di due decimali usando l'arrotondamento commerciale sui mezzi centesimi: valori come 1,005 diventano 1,01.

### IVA per riga

Ogni riga della fattura cliente ha la propria aliquota IVA in percentuale. Il valore predefinito per le nuove righe è 22% (aliquota ordinaria italiana), ma puoi modificarla per riflettere aliquote ridotte (10%, 5%, 4%) o le righe esenti (0%). Il pannello di riepilogo mostra il subtotale (imponibile), l'IVA totale e il totale generale (imponibile + IVA). Le fatture precedenti alla migrazione vengono caricate con aliquota IVA pari a 0%, mantenendo invariato il loro totale.

Se un documento deriva da un ordine o da un'offerta, usa il collegamento automatico per preservare la tracciabilità.
