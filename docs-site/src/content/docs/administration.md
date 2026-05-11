---
title: Amministrazione
description: Gestione di utenti, ruoli, autenticazione, impostazioni, email e log.
sidebar:
  order: 6
---

## Utenti e ruoli

Gli amministratori gestiscono utenti, ruoli e permessi. Ogni ruolo dovrebbe concedere solo le funzioni necessarie al lavoro quotidiano.

Le righe di permesso con ambito **All** concedono accesso trasversale a tutti i record della stessa area, ad esempio tutti i clienti, fornitori, progetti, task, consuntivi o work unit. L'azione **View** abilita la vista e la consultazione su tutti i record; quando selezionate, anche **Create**, **Update** e **Delete** sono permessi reali e consentono scritture su record non assegnati. I permessi senza **All** mantengono l'ambito assegnato all'utente.

Quando modifichi un ruolo, considera l'impatto su tutti gli utenti assegnati. Dopo modifiche importanti, verifica l'accesso con un profilo di prova o con un utente rappresentativo.

## Autenticazione

Praetor supporta autenticazione locale e integrazioni aziendali come LDAP o SSO quando configurate. Mantieni aggiornati endpoint, mapping dei ruoli e impostazioni di sicurezza.

Nella lista utenti puoi usare il menu azioni e scegliere **Cambia metodo di autenticazione** per vincolare un utente applicativo a credenziali locali, LDAP, OIDC o SAML. Per OIDC e SAML seleziona anche il provider specifico: l'utente potrà accedere solo tramite quel provider. Dipendenti interni o esterni non sono account applicativi e non possono essere vincolati a LDAP/SSO.

La sincronizzazione LDAP aggiorna solo utenti applicativi già impostati su LDAP. Un utente locale con lo stesso username resta locale finché un amministratore non cambia esplicitamente il suo metodo di autenticazione.

Se un utente non riesce ad accedere, controlla credenziali, stato dell'utente, ruolo assegnato e log di autenticazione.

## Impostazioni generali ed email

Le impostazioni generali controllano funzioni trasversali come AI reporting e preferenze applicative. Le impostazioni email servono per invii e notifiche.

Dopo aver modificato SMTP, mittente o sicurezza, esegui sempre un test di invio prima di considerare conclusa la configurazione.

## Log

I log aiutano a ricostruire accessi e operazioni rilevanti. Usali per audit, troubleshooting e verifiche dopo modifiche amministrative.

Filtra per periodo e utente per ridurre il rumore e concentrarti sull'evento da analizzare.
