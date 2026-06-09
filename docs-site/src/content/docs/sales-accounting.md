---
title: Vendite e contabilità
description: Flussi per preventivi, offerte, ordini, fatture clienti e documenti fornitori.
sidebar:
  order: 5
---

## Preventivi e offerte clienti

I preventivi e le offerte raccolgono prodotti, quantità, prezzi, sconti e condizioni. Usa il catalogo per partire da dati coerenti e controlla sempre totali, margini e validità prima di inviare il documento.

Ogni riga del preventivo include la colonna **Durata**, posizionata tra **Quantità** e **Costo**: indica per quanto tempo è valido il servizio. Accanto al valore un selettore permette di scegliere l'unità — **Mesi** o **Anni** (1 anno = 12 mesi) — con lo stesso formato *valore / unità* usato per la quantità. La durata si comporta come un moltiplicatore insieme alla quantità, quindi sia il **Costo Totale** sia i **Ricavi** della riga sono calcolati come *valore unitario × Quantità × Durata (in mesi)*. Per le voci una tantum lascia **Durata = 1 mese**, così i totali restano identici al comportamento precedente.

La **Durata** segue l'intera catena documentale: quando converti un preventivo in offerta e poi in ordine di vendita, le righe mantengono sia il valore sia l'unità (mesi o anni) impostati, così i totali del documento derivato coincidono con quelli del preventivo. Anche le **fatture clienti** hanno la colonna Durata sulle righe e moltiplicano l'imponibile (e quindi IVA e totale) per i mesi corrispondenti; sulle fatture la durata si imposta manualmente, dato che le righe non vengono copiate automaticamente da un ordine.

La durata si applica a **tutte le righe**, indipendentemente dall'unità di quantità (**Ore**, **Giorni** o **Unità**): il campo Durata è modificabile con il selettore **Mesi** / **Anni** / **N/D** e moltiplica i totali della riga. Selezionando **N/D** la durata non si applica alla riga: il campo numerico accanto viene disabilitato e i totali della riga non vengono moltiplicati per la durata.

La lista dei preventivi mostra codice, data di inserimento, cliente, subtotale, sconto percentuale, sconto assoluto, totale scontato, margine, MOL, termini di pagamento, scadenza e stato per controllare rapidamente i valori principali senza aprire ogni record.

Quando crei o modifichi un **preventivo** o un'**offerta**, ogni riga di **Prodotti / Servizi** che fa riferimento a un **Preventivo Fornitore** o a un **prodotto** mostra un'icona di apertura rapida; negli **ordini cliente** e nelle **fatture clienti** la stessa icona apre il **prodotto** collegato della riga. Aprila per consultare il record collegato nella sua pagina già filtrata in una nuova scheda del browser, senza chiudere né modificare il documento in corso. L'icona è sempre presente (così le righe restano allineate) quando hai il permesso di accedere alla vista di destinazione: se la riga non ha un riferimento da aprire resta visibile ma disabilitata, con un tooltip che lo segnala. Sulla pagina di destinazione il filtro è applicato tramite il filtro nativo della colonna (**Codice**), così resta visibile e puoi rimuoverlo dal menu del filtro per tornare all'elenco completo. La rimozione di una riga chiede prima conferma: il clic sull'icona del cestino apre una richiesta di conferma, così un clic accidentale non elimina mai un prodotto finché non confermi.

Nel riepilogo delle offerte, la riga **Sconto** mostra sempre la percentuale equivalente tra parentesi, anche quando lo sconto globale è inserito come importo fisso. L'importo dello sconto resta visibile in valuta sulla destra.

Nella lista **Offerte Clienti**, la data visibile è la **Data Invio**: viene valorizzata quando l'offerta passa allo stato inviata e non rappresenta più la data tecnica di creazione del record. La tabella mostra anche subtotale, sconto percentuale, sconto assoluto, totale scontato, margine, MOL e termini di pagamento per confrontare le offerte senza aprire ogni scheda.

Quando un documento viene accettato, prosegui creando l'ordine o il documento collegato invece di reinserire manualmente le stesse righe.

Le offerte clienti in stato **Accettata** o **Rifiutata** possono essere riportate in **Bozza** dal menu azioni solo da Top Manager o admin. Praetor richiede conferma, permette di indicare un motivo e registra il cambio nello storico/audit; l'azione non è disponibile se dall'offerta è già nato un ordine di vendita.

## Preventivi fornitori

I preventivi fornitori aiutano a confrontare costi e condizioni d'acquisto. Associa le righe ai prodotti corretti quando possibile, così i dati restano tracciabili nei flussi successivi.

Nella sezione **Informazioni Fornitore** del dialog **Nuovo Preventivo Fornitore** devi collegare un **Cliente**: ogni preventivo fornitore deve essere associato a un cliente. Il campo è obbligatorio — è contrassegnato dall'asterisco `*` come **Fornitore** e **Codice Preventivo**, e il salvataggio è bloccato finché non selezioni un cliente; non esiste più l'opzione vuota *Nessun cliente*. Il cliente collegato è visibile sia nel dettaglio del preventivo sia nella colonna **Cliente** della lista.

La tabella **Articoli** rende esplicita la catena di prezzo d'acquisto con le colonne **Prodotto**, **Prezzo listino**, **Sconto a noi (%)**, **Costo unitario**, **Qtà**, **Durata** e **Totale**. Inserisci il prezzo di listino del fornitore e la percentuale di sconto che ti concede (limitata a 0–100%, perché uno sconto superiore porterebbe il costo sotto zero): Praetor calcola il **Costo unitario** come `Prezzo listino × (1 − Sconto a noi / 100)`, mentre il **Totale** di riga è `Costo unitario × Qtà × Durata (in mesi)`. Il campo Costo unitario è in sola lettura perché derivato. Nel **Riepilogo**, il **Subtotale** somma i prezzi di listino (`Prezzo listino × Qtà × Durata`), la riga **Sconto** evidenzia lo sconto totale concesso dai fornitori e il **Totale** riporta il costo netto (`Costo unitario × Qtà × Durata`). La riga Sconto compare solo quando almeno una riga ha uno sconto.

La colonna **Durata** è posizionata dopo **Qtà** e funziona esattamente come nei [preventivi clienti](#preventivi-e-offerte-clienti): moltiplica il totale della riga per il numero di mesi, con un selettore **Mesi** / **Anni** / **N/D** (1 anno = 12 mesi). Si applica a **tutte le righe**, indipendentemente dall'unità di quantità (**Ore**, **Giorni** o **Unità**). Selezionando **N/D** la durata non si applica alla riga: il campo numerico accanto viene disabilitato e il totale della riga non viene moltiplicato per la durata. Per le voci una tantum lascia **Durata = 1 mese** (o **N/D**), così i totali restano identici al comportamento precedente.

Puoi allegare i file del fornitore (**xlsx**, **pdf** o **docx**, fino a 10 MB ciascuno) nella sezione **Allegati**. I file possono essere aggiunti già dal dialog **Nuovo Preventivo Fornitore** — vengono messi in coda mentre compili il preventivo e caricati automaticamente al salvataggio — oltre che successivamente finché il preventivo è in bozza. Gli allegati possono essere modificati solo nei preventivi in bozza senza ordine collegato; quando il preventivo esce dalla bozza o nasce un ordine collegato la sezione diventa di sola lettura e i file esistenti possono solo essere scaricati.

## Ordini

Gli ordini clienti e fornitori consolidano le informazioni operative. Prima di confermare, verifica anagrafica, righe, sconti, condizioni di pagamento e collegamenti con documenti precedenti.

Un ordine di vendita creato da un'offerta accettata nasce in stato **Bozza** e resta completamente modificabile (cliente, righe, sconti, note e condizioni di pagamento) finché è in bozza. Passa in sola lettura solo dopo essere stato **Confermato** o **Rifiutato**.

Le righe che hanno generato automaticamente un **ordine fornitore** (identificabili dalla colonna *Ordine fornitore*) restano bloccate anche in bozza: non possono essere rimosse né modificate nel prodotto o nella quantità, così l'ordine di approvvigionamento collegato non resta disallineato. Puoi comunque aggiornarne il prezzo di vendita, aggiungere altre righe e modificare i campi di testata.

Gli **ordini fornitore** ereditano la colonna **Durata** dal preventivo: creando un ordine da un preventivo fornitore (con il pulsante dedicato o nella conversione automatica) ogni riga mantiene il numero di mesi impostato e il **Totale** dell'ordine è calcolato come `Costo unitario × Qtà × Durata`, così coincide con quello del preventivo invece di azzerare la durata a un mese. La durata resta modificabile, con il selettore **Mesi** / **Anni** / **N/D**, finché l'ordine è in bozza; scegliendo **N/D** la riga viene esclusa dal moltiplicatore di durata.

## Fatture

Le fatture clienti e fornitori devono riflettere ordini e consegne effettive. Controlla imponibili, IVA, totale e riferimenti al documento collegato.

Quando una fattura esce dallo stato bozza diventa in sola lettura: non può essere riportata in bozza o eliminata. Elimina solo le bozze create per errore, prima dell'emissione.

L'importo pagato non può superare il totale della fattura. Quando una fattura viene impostata su **pagata**, l'importo pagato deve coprire almeno l'intero totale; in caso contrario Praetor respinge il salvataggio per mantenere coerenti scadenziari, saldi e report.

Sia le **fatture clienti sia quelle fornitori** riportano la colonna **Durata** sulle righe, con lo stesso selettore **Mesi** / **Anni** / **N/D**, e moltiplicano il totale della riga per i mesi corrispondenti. Quando crei una **fattura fornitore** da un ordine fornitore la durata viene riportata così il totale della fattura coincide con quello dell'ordine; altrimenti è modificabile riga per riga finché la fattura è in bozza. Selezionando **N/D** la riga viene esclusa dal moltiplicatore di durata.

Praetor arrotonda imponibili, IVA, costi e totali alla precisione monetaria di due decimali usando l'arrotondamento commerciale sui mezzi centesimi: valori come 1,005 diventano 1,01.

### IVA per riga

Ogni riga della fattura cliente ha la propria aliquota IVA in percentuale. Il valore predefinito per le nuove righe è 22% (aliquota ordinaria italiana), ma puoi modificarla per riflettere aliquote ridotte (10%, 5%, 4%) o le righe esenti (0%). Il pannello di riepilogo mostra il subtotale (imponibile), l'IVA totale e il totale generale (imponibile + IVA). Le fatture precedenti alla migrazione vengono caricate con aliquota IVA pari a 0%, mantenendo invariato il loro totale.

Se un documento deriva da un ordine o da un'offerta, usa il collegamento automatico per preservare la tracciabilità.
