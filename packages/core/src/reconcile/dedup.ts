import type { ChangeEventDraft } from '../event.js';

/** A bare disk observation from the git-centric scan (provenance-blind). */
export interface Observation {
  worktree: string;
  path: string;
  /** Content hash of the file now, or `null` if it is gone. */
  postHash: string | null;
}

/** A recent precise (Mutate) event for this path awaiting disk confirmation. */
export interface PreciseOp {
  opId: string;
  preHash: string | null;
  postHash: string | null;
  provenance: 'declared' | 'gated';
}

/** What the kernel already knows about a path at the moment of an observation. */
export interface PathState {
  /** The last post_hash the kernel recorded for this path (`null` ⇒ absent). */
  priorHash: string | null;
  pendingPrecise?: PreciseOp;
}

/**
 * The causal-dedup decision, keyed on the transition
 * `(worktree, path, pre_hash, post_hash)`. Content-hash dedup drops a no-op; an
 * observation that matches a recent precise event is a **confirmation** (not a
 * duplicate change); any other real transition is an **inferred** event the
 * provenance-blind reconciler authors. Returns `null` when nothing changed.
 */
export function classifyObservation(obs: Observation, state: PathState): ChangeEventDraft | null {
  const preHash = state.priorHash;
  const postHash = obs.postHash;
  if (preHash === postHash) return null; // no-op: same content (or still absent)

  const precise = state.pendingPrecise;
  if (precise && precise.preHash === preHash && precise.postHash === postHash) {
    return {
      worktree: obs.worktree,
      actor: 'reconciler',
      op_id: precise.opId,
      provenance: precise.provenance,
      cause: null,
      kind: 'confirm',
      path: obs.path,
      pre_hash: preHash,
      post_hash: postHash,
      generated: false,
    };
  }

  return {
    worktree: obs.worktree,
    actor: 'reconciler',
    op_id: null,
    provenance: 'inferred',
    cause: null,
    kind: kindFor(preHash, postHash),
    path: obs.path,
    pre_hash: preHash,
    post_hash: postHash,
    generated: false,
  };
}

function kindFor(preHash: string | null, postHash: string | null): 'create' | 'modify' | 'delete' {
  if (preHash === null) return 'create';
  if (postHash === null) return 'delete';
  return 'modify';
}
