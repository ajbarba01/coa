import { z } from 'zod';

/**
 * The two disambiguated `Capability*` shapes:
 * - {@link CapabilityFrame} — pre-compile per-(sub)agent allow/deny tool intents.
 * - {@link CapabilitySet}   — the enforced per-session sandbox set.
 *
 * The third, the backend port manifest (`CapabilityProfile`), is parked in
 * `archive/capability-profile/`.
 */

export const capabilityFrameSchema = z.object({
  allow: z.array(z.string()),
  deny: z.array(z.string()),
  perAgent: z
    .record(z.string(), z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }))
    .optional(),
});
export type CapabilityFrame = z.infer<typeof capabilityFrameSchema>;

/** The enforced per-session sandbox set. */
export const capabilitySetSchema = z.object({
  allowedTools: z.array(z.string()),
  denyRules: z.array(z.string()),
  permissionMode: z.string(),
  denyRead: z.array(z.string()),
});
export type CapabilitySet = z.infer<typeof capabilitySetSchema>;
