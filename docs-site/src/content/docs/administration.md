---
title: Amministrazione
description: Gestione di utenti, ruoli, autenticazione, impostazioni, email e log.
sidebar:
  order: 6
---

## Utenti e ruoli

Gli amministratori gestiscono utenti, ruoli e permessi. Ogni ruolo dovrebbe concedere solo le funzioni necessarie al lavoro quotidiano.

Le righe di permesso con ambito **All** concedono accesso trasversale a tutti i record della stessa area, ad esempio tutti i clienti, fornitori, progetti, task, consuntivi o work unit. L'azione **View** abilita la vista e la consultazione su tutti i record; quando selezionate, anche **Create**, **Update** e **Delete** sono permessi reali e consentono scritture su record non assegnati. I permessi senza **All** mantengono l'ambito assegnato all'utente.

Quando modifichi un ruolo, considera l'impatto su tutti gli utenti assegnati. Praetor impedisce l'eliminazione di un ruolo ancora assegnato a un utente, sia come ruolo principale sia come ruolo aggiuntivo. Dopo modifiche importanti, verifica l'accesso con un profilo di prova o con un utente rappresentativo.

## Autenticazione

Praetor supporta autenticazione locale e integrazioni aziendali come LDAP o SSO quando configurate. Mantieni aggiornati endpoint, mapping dei ruoli e impostazioni di sicurezza.

Quando salvi la configurazione LDAP, Praetor conferma il salvataggio solo dopo la persistenza riuscita. Se il server rifiuta le impostazioni, la schermata mostra il messaggio di errore e mantiene visibili i valori da correggere.

Quando modifichi una configurazione LDAP già salvata, la password di bind resta mascherata. Puoi aggiornare il Bind DN senza reinserire la password se il segreto esistente resta valido; reinserisci la password solo quando vuoi cambiarla o cancellala insieme al Bind DN per rimuovere le credenziali di bind.

Prima di abilitare un provider SAML, configura una sorgente metadata valida (URL o XML) oppure la configurazione manuale con **Entry Point** e **Certificato IdP**. Praetor rifiuta il salvataggio di provider SAML abilitati senza questi dati minimi. È inoltre richiesto il campo **IdP Issuer** a meno che l'entity ID dell'IdP non sia ricavabile da un **Metadata XML** inline — altrimenti l'elemento `<Issuer>` delle risposte SAML in arrivo non può essere verificato.

Quando modifichi un provider esistente, i campi sensibili (**Client Secret**, **Metadata XML**, **Certificato IdP**, **Chiave privata firma**) sono mostrati come anteprima bloccata **Segreto memorizzato — valore nascosto** invece di essere precompilati con il valore. Usa il controllo **Sostituisci** per digitare un nuovo valore, oppure **Mantieni valore salvato** per annullare. Salvare senza entrare in modalità Sostituisci lascia il valore memorizzato intatto.

Se il salvataggio di un provider OIDC o SAML non riesce, la scheda del provider mostra un messaggio di errore con il dettaglio restituito dal server. Correggi i campi indicati o riprova quando il servizio torna disponibile prima di considerare la configurazione aggiornata.

Nella lista utenti puoi usare il menu azioni e scegliere **Cambia metodo di autenticazione** per vincolare un utente applicativo a credenziali locali, LDAP, OIDC o SAML. Per OIDC e SAML seleziona anche il provider specifico: l'utente potrà accedere solo tramite quel provider. Dipendenti interni o esterni non sono account applicativi e non possono essere vincolati a LDAP/SSO.

Quando vincoli un utente a LDAP, Praetor consulta la directory e applica subito i ruoli configurati nel mapping dei gruppi LDAP, sovrascrivendo il ruolo locale. Se la directory non è raggiungibile o l'utente non vi è presente, il ruolo esistente viene mantenuto e il prossimo accesso o sincronizzazione riapplicherà il mapping.

La sincronizzazione LDAP aggiorna solo utenti applicativi già impostati su LDAP. Un utente locale con lo stesso username resta locale finché un amministratore non cambia esplicitamente il suo metodo di autenticazione.

La sincronizzazione LDAP manuale richiede una configurazione LDAP abilitata. Se LDAP è disabilitato o non configurato, la richiesta viene respinta e non viene registrata come sincronizzazione riuscita; se la directory non è raggiungibile, Praetor segnala l'errore invece di riportare un successo.

Il tester di connessione LDAP usa la configurazione salvata e può essere eseguito anche quando LDAP è ancora disabilitato. Salva prima le modifiche alla configurazione, verifica credenziali e gruppi con il tester, poi abilita LDAP quando la validazione è riuscita.

La ricerca dei gruppi LDAP usa la **Base ricerca gruppi** e il **Filtro membri gruppo** configurati. In Active Directory, quando vuoi cercare i gruppi sotto una OU di gruppi usando il DN dell'utente, usa in genere `(member={0})`: `{0}` viene sostituito con il DN dell'utente e la ricerca viene eseguita nella base gruppi configurata.

A ogni accesso LDAP e a ogni sincronizzazione periodica, Praetor ricalcola il ruolo dell'utente partendo dal mapping dei gruppi LDAP. Se almeno uno dei gruppi LDAP dell'utente corrisponde a un mapping configurato, i ruoli mappati prevalgono e sostituiscono l'assegnazione corrente. **Se nessun gruppo LDAP corrisponde ad alcun mapping configurato, il ruolo esistente viene preservato** — l'assegnazione manuale dell'amministratore non viene silenziosamente declassata al ruolo predefinito `Utente`. Per forzare un cambio di ruolo a un utente senza mapping corrispondente, aggiorna l'appartenenza al gruppo LDAP oppure la configurazione del mapping dei ruoli.

Quando LDAP è abilitato, gli utenti applicativi presenti nella directory ma non ancora in Praetor vengono creati automaticamente al primo accesso riuscito. Il nuovo account viene salvato con lo username canonico LDAP (`uid` o `sAMAccountName`) — non con il valore digitato nella schermata di login — così che le successive sincronizzazioni LDAP aggiornino sempre la stessa riga anche quando l'utente accede con un alias, ad esempio la propria email. L'utente provisionato viene vincolato all'autenticazione LDAP e riceve i ruoli derivati dai gruppi LDAP a cui appartiene; i nuovi account senza mapping corrispondente ricevono il ruolo predefinito `Utente`.

Il toggle **Modalità di Provisioning Utenti** nelle impostazioni LDAP controlla cosa fa la sincronizzazione periodica per gli utenti non ancora presenti localmente:

- **Provisioning al Login** (predefinito) — la sincronizzazione periodica aggiorna solo nomi visualizzati e mapping dei ruoli degli utenti applicativi esistenti. I nuovi utenti vengono creati solo al primo accesso.
- **Provisioning automatico di tutti gli utenti corrispondenti** — la sincronizzazione periodica crea anche un account locale per ogni voce LDAP che corrisponde al filtro configurato. Utile quando vuoi che tutti gli utenti della directory siano già presenti in Praetor prima del loro primo accesso.

In entrambe le modalità, il provisioning al login resta attivo, quindi un primo accesso funziona sempre.

Se un utente non riesce ad accedere, controlla credenziali, stato dell'utente, ruolo assegnato e log di autenticazione.

## Impostazioni generali ed email

Le impostazioni generali controllano funzioni trasversali come AI reporting e preferenze applicative. Le impostazioni email servono per invii e notifiche.

Dopo aver modificato SMTP, mittente o sicurezza, esegui sempre un test di invio prima di considerare conclusa la configurazione.

## Log

I log aiutano a ricostruire accessi e operazioni rilevanti. Usali per audit, troubleshooting e verifiche dopo modifiche amministrative.

Filtra per periodo e utente per ridurre il rumore e concentrarti sull'evento da analizzare.
