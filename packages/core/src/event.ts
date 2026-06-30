import { changeEventSchema, SCHEMA_VERSION, type ChangeEvent } from '@coa/shared';

/** Distribute `Omit` across a union so each member is omitted independently. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * A change-event as a producer hands it to `emit` — everything but the fields M1
 * stamps authoritatively: the monotonic `seq`, the `ts`, and the frame
 * `schema_version`. The typed write methods and the reconciler build these.
 */
export type ChangeEventDraft = DistributiveOmit<ChangeEvent, 'seq' | 'ts' | 'schema_version'>;

/** Stamp a draft into a validated frame. The single place `seq`/`ts`/version are applied. */
export function stampFrame(draft: ChangeEventDraft, seq: number, ts: string): ChangeEvent {
  return changeEventSchema.parse({ ...draft, schema_version: SCHEMA_VERSION, seq, ts });
}
