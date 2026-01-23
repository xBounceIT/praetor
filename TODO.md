### Test 23/01/26 ###
 
*** Generiche
    - Io imposterei il menu diversamente con i seguenti moduli:
        - CRM:
          - Clienti: Anagrafica Clienti
          - Preventivi: nostri da fare vs Clienti
          - Vendite: ordini di vendita
            - Ieri se ho sentito bene il flusso è da cambiare perchè deve essere Preventivo -> Offerta -> Vendita giusto? In caso qui ci sarà anche Offerte
        - Catalogo
          - Prodotti: catalogo dei beni (es. licenze office) e servizi (es. consulenza) che proponiamo ai clienti
        - HR:
          - Forza lavoro: lista dipendenti con ruolo applicativo e (solo visibile ai manager) costo orario dell'utente
          - Unità di lavoro: pagina per creazione competence center e assegnazione manager dei center e membri
        - Fornitori:
          - Anagrafica
          - Preventivi: preventivi ricevuti da fornitori
        - Finanza
          - Fatture: Gestisci e traccia le fatture vs clienti
          - Pagamenti: Registra e traccia pagamenti clienti
          - Spese: Traccia spese aziendali e costi
          - Reports: Visualizza analitiche finanziarie e insight
        - Progetti:
          - Progetti: Creazione progetti associati a cliente
          - Attività: Creazione task associate a progetti
        - Presenze:
          - Time tracker: il nostro presenze
          - Progetti: vista read only sui progetti a te assegnati
          - Attività: vista read only sui task a te assegnati
          - Attività ricorrenti: vista tabellare delle attività che l'utente indica come ricorrenti in Time Tracker
          - Report: l'attuale rapporto di presenze
    - Le valute sono in dollari, è possibile mettere €? (DONE)
    - Quando premi invio chiude, è possibile toglierlo? (EH?)
    - per tutti i menu a tendina che dipendono da EC/AF/FR è possibile creare un modulo simil "amministratore" per editarli tutti?
 
*** CRM
    NOTA: Products e Special Bid togliamoli da sotto CRM e facciamo modulo dedicato "Catalogo" (richiesta EC) (DONE)
    - Clients: Condizioni Commerciali / Pagamento può essere rimossa da qui (DONE)
    - Quotes
        - sarebbe possibile avere tutto più ordinato su unica riga i dettaglio dei prodotti e quote?
        - La conferma sta per "inviata"? Se si, è possibile cambiare label? (DONE)
        - Un preventivo ha 3 stati: bozza, inviata, accettato/rifiutato (la cancellazione è possibile solo nello stato di bozza) (DONE)
    - Sales
        - Lo stato di pending a che serve?
        - Gli stati di un offerta sono: bozza, inviata, accettato/rifiutato (la cancellazione è possibile solo nello stato di bozza; la cancellazione della bozza se il preventivo associato è accettato non deve essere possibile)
        - OK si può creare un'offerta senza preventivo ma è possibile creata un'offerta crearlo con una "descrizione" "generato automaticamente dall'offerta xxx" ?   
        - I termini di pagamento possono essere diversi da preventivo, li puoi lasciare modificabili? 
        - Inoltre, su un'offerta mista (es: fornitura e consulenza) la modalità di fatturazione sarà differente, si può gestire?  
        - Una volta accetta è possibile impostare un flusso di creazione progetti che in prima battuta ne crea uno per ogni "tipo"? (Es: se offerta prevede tutti e tre "Fornitura - Servizio - Consulenza " ne crea 3 achee se ci sono più forniture/servizi/consulenze)
        - Una volta accetta nel modulo finanza deve essere gestita la possibilità di termini di pagamento differenti? (come indicato ieri da EC, colpa tua che gli hai detto che era fattibile da subito, serviranno prevedere diversi alert via mail)
        - Una volta accettata in un sotto menu "rinnovi" si deve inserire un riga per ogni Fornitura/Servizio che hanno una scadenza? 
    - Rinnovi (NEW - Richiesta ieri da EC)
        - Deve avere i seguenti campi
            - Numero offerta automatico [NON editabile]
            - Tipo automatico [NON editabile] (solo Fornitura e Servizi)
            - Categoria automatico [NON editabile]
            - Descrizione automatico [NON editabile] (ove presente in offerta)
            - Costo interno: automatico [NON editabile]
            - Mol: automatico [NON editabile]
            - Prezzo Cliente: automatico [NON editabile]
            - Margine: automatico [NON editabile]
            - Data accettazione (coincide con la creazione)
            - Data attivazione [editabile] (può essere precedente all'accetazione)
            - Data scadenza [editabile] (non lo facciamo automatica che sui servizi facciamo parecchi magheggi)
            - Note: testo libero [editabile] 
            - Se non compilate le due date ogni "x" (da definire, penso 1 volta alla settimana il lunedì alle 10) devono generare un alert via mail
    - Report (NEW) 
        - Deve consentire la possibilità di ricerche incrociate tra Preventivi e Offerta con tute le opzioni possibili
 
*** Catalogo
    - Products: deve avere i seguenti campi
        - Nome: univoco [editabile]
        - Descrizione: testo libero [editabile]
        - Tipo: Fornitura - Servizio - Consulenza [tendina]
        - Categoria: diversa per ogni tipo (da capire se libera o menu a tendina ma ti devo dare tante variabili es: Fornitura: Hardware - Licenza - Subscription / Consulenza: Cons. Specialistica - Cons. tecnica - Cons. Governace)
        - Sottocategoria: diversa per ogni categoria (come sopra)
        - Fornitore: capiamo con EC se serve qui 
        - Costo interno: testo libero [editabile]
        - Mol: testo libero [editabile]
        - Prezzo Cliente: automatico 
        - Margine: automatico 
    - Special Bid: deve avere i seguenti campi
        - Nome: univoco [automatico composto da "$Prodotto - Special Bid - $Cliente"] 
        - Product: selezione da Products  [tendina]
        - Cliente: selezione da CRM/Clients  [tendina]
        - Costo interno: automatico [NON editabile]
        - Mol: automatico [NON editabile]
        - Prezzo Cliente: automatico [NON editabile]
        - Margine: automatico [NON editabile]
        - Nuovo Costo interno: testo libero [editabile]
        - Nuovo Mol: testo libero [editabile]
        - Nuovo Prezzo Cliente: [automatico] 
        - Nuovo Margine: [automatico] 
    - Per entrambi nella visualizzazione sulla dashboard ci deve essere uno stato "attivo/disattivo" visibile
 
NOTA SPECIAL BID: una volta scaduti non devono poter essere eliminati e/o modificati
 
*** Finanze
    - Entrate
        - NOTA: dobbiamo gestire sia i canoni (forniture/servizi), sia i task (forniture/servizi_pagamento_anticipato/consulenze), sia i consuntivi a misura (T&M, basket, etc.. ); importate avere alert   
    - Uscite
        - NOTA: dobbiamo gestire sia i canoni, sia i task, sia i consuntivi a misura; importate avere alert  
    - Report
        - deve essere altamente personalizzabile