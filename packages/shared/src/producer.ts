import type { ChangeEvent } from './change-event.js';
import type { ContextSlice, ToolCall } from './tool.js';
import type { FlagRecord } from './flag.js';
import type { Patch } from './patch.js';

/**
 * The producer contract (P2) — the shared seam between M3's one flag pipeline and
 * every module that feeds it (M3's own checkers, M4's generation/grounding/health
 * producers, M6's mutate producer). The TYPE lives in M0 so any module can
 * implement it without importing M3's ring; M3 owns the pipeline + the CF-6
 * `validateProducer` registration gate that admits these.
 *
 * Each producer emits into the single pipeline against the one schema; there are
 * no per-producer side channels. The `type` on the flags a producer emits is
 * producer-stamped (M3 holds no `producerId -> type` map).
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
  /** When the producer runs (a coarse activation label; M8/M1 drive the trigger). */
  activation: string;
  run(input: ProducerInput): FlagRecord[];
  /** A deterministic auto-patch for a Type-1 flag (CF-3). */
  fix?(flag: FlagRecord): Patch;
  /** The bounded evidence slice behind a flag (the CF-5 validator + CON-3 seed). */
  envelope?(flag: FlagRecord): ContextSlice;
  /** CF-6: the golden pair the registration gate requires — a good case that must NOT flag, a bad case that MUST. */
  golden: { good: ProducerInput; bad: ProducerInput };
}
