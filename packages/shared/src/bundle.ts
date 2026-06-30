import { z } from 'zod';
import { capabilityFrameSchema } from './capability.js';

/** Role-as-bundle (D95/D132): a Role is a named set of Pieces + a capability frame + asset contracts. */
export const bundleManifestSchema = z.object({
  role: z.string(),
  pieces: z.array(z.string()),
  frame: capabilityFrameSchema,
  /**
   * The TAX-2 authority surface (D132 part a): each exported directive (a Piece name) →
   * the constraint ids it is `governed-by`. This is the bundle's declared public-authority
   * surface — removing a link or a whole directive is a breaking (MAJOR) change.
   */
  linkedDirectives: z.record(z.string(), z.array(z.string())),
  assetContractHashes: z.record(z.string(), z.string()),
  version: z.string(),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;
