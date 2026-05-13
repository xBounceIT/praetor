// Registers `ajv-formats` with Fastify's AJV instance so JSON-schema `format` keywords
// (`date-time`, `date`, `email`, ...) are actually validated.
//
// @fastify/ajv-compiler auto-registers `ajv-formats` with default options when no explicit
// formats plugin is supplied. Wiring it ourselves makes the configuration explicit (we choose
// which formats are active) and protects against silent breakage if the upstream default ever
// changes. The compiler dedupes by checking `plugin.name === 'formatsPlugin'`, so we keep the
// underlying function reference (whose `.name` is `formatsPlugin`) - any wrapper would break
// the dedupe and double-register the plugin.

import type { Plugin } from 'ajv';
import addFormats, { type FormatsPluginOptions } from 'ajv-formats';

// Re-typed as a generic AJV `Plugin` so it fits Fastify's `ajv.plugins` array signature
// (Fastify expects `Plugin<unknown>`, while ajv-formats's own signature is `Plugin<FormatsPluginOptions>`).
// The default-import shape from `ajv-formats` also loses the callable type after TS module-interop
// translation, so we cast here once instead of at every call site.
export const ajvFormatsPlugin = addFormats as unknown as Plugin<unknown>;

export const ajvFormatsPluginOptions: FormatsPluginOptions = {
  mode: 'full',
  // Limit registration to the formats we actually use in route schemas - keeps the keyword set
  // tight. `date-time` is the load-bearing one (logs.ts startDate/endDate, others).
  formats: ['date-time', 'date', 'time', 'email', 'uri', 'uuid'],
  keywords: true,
};
