import { z } from 'zod';

/**
 * The console's entity-less UI/policy state (`~/.coa/console.yaml`). Credential-blind:
 * only provider ids. `addedProviders` models the "added, no credentials yet" empty state;
 * `disabledProviders` is BACKEND-provider bench (service-provider bench lives on the
 * web.yaml entry). `hiddenModels` is reserved for a later model-visibility pass.
 * `isolatedBrowserLogins` and `browserPath` control the dedicated-browser-session flow.
 * Drop-unknown / never-throw, like the web-key store.
 */
export const consoleStateSchema = z
  .object({
    version: z.literal(1).default(1),
    addedProviders: z.array(z.string()).default([]),
    disabledProviders: z.array(z.string()).default([]),
    /** The global "sign logins in through a dedicated browser profile" toggle. OFF by
     *  default: with it off, a login spawn is byte-identical to today (off means a literal pass-through). */
    isolatedBrowserLogins: z.boolean().default(false),
    /** The user's browser-binary override. Absent ⇒ auto-detection decides. */
    browserPath: z.string().optional(),
  })
  .strip();
export type ConsoleState = z.infer<typeof consoleStateSchema>;
