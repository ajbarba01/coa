import { z } from 'zod';

/**
 * The three disambiguated `Capability*` shapes (D-CAT):
 * - {@link CapabilityFrame}  — pre-compile per-(sub)agent allow/deny tool intents.
 * - {@link CapabilityProfile} — the backend port manifest (D62/D109).
 * - {@link CapabilitySet}    — the enforced per-session sandbox set.
 */

export const capabilityFrameSchema = z.object({
  allow: z.array(z.string()),
  deny: z.array(z.string()),
  perAgent: z
    .record(z.string(), z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }))
    .optional(),
});
export type CapabilityFrame = z.infer<typeof capabilityFrameSchema>;

/** The capability-profile manifest shape (D62/D109). M0 owns the shape; M9 owns the ports. */
export const capabilityProfileSchema = z.object({
  ports: z.record(z.string(), z.object({ present: z.boolean(), nullFallback: z.string() })),
  spiVersion: z.string(),
  degradation: z.record(z.string(), z.string()),
});
export type CapabilityProfile = z.infer<typeof capabilityProfileSchema>;

/** The enforced per-session sandbox set. */
export const capabilitySetSchema = z.object({
  allowedTools: z.array(z.string()),
  denyRules: z.array(z.string()),
  permissionMode: z.string(),
  denyRead: z.array(z.string()),
});
export type CapabilitySet = z.infer<typeof capabilitySetSchema>;
