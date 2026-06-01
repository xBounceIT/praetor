---
title: CRM, catalogo e progetti
description: Gestione di clienti, fornitori, prodotti, progetti, attività e Competence Center.
sidebar:
  order: 3
---

## Clienti e fornitori

Le anagrafiche CRM raccolgono i dati usati nei flussi commerciali e contabili. Mantieni nomi, contatti, indirizzi e dati fiscali aggiornati prima di creare offerte, ordini o fatture.

Evita duplicati: prima di creare una nuova anagrafica, cerca se il cliente o fornitore esiste già.

### Eliminazione protetta

Non è possibile eliminare un cliente o un fornitore se sono presenti documenti commerciali collegati (preventivi, offerte, ordini, fatture). La richiesta di eliminazione viene respinta e il documento non viene perso: prima rimuovi o annulla i documenti collegati, poi elimina l'anagrafica. Questa protezione esiste perché un documento contabile emesso deve rimanere tracciabile, anche se l'anagrafica della controparte non serve più.

## Catalogo interno

Il catalogo contiene prodotti, categorie, unità di misura e logiche di prezzo. Le informazioni del catalogo alimentano preventivi, offerte e documenti contabili.

Aggiorna il listino quando cambiano costi, margini o condizioni di vendita, così i nuovi documenti partono da dati affidabili.

## Progetti e attività

I progetti collegano clienti, attività e registrazioni di tempo. Crea attività chiare e riutilizzabili, con nomi che descrivono il lavoro effettivo.

Per ogni progetto e attività puoi indicare il tipo di consuntivazione: canone o a misura. Le attività a misura sono sempre mensili; per i canoni puoi scegliere frequenza mensile o una tantum. Se le attività usano un tipo diverso da quello del progetto, il progetto viene mostrato come misto.

Usa la stima di impegno mensile per pianificare il carico ricorrente e l'impegno totale per monitorare l'avanzamento rispetto alle ore complessive previste.

L'azione **Aggiungi Progetto** apre una finestra dedicata alla sola creazione: cliente, nome, date, offerta, consuntivazione, ordine facoltativo, ricavo facoltativo e una tabella di attività iniziali. Al salvataggio sei portato direttamente alla pagina di dettaglio del nuovo progetto.

Cliccando una riga nell'elenco progetti si apre la **pagina di dettaglio del progetto**, che sostituisce la vecchia finestra di modifica ed è organizzata in due sezioni:

- La sezione superiore dispone i campi del progetto orizzontalmente (cliente, nome, descrizione, date, offerta, consuntivazione, ricavo, switch di disabilitazione) accanto alla tabella attività modificabile inline.
- Sotto, la **dashboard del progetto** mostra KPI (ore totali, costo totale, dimensione team, % budget usato) e quattro grafici: ore per utente (suddivise per attività), ore per attività (ore registrate rispetto all'effort disponibile), costo vs ricavo e attività mensile. I grafici si popolano man mano che vengono registrate ore; se non ci sono ancora voci, ogni grafico mostra uno stato vuoto. La pagina mostra anche un avviso quando (a) il progetto ha più di 5.000 voci (vengono caricate solo le più recenti), (b) il tuo ruolo limita gli utenti di cui puoi vedere le voci (i totali riflettono solo la tua visibilità), oppure (c) non hai i permessi per vedere le voci timesheet.

Accanto al titolo della dashboard del progetto trovi due pulsanti, **Modifica** e **Viste**. **Modifica** trasforma l'intera dashboard — ogni scheda KPI, la cronologia del progetto e tutti e quattro i grafici — in un layout libero che puoi riorganizzare. Trascina una scheda dalla sua intestazione per spostarla ovunque sulla griglia a 12 colonne, trascina il bordo destro, il bordo inferiore o l'angolo per ridimensionarla, e usa il pulsante a forma di occhio su una scheda per nasconderla (o ripristinarne una nascosta). Puoi anche spostare la scheda attiva con i tasti freccia e ridimensionarla tenendo premuto **Maiusc** con i tasti freccia. Le schede risalgono per riempire gli spazi lasciati liberi. Quando hai finito, mantieni la disposizione per questo progetto o salvala come vista riutilizzabile. Modificare la dashboard di un progetto crea un **layout specifico del progetto** che riguarda solo quel progetto. Il menu **Viste** permette di applicare una vista salvata, scegliere **Usa predefinito globale** (rimuove il layout personalizzato del progetto così torna a seguire il predefinito condiviso) oppure **Imposta come predefinito globale** (rende la disposizione attuale la base per ogni progetto che non ha un proprio layout).

Le **viste salvate con nome** sono memorizzate sul server e appartengono a chi le crea: restano disponibili da qualsiasi dispositivo e possono essere condivise. Dal menu **Viste** il proprietario può **condividere** una vista con utenti specifici assegnando a ciascuno il permesso **lettura** (può solo applicarla) o **scrittura** (può modificarla, rinominarla e risalvarla, e la modifica diventa effettiva per tutti coloro con cui è condivisa). Solo il proprietario può **eliminare** la vista o gestirne la condivisione; le viste condivise mostrano le iniziali dell'autore in un piccolo avatar (passa il mouse per vederne il nome completo) accanto al tipo di accesso. Chi ha accesso in sola lettura può comunque **duplicare** la vista in una copia propria e modificabile. Le modifiche di chi ha accesso in scrittura si propagano agli altri al successivo caricamento o applicazione della vista, non in tempo reale. Il **layout specifico del progetto** e il **predefinito globale personale** restano invece memorizzati localmente nel browser e privati per ciascun utente. Sugli schermi stretti le schede si impilano in un'unica colonna e la modifica con trascinamento non è disponibile.

Quando crei o modifichi un progetto puoi compilare anche:

- **Data inizio progetto** e **Data fine progetto** — definiscono la finestra temporale prevista. Entrambe sono obbligatorie (alla creazione e a ogni salvataggio successivo dalla pagina di dettaglio) così che i progetti abbiano sempre una finestra di pianificazione; la data di fine non può precedere la data di inizio.
- **Riferimento offerta** — collega il progetto a un'offerta accettata. Il campo è obbligatorio.
- **Ricavo progetto** — segue questa precedenza: (1) se le attività hanno un valore di ricavo, il ricavo del progetto è la somma di quei valori in sola lettura; (2) altrimenti, se è collegato un ordine, il ricavo è ereditato in sola lettura dal totale dell'ordine; (3) altrimenti puoi inserirlo manualmente.

Quando un progetto termina, verifica che le attività siano coerenti e che non rimangano registrazioni pendenti.

### Regole progetto

La sezione **Regole del progetto** nella pagina di dettaglio permette di creare controlli automatici sul progetto. Una regola confronta uno o più campi del progetto (ricavo, ore consuntive, giorni alla scadenza, consuntivazione o stato; i campi di costo richiedono il permesso **Report costi**) con soglie, valori o altri campi compatibili e può combinare le condizioni con **AND** oppure **OR**. Quando la regola diventa vera, invia una notifica agli utenti assegnati selezionati o agli utenti che hanno uno dei ruoli scelti. La sezione è visibile e modificabile tramite il permesso **Regole Progetto** (`projects.rules`), assegnato per impostazione predefinita a Manager e Top Manager. Le notifiche sono inviate solo sul passaggio da condizione non verificata a verificata, quindi non vengono duplicate mentre la regola resta vera. Riabilitare una regola o modificarne la condizione la prepara a generare una nuova notifica al prossimo controllo pianificato.

### Assegnazione utenti

Dal comando **Assegna Utenti** gestisci chi è assegnato a un progetto o a una sua attività. L'accesso a questa finestra è governato dal permesso **Assegnazioni Progetto**: l'azione **View** consente di aprire le assegnazioni di qualsiasi progetto o attività indipendentemente dalla propria appartenenza, mentre **Update** consente di modificarle. Manager e Top Manager dispongono di entrambe per impostazione predefinita, quindi possono gestire le assegnazioni anche quando non sono membri del progetto o dell'attività.

## Competence Center

I Competence Center collegano risorse, costi e assegnazioni. Sono utili per analisi HR e controllo economico dei progetti.

Solo utenti con permessi adeguati dovrebbero modificare costi, assegnazioni o dati storici.
