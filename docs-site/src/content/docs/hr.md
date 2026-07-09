---
title: HR e dipendenti
description: Gestione dei profili HR di dipendenti interni, esterni e utenti applicativi.
sidebar:
  order: 4
---

## Anagrafica dipendenti

Il modulo **HR** gestisce i dati operativi dei dipendenti separandoli dai controlli di accesso. Le schermate **Dipendenti Interni** e **Dipendenti Esterni** mostrano i dettagli utili alla gestione quotidiana: codice dipendente, telefono aziendale, email, ruolo, dipartimento derivato dai Competence Center, responsabile, tipo di contratto, stato HR, sede di lavoro, date di assunzione o cessazione, anagrafica personale con nome completo, telefono personale, indirizzo completo e note.

Gli utenti applicativi con accesso a Praetor compaiono tra i dipendenti interni quando hai i permessi HR necessari. In questo modo HR può mantenere il profilo operativo anche per chi usa l'applicazione, mentre **Amministrazione > Utenti** resta dedicata a ruoli, permessi, metodo di autenticazione, stato account e altri controlli di sicurezza.

## Profili interni ed esterni

Usa **Dipendenti Interni** per personale aziendale e utenti applicativi. Usa **Dipendenti Esterni** per collaboratori, consulenti, fornitori o altre risorse esterne che devono essere tracciate nei processi HR e di progetto ma non hanno un account applicativo.

Le tabelle HR espongono i dati principali per lavorare rapidamente: codice dipendente, email e telefono aziendale in colonne separate, ruolo, dipartimento, responsabile e stato HR. Apri una riga per aggiornare il profilo quando hai il permesso di modifica corrispondente.

Il campo **Dipartimento** è in sola lettura nell'anagrafica HR: viene calcolato dai Competence Center attivi a cui la persona appartiene, ordinati alfabeticamente e separati da virgola. Le membership si modificano dalla gestione **Competence Center**, non dal form HR. Il campo **Responsabile** è opzionale e può essere impostato solo scegliendo un utente applicativo attivo diverso dalla persona stessa.

I valori di stato HR descrivono il ciclo di vita della risorsa (**Attivo**, **Onboarding**, **In permesso/assenza**, **Cessato**) e non disabilitano l'accesso all'applicazione. Per bloccare un account applicativo continua a usare lo stato account in **Amministrazione > Utenti**.

Negli ambienti demo, il seed dati include profili HR realistici per utenti applicativi, dipendenti interni senza account e collaboratori esterni, così le schermate HR mostrano subito esempi completi di contratto, sede, stato e contatti.

## Nome, email e provider aziendali

Per utenti locali, HR può aggiornare nome ed email direttamente dall'**Anagrafica Aziendale** del profilo dipendente. L'email viene salvata tramite lo stesso percorso usato dalle impostazioni personali, quindi resta coerente con le altre funzioni dell'applicazione.

Per utenti gestiti da LDAP, OIDC o SAML, nome ed email sono controllati dal provider aziendale. Praetor li mostra in sola lettura nelle schermate HR e rifiuta modifiche manuali inviate al server. A ogni login o sincronizzazione, valori non vuoti provenienti dal provider aggiornano nome, iniziali avatar ed email; valori mancanti non cancellano i dati locali esistenti.

## Permessi

La visibilità dei dettagli HR dipende dal tipo di dipendente:

- **HR Interni - View/Update** consente di leggere o modificare i dettagli HR di dipendenti interni e utenti applicativi trattati come interni. La creazione e l'eliminazione dei profili interni passano invece dai permessi **Amministrazione Utenti - Create/Delete**, anche quando l'azione parte dalla schermata HR.
- **HR Esterni - View/Update** consente di leggere o modificare i dettagli HR dei dipendenti esterni.

Il ruolo **Admin** non include più accesso HR predefinito: la creazione, la modifica dello stato account e la gestione dei ruoli restano in **Amministrazione > Utenti**, mentre l'accesso alle anagrafiche HR va assegnato tramite i permessi HR necessari.

Senza i permessi HR corretti, i campi HR non vengono restituiti dalle API utenti e non sono disponibili nelle schermate. I controlli amministrativi dell'account restano governati dai permessi di amministrazione utenti.

## Competence Center

I Competence Center collegano persone, costi e assegnazioni. Mantieni aggiornate le membership dei Competence Center perché alimentano il campo **Dipartimento** mostrato nelle anagrafiche HR, oltre alle analisi su costi, disponibilità e composizione dei team sui progetti.

Ogni scheda Competence Center mostra le iniziali dei membri assegnati: passa il mouse su un'iniziale per vederne il nome completo. Quando i membri superano lo spazio disponibile, un badge `+N` riassume i restanti e, al passaggio del mouse, ne elenca l'intera composizione senza dover aprire la scheda.
