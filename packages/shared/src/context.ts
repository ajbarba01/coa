import { z } from 'zod';
import { flagRecordSchema } from './flag.js';

/**
 * The assembled context package — ephemeral, byte-stable, inspectable;
 * not a committed git artifact. This package owns the shape.
 */
export const contextPackageSchema = z.object({
  header: z.object({
    activeConstraints: z.array(z.string()),
    openFlags: z.array(flagRecordSchema),
  }),
  pieces: z.array(z.object({ ref: z.string(), rank: z.number(), reason: z.string() })),
  referenceBin: z.array(z.string()),
  freshness: z.object({ walPosition: z.number(), builtAtSeq: z.number() }),
});
export type ContextPackage = z.infer<typeof contextPackageSchema>;

/** A reference to an assembled package by scope + WAL position (the compiled-config slot). */
export const contextPackageRefSchema = z.object({
  scope: z.string(),
  walPosition: z.number(),
});
export type ContextPackageRef = z.infer<typeof contextPackageRefSchema>;
