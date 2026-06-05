---
title: Amministrazione
description: Gestione di utenti, ruoli, autenticazione, impostazioni, email e log.
sidebar:
  order: 7
---

## Utenti e ruoli

Gli amministratori gestiscono utenti, ruoli e permessi. Ogni ruolo dovrebbe concedere solo le funzioni necessarie al lavoro quotidiano.

La pagina **Utenti** resta focalizzata sull'accesso applicativo: username, ruolo, permessi, metodo di autenticazione e stato account. I dati HR come telefono, email operativa, mansione, reparto, contratto, sede e contatti di emergenza si gestiscono dal modulo **HR**, non da Amministrazione.

Le righe di permesso con ambito **All** concedono accesso trasversale a tutti i record della stessa area, ad esempio tutti i clienti, fornitori, progetti, task, consuntivi o Competence Center. L'azione **View** abilita la vista e la consultazione su tutti i record; quando selezionate, anche **Create**, **Update** e **Delete** sono permessi reali e consentono scritture su record non assegnati. I permessi senza **All** mantengono l'ambito assegnato all'utente.

Il permesso `timesheets.expired_projects.create` abilita la registrazione di ore su progetti scaduti. I ruoli di sistema **Manager** e **Top Manager** lo ricevono per impostazione predefinita; per gli altri ruoli assegnalo solo quando è necessario consentire consuntivazioni tardive o rettifiche operative su progetti già conclusi.

Il ruolo di sistema **Top Manager** include tutti i permessi Competence Center, compreso l'ambito **All** per visualizzare, creare, aggiornare ed eliminare. Gli altri ruoli non possono ricevere permessi Competence Center.

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

La sezione **Mappatura attributi** consente di scegliere quali attributi della directory popolano l'identità di ciascun utente: l'**Attributo Nome** (predefinito `givenName`), l'**Attributo Cognome** (predefinito `sn`) e l'**Attributo Email** (predefinito `mail`). Lascia vuoto un campo per usare il valore predefinito. Sia all'accesso sia durante la sincronizzazione periodica, Praetor salva nome e cognome risolti nel profilo dell'utente e compone il nome visualizzato come `Nome Cognome`, ricadendo su `cn`/`displayName` della directory quando questi attributi sono vuoti. Il nome e l'email risolti vengono mostrati nel tester di connessione così da poter verificare la mappatura prima di abilitare LDAP. Per gli utenti gestiti da LDAP questi campi identità sono di sola lettura nel profilo dipendente, poiché la directory è la fonte di verità.

**Il mapping dei ruoli si applica solo al primo provisioning.** Il mapping LDAP gruppo-ruolo determina i ruoli che l'utente riceve la **prima** volta che viene creato in Praetor (provisioning automatico al primo accesso, provisioning massivo durante la sincronizzazione, o quando un amministratore vincola a LDAP un utente esistente). Da quel momento in poi, i ruoli sono di proprietà di Praetor: le assegnazioni fatte nella pagina Utenti sono l'unica fonte di verità, e gli accessi LDAP successivi o le sincronizzazioni pianificate non sovrascriveranno mai più quelle assegnazioni — anche se l'appartenenza dell'utente ai gruppi LDAP cambia. La stessa regola vale per i provider OIDC e SAML. Per ri-applicare il mapping LDAP a un utente specifico, scollegalo e ricollegalo dal menu azioni dell'utente — Praetor aggiornerà i suoi ruoli dalla directory al momento del nuovo bind, preservando eventuali ruoli assegnati dall'amministratore se nessun gruppo LDAP corrisponde. Per gli utenti OIDC/SAML il mapping dei ruoli viene consultato solo al primissimo accesso SSO che crea l'account Praetor; per gli accessi successivi (incluso dopo un cambio di metodo di autenticazione amministrativo) aggiorna i ruoli manualmente dalla pagina Utenti.

Quando LDAP è abilitato, gli utenti applicativi presenti nella directory ma non ancora in Praetor possono essere creati automaticamente al primo accesso riuscito. Il nuovo account viene salvato con lo username canonico LDAP (`uid` o `sAMAccountName`, in minuscolo) — non con il valore digitato nella schermata di login — così che le successive sincronizzazioni LDAP aggiornino sempre la stessa riga anche quando l'utente accede con un alias, ad esempio la propria email, e un cambio di maiuscole/minuscole nella directory tra una sincronizzazione e l'altra (ad esempio `jdoe` → `JDoe`) non crei mai una riga duplicata. Praetor legge questi attributi LDAP senza distinzione tra maiuscole e minuscole, quindi directory o proxy che restituiscono `samaccountname` o `displayname` continuano a risolvere correttamente username e nome visualizzato. L'utente provisionato viene vincolato all'autenticazione LDAP e riceve i ruoli derivati dai gruppi LDAP a cui appartiene; i nuovi account senza mapping corrispondente ricevono il ruolo predefinito `Utente`.

Il confronto degli username è case-insensitive sia per l'accesso locale sia per LDAP e SSO: digitare `JDoe`, `jdoe` o `JDOE` risolve sempre allo stesso account, quindi gli utenti non devono ricordare le maiuscole/minuscole esatte del proprio nome utente.

La sezione **Provisioning Utenti** delle impostazioni LDAP espone due interruttori indipendenti:

- **Provisioning al primo accesso** (attivo di default) — se attivo, qualsiasi utente LDAP che si autentica con successo ottiene la creazione di un account locale al primo accesso. Disattivalo per limitare gli accessi agli utenti che hanno già un account locale (creato manualmente o tramite la sincronizzazione massiva descritta sotto). Gli utenti già vincolati a LDAP continuano comunque ad accedere; solo la creazione automatica di utenti directory non ancora presenti viene bloccata.
- **Provisioning massivo durante la sincronizzazione** (disattivo di default) — se attivo, la sincronizzazione periodica crea anche un account locale per ogni voce LDAP che corrisponde al filtro utente configurato, applicando il mapping dei ruoli LDAP al momento della creazione. Se disattivo, la sincronizzazione aggiorna soltanto i nomi visualizzati degli utenti già esistenti. In entrambi i casi, il mapping dei ruoli non viene mai ri-applicato a utenti che esistono già in Praetor.

I due interruttori sono indipendenti: disattivando entrambi (e creando manualmente gli utenti) ottieni la configurazione che limita gli accessi LDAP a un insieme di utenti curato manualmente.

Se un utente non riesce ad accedere, controlla credenziali, stato dell'utente, ruolo assegnato e log di autenticazione.

### Autenticazione a due fattori (2FA)

Praetor supporta l'autenticazione a due fattori basata su TOTP (app authenticator come Google Authenticator, Authy o 1Password) per gli account con credenziali locali o LDAP. Ogni utente abilita la 2FA dalle proprie **Impostazioni → Sicurezza**. Per sicurezza, l'attivazione da una sessione già autenticata richiede prima di reinserire la password dell'account (così una sessione compromessa da sola non può registrare un secondo fattore); Praetor mostra poi un codice QR (e una chiave da inserire manualmente) da scansionare con l'app authenticator, chiede un codice a sei cifre per confermare e infine mostra una serie di **codici di backup** monouso da conservare al sicuro. I codici di backup vengono mostrati una sola volta; puoi rigenerarli in qualsiasi momento — invalidando i precedenti — inserendo un codice valido. L'attivazione della 2FA disconnette anche gli altri tuoi dispositivi e revoca i token API esistenti, così nulla emesso prima dell'attivazione può continuare ad aggirare il nuovo secondo fattore (il dispositivo da cui hai effettuato l'attivazione resta connesso).

Quando la 2FA è attiva e disponibile, dopo username e password l'accesso richiede un codice dell'app authenticator (oppure uno dei codici di backup, ciascuno utilizzabile una sola volta). Per disattivarla è richiesta una nuova autenticazione: gli utenti locali inseriscono la password attuale **e** un codice valido, gli utenti LDAP un codice valido. La disattivazione revoca le altre sessioni attive dell'utente.

**Il criterio MFA.** Il criterio 2FA si trova in una scheda **MFA** dedicata nelle impostazioni di **Autenticazione** ed espone quattro controlli. Poiché queste impostazioni vengono salvate tramite le impostazioni generali, la scheda compare solo agli amministratori che hanno il permesso di modifica delle impostazioni generali.

- **Abilita 2FA** — interruttore globale di accensione/spegnimento dell'intera funzione. Quando è disattivato, la 2FA non è disponibile a livello di organizzazione: nessuno può attivarla e anche gli utenti che l'avevano già configurata non ricevono più la richiesta di un codice all'accesso e non vengono mai obbligati alla 2FA. Usalo come interruttore di emergenza per sospendere completamente l'autenticazione a due fattori.
- **Imponi 2FA** — interruttore principale di imposizione. È disponibile solo mentre **Abilita 2FA** è attivo. Quando è disattivato, la 2FA resta facoltativa (gli utenti possono attivarla volontariamente); quando è attivato, i controlli per ruolo qui sotto decidono chi è effettivamente obbligato a usarla.
- **Imponi per i ruoli** — selezione multipla dei ruoli i cui utenti devono usare la 2FA. Lasciandola vuota l'obbligo vale per **tutti** gli utenti con credenziali locali o LDAP. Selezionando uno o più ruoli, l'imposizione si restringe agli utenti che possiedono uno di quei ruoli, considerando sia il ruolo principale sia eventuali ruoli aggiuntivi assegnati, non solo quello attivo.
- **Ruoli esenti** — selezione multipla dei ruoli che non sono mai obbligati a usare la 2FA. L'esenzione **prevale sull'imposizione**: un utente che possiede un ruolo esente non viene mai obbligato, anche se possiede anche un ruolo imposto.

Un utente è obbligato a usare la 2FA solo quando **Abilita 2FA** e **Imponi 2FA** sono entrambi attivi, l'account usa credenziali locali o LDAP, nessuno dei ruoli dell'utente è tra i **Ruoli esenti** e, inoltre, **Imponi per i ruoli** è vuoto oppure uno dei ruoli dell'utente vi è elencato.

Quando un utente è obbligato a usare la 2FA e non l'ha ancora configurata, viene indirizzato alla procedura di attivazione al successivo accesso e ottiene una sessione solo dopo averla completata. Attivare l'imposizione (o ampliarla per includere più utenti) non disconnette nessuno: le sessioni del browser già aperte degli utenti interessati restano attive e il criterio ha effetto al loro successivo accesso, mentre il tentativo di passare a un ruolo obbligato senza un secondo fattore viene bloccato. Vengono però revocati i token API (token di accesso personali e token MCP) di quegli utenti — nella stessa transazione che salva il criterio — perché tali token non attraversano la fase di attivazione al login e manterrebbero altrimenti l'accesso via API senza un secondo fattore. Le credenziali vengono revocate allo stesso modo ogni volta che un utente non ancora iscritto diventa soggetto all'obbligo — per promozione a un ruolo imposto o per cambio del metodo di autenticazione verso uno compatibile con la 2FA (locale o LDAP). Un utente soggetto all'obbligo non può disattivare la propria 2FA dalle impostazioni: solo un reset da parte di un amministratore può rimuoverla.

**Provider OIDC/SAML.** Gli utenti che accedono tramite un provider esterno (OIDC o SAML) non usano la 2FA di Praetor: il secondo fattore è gestito dal loro identity provider. Per questi utenti l'attivazione non è disponibile e il criterio di imposizione non si applica mai, qualunque sia la selezione dei ruoli.

**Ripristino.** Se un utente perde l'accesso al proprio authenticator, un amministratore può azzerarne la 2FA dal menu azioni nella lista utenti (**Reimposta 2FA**). L'operazione disattiva la 2FA dell'utente e revoca le sue credenziali attive — sia le sessioni sia i token API (token di accesso personali e token MCP), poiché il ripristino è un'azione di recupero e un token ancora valido manterrebbe altrimenti l'accesso senza 2FA; al successivo accesso l'utente userà solo la password (e, se il criterio richiede ancora la 2FA per quell'utente, gli verrà richiesto di riconfigurarla).

## Impostazioni generali ed email

Le impostazioni generali controllano funzioni trasversali come AI reporting e preferenze applicative. Le impostazioni email servono per invii e notifiche.

Nella scheda **Personalizzazione**, gli amministratori personalizzano il nome e il logo dell'azienda. Il nome azienda sostituisce la scritta "PRAETOR" nella barra laterale, mentre il logo caricato sostituisce sia l'icona nella barra laterale sia il logo della schermata di accesso. I logo accettano PNG, JPEG, WEBP o SVG fino a 2 MB; lasciando vuoto un campo si ripristina il valore predefinito di Praetor. La personalizzazione è leggibile pubblicamente affinché la schermata di accesso possa mostrarla prima dell'accesso, ma solo gli amministratori con il permesso di aggiornamento delle impostazioni generali possono modificarla.

Dalla scheda **Preferenze di Tracciamento** gli amministratori configurano anche i metadati usati dal prospetto RIL: nome azienda, orari di entrata e uscita predefiniti, minuti di pausa pranzo, opzioni Note e opzioni Trasferta. Le Note si configurano con campi separati **Codice** e **Nome**; le Trasferte si configurano con righe nome aggiungibili, con la prima opzione usata per i giorni in sede e la seconda per il telelavoro. Gli orari predefiniti popolano i giorni RIL validi, e il valore della pausa pranzo viene usato per ricalcolare Ore e PICAP dai valori modificabili di entrata e uscita; nessuna di queste impostazioni modifica le registrazioni esistenti.

La visibilità della pagina RIL si gestisce dai ruoli con il permesso **timesheets.ril.view**. I ruoli che avevano già accesso al Time Tracker ricevono automaticamente il permesso durante la migrazione.

Dopo aver modificato SMTP, mittente o sicurezza, esegui sempre un test di invio prima di considerare conclusa la configurazione.

## Log

I log aiutano a ricostruire accessi e operazioni rilevanti. Usali per audit, troubleshooting e verifiche dopo modifiche amministrative.

Filtra per periodo per ridurre il rumore e concentrarti sull'evento da analizzare.
