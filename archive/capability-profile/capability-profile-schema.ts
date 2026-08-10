// Archived from packages/shared/src/capability.ts (the backend port manifest). It lost
// its last consumer when the runtime-adapter port shrank to the methods the loop
// actually drives — nothing built or read a profile after that. The other two
// `Capability*` shapes (the per-agent tool intents and the enforced per-session
// sandbox set) stay in the tree.
import { z } from 'zod';

/** The capability-profile manifest shape. The shared package owned the shape; the backend adapter owned the ports. */
export const capabilityProfileSchema = z.object({
  ports: z.record(z.string(), z.object({ present: z.boolean(), nullFallback: z.string() })),
  spiVersion: z.string(),
  degradation: z.record(z.string(), z.string()),
});
export type CapabilityProfile = z.infer<typeof capabilityProfileSchema>;
