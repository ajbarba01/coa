import type { SessionSummary } from './agents.js';

/** One nested row under a tree's header — depth 1 for a direct child, 2 for a
 *  grandchild, and so on. Never the header itself (that lives on the group). */
export interface SessionTreeRow {
  session: SessionSummary;
  depth: number;
}

/** One family tree, rendered as a header plus its nested descendants. */
export interface SessionTreeGroup {
  /** The group's top row — a true root (no `parent`), or, for lineage the data
   *  cannot resolve, the orphan itself standing in for its own tree (see
   *  {@link groupSessionTree}'s doc). */
  header: SessionSummary;
  /** Every session below the header, indent-ordered (depth >= 1). */
  rows: SessionTreeRow[];
  /** Sum of `costUsd` over the header + every row, treating an untracked member
   *  as 0 once anything in the tree carries a cost; `undefined` only when NOTHING
   *  in the tree is tracked yet (the "not tracked yet" floor). */
  costUsd: number | undefined;
}

/**
 * Group a flat session list into one row per family tree — default-nest, not
 * default-leak: EVERY session ends up inside exactly one group, nested under its
 * header unless it IS one, so a grouping gap can never surface a child as an
 * indistinguishable extra top-level row.
 *
 * Three passes, each a considered fallback for the one before:
 *
 * 1. Every session with no `parent` is a group header (a person-started root —
 *    the overwhelming common case). Its descendants are found by walking
 *    `.parent` links down from it, guarded by a visited set so a cycle or a
 *    self-referential `parent` can't loop the walk (mirrors
 *    `core/session/lineage.ts`'s `descendantsOf`, reimplemented here since the
 *    renderer cannot import `@coa/core`).
 * 2. A session the parent walk never reaches — a broken or missing `parent`
 *    link — falls back to its stored `.root`: if that names a header pass 1
 *    already placed, it attaches directly underneath (depth 1). This is what
 *    the denormalized `root` (Task 7) is FOR — a parent chain can go missing or
 *    cyclic, but the stored root cannot, so a mid-chain gap doesn't cost a
 *    session its tree.
 * 3. Anything still unplaced has nothing in the data naming a real tree — its
 *    `root` is absent, or points nowhere pass 1 placed. It becomes its own
 *    singleton group. That is a deliberate floor for corrupt/hostile lineage,
 *    not an accidental leak: the alternatives (dropping the session, or
 *    guessing a tree to attach it to) are both worse than showing it plainly.
 */
export function groupSessionTree(sessions: readonly SessionSummary[]): SessionTreeGroup[] {
  const childrenOf = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    if (session.parent === undefined) continue;
    const siblings = childrenOf.get(session.parent);
    if (siblings) siblings.push(session);
    else childrenOf.set(session.parent, [session]);
  }

  const placed = new Set<string>();
  const groups: SessionTreeGroup[] = [];

  // Pass 1: true roots + their parent-linked descendants (cycle-safe).
  for (const header of sessions) {
    if (header.parent !== undefined) continue;
    placed.add(header.id);
    const rows: SessionTreeRow[] = [];
    // An explicit stack, not recursion: spawn depth is unbounded by design
    // (the cost cap is the only fan-out bound, not a depth counter), so a long enough
    // linear chain overflows the call stack and takes the whole panel down with
    // an uncaught RangeError. Children are pushed in reverse so popping still
    // yields depth-first pre-order, i.e. the same row order recursion produced.
    const stack: SessionTreeRow[] = [];
    const pushChildren = (id: string, depth: number): void => {
      for (const child of [...(childrenOf.get(id) ?? [])].reverse())
        stack.push({ session: child, depth });
    };
    pushChildren(header.id, 1);
    while (stack.length > 0) {
      const row = stack.pop();
      if (row === undefined) break;
      if (placed.has(row.session.id)) continue; // cycle / self-parent guard
      placed.add(row.session.id);
      rows.push(row);
      pushChildren(row.session.id, row.depth + 1);
    }
    groups.push({ header, rows, costUsd: sumCost([header, ...rows.map((r) => r.session)]) });
  }

  // Pass 2: a broken parent link still finds its tree via the stored root.
  for (const session of sessions) {
    if (placed.has(session.id)) continue;
    const group = session.root === undefined ? undefined : findGroup(groups, session.root);
    if (group === undefined) continue;
    placed.add(session.id);
    group.rows.push({ session, depth: 1 });
    group.costUsd = sumCost([group.header, ...group.rows.map((r) => r.session)]);
  }

  // Pass 3: nothing in the data names this session's tree — render it plainly,
  // as its own group, rather than drop it or guess where it belongs.
  for (const session of sessions) {
    if (placed.has(session.id)) continue;
    placed.add(session.id);
    groups.push({ header: session, rows: [], costUsd: sumCost([session]) });
  }

  return groups;
}

function findGroup(
  groups: readonly SessionTreeGroup[],
  headerId: string,
): SessionTreeGroup | undefined {
  return groups.find((g) => g.header.id === headerId);
}

function sumCost(sessions: readonly SessionSummary[]): number | undefined {
  const tracked = sessions.filter((s) => s.costUsd !== undefined);
  if (tracked.length === 0) return undefined;
  return tracked.reduce((total, s) => total + (s.costUsd ?? 0), 0);
}

/** The group containing `sessionId`, wherever in its tree it sits (header or a
 *  nested row) — what a session's own tab needs to find its tree's roll-up,
 *  since a person can open any member's tab, not just the root's. */
export function sessionGroupFor(
  groups: readonly SessionTreeGroup[],
  sessionId: string,
): SessionTreeGroup | undefined {
  return groups.find(
    (g) => g.header.id === sessionId || g.rows.some((r) => r.session.id === sessionId),
  );
}

/**
 * `matched` plus each session's whole ancestor chain, pulled in from
 * `allSessions` when missing — what a FILTERED list (a search's `hits`) needs
 * before `groupSessionTree`, so a matched child whose parent's own title
 * didn't match the query still finds its real header instead of falling
 * through to `groupSessionTree`'s pass-3 floor and rendering as an apparent,
 * unrelated root. Walks the FULL chain (not just the immediate parent) —
 * resolving only one level can't tell a matched grandchild whose parent AND
 * grandparent both missed the query apart from one whose parent alone did.
 *
 * Mirrors `groupSessionTree`'s own two-pass recovery: when the `parent` walk
 * hits a broken link (a deleted mid-tree session, e.g.), it falls back to the
 * stopping session's stored `.root` before giving up — the same denormalized
 * root that lets `groupSessionTree` recover a broken chain without walking
 * it. Skipping that fallback here would leave the identical class of gap this
 * function exists to close: the same data nesting correctly with no search
 * and leaking under one.
 *
 * Cycle/broken-link safe per chain (a visited set, same guard as
 * `groupSessionTree`'s own walk — no depth cap, since this system
 * deliberately has none): an unresolvable or self-referential parent stops
 * the climb (after the root fallback) rather than looping or throwing. A
 * no-op when every ancestor is already present — the ordinary empty-query
 * case, where `matched` already IS the full list.
 */
export function withAncestors(
  allSessions: readonly SessionSummary[],
  matched: readonly SessionSummary[],
): SessionSummary[] {
  const byId = new Map(allSessions.map((s) => [s.id, s] as const));
  const present = new Set(matched.map((s) => s.id));
  const pulled: SessionSummary[] = [];
  const pull = (candidate: SessionSummary): void => {
    if (present.has(candidate.id)) return;
    present.add(candidate.id);
    pulled.push(candidate);
  };
  for (const session of matched) {
    const seen = new Set<string>([session.id]);
    let current = session;
    while (current.parent !== undefined) {
      const parent = byId.get(current.parent);
      if (parent === undefined || seen.has(parent.id)) {
        // The chain broke (missing) or looped (cyclic) before reaching a true
        // root — try the stored root once, exactly as `groupSessionTree`'s
        // pass 2 would. That fallback reads the ORIGINALLY-MATCHED session's
        // own `.root` (`session`, not the walk pointer `current`): `root`
        // denormalizes straight to the tree's true top for every session that
        // has it, so `session.root` already names the same answer regardless
        // of how many hops separate `session` from where the walk broke. An
        // intermediate node the walk happens to be standing on at the break
        // may have no `.root` of its own at all (fields added later, or never
        // backfilled) — reading THAT would silently no-op even though the
        // session we actually need to place is fully resolvable.
        const root = session.root === undefined ? undefined : byId.get(session.root);
        if (root !== undefined) pull(root);
        break;
      }
      seen.add(parent.id);
      pull(parent);
      current = parent;
    }
  }
  return pulled.length === 0 ? [...matched] : [...matched, ...pulled];
}
