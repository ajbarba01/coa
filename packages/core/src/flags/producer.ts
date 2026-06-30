import type { ChangeEvent, ContextSlice, FlagRecord, Patch, ToolCall } from '@coa/shared';

/**
 * The one add-path member (P2). Every check — typecheck, format, custom rule,
 * staleness, grounding, generation-drift — is a producer emitting into the single
 * pipeline against the one schema; there are no per-producer side channels. The
 * `type` field on the flags a producer emits is producer-stamped (M3 holds no
 * `producerId -> type` map).
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

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * CF-6 — the mandatory registration gate. A constraint cannot be raw-hand-dropped:
 * it must pass its good case, catch its bad case, and (given a calibration corpus)
 * not fire on everything. The loader admits only producers carrying this stamp.
 */
export function validateProducer(producer: Producer, corpus?: ProducerInput[]): ValidationResult {
  if (producer.run(producer.golden.good).length > 0) {
    return { ok: false, reason: 'false-positive on the golden good case' };
  }
  if (producer.run(producer.golden.bad).length === 0) {
    return { ok: false, reason: 'missed the golden bad case' };
  }
  if (corpus !== undefined && corpus.length > 0) {
    const firing = corpus.filter((input) => producer.run(input).length > 0).length;
    if (firing === corpus.length) {
      return { ok: false, reason: 'fires on every calibration-corpus member' };
    }
  }
  return { ok: true };
}
