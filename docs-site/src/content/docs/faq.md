---
title: FAQ e risoluzione problemi
description: Risposte rapide ai problemi piu comuni durante l'uso di Praetor.
sidebar:
  order: 8
---

## Non vedo un modulo

La visibilità dei moduli dipende dai permessi del ruolo e da alcune impostazioni globali. Chiedi a un amministratore di verificare il ruolo assegnato e l'abilitazione del modulo.

## Non riesco a salvare un documento

Controlla i campi obbligatori, i valori numerici e le date. Nei documenti commerciali verifica anche che righe, quantità, prezzi e anagrafica siano completi.

## I totali non sono quelli attesi

Rivedi sconti, tipo di sconto, unità di misura, quantità e prezzo unitario. Se il documento è stato generato da un altro documento, controlla anche il collegamento di origine.

## La sessione è scaduta

Effettua di nuovo l'accesso. Le sessioni scadono per proteggere i dati quando l'applicazione resta inattiva.

## Un aggiornamento si ferma durante le migrazioni

Il backend applica le migrazioni del database prima di accettare traffico. Se un deploy viene interrotto a metà, rilancia lo stesso comando di upgrade: le migrazioni già registrate vengono saltate e quelle mancanti vengono riconosciute tramite hash. Se l'avvio continua a fallire, controlla i log del backend prima di fare rollback.

## La documentazione tecnica è ancora disponibile?

Sì. La documentazione API resta su `/docs/api` e la documentazione frontend resta su `/docs/frontend`.
