---
title: Amministrazione
description: Gestione di utenti, ruoli, autenticazione, impostazioni, email e log.
sidebar:
  order: 6
---

## Utenti e ruoli

Gli amministratori gestiscono utenti, ruoli e permessi. Ogni ruolo dovrebbe concedere solo le funzioni necessarie al lavoro quotidiano.

Quando modifichi un ruolo, considera l'impatto su tutti gli utenti assegnati. Dopo modifiche importanti, verifica l'accesso con un profilo di prova o con un utente rappresentativo.

## Autenticazione

Praetor supporta autenticazione locale e integrazioni aziendali come LDAP o SSO quando configurate. Mantieni aggiornati endpoint, mapping dei ruoli e impostazioni di sicurezza.

Nella lista utenti puoi usare il menu azioni e scegliere **Cambia metodo di autenticazione** per vincolare un utente applicativo a credenziali locali, LDAP, OIDC o SAML. Per OIDC e SAML seleziona anche il provider specifico: l'utente potrà accedere solo tramite quel provider.

Se un utente non riesce ad accedere, controlla credenziali, stato dell'utente, ruolo assegnato e log di autenticazione.

## Impostazioni generali ed email

Le impostazioni generali controllano funzioni trasversali come AI reporting e preferenze applicative. Le impostazioni email servono per invii e notifiche.

Dopo aver modificato SMTP, mittente o sicurezza, esegui sempre un test di invio prima di considerare conclusa la configurazione.

## Log

I log aiutano a ricostruire accessi e operazioni rilevanti. Usali per audit, troubleshooting e verifiche dopo modifiche amministrative.

Filtra per periodo e utente per ridurre il rumore e concentrarti sull'evento da analizzare.
