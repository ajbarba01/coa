import type { CapabilityProfile } from '@coa/shared';

/**
 * The D109 null-fallback contracts: the defined "degrade gracefully" results a
 * backend returns when a capability is absent, so the core never throws and
 * never branches on which backend is active.
 */

/**
 * The {@link RuntimeAdapter.refs} null-fallback. A backend without a language
 * server returns this; the caller (M6's `find_references`, M1's graph build)
 * degrades to M2's tree-sitter floor (D144).
 */
export const REFS_NULL_FALLBACK = null;

/**
 * The barebones baseline (D62/D109): a pinned, minimal profile guaranteed to
 * work on any backend. It is the floor {@link RuntimeAdapter.capabilityProfile}
 * falls back to — the enhancement ports are marked absent, each degrading to its
 * defined floor, so a missing capability never removes a feature outright (D85).
 */
export const barebonesProfile: CapabilityProfile = {
  spiVersion: '0.0.0-internal',
  ports: {
    refs: { present: false, nullFallback: 'M2 tree-sitter floor' },
    inject_runtime: { present: false, nullFallback: 'context only at session-start render' },
    cache_control: { present: false, nullFallback: 'no cache breakpoints; full prefix re-sent' },
    runEval: { present: false, nullFallback: 'eval gate skipped; promotion needs manual review' },
  },
  degradation: {
    overall: 'the rented loop + the neutral floor only; every high-fidelity port degraded',
  },
};
