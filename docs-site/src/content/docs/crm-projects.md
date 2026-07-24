---
title: CRM, catalogo e progetti
description: Gestione di clienti, fornitori, prodotti, commesse, attività e Competence Center.
sidebar:
  order: 3
---

## Clienti e fornitori

Le anagrafiche CRM raccolgono i dati usati nei flussi commerciali e contabili. Mantieni nomi, contatti, indirizzi e dati fiscali aggiornati prima di creare offerte, ordini o fatture.

Evita duplicati: prima di creare una nuova anagrafica, cerca se il cliente o fornitore esiste già.

Nelle tabelle anagrafiche, i riferimenti di contatto sono consultabili in colonne dedicate. Per i fornitori trovi referente, email e telefono separati, come nell'elenco clienti, così puoi ordinare, filtrare e leggere ogni dato senza aprire la scheda.

Nelle schede di clienti e fornitori puoi aggiungere più contatti, ciascuno con nome obbligatorio e ruolo, email e telefono facoltativi. Il primo contatto dell'elenco è quello principale e alimenta le colonne referente, email e telefono dell'anagrafica; eliminandolo, il contatto successivo diventa principale. Puoi anche lasciare l'elenco vuoto.

### Creare più clienti e fornitori

Accanto a **Aggiungi Nuovo Cliente**, la freccia apre due azioni riservate a chi può creare clienti:

- **Aggiungi molteplici Clienti** apre una tabella orizzontale. Inserisci una riga per cliente, aggiungi o elimina righe e salva il lotto. Le righe valide vengono create subito; quelle non valide restano nella finestra con l'errore indicato nella relativa cella.
- **Importa da Excel** permette di scaricare `praetor-clients-import.xlsx`, compilare le celle evidenziate e importare fino a 500 clienti. Il modello include istruzioni e tendine per i campi tipizzati. Le opzioni di settore, numero dipendenti, fatturato e numero sedi vengono lette dal CRM ogni volta che scarichi il modello, quindi includono subito le modifiche più recenti.

Il modello clienti richiede `clientCode`, `name` e `fiscalCode`; offre inoltre `type`, `contactName`, `contactRole`, `email`, `phone`, `website`, `addressCountry`, `addressState`, `addressCap`, `addressProvince`, `addressCivicNumber`, `addressLine`, `atecoCode`, `sector`, `numberOfEmployees`, `revenue`, `officeCountRange` e `description`. Non modificare nomi, ordine delle colonne, fogli o struttura protetta. Sono accettati soltanto modelli XLSX generati da Praetor, fino a 5 MiB. Le righe valide vengono create anche quando altre contengono errori; dopo un risultato parziale, **Importa clienti** riprova soltanto i record non riusciti. Un valore tipizzato eliminato dal CRM dopo il download viene segnalato come non valido durante l'importazione.

La freccia accanto a **Aggiungi Nuovo Fornitore** offre le stesse modalità:

- **Aggiungi molteplici fornitori** apre la tabella per inserire e correggere un lotto.
- **Importa da Excel** scarica `praetor-suppliers-import.xlsx` e applica gli stessi limiti e controlli strutturali del modello clienti.

Per ogni fornitore sono obbligatori `supplierCode`, `name` e `vatNumber`. Il modello evidenzia il gruppo del referente con le colonne **Nome Contatto**, **Ruolo Contatto**, **Email Contatto** e **Telefono Contatto**, corrispondenti a `contactName`, `contactRole`, `email` e `phone`; sono disponibili anche `address`, `taxCode`, `paymentTerms` e `notes`. Se compili ruolo, email o telefono devi indicare anche il nome del referente; l'import crea un solo contatto principale per riga. Ulteriori contatti possono essere aggiunti successivamente dalla scheda fornitore. I codici fornitore devono essere univoci senza distinzione tra maiuscole e minuscole in creazione, import e aggiornamento.

Nei preventivi clienti e fornitori il campo **Canale** è obbligatorio e indica il canale usato per comunicare o negoziare il preventivo. Lo stesso canale è visibile nelle tabelle dei preventivi. Le opzioni sono condivise tra i due moduli: chi ha permessi di gestione sui preventivi può usare il pulsante **Gestisci** con icona a ingranaggio sopra il campo per aggiungere, rinominare o rimuovere i canali disponibili e scegliere un’icona dal set proposto. Email, Telefono e WhatsApp sono valori predefiniti riconoscibili dalla propria icona e non possono essere modificati o eliminati. I canali personalizzati già usati da preventivi esistenti non possono essere eliminati.

### Eliminazione protetta

Non è possibile eliminare un cliente o un fornitore se sono presenti documenti commerciali collegati (preventivi, offerte, ordini, fatture). La richiesta di eliminazione viene respinta e il documento non viene perso: prima rimuovi o annulla i documenti collegati, poi elimina l'anagrafica. Questa protezione esiste perché un documento contabile emesso deve rimanere tracciabile, anche se l'anagrafica della controparte non serve più.

## Catalogo interno

Il catalogo contiene prodotti, categorie, unità di misura e logiche di prezzo. Le informazioni del catalogo alimentano preventivi, offerte e documenti contabili.

Nel modulo di creazione o modifica di un prodotto, il pulsante **Gestisci** sopra i campi **Tipo**, **Categoria** e **Sottocategoria** apre l'elenco delle relative voci. Da qui puoi aggiungere o rinominare una voce e, quando non è protetta da collegamenti esistenti, eliminarla. I nomi di tipo e di categoria devono essere univoci senza distinzione tra maiuscole e minuscole.

Aggiorna il listino quando cambiano costi, margini o condizioni di vendita, così i nuovi documenti partono da dati affidabili.

## Commesse e attività

Le commesse collegano clienti, attività e registrazioni di tempo. Il modulo resta **Progetti**, ma le pagine operative sono **Commesse** e **Rivendite**. Dentro **Commesse**, usa le tab **Commesse** e **Attività** per passare dall'archivio commesse alla gestione attività; l'archivio mostra anche data inizio e data fine di ogni commessa.

Per ogni commessa e attività puoi indicare il tipo di consuntivazione (canone o a misura) e la frequenza (mensile o una tantum) in modo indipendente: entrambi i tipi di consuntivazione supportano entrambe le frequenze. Se le attività usano un tipo diverso da quello della commessa, la commessa viene mostrata come mista.

Usa la stima di impegno mensile per pianificare il carico ricorrente e la durata dell'attività come moltiplicatore generico. L'impegno totale è calcolato automaticamente come impegno mensile × durata e viene usato per monitorare l'avanzamento rispetto alle ore complessive previste. Il ricavo totale dell'attività è calcolato allo stesso modo: ricavo × durata. I totali delle ore registrate rispettano separatamente la visibilità delle attività e quella dei timesheet: mostrano le proprie ore, includono gli utenti gestiti per chi dispone del permesso Timesheet e comprendono tutti gli utenti soltanto con **Tutti i timesheet - View** (`timesheets.tracker_all.view`).

Per creare un'attività in una commessa assegnata servono il permesso **Attività - Create** (`projects.tasks.create`) e l'assegnazione alla commessa. Il permesso globale **Tutte le attività - Create** (`projects.tasks_all.create`) consente invece di creare attività in qualsiasi commessa. I permessi di sola visualizzazione globale delle commesse non autorizzano la creazione di attività e non estendono le assegnazioni dell'utente.

L'azione **Aggiungi Commessa** apre una finestra dedicata alla sola creazione. Il primo campo è **Tipo**: per una commessa **Attivo** o **Passivo** compili ordine cliente, cliente, nome, date, offerta facoltativa, stato, consuntivazione, ricavo facoltativo e attività iniziali; per una commessa **Interna** ordine e offerta sono nascosti, il cliente viene impostato automaticamente sul nome azienda configurato in Praetor e le date sono facoltative. Al salvataggio, chi dispone del permesso sui dati avanzati viene portato alla pagina di dettaglio; gli altri ruoli restano nell'archivio.

L'archivio commesse resta consultabile con il permesso **Progetti** (`projects.manage.view`). Per cliccare una riga e aprire la **pagina di dettaglio della commessa** serve anche **Dati avanzati commessa** (`projects.details.view`), assegnato per impostazione predefinita a Manager e Top Manager. Senza questo permesso la tabella conserva tutte le colonne operative, ma le righe non sono interattive e ordine collegato, offerta, ricavo e dati interni del dettaglio non vengono esposti dalle API. La pagina sostituisce la vecchia finestra di modifica ed è organizzata in due sezioni:

- La sezione superiore dispone i campi della commessa orizzontalmente (tipo, cliente, nome, descrizione, date, stato, consuntivazione, ricavo, switch di disabilitazione e, per le commesse commerciali, ordine e offerta) accanto alla tabella attività modificabile inline.
- Sotto, la **dashboard della commessa** mostra KPI (ore totali, costo totale, dimensione team, % budget usato) e quattro grafici: ore per utente (suddivise per attività), ore per attività (ore registrate rispetto all'effort disponibile), costo vs ricavo e attività mensile. I grafici si popolano man mano che vengono registrate ore; se non ci sono ancora voci, ogni grafico mostra uno stato vuoto. La pagina mostra anche un avviso quando (a) la commessa ha più di 5.000 voci (vengono caricate solo le più recenti), (b) il tuo ruolo limita gli utenti di cui puoi vedere le voci (i totali riflettono solo la tua visibilità), oppure (c) non hai i permessi per vedere le voci timesheet.

Accanto al titolo della dashboard della commessa trovi due pulsanti, **Modifica** e **Viste**. **Modifica** trasforma l'intera dashboard — ogni scheda KPI, la cronologia della commessa e tutti e quattro i grafici — in un layout libero che puoi riorganizzare. Trascina una scheda dalla sua intestazione per spostarla ovunque sulla griglia a 12 colonne, trascina il bordo destro, il bordo inferiore o l'angolo per ridimensionarla, e usa il pulsante a forma di occhio su una scheda per nasconderla (o ripristinarne una nascosta). Puoi anche spostare la scheda attiva con i tasti freccia e ridimensionarla tenendo premuto **Maiusc** con i tasti freccia. Le schede risalgono per riempire gli spazi lasciati liberi. Quando hai finito, mantieni la disposizione per questa commessa o salvala come vista riutilizzabile. Modificare la dashboard di una commessa crea un **layout specifico della commessa** che riguarda solo quella commessa. Il menu **Viste** permette di applicare una vista salvata, scegliere **Usa predefinito globale** (rimuove il layout personalizzato della commessa così torna a seguire il predefinito condiviso) oppure **Imposta come predefinito globale** (rende la disposizione attuale la base per ogni commessa che non ha un proprio layout).

Le **viste salvate con nome** sono memorizzate sul server e appartengono a chi le crea: restano disponibili da qualsiasi dispositivo e possono essere condivise. Dal menu **Viste** il proprietario può **condividere** una vista con utenti specifici assegnando a ciascuno il permesso **lettura** (può solo applicarla) o **scrittura** (può modificarla, rinominarla e risalvarla, e la modifica diventa effettiva per tutti coloro con cui è condivisa). Solo il proprietario può **eliminare** la vista o gestirne la condivisione; le viste condivise mostrano le iniziali dell'autore in un piccolo avatar (passa il mouse per vederne il nome completo) accanto al tipo di accesso. Chi ha accesso in sola lettura può comunque **duplicare** la vista in una copia propria e modificabile. Le modifiche di chi ha accesso in scrittura si propagano agli altri al successivo caricamento o applicazione della vista, non in tempo reale. Il **layout specifico della commessa** e il **predefinito globale personale** restano invece memorizzati localmente nel browser e privati per ciascun utente. Sugli schermi stretti le schede si impilano in un'unica colonna e la modifica con trascinamento non è disponibile.

Quando crei o modifichi una commessa puoi compilare anche:

- **Data inizio commessa** e **Data fine commessa** — definiscono la finestra temporale prevista. Sono obbligatorie per le commesse **Attivo** e **Passivo**, mentre per le **Interne** sono entrambe facoltative così da poter tracciare attività aziendali senza una scadenza. Quando entrambe sono valorizzate, la data di fine non può precedere la data di inizio. Tornando da **Interna** a un tipo commerciale devi specificarle entrambe nello stesso salvataggio.
- **Ordine cliente** — collega una commessa **Attivo** o **Passivo** a un ordine cliente confermato. È obbligatorio per questi tipi alla creazione e al salvataggio; quando lo scegli, il cliente della commessa viene impostato dall'ordine e resta bloccato. Le commesse **Interne** non possono avere un ordine.
- **Riferimento offerta** — collega facoltativamente una commessa **Attivo** o **Passivo** a un'offerta accettata. Le commesse **Interne** non possono avere un'offerta.
- **Tipo** — classifica la commessa come **Attivo**, **Passivo** o **Interna**. È obbligatorio e viene mostrato nell'archivio e nel dettaglio. **Interna** serve a tracciare attività aziendali senza ordine, offerta o periodo obbligatorio; il cliente è gestito da Praetor e coincide con il nome azienda della Personalizzazione, mentre stato, fatturazione, ricavo, attività, timesheet e permessi restano invariati. Convertendo una commessa collegata in **Interna**, una conferma rimuove localmente ordine e offerta e il salvataggio persiste insieme le tre modifiche; annullando non cambia nulla. Tornando ad **Attivo** o **Passivo**, i campi commerciali ricompaiono e il salvataggio resta bloccato finché non selezioni un ordine confermato coerente con il cliente e inserisci le date richieste. Le commesse già esistenti prima dell'introduzione del campo tipo restano **Attivo** e richiedono la conferma esplicita alla prima modifica.
- **Stato** — segue il ciclo operativo della commessa ed è visibile come colonna nell'archivio. Le opzioni sono **Da fare** (commessa pianificata, ore inseribili), **In corso** (commessa attiva, ore inseribili), **In pausa** (commessa sospesa, ore non inseribili) e **Terminato** (commessa conclusa, ore non inseribili). Il selettore, il riepilogo informativo e i badge usano icone da media player coerenti: quadrato Stop per **Da fare**, Play per **In corso**, Pausa per **In pausa** e segno di spunta per **Terminato**. Il form mostra un'icona informativa accanto all'etichetta **Stato** con un riepilogo rapido in hover o focus. Le nuove commesse partono da **Da fare**; le commesse già esistenti sono inizializzate a **In corso**. **In pausa** e **Terminato** non disabilitano la scheda commessa: restano visibili in gestione per storico e riapertura cambiando stato.
- **Ricavo commessa** — segue questa precedenza: (1) se le attività hanno un valore di ricavo, il ricavo della commessa è la somma dei ricavi totali delle attività (`ricavo × durata`) in sola lettura; (2) altrimenti puoi inserirlo manualmente. Il totale dell'ordine collegato non viene importato automaticamente come ricavo della commessa.

Quando una commessa termina, passa lo stato a **Terminato** per impedire nuove ore e verifica che le attività siano coerenti e che non rimangano registrazioni pendenti.

### Rivendite

La voce **Rivendite** nel modulo Progetti gestisce operazioni economiche separate da attività operative, timesheet e assegnazioni utenti. La pagina è divisa nelle tab **Rivendite** e **Attività**: la prima mostra l'elenco rivendite con data inizio e data fine, mentre la tab attività si abilita dopo aver selezionato una rivendita e contiene riepilogo economico e attività rivendita. In creazione devi selezionare un **ordine cliente**, un solo **ordine fornitore** collegato a quell'ordine cliente, indicare **data inizio** e **scadenza rivendita** obbligatorie e aggiungere almeno una **attività rivendita** nella tabella iniziale: il sistema accetta l'ordine fornitore solo se almeno una riga dell'ordine cliente lo referenzia.

Ogni rivendita mostra il **Ricavo Rivendita** come somma dei ricavi inseriti nelle sue attività. Il **Costo Rivendita** ufficiale è invece importato dal totale dell'ordine fornitore e non viene modificato manualmente. Nel form di creazione entrambi i valori sono mostrati in sola lettura mentre compili le attività. Le attività rivendita restano compilate a mano e includono nome attività, fatturazione (mensile, trimestrale, annuale o una tantum), categoria, costo, ricavo, stato rilasciato, scadenza indipendente e note.

Il costo delle attività è modificabile: se la somma dei costi attività non coincide con il totale dell'ordine fornitore, la vista mostra una **varianza**. La varianza è un avviso operativo e non blocca il salvataggio, così puoi completare l'allineamento progressivamente.

Le categorie Rivendite sono un catalogo dedicato, inizializzato con **Hardware**, **Sottoscrizione** e **Licenza**. Puoi gestirle dal pulsante **Categorie Rivendite** nella vista Rivendite oppure dal controllo **Categoria** dentro il form di creazione rivendita, con lo stesso comportamento delle categorie prodotto del listino interno; una categoria usata da attività non può essere eliminata.

L'accesso è governato dai permessi separati **Rivendite** (`projects.resales.view/create/update/delete`), assegnati per impostazione predefinita ai profili Manager e Top Manager.

### Regole commessa

La sezione **Regole della commessa** nella pagina di dettaglio permette di creare controlli automatici sulla commessa. Una regola confronta uno o più campi della commessa (ricavo, ore consuntive, giorni alla scadenza, consuntivazione o stato; i campi di costo richiedono il permesso **Report costi**) con soglie, valori o altri campi compatibili e può combinare le condizioni con **AND** oppure **OR**. Le regole le cui condizioni fanno riferimento a campi di costo non sono incluse né nella risposta API né nell'elenco quando l'utente non dispone di **Report costi**, anche se il campo di costo è usato come termine di confronto. Il campo stato usa gli stessi valori operativi della commessa: **Da fare**, **In corso**, **In pausa** e **Terminato**. Quando la regola diventa vera, può eseguire una o più azioni: inviare notifiche a utenti assegnati selezionati o agli utenti assegnati che appartengono ai ruoli selezionati, e inviare un evento JSON a uno dei webhook abilitati dagli amministratori. Sono disponibili solo i ruoli ricoperti da almeno un utente abilitato assegnato alla commessa; le notifiche per ruolo non vengono mai estese a utenti esterni alle assegnazioni della commessa. Le destinazioni webhook sono visibili e selezionabili solo con il permesso **Visualizza webhook** (`administration.webhooks.view`); senza questo permesso si possono configurare solo azioni di notifica. Le azioni webhook esistenti e nascoste vengono conservate quando si modificano altri dettagli della regola o i destinatari delle notifiche; la regola può essere disabilitata senza esporne la destinazione, ma non può essere riabilitata senza **Visualizza webhook**. Nell'elenco, una destinazione nascosta viene indicata solo come azione webhook protetta, senza mostrarne nome o identificativo. Il payload del webhook include commessa, regola e metriche disponibili; le metriche di costo sono incluse solo quando la condizione della regola usa campi di costo. La sezione è visibile e modificabile tramite il permesso **Regole Progetto** (`projects.rules`), assegnato per impostazione predefinita a Manager e Top Manager. Le azioni sono eseguite solo sul passaggio da condizione non verificata a verificata, quindi non vengono duplicate mentre la regola resta vera. Riabilitare una regola o modificarne la condizione la prepara a generare nuovamente le azioni al prossimo controllo pianificato.

### Assegnazione utenti

Dal comando **Assegna Utenti** gestisci chi è assegnato a una commessa o a una sua attività. L'accesso a questa finestra è governato dal permesso **Assegnazioni Progetto**: l'azione **View** consente di aprire le assegnazioni di qualsiasi commessa o attività indipendentemente dalla propria appartenenza, mentre **Update** consente di modificarle. I permessi di modifica delle attività non autorizzano la gestione delle assegnazioni. Manager e Top Manager dispongono di entrambi i permessi di assegnazione per impostazione predefinita, quindi possono gestire le assegnazioni anche quando non sono membri della commessa o dell'attività. Per le attività, il server accetta soltanto utenti abilitati, visibili a chi esegue la modifica e idonei all'assegnazione; utenti disabilitati, Top Manager e utenti con il solo ruolo Admin vengono rifiutati anche nelle richieste API dirette.

## Competence Center

I Competence Center collegano risorse, costi e assegnazioni. Sono utili per analisi HR e controllo economico delle commesse.

Solo utenti con permessi adeguati dovrebbero modificare costi, assegnazioni o dati storici.
