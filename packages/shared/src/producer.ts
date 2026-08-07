import type { ChangeEvent } from './change-event.js';
import type { ContextSlice, ToolCall } from './tool.js';
import type { FlagRecord } from './flag.js';
import type { Patch } from './patch.js';

/**
 * The producer contract — the shared seam between the one flag pipeline and
 * every module that feeds it (the pipeline's own checkers, the generation/grounding/health
 * producers, the mutate producer). The TYPE lives here so any module can
 * implement it without importing the pipeline's ring; the pipeline owns itself + the
 * `validateProducer` registration gate that admits these.
 *
 * Each producer emits into the single pipeline against the one schema; there are
 * no per-producer side channels. The `type` on the flags a producer emits is
 * producer-stamped (the pipeline holds no `producerId -> type` map).
 */

/** What a producer runs against: a scope sweep, a change-event, or a tool call. */
export type ProducerInput =
  | { kind: 'scope'; scope: string }
  | { kind: 'change'; event: ChangeEvent }
  | { kind: 'tool'; call: ToolCall };

export interface Producer {
  id: string;
  /** `deterministic` ⇒ may emit Type-1; `judgment` ⇒ Type-2 only. */
  kind: 'deterministic' | 'judgment';
  /** When the producer runs (a coarse activation label; the session host and the spine drive the trigger). */
  activation: string;
  run(input: ProducerInput): FlagRecord[];
  /**
   * Rebuild-to-follow opt-in (default false). A reconciling producer's `run`
   * returns the **complete current** flag set for its concern (not an incremental
   * per-event delta), so the driver may self-heal: any fingerprint it previously
   * emitted but no longer does is resolved. Incremental producers (the default)
   * emit per-event and are append-only — the driver never diff-resolves them.
   */
  reconciling?: boolean;
  /** A deterministic auto-patch for a Type-1 flag. */
  fix?(flag: FlagRecord): Patch;
  /** The bounded evidence slice behind a flag (feeds the validator and seeds the context assembly). */
  envelope?(flag: FlagRecord): ContextSlice;
  /** The golden pair the registration gate requires — a good case that must NOT flag, a bad case that MUST. */
  golden: { good: ProducerInput; bad: ProducerInput };
}
