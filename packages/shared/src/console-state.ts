import { z } from 'zod';

/**
 * The console's entity-less UI/policy state (`~/.coa/console.yaml`). Credential-blind:
 * only provider ids. `addedProviders` models the "added, no credentials yet" empty state;
 * `disabledProviders` is BACKEND-provider bench (service-provider bench lives on the
 * web.yaml entry). `hiddenModels` is reserved for a later model-visibility pass.
 * Drop-unknown / never-throw, like the web-key store.
 */
export const consoleStateSchema = z
  .object({
    version: z.literal(1).default(1),
    addedProviders: z.array(z.string()).default([]),
    disabledProviders: z.array(z.string()).default([]),
  })
  .strip();
export type ConsoleState = z.infer<typeof consoleStateSchema>;
