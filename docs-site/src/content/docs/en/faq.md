---
title: FAQ and troubleshooting
description: Quick answers to common issues while using Praetor.
sidebar:
  order: 8
---

## I cannot see a module

Module visibility depends on role permissions and some global settings. Ask an administrator to check the assigned role and module availability.

## I cannot save a document

Check required fields, numeric values, and dates. In forms, required fields are marked with a red asterisk (*) next to the label. In commercial documents, also verify that rows, quantities, prices, and records are complete.

## Totals are not what I expected

Review discounts, discount type, units, quantities, and unit price. If the document was generated from another document, also check the source link.

## The session expired

Sign in again. Sessions expire to protect data when the application is left idle.

## An upgrade stops during migrations

The backend applies database migrations before accepting traffic. If a deployment is interrupted halfway through, run the same upgrade command again: recorded migrations are skipped and missing entries are detected by hash. If startup still fails, inspect backend logs before rolling back.

## Is technical documentation still available?

Yes. API documentation remains available at `/docs/api` and frontend documentation remains available at `/docs/frontend`.
