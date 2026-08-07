// Archived from packages/core/src/flags/autopatch.ts
import type { FlagRecord, Patch } from '@coa/shared';
import type { Producer } from './producer.js';

/**
 * CF-3 / CF-4 — the visible Type-1 auto-patch planner. A Type-1 producer carrying a
 * deterministic `fix` patches **visibly and coherently**: every auto-patch becomes
 * a WAL change-event (the actual `M1.emit` is the wiring's job) AND a feed item
 * with a one-action revert. Two guards keep it honest:
 *  - **span confinement (CF-3):** a Type-1 fix only ever touches the span of its
 *    flag — a fix that overreaches to another file is demoted to a plain flag.
 *  - **flapping detector (CF-3):** a patch the agent immediately re-reverts
 *    (a patch↔counter-edit loop on one fingerprint) auto-demotes from auto-patch to
 *    a plain flag, never silently disabled.
 *
 * CF-4 coherence: a patch to a file the agent holds an uncommitted edit on is
 * deferred to the next Stop turn-boundary rather than clobbering live work.
 */
export type AutoPatchPlan =
  | { kind: 'apply'; patch: Patch; feedItem: string }
  | { kind: 'flag-only'; reason: string };

/** One patch↔counter-edit cycle on a fingerprint is treated as oscillation (conservative). */
const FLAP_THRESHOLD = 1;

export class AutoPatcher {
  private readonly cycles = new Map<string, number>();
  private readonly demoted = new Set<string>();

  /** Plan the auto-patch for a flag, or `undefined` when it is not auto-patchable at all. */
  plan(flag: FlagRecord, producer: Producer): AutoPatchPlan | undefined {
    if (flag.type !== 1 || producer.fix === undefined) return undefined;
    if (this.demoted.has(flag.fingerprint)) {
      return { kind: 'flag-only', reason: 'auto-demoted after a patch↔counter-edit oscillation' };
    }
    const patch = producer.fix(flag);
    if (patch.target !== fileOf(flag.location)) {
      return { kind: 'flag-only', reason: 'fix overreaches beyond the flag span' };
    }
    return {
      kind: 'apply',
      patch,
      feedItem: `auto-patched ${patch.target}: ${flag.message} — one-action revert available`,
    };
  }

  /** Record that an auto-patch landed (so a subsequent counter-edit is detectable). */
  noteApplied(fingerprint: string): void {
    if (!this.cycles.has(fingerprint)) this.cycles.set(fingerprint, 0);
  }

  /** Record a counter-edit; once the oscillation threshold is crossed, auto-demote the fingerprint. */
  noteReverted(fingerprint: string): void {
    const next = (this.cycles.get(fingerprint) ?? 0) + 1;
    this.cycles.set(fingerprint, next);
    if (next >= FLAP_THRESHOLD) this.demoted.add(fingerprint);
  }

  /** CF-4 — defer a patch to a file the agent holds an uncommitted edit on. */
  shouldDefer(target: string, heldFiles: string[]): boolean {
    return heldFiles.includes(target);
  }
}

/** The file portion of a `path:line` flag location. */
function fileOf(location: string): string {
  const colon = location.indexOf(':');
  return colon === -1 ? location : location.slice(0, colon);
}
