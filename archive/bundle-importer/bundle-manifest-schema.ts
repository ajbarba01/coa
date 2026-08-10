// Archived from packages/shared/src/bundle.ts (the bundle's wire manifest, removed
// with the importer — its only remaining consumers were this directory's files).
import { z } from 'zod';
import { capabilityFrameSchema } from '@coa/shared';

/** Role-as-bundle: a Role is a named set of Pieces + a capability frame + asset contracts. */
export const bundleManifestSchema = z.object({
  role: z.string(),
  pieces: z.array(z.string()),
  frame: capabilityFrameSchema,
  /**
   * The authority surface: each exported directive (a Piece name) →
   * the constraint ids it is `governed-by`. This is the bundle's declared public-authority
   * surface — removing a link or a whole directive is a breaking (MAJOR) change.
   */
  linkedDirectives: z.record(z.string(), z.array(z.string())),
  assetContractHashes: z.record(z.string(), z.string()),
  version: z.string(),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;
