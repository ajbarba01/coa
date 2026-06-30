import { z } from 'zod';

/**
 * M0 — the credential-blind multi-account types. coa stores POINTERS to Claude
 * subscription logins (a config dir or a named profile), never tokens. The
 * locator→env mapping that turns a locator into SDK auth lives in the Claude
 * adapter (the backend seam), not here. `ambient` = no override = today's behavior.
 */

/** Reserved `active` sentinel: run under whatever login the environment already resolves. */
export const AMBIENT = 'ambient';

/** A pointer to a subscription login — never a secret. */
export const locatorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('config-dir'), dir: z.string().min(1) }),
  z.object({ type: z.literal('ant-profile'), profile: z.string().min(1) }),
  z.object({ type: z.literal('ambient') }),
]);
export type Locator = z.infer<typeof locatorSchema>;

/** A registered account: a user-facing label + the neutral pointer to its login. */
export const accountSchema = z.object({
  label: z.string().min(1),
  provider: z.literal('claude').default('claude'),
  locator: locatorSchema,
});
export type Account = z.infer<typeof accountSchema>;

/** The on-disk registry: the active label (or {@link AMBIENT}) + the registered accounts. */
export const accountsFileSchema = z.object({
  active: z.string().min(1),
  accounts: z.array(accountSchema),
});
export type AccountsFile = z.infer<typeof accountsFileSchema>;
