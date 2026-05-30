---
title: Amministrazione
description: Gestione di utenti, ruoli, autenticazione, impostazioni, email e log.
sidebar:
  order: 6
---

## Utenti e ruoli

Gli amministratori gestiscono utenti, ruoli e permessi. Ogni ruolo dovrebbe concedere solo le funzioni necessarie al lavoro quotidiano.

Le righe di permesso con ambito **All** concedono accesso trasversale a tutti i record della stessa area, ad esempio tutti i clienti, fornitori, progetti, task, consuntivi o Competence Center. L'azione **View** abilita la vista e la consultazione su tutti i record; quando selezionate, anche **Create**, **Update** e **Delete** sono permessi reali e consentono scritture su record non assegnati. I permessi senza **All** mantengono l'ambito assegnato all'utente.

Quando modifichi un ruolo, considera l'impatto su tutti gli utenti assegnati. Praetor impedisce l'eliminazione di un ruolo ancora assegnato a un utente, sia come ruolo principale sia come ruolo aggiuntivo. Dopo modifiche importanti, verifica l'accesso con un profilo di prova o con un utente rappresentativo.

## Autenticazione

Praetor supporta autenticazione locale e integrazioni aziendali come LDAP o SSO quando configurate. Mantieni aggiornati endpoint, mapping dei ruoli e impostazioni di sicurezza.

Quando salvi la configurazione LDAP, Praetor conferma il salvataggio solo dopo la persistenza riuscita. Se il server rifiuta le impostazioni, la schermata mostra il messaggio di errore e mantiene visibili i valori da correggere.

Per mTLS LDAP configurato tramite variabili ambiente, `LDAP_TLS_CERT_FILE` e `LDAP_TLS_KEY_FILE` devono essere impostate insieme e puntare a file leggibili. Se manca uno dei due valori o un percorso non esiste, Praetor segnala l'errore prima di creare il client LDAP invece di proseguire con una configurazione TLS parziale.

Quando modifichi una configurazione LDAP già salvata, la password di bind è nascosta dietro un badge **Segreto memorizzato — Sostituisci**. Aggiorna il Bind DN o qualunque altro campo e salva senza toccare la password — il segreto memorizzato viene preservato. Clicca **Sostituisci** solo quando vuoi inserire una nuova password; usa **Mantieni valore memorizzato** per annullare prima di salvare, oppure lascia il campo vuoto dopo Sostituisci per rimuovere le credenziali di bind. Lo stesso schema Memorizzato / Sostituisci protegge la password SMTP (Impostazioni Email) e i segreti SSO (client secret OIDC, certificato IdP SAML, chiave privata di firma e XML del metadata), così digitare per errore in questi campi non sovrascrive più il valore memorizzato.

Prima di abilitare un provider SAML, configura una sorgente metadata valida (URL o XML) oppure la configurazione manuale con **Entry Point** e **Certificato IdP**. Praetor rifiuta il salvataggio di provider SAML abilitati senza questi dati minimi. È inoltre richiesto il campo **IdP Issuer** a meno che l'entity ID dell'IdP non sia ricavabile da un **Metadata XML** inline. Durante il login, Praetor accetta solo assertion SAML firmate il cui elemento `<Issuer>` corrisponde a quel valore.

Se il salvataggio di un provider OIDC o SAML non riesce, la scheda del provider mostra un messaggio di errore con il dettaglio restituito dal server. Correggi i campi indicati o riprova quando il servizio torna disponibile prima di considerare la configurazione aggiornata.

Durante il login OIDC, Praetor accetta solo gli endpoint remoti usati per autorizzazione, token, JWKS e UserInfo che usano HTTPS e non risolvono verso reti private, loopback o link-local. L'`end_session_endpoint` viene validato nello stesso modo quando abiliti il logout OIDC. Se il provider non espone `userinfo_endpoint`, l'accesso continua usando i claim dell'ID token: in questo caso configura username, nome, email e gruppi su claim presenti nell'ID token.

Per i provider OIDC puoi abilitare **Chiama l'endpoint end-session dell'IdP al logout**: quando attivo, il logout di Praetor reindirizza il browser dell'utente all'`end_session_endpoint` annunciato dal discovery document dell'IdP (OIDC RP-Initiated Logout). Senza questa opzione il logout invalida solo la sessione Praetor — il cookie dell'IdP resta attivo e una nuova autenticazione SSO entrerebbe silenziosamente con l'utente precedente, problema rilevante sulle postazioni condivise. Per usarla, l'IdP deve esporre `end_session_endpoint` nel discovery e la `FRONTEND_URL` di Praetor deve essere registrata come URI di redirect post-logout autorizzato. Lascia disattivata l'opzione per gli IdP la cui UI di end-session è scomoda (pagine di conferma forzate, redirect post-logout poco affidabili).

Nella lista utenti puoi usare il menu azioni e scegliere **Cambia metodo di autenticazione** per vincolare un utente applicativo a credenziali locali, LDAP, OIDC o SAML. Per OIDC e SAML seleziona anche il provider specifico: l'utente potrà accedere solo tramite quel provider. Dipendenti interni o esterni non sono account applicativi e non possono essere vincolati a LDAP/SSO.

Quando vincoli un utente a LDAP, Praetor lo consulta nella directory e applica i ruoli configurati nel mapping dei gruppi LDAP **solo se almeno uno dei gruppi LDAP dell'utente corrisponde a un mapping configurato**. Se nessun gruppo corrisponde (oppure la directory non è raggiungibile o l'utente non vi è presente al momento del bind), il ruolo esistente viene preservato — Praetor non declassa mai silenziosamente l'utente al ruolo predefinito `Utente` al momento del bind. È un'operazione di bootstrap una tantum: gli accessi successivi e le sincronizzazioni periodiche **non** ri-applicano la mappatura (vedi la regola "solo al primo provisioning" più sotto).

La sincronizzazione LDAP aggiorna solo utenti applicativi già impostati su LDAP. Un utente locale con lo stesso username resta locale finché un amministratore non cambia esplicitamente il suo metodo di autenticazione.

La sincronizzazione LDAP manuale richiede una configurazione LDAP abilitata. Se LDAP è disabilitato o non configurato, la richiesta viene respinta e non viene registrata come sincronizzazione riuscita; se la directory non è raggiungibile, Praetor segnala l'errore invece di riportare un successo.

Il tester di connessione LDAP usa la configurazione salvata e può essere eseguito anche quando LDAP è ancora disabilitato. Salva prima le modifiche alla configurazione, verifica credenziali e gruppi con il tester, poi abilita LDAP quando la validazione è riuscita. I tentativi ripetuti del tester sono limitati con la stessa soglia del login per proteggere la directory da cicli di retry o spray di password. Il tester riporta il ruolo che il **login reale** assegnerebbe: un utente esistente già vincolato a LDAP viene mostrato sempre come `Ruolo Attuale` preservato (perché il login reale è bootstrap-only e non sovrascrive mai il ruolo memorizzato), mentre uno username senza riga corrispondente in Praetor ricade sul ruolo `Utente` predefinito quando nessun gruppo corrisponde a una mappatura configurata.

Il **Filtro utente** LDAP deve identificare una sola voce directory per lo username digitato. Se la ricerca restituisce più voci, Praetor rifiuta l'autenticazione e il test di connessione segnala l'errore invece di scegliere un DN arbitrario.

La ricerca dei gruppi LDAP usa la **Base ricerca gruppi** e il **Filtro membri gruppo** configurati. In Active Directory, quando vuoi cercare i gruppi sotto una OU di gruppi usando il DN dell'utente, usa in genere `(member={0})`: `{0}` viene sostituito con il DN dell'utente e la ricerca viene eseguita nella base gruppi configurata.

**Il mapping dei ruoli si applica solo al primo provisioning.** Il mapping LDAP gruppo-ruolo determina i ruoli che l'utente riceve la **prima** volta che viene creato in Praetor (provisioning automatico al primo accesso, provisioning massivo durante la sincronizzazione, o quando un amministratore vincola a LDAP un utente esistente). Da quel momento in poi, i ruoli sono di proprietà di Praetor: le assegnazioni fatte nella pagina Utenti sono l'unica fonte di verità, e gli accessi LDAP successivi o le sincronizzazioni pianificate non sovrascriveranno mai più quelle assegnazioni — anche se l'appartenenza dell'utente ai gruppi LDAP cambia. La stessa regola vale per i provider OIDC e SAML. Per ri-applicare il mapping LDAP a un utente specifico, scollegalo e ricollegalo dal menu azioni dell'utente — Praetor aggiornerà i suoi ruoli dalla directory al momento del nuovo bind, preservando eventuali ruoli assegnati dall'amministratore se nessun gruppo LDAP corrisponde. Per gli utenti OIDC/SAML il mapping dei ruoli viene consultato solo al primissimo accesso SSO che crea l'account Praetor; per gli accessi successivi (incluso dopo un cambio di metodo di autenticazione amministrativo) aggiorna i ruoli manualmente dalla pagina Utenti.

Quando LDAP è abilitato, gli utenti applicativi presenti nella directory ma non ancora in Praetor possono essere creati automaticamente al primo accesso riuscito. Il nuovo account viene salvato con lo username canonico LDAP (`uid` o `sAMAccountName`, in minuscolo) — non con il valore digitato nella schermata di login — così che le successive sincronizzazioni LDAP aggiornino sempre la stessa riga anche quando l'utente accede con un alias, ad esempio la propria email, e un cambio di maiuscole/minuscole nella directory tra una sincronizzazione e l'altra (ad esempio `jdoe` → `JDoe`) non crei mai una riga duplicata. Praetor legge questi attributi LDAP senza distinzione tra maiuscole e minuscole, quindi directory o proxy che restituiscono `samaccountname` o `displayname` continuano a risolvere correttamente username e nome visualizzato. L'utente provisionato viene vincolato all'autenticazione LDAP e riceve i ruoli derivati dai gruppi LDAP a cui appartiene; i nuovi account senza mapping corrispondente ricevono il ruolo predefinito `Utente`.

Il confronto degli username è case-insensitive sia per l'accesso locale sia per LDAP e SSO: digitare `JDoe`, `jdoe` o `JDOE` risolve sempre allo stesso account, quindi gli utenti non devono ricordare le maiuscole/minuscole esatte del proprio nome utente.

La sezione **Provisioning Utenti** delle impostazioni LDAP espone due interruttori indipendenti:

- **Provisioning al primo accesso** (attivo di default) — se attivo, qualsiasi utente LDAP che si autentica con successo ottiene la creazione di un account locale al primo accesso. Disattivalo per limitare gli accessi agli utenti che hanno già un account locale (creato manualmente o tramite la sincronizzazione massiva descritta sotto). Gli utenti già vincolati a LDAP continuano comunque ad accedere; solo la creazione automatica di utenti directory non ancora presenti viene bloccata.
- **Provisioning massivo durante la sincronizzazione** (disattivo di default) — se attivo, la sincronizzazione periodica crea anche un account locale per ogni voce LDAP che corrisponde al filtro utente configurato, applicando il mapping dei ruoli LDAP al momento della creazione. Se disattivo, la sincronizzazione aggiorna soltanto i nomi visualizzati degli utenti già esistenti. In entrambi i casi, il mapping dei ruoli non viene mai ri-applicato a utenti che esistono già in Praetor.

I due interruttori sono indipendenti: disattivando entrambi (e creando manualmente gli utenti) ottieni la configurazione che limita gli accessi LDAP a un insieme di utenti curato manualmente.

Se un utente non riesce ad accedere, controlla credenziali, stato dell'utente, ruolo assegnato e log di autenticazione.

## Impostazioni generali ed email

Le impostazioni generali controllano funzioni trasversali come AI reporting e preferenze applicative. Le impostazioni email servono per invii e notifiche.

Dalla scheda **Preferenze di Tracciamento** gli amministratori configurano anche i metadati usati dal prospetto RIL: nome azienda, orario di entrata predefinito e minuti di pausa pranzo. Il valore della pausa pranzo viene usato anche per ricalcolare Ore e PICAP dai valori modificabili di entrata e uscita; nessuna di queste impostazioni modifica le registrazioni esistenti.

La visibilità della pagina RIL si gestisce dai ruoli con il permesso **timesheets.ril.view**. I ruoli che avevano già accesso al Time Tracker ricevono automaticamente il permesso durante la migrazione.

Dopo aver modificato SMTP, mittente o sicurezza, esegui sempre un test di invio prima di considerare conclusa la configurazione.

## Log

I log aiutano a ricostruire accessi e operazioni rilevanti. Usali per audit, troubleshooting e verifiche dopo modifiche amministrative.

Filtra per periodo per ridurre il rumore e concentrarti sull'evento da analizzare.
