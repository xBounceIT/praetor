## 24-25/01/2026 - Operativo

- Aggiornato lo stato dei preventivi e delle vendite a: bozza, inviato, accettato, rifiutato
- Aggiunta l'opzione di localizzazione automatica in base alla lingua del browser
- Rifattorizzato SpecialBidsView per sostituire la visualizzazione delle righe delle offerte scadute con un formato tabellare per una maggiore chiarezza e organizzazione.
- Adeguata la localizzazione dell'etichetta totale nel componente SpecialBidsView.
- Aggiunto un nuovo modulo Catalogo e spostate lì le pagine Prodotti e Offerte speciali.
- Rimossi i termini di pagamento dalla creazione del cliente.
- Impostato l'euro come valuta predefinita.
- Rimossa la possibilità di cancellare o modificare Special Bid scaduti
- Aggiunta valuta alle colonne costo, prezzo di vendita e margine nella pagina dei prodotti
- Aggiunti campi opzionali per la descrizione e la sottocategoria al tipo di prodotto per migliorare i dettagli del prodotto.
- Aggiornato il componente ProductsView per gestire i nuovi campi e modificata la gestione dei tipi per includere “fornitura” e “consulenza”.
- Implementata la gestione degli errori per le operazioni asincrone sui prodotti e aggiunta la gestione dello stato degli errori del server.
- Introdotto un modale per l'aggiunta di sottocategorie, migliorando la gestione delle categorie.
- Aggiunti controlli pre commit di linting con husky
- Aggiunto ESLint per analisi codice statica
- Aggiunta generazione progetto automatica per ciascuna voce quando una vendita viene accettata. La nomenclatura del progetto sarà "$IDCLIENTE_$IDPRODOTTO_$ANNO"
- Aggiunta auto assegnazione dei manager a tutti i clienti, progetti e task
- Aggiornata vista assegnazione clienti, progetti e task
- Allineato stile pagina Prodoti e Task con pagine piu recenti

## 24-25/01/2026 - Sicurezza

- Risolto il problema che consentiva ai manager di leggere, aggiornare ed eliminare le voci dei fogli presenze degli utenti che non gestivano.
