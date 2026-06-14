---
title: CRM, catalogo e progetti
description: Gestione di clienti, fornitori, prodotti, progetti, attività e Competence Center.
sidebar:
  order: 3
---

## Clienti e fornitori

Le anagrafiche CRM raccolgono i dati usati nei flussi commerciali e contabili. Mantieni nomi, contatti, indirizzi e dati fiscali aggiornati prima di creare offerte, ordini o fatture.

Evita duplicati: prima di creare una nuova anagrafica, cerca se il cliente o fornitore esiste già.

Nei preventivi clienti e fornitori il campo **Canale di Comunicazione** è obbligatorio e indica il canale usato per comunicare o negoziare il preventivo. Lo stesso canale è visibile nelle tabelle dei preventivi. Le opzioni sono condivise tra i due moduli: chi ha permessi di gestione sui preventivi può usare il pulsante **Gestisci** con icona a ingranaggio sopra il campo per aggiungere, rinominare o rimuovere i canali disponibili. I canali già usati da preventivi esistenti non possono essere eliminati.

### Eliminazione protetta

Non è possibile eliminare un cliente o un fornitore se sono presenti documenti commerciali collegati (preventivi, offerte, ordini, fatture). La richiesta di eliminazione viene respinta e il documento non viene perso: prima rimuovi o annulla i documenti collegati, poi elimina l'anagrafica. Questa protezione esiste perché un documento contabile emesso deve rimanere tracciabile, anche se l'anagrafica della controparte non serve più.

## Catalogo interno

Il catalogo contiene prodotti, categorie, unità di misura e logiche di prezzo. Le informazioni del catalogo alimentano preventivi, offerte e documenti contabili.

Aggiorna il listino quando cambiano costi, margini o condizioni di vendita, così i nuovi documenti partono da dati affidabili.

## Progetti e attività

I progetti collegano clienti, attività e registrazioni di tempo. Crea attività chiare e riutilizzabili, con nomi che descrivono il lavoro effettivo.

Per ogni progetto e attività puoi indicare il tipo di consuntivazione (canone o a misura) e la frequenza (mensile o una tantum) in modo indipendente: entrambi i tipi di consuntivazione supportano entrambe le frequenze. Se le attività usano un tipo diverso da quello del progetto, il progetto viene mostrato come misto.

Usa la stima di impegno mensile per pianificare il carico ricorrente e la durata dell'attività come moltiplicatore generico. L'impegno totale è calcolato automaticamente come impegno mensile × durata e viene usato per monitorare l'avanzamento rispetto alle ore complessive previste. Il ricavo totale dell'attività è calcolato allo stesso modo: ricavo × durata.

L'azione **Aggiungi Progetto** apre una finestra dedicata alla sola creazione: ordine cliente, cliente, nome, date, offerta facoltativa, tipo, consuntivazione, ricavo facoltativo e una tabella di attività iniziali. Al salvataggio sei portato direttamente alla pagina di dettaglio del nuovo progetto.

Cliccando una riga nell'elenco progetti si apre la **pagina di dettaglio del progetto**, che sostituisce la vecchia finestra di modifica ed è organizzata in due sezioni:

- La sezione superiore dispone i campi del progetto orizzontalmente (ordine cliente, cliente, nome, descrizione, date, offerta, tipo, consuntivazione, ricavo, switch di disabilitazione) accanto alla tabella attività modificabile inline.
- Sotto, la **dashboard del progetto** mostra KPI (ore totali, costo totale, dimensione team, % budget usato) e quattro grafici: ore per utente (suddivise per attività), ore per attività (ore registrate rispetto all'effort disponibile), costo vs ricavo e attività mensile. I grafici si popolano man mano che vengono registrate ore; se non ci sono ancora voci, ogni grafico mostra uno stato vuoto. La pagina mostra anche un avviso quando (a) il progetto ha più di 5.000 voci (vengono caricate solo le più recenti), (b) il tuo ruolo limita gli utenti di cui puoi vedere le voci (i totali riflettono solo la tua visibilità), oppure (c) non hai i permessi per vedere le voci timesheet.

Accanto al titolo della dashboard del progetto trovi due pulsanti, **Modifica** e **Viste**. **Modifica** trasforma l'intera dashboard — ogni scheda KPI, la cronologia del progetto e tutti e quattro i grafici — in un layout libero che puoi riorganizzare. Trascina una scheda dalla sua intestazione per spostarla ovunque sulla griglia a 12 colonne, trascina il bordo destro, il bordo inferiore o l'angolo per ridimensionarla, e usa il pulsante a forma di occhio su una scheda per nasconderla (o ripristinarne una nascosta). Puoi anche spostare la scheda attiva con i tasti freccia e ridimensionarla tenendo premuto **Maiusc** con i tasti freccia. Le schede risalgono per riempire gli spazi lasciati liberi. Quando hai finito, mantieni la disposizione per questo progetto o salvala come vista riutilizzabile. Modificare la dashboard di un progetto crea un **layout specifico del progetto** che riguarda solo quel progetto. Il menu **Viste** permette di applicare una vista salvata, scegliere **Usa predefinito globale** (rimuove il layout personalizzato del progetto così torna a seguire il predefinito condiviso) oppure **Imposta come predefinito globale** (rende la disposizione attuale la base per ogni progetto che non ha un proprio layout).

Le **viste salvate con nome** sono memorizzate sul server e appartengono a chi le crea: restano disponibili da qualsiasi dispositivo e possono essere condivise. Dal menu **Viste** il proprietario può **condividere** una vista con utenti specifici assegnando a ciascuno il permesso **lettura** (può solo applicarla) o **scrittura** (può modificarla, rinominarla e risalvarla, e la modifica diventa effettiva per tutti coloro con cui è condivisa). Solo il proprietario può **eliminare** la vista o gestirne la condivisione; le viste condivise mostrano le iniziali dell'autore in un piccolo avatar (passa il mouse per vederne il nome completo) accanto al tipo di accesso. Chi ha accesso in sola lettura può comunque **duplicare** la vista in una copia propria e modificabile. Le modifiche di chi ha accesso in scrittura si propagano agli altri al successivo caricamento o applicazione della vista, non in tempo reale. Il **layout specifico del progetto** e il **predefinito globale personale** restano invece memorizzati localmente nel browser e privati per ciascun utente. Sugli schermi stretti le schede si impilano in un'unica colonna e la modifica con trascinamento non è disponibile.

Quando crei o modifichi un progetto puoi compilare anche:

- **Data inizio progetto** e **Data fine progetto** — definiscono la finestra temporale prevista. Entrambe sono obbligatorie (alla creazione e a ogni salvataggio successivo dalla pagina di dettaglio) così che i progetti abbiano sempre una finestra di pianificazione; la data di fine non può precedere la data di inizio.
- **Ordine cliente** — collega il progetto a un ordine cliente confermato. Il campo è obbligatorio alla creazione e al salvataggio dalla pagina di dettaglio; quando scegli un ordine, il cliente del progetto viene impostato dall'ordine e resta bloccato.
- **Riferimento offerta** — collega il progetto a un'offerta accettata quando serve tracciarne l'origine commerciale. Il campo è facoltativo e può restare vuoto.
- **Tipo** — classifica il progetto come **Attivo** o **Passivo**. È un campo obbligatorio (con lo stesso indicatore `*` di Cliente e Nome Progetto): il progetto non può essere creato finché non scegli un valore, e il tipo selezionato è mostrato nell'elenco progetti e nella pagina di dettaglio. I progetti già esistenti prima dell'introduzione del campo sono impostati su **Attivo** in modo predefinito, ma alla **prima modifica** dalla pagina di dettaglio devi confermare esplicitamente il tipo: il selettore parte vuoto e il salvataggio è bloccato finché non scegli un valore, così la scelta non resta quella predefinita per inerzia.
- **Ricavo progetto** — segue questa precedenza: (1) se le attività hanno un valore di ricavo, il ricavo del progetto è la somma dei ricavi totali delle attività (`ricavo × durata`) in sola lettura; (2) altrimenti puoi inserirlo manualmente. Il totale dell'ordine collegato non viene importato automaticamente come ricavo del progetto.

Quando un progetto termina, verifica che le attività siano coerenti e che non rimangano registrazioni pendenti.

### Rivendite

La voce **Rivendite** nel modulo Progetti gestisce operazioni economiche separate da attività operative, timesheet e assegnazioni utenti. In creazione devi selezionare un **ordine cliente**, un solo **ordine fornitore** collegato a quell'ordine cliente, indicare **data inizio** e **scadenza rivendita** obbligatorie e aggiungere almeno una **attività rivendita** nella tabella iniziale: il sistema accetta l'ordine fornitore solo se almeno una riga dell'ordine cliente lo referenzia.

Ogni rivendita mostra il **Ricavo Rivendita** come somma dei ricavi inseriti nelle sue attività. Il **Costo Rivendita** ufficiale è invece importato dal totale dell'ordine fornitore e non viene modificato manualmente. Nel form di creazione entrambi i valori sono mostrati in sola lettura mentre compili le attività. Le attività rivendita restano compilate a mano e includono nome attività, fatturazione (mensile, trimestrale, annuale o una tantum), categoria, costo, ricavo, stato rilasciato, scadenza indipendente e note.

Il costo delle attività è modificabile: se la somma dei costi attività non coincide con il totale dell'ordine fornitore, la vista mostra una **varianza**. La varianza è un avviso operativo e non blocca il salvataggio, così puoi completare l'allineamento progressivamente.

Le categorie Rivendite sono un catalogo dedicato, inizializzato con **Hardware**, **Sottoscrizione** e **Licenza**. Puoi gestirle dal pulsante **Categorie Rivendite** nella vista Rivendite oppure dal controllo **Categoria** dentro il form di creazione rivendita, con lo stesso comportamento delle categorie prodotto del listino interno; una categoria usata da attività non può essere eliminata.

L'accesso è governato dai permessi separati **Rivendite** (`projects.resales.view/create/update/delete`), assegnati per impostazione predefinita ai profili Manager e Top Manager.

### Regole progetto

La sezione **Regole del progetto** nella pagina di dettaglio permette di creare controlli automatici sul progetto. Una regola confronta uno o più campi del progetto (ricavo, ore consuntive, giorni alla scadenza, consuntivazione o stato; i campi di costo richiedono il permesso **Report costi**) con soglie, valori o altri campi compatibili e può combinare le condizioni con **AND** oppure **OR**. Quando la regola diventa vera, invia una notifica agli utenti assegnati selezionati o agli utenti che hanno uno dei ruoli scelti. La sezione è visibile e modificabile tramite il permesso **Regole Progetto** (`projects.rules`), assegnato per impostazione predefinita a Manager e Top Manager. Le notifiche sono inviate solo sul passaggio da condizione non verificata a verificata, quindi non vengono duplicate mentre la regola resta vera. Riabilitare una regola o modificarne la condizione la prepara a generare una nuova notifica al prossimo controllo pianificato.

### Assegnazione utenti

Dal comando **Assegna Utenti** gestisci chi è assegnato a un progetto o a una sua attività. L'accesso a questa finestra è governato dal permesso **Assegnazioni Progetto**: l'azione **View** consente di aprire le assegnazioni di qualsiasi progetto o attività indipendentemente dalla propria appartenenza, mentre **Update** consente di modificarle. Manager e Top Manager dispongono di entrambe per impostazione predefinita, quindi possono gestire le assegnazioni anche quando non sono membri del progetto o dell'attività.

## Competence Center

I Competence Center collegano risorse, costi e assegnazioni. Sono utili per analisi HR e controllo economico dei progetti.

Solo utenti con permessi adeguati dovrebbero modificare costi, assegnazioni o dati storici.
