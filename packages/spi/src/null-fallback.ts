import type { CapabilityProfile } from '@coa/shared';

/**
 * The null-fallback contracts: the defined "degrade gracefully" results a
 * backend returns when a capability is absent, so the core never throws and
 * never branches on which backend is active.
 */

/**
 * The {@link RuntimeAdapter.refs} null-fallback. A backend without a language
 * server returns this; the caller (the governed `find_references` tool, the
 * graph build) degrades to the tree-sitter floor.
 */
export const REFS_NULL_FALLBACK = null;

/**
 * The barebones baseline: a pinned, minimal profile guaranteed to work on any
 * backend. It is the floor {@link RuntimeAdapter.capabilityProfile} falls back
 * to — the enhancement ports are marked absent, each degrading to its defined
 * floor, so a missing capability never removes a feature outright.
 */
export const barebonesProfile: CapabilityProfile = {
  spiVersion: '0.0.0-internal',
  ports: {
    refs: { present: false, nullFallback: 'tree-sitter floor' },
    inject_runtime: { present: false, nullFallback: 'context only at session-start render' },
    cache_control: { present: false, nullFallback: 'no cache breakpoints; full prefix re-sent' },
    runEval: { present: false, nullFallback: 'eval gate skipped; promotion needs manual review' },
  },
  degradation: {
    overall: 'the rented loop + the neutral floor only; every high-fidelity port degraded',
  },
};
