import { z } from 'zod';
import { capabilityFrameSchema } from './capability.js';

/** Role-as-bundle (D95/D132): a Role is a named set of Pieces + a capability frame + asset contracts. */
export const bundleManifestSchema = z.object({
  role: z.string(),
  pieces: z.array(z.string()),
  frame: capabilityFrameSchema,
  assetContractHashes: z.record(z.string(), z.string()),
  version: z.string(),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;
