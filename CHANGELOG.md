## 20260209 - Operativo
- Aggiunto Swagger (/docs/api) e TypeDoc (/docs/frontend) per documentazione automatica Backend e Frontend durante commit
- Refactoring completo backend e frontend per supporto documentazione automatica
- Migliorati controlli pre-commit per maggiore qualità del codice
- Aggiunta pagina listino esterno
- Modificato special bid per fare riferimento solo a listino esterno
- Aggiunto tooltip custom su ciascun pulsante
- RBAC 2.0: Profili personalizzati, permessi granulari, nuova pagina Ruoli nel modulo Amministrazione (stile glpi)
- Migrato da ESLint + Prettier a Biome (AIO)

## 20260202 - Operativo

* Ridisegnata la sidebar per avere tutti i moduli disponibili nel menu esposti e le loro pagine come voci del dropdown
* Rimossi filtri e barra di ricerca dalle pagine
* Rimosse tabelle storico / scadute / disattive e unificato tutto nella tabella principale, aggiungendo ove mancante la colonna stato
* Aggiunta filtri sulle colonne stile excel
* Rimosse le pagine Progetti e Attività dal modulo Presenze
* Aggiunto all'utente base il modulo Progetti in sola lettura
* Aggiunto sistema di notifiche email con tester
* Aggiunto campo luogo in Timesheet, con default "Remoto" ma personalizzabile dalle impostazioni globali
* Riorganizzate le pagine e file
* Migrato da NPM a BUN
* Revert HTTP2 -> HTTP1.1 (senza ssl i browser non lo supportano e da errori)
* Risolti 200+ errori typescript
* Completamente localizzata l'app

## 20260125 - Operativo

* Aggiornato lo stato dei preventivi e delle vendite a: bozza, inviato, accettato, rifiutato
* Aggiunta l'opzione di localizzazione automatica in base alla lingua del browser
* Rifattorizzata la pagina Special Bids per sostituire la visualizzazione delle righe delle offerte scadute con un formato tabellare per una maggiore chiarezza e organizzazione.
* Aggiunto un nuovo modulo Catalogo e spostate lì le pagine Prodotti e Offerte speciali.
* Rimossi i termini di pagamento dalla creazione del cliente.
* Impostato l'euro come valuta predefinita.
* Rimossa la possibilità di cancellare o modificare Special Bid scaduti
* Aggiunta valuta alle colonne costo, prezzo di vendita e margine nella pagina dei prodotti
* Aggiunti campi opzionali per la descrizione e la sottocategoria al tipo di prodotto per migliorare i dettagli del prodotto.
* Aggiornata la pagina Prodotti per gestire i nuovi campi e modificata la gestione dei tipi per includere “fornitura” e “consulenza”.
* Implementata la gestione degli errori per le operazioni asincrone sui prodotti e aggiunta la gestione dello stato degli errori del server.
* Introdotto un modale per l'aggiunta di sottocategorie, migliorando la gestione delle categorie.
* Aggiunta generazione progetto automatica per ciascuna voce quando una vendita viene accettata. La nomenclatura del progetto sarà "$IDCLIENTE\_$IDPRODOTTO\_$ANNO"
* Aggiunta auto assegnazione dei manager a tutti i clienti, progetti e task
* Aggiornata vista assegnazione clienti, progetti e task
* Allineato stile pagina Prodoti e Task con pagine piu recenti
* Aggiunto sistema di notifiche
* Aggiunta notifica creazione progetti a manager
* Aggiunto nuovo MOL %, nuovo margine calcolato e nuovo prezzo di vendita calcolato a creazione special bid

## 20260125 - Sicurezza

* Risolto il problema che consentiva ai manager di leggere, aggiornare ed eliminare le voci dei fogli presenze degli utenti che non gestivano.
* Aggiunti controlli pre commit di linting con husky
* Aggiunto ESLint per analisi codice statica
* Aggiunto controllo su id prodotto e cliente per evitare duplicati
