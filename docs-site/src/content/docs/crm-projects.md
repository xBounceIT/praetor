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

- La sezione superiore dispone i campi del progetto orizzontalmente (cliente, nome, descrizione, date, offerta, consuntivazione, ricavo, colore, switch di disabilitazione) accanto alla tabella attività modificabile inline.
- Sotto, una sezione analitica mostra KPI (ore totali, costo totale, dimensione team, % budget usato) e quattro grafici: ore per utente, ore per attività, ore nel tempo e ore per luogo. I grafici si popolano man mano che vengono registrate ore; se non ci sono ancora voci, ogni grafico mostra uno stato vuoto. La pagina mostra anche un avviso quando (a) il progetto ha più di 5.000 voci (vengono caricate solo le più recenti), (b) il tuo ruolo limita gli utenti di cui puoi vedere le voci (i totali riflettono solo la tua visibilità), oppure (c) non hai i permessi per vedere le voci timesheet.

Quando crei o modifichi un progetto puoi compilare anche:

- **Data inizio progetto** e **Data fine progetto** — definiscono la finestra temporale prevista. Entrambe sono obbligatorie (alla creazione e a ogni salvataggio successivo dalla pagina di dettaglio) così che i progetti abbiano sempre una finestra di pianificazione; la data di fine non può precedere la data di inizio.
- **Riferimento offerta** — collega il progetto a un'offerta accettata. Il campo è obbligatorio.
- **Ricavo progetto** — segue questa precedenza: (1) se le attività hanno un valore di ricavo, il ricavo del progetto è la somma di quei valori in sola lettura; (2) altrimenti, se è collegato un ordine, il ricavo è ereditato in sola lettura dal totale dell'ordine; (3) altrimenti puoi inserirlo manualmente.

Praetor assegna automaticamente un colore univoco quando crei un progetto. Puoi modificarlo in seguito dalla pagina di dettaglio; il sistema impedisce colori duplicati e genera nuovi colori quando la palette iniziale è esaurita.

Quando un progetto termina, verifica che le attività siano coerenti e che non rimangano registrazioni pendenti.

## Competence Center

I Competence Center collegano risorse, costi e assegnazioni. Sono utili per analisi HR e controllo economico dei progetti.

Solo utenti con permessi adeguati dovrebbero modificare costi, assegnazioni o dati storici.
