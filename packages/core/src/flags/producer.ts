import type { Producer, ProducerInput } from '@coa/shared';

/**
 * M3 owns the pipeline + the CF-6 registration gate; the producer contract TYPE
 * it gates against (`Producer`/`ProducerInput`) lives in M0 (`@coa/shared`) so any
 * feeding module — M4's producers, M6's mutate producer — implements it without
 * importing this ring. Re-exported here for the historical `@coa/core` surface.
 */
export type { Producer, ProducerInput } from '@coa/shared';

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
