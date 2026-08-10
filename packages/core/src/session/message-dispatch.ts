import type { CoaError } from '@coa/shared';
import type { SessionEndReason } from './notify.js';
import type { AgentMessage } from './message-log.js';

/**
 * The pure decision half of inter-agent messaging (docs/adr/0039) — mesh-membership
 * checking, thread resolution, and delivery-plan/roster-relation computation. No I/O:
 * every fact this module needs (a session's root/agentRef, its live run state, its last
 * observed end reason, a thread's anchor) is handed in as a plain closure, so
 * `dispatchMessage`/`buildRoster` are testable with stub data alone — mirrors
 * `worktree-manager.ts`'s `decideBind` pure-function split from its I/O-performing class.
 * `session-service.ts` supplies the real closures (the live registry, the store, the
 * durable message log) and performs the actual delivery the plan names.
 */

/** A session's live run state, as `session-service.ts` derives it from the registry:
 *  `'running'` while a turn is in flight (mid-tool-call, mid-generation — a message
 *  lands at the turn's own next boundary via the delivery queue); `'idle'` for a
 *  registered session between turns (the drive loop is parked, so nothing short of a
 *  fresh queued turn wakes it — see {@link DeliveryPlan}); `'not-registered'` for an id
 *  the live registry has no entry for at all (idle-evicted, or never started this
 *  process's lifetime) — still `'wake'`-able whenever the store still knows it. */
export type LiveState = 'running' | 'idle' | 'not-registered';

/** What `dispatchMessage` needs to know about a session to place it in the mesh — the
 *  pure projection of `SessionMeta` a caller supplies (never the whole record). */
export interface MeshLookup {
  /** This session's family-tree root; absent ⇒ it IS the root (mirrors
   *  `LiveSession.root`/`SessionMeta.root`'s own "root defaults to self" convention). */
  root?: string;
  agentRef: string;
}

export interface DispatchDeps {
  /** Look up a session's mesh membership; `undefined` ⇒ no such session is known at
   *  all (never spawned, or its record was explicitly removed) — the one genuine
   *  "unknown target" case. An idle-evicted-but-still-known session still resolves. */
  lookup: (id: string) => MeshLookup | undefined;
  liveState: (id: string) => LiveState;
  /** Resolve a reply's thread anchor from the message it replies to (a durable-log
   *  read, scoped to the mesh's own root); `undefined` ⇒ the replied-to id isn't in the
   *  log (unknown/foreign) — the caller falls back to treating it as its own anchor,
   *  never throwing over a stale or foreign `replyTo`. */
  resolveThread: (replyTo: string) => string | undefined;
  newId: () => string;
  now: () => string;
}

/** How a dispatched message actually reaches its recipient, keyed by the recipient's
 *  live state at send time (docs/superpowers/specs/2026-08-04-inter-agent-messaging-and-dispatch-design.md's
 *  four-state table, collapsed to two REALIZATION mechanisms coa's turn model actually
 *  has — see docs/adr/0039 for why idle/finished/not-yet-started collapse together):
 *  - `mid-turn` — the recipient is actively running a turn RIGHT NOW; the message rides
 *    the existing `Delivery`/`DeliveryQueue` mechanism (docs/adr/0030) and lands at that
 *    turn's own next boundary, exactly like a completion notice does today.
 *  - `wake` — the recipient is idle (registered, parked at `nextTurn()`), not currently
 *    registered at all (evicted, or its founding turn hasn't started draining yet), or
 *    has already finished its assigned work. None of these three can be reached by a
 *    queue push alone (nothing is draining it) — the caller enqueues a fresh turn, which
 *    either starts a revived session's drive loop (idle-evicted / never-started) or joins
 *    the queue an already-running loop is parked on (idle / not-yet-started). */
export type DeliveryPlan = { kind: 'mid-turn' } | { kind: 'wake' };

export type SendMessageOutcome =
  | { applied: true; message: AgentMessage; plan: DeliveryPlan; fromAgentRef: string }
  | { applied: false; error: CoaError };

/**
 * Dispatch one message: validate the mesh boundary (sender and target must share a
 * family-tree root — hierarchy is provenance, never a permission check, so ANY two
 * members of the same tree may address each other), resolve its thread, and decide how
 * it will reach the recipient. Never throws; an out-of-tree or unknown target is an
 * unapplied result, mirroring `spawnAgent`'s own never-throw-never-deny contract.
 *
 * A message TO a session whose root has itself been torn down (the whole tree was
 * closed) still dispatches, as long as sender and target still agree on the SAME root
 * value — `root` is a stored, permanent fact (`SessionMeta.root` never changes once
 * set), never a liveness check; only `to` itself being wholly unknown is refused. This
 * is a deliberate deviation from the design doc's "a cancelled thread tells the sender
 * not to resend" — see docs/adr/0039 for why: coa's session model has no "permanently
 * dead" session, only a torn-down one a fresh turn can always revive (exactly like a
 * person resuming an old conversation), so there is nothing here to refuse on.
 */
export function dispatchMessage(
  args: { from: string; to: string; body: string; replyTo?: string },
  deps: DispatchDeps,
): SendMessageOutcome {
  const toMeta = deps.lookup(args.to);
  if (toMeta === undefined) {
    return {
      applied: false,
      error: { code: 'unknown-target', message: `no known agent session '${args.to}'` },
    };
  }
  const fromMeta = deps.lookup(args.from);
  const fromRoot = fromMeta?.root ?? args.from;
  const toRoot = toMeta.root ?? args.to;
  if (fromRoot !== toRoot) {
    return {
      applied: false,
      error: {
        code: 'out-of-tree',
        message: `'${args.to}' is outside this agent's family tree — messaging is mesh-scoped to one root's descendants`,
      },
    };
  }

  const id = deps.newId();
  // A fresh message anchors its own thread; a reply resolves the thread it replies
  // into (falling back to its own id if `replyTo` doesn't resolve — never a throw).
  const threadId =
    args.replyTo !== undefined ? (deps.resolveThread(args.replyTo) ?? args.replyTo) : id;

  const message: AgentMessage = {
    id,
    threadId,
    ...(args.replyTo !== undefined ? { replyTo: args.replyTo } : {}),
    from: args.from,
    to: args.to,
    root: toRoot,
    body: args.body,
    createdAt: deps.now(),
  };
  const plan: DeliveryPlan =
    deps.liveState(args.to) === 'running' ? { kind: 'mid-turn' } : { kind: 'wake' };
  return { applied: true, message, plan, fromAgentRef: fromMeta?.agentRef ?? args.from };
}

// ---- Roster ----

/** A tree member's shape `buildRoster` needs — the pure projection of `SessionMeta`
 *  (or a live `LiveSession`) a caller supplies. */
export interface RosterMember {
  id: string;
  agentRef: string;
  /** Absent ⇒ this member IS the tree's root. */
  parent?: string;
}

/** Where a roster row sits relative to the CALLER (`self`), computed from the parent
 *  chain — never a permission distinction (addressing is a mesh regardless of relation),
 *  just what a relationship-relative render needs to group by (the critique's "roster
 *  shape" gap: Traycer's proven answer, not a flat list). `'ancestor'`/`'descendant'`
 *  cover anything beyond the immediate parent/child; `'other'` is a tree member neither
 *  directly nor transitively related along the parent chain (e.g. a cousin via a shared
 *  grandparent). */
export type RosterRelation = 'self' | 'parent' | 'child' | 'ancestor' | 'descendant' | 'other';

export interface RosterEntry {
  sessionId: string;
  agentRef: string;
  relation: RosterRelation;
  live: LiveState;
  /** `'observed'` when this process directly knows the fact (currently registered —
   *  running or idle — or a `SessionEndReason` this process itself saw fire); `'advisory'`
   *  when it is a guess derived from silence (not registered, and never observed
   *  ending — an idle-eviction, or a session from a prior daemon lifetime). Graded
   *  confidence per the design doc: a turn-ended signal is trustworthy, silence is not. */
  confidence: 'observed' | 'advisory';
  /** The last end reason this process itself observed for this session (`#emitStatus`'s
   *  own three-outcome vocabulary — `notify.ts`'s `SessionEndReason`); absent when the
   *  session is currently registered, or was never observed ending by this process. */
  endReason?: SessionEndReason;
}

/**
 * Every member of `selfId`'s family tree (its whole root-anchored set, `members` —
 * `session-service.ts` supplies every `SessionMeta` sharing `selfId`'s root, `selfId`
 * included), each labeled with its relation to the caller and its live/confidence
 * reading. Pure: no I/O, no bound on row count (the workbench-layer tool handler bounds
 * and sanitizes what actually rides back to the model, mirroring `spawn.ts`'s
 * `listKnownAgents`).
 */
export function buildRoster(
  selfId: string,
  members: readonly RosterMember[],
  liveState: (id: string) => LiveState,
  lastEnd: (id: string) => { reason: SessionEndReason; at: string } | undefined,
): RosterEntry[] {
  const byId = new Map(members.map((m) => [m.id, m] as const));
  const childrenOf = new Map<string, string[]>();
  for (const m of members) {
    if (m.parent === undefined) continue;
    const siblings = childrenOf.get(m.parent);
    if (siblings) siblings.push(m.id);
    else childrenOf.set(m.parent, [m.id]);
  }

  // Every descendant of selfId, any depth (mirrors lineage.ts's descendantsOf: a
  // visited-set walk, since `parent` may cycle in a hand-edited/adversarial tree).
  const descendants = new Set<string>();
  {
    const visited = new Set([selfId]);
    const stack = [...(childrenOf.get(selfId) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined || visited.has(next)) continue;
      visited.add(next);
      descendants.add(next);
      const kids = childrenOf.get(next);
      if (kids) stack.push(...kids);
    }
  }

  // Every ancestor of selfId, walking `parent` up (cycle-guarded the same way).
  const ancestors = new Set<string>();
  {
    const seen = new Set([selfId]);
    let cursor = byId.get(selfId)?.parent;
    while (cursor !== undefined && !seen.has(cursor)) {
      ancestors.add(cursor);
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent;
    }
  }

  const directParent = byId.get(selfId)?.parent;
  const directChildren = new Set(childrenOf.get(selfId) ?? []);

  return members.map((m): RosterEntry => {
    const relation: RosterRelation =
      m.id === selfId
        ? 'self'
        : m.id === directParent
          ? 'parent'
          : directChildren.has(m.id)
            ? 'child'
            : ancestors.has(m.id)
              ? 'ancestor'
              : descendants.has(m.id)
                ? 'descendant'
                : 'other';
    const live = liveState(m.id);
    const end = lastEnd(m.id);
    const confidence: 'observed' | 'advisory' =
      live !== 'not-registered' ? 'observed' : end !== undefined ? 'observed' : 'advisory';
    return {
      sessionId: m.id,
      agentRef: m.agentRef,
      relation,
      live,
      confidence,
      ...(end !== undefined ? { endReason: end.reason } : {}),
    };
  });
}
