import { describe, expect, it } from 'vitest';
import { groupSessionTree, sessionGroupFor, withAncestors } from './session-tree.js';
import type { SessionSummary } from './agents.js';

/** Minimal session fixture — only the fields `groupSessionTree` reads. */
function s(id: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return { id, agentRef: 'roles/dev', title: id, updatedAt: '2026-08-01T00:00:00Z', ...extra };
}

describe('groupSessionTree', () => {
  it('nests two children under their root and never absorbs an unrelated root — the mixed fixture', () => {
    // A single-item fixture is exactly what let the previous stage's grouping bug hide
    // through eight reviews: with one child it trivially becomes [0]. Two children plus a
    // second, wholly unrelated root is the minimum shape that can distinguish "groups
    // correctly" from "flattens everything" or "merges every root into one bucket".
    const root = s('root');
    const child1 = s('c1', { parent: 'root', root: 'root' });
    const child2 = s('c2', { parent: 'root', root: 'root' });
    const otherRoot = s('other');

    const groups = groupSessionTree([root, child1, child2, otherRoot]);

    expect(groups).toHaveLength(2);
    const rootGroup = groups.find((g) => g.header.id === 'root');
    expect(rootGroup?.rows.map((r) => [r.session.id, r.depth])).toEqual([
      ['c1', 1],
      ['c2', 1],
    ]);
    const otherGroup = groups.find((g) => g.header.id === 'other');
    expect(otherGroup?.rows).toEqual([]);
  });

  it('nests a grandchild two levels deep — a one-level tree cannot prove this', () => {
    const root = s('root');
    const child = s('c1', { parent: 'root', root: 'root' });
    const grandchild = s('g1', { parent: 'c1', root: 'root' });

    const groups = groupSessionTree([root, child, grandchild]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows.map((r) => [r.session.id, r.depth])).toEqual([
      ['c1', 1],
      ['g1', 2],
    ]);
  });

  it('sums the whole tree, not the root’s own spend — a root that spends LESS than its descendants', () => {
    const root = s('root', { costUsd: 1 });
    const child1 = s('c1', { parent: 'root', root: 'root', costUsd: 10 });
    const child2 = s('c2', { parent: 'root', root: 'root', costUsd: 5 });

    const [group] = groupSessionTree([root, child1, child2]);

    expect(group?.costUsd).toBe(16);
    expect(group?.costUsd).not.toBe(root.costUsd);
  });

  it('floors to "not tracked" only when NOTHING in the tree carries a cost', () => {
    const root = s('root');
    const child = s('c1', { parent: 'root', root: 'root' });
    const [group] = groupSessionTree([root, child]);
    expect(group?.costUsd).toBeUndefined();
  });

  it('treats an untracked member as 0 once anything in the tree is tracked', () => {
    const root = s('root', { costUsd: 2 });
    const child = s('c1', { parent: 'root', root: 'root' }); // no costUsd yet
    const [group] = groupSessionTree([root, child]);
    expect(group?.costUsd).toBe(2);
  });

  describe('hostile lineage — default-nest, not default-leak', () => {
    it('a child whose parent id is not in the data still nests under its stored root', () => {
      const root = s('root');
      const orphanParent = s('x1', { parent: 'ghost-parent', root: 'root' });
      const groups = groupSessionTree([root, orphanParent]);

      expect(groups).toHaveLength(1);
      expect(groups[0]?.header.id).toBe('root');
      expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['x1']);
    });

    it('a child whose root points at a session that does not exist becomes its own group, deliberately — not a leak into an unrelated tree', () => {
      const root = s('root');
      const child = s('c1', { parent: 'root', root: 'root' });
      const unresolvable = s('y1', { parent: 'ghost-parent', root: 'ghost-root' });
      const groups = groupSessionTree([root, child, unresolvable]);

      expect(groups).toHaveLength(2);
      const rootGroup = groups.find((g) => g.header.id === 'root');
      expect(rootGroup?.rows.map((r) => r.session.id)).toEqual(['c1']); // never absorbed 'y1'
      const orphanGroup = groups.find((g) => g.header.id === 'y1');
      expect(orphanGroup?.rows).toEqual([]);
    });

    it('a parent cycle terminates and both members land under their shared real root exactly once', () => {
      const root = s('root');
      // A.parent = B, B.parent = A — neither is reachable from `root` by construction,
      // but both carry the real root id, which is what a broken/cyclic parent chain
      // cannot corrupt (root is stored, not walked).
      const a = s('a', { parent: 'b', root: 'root' });
      const b = s('b', { parent: 'a', root: 'root' });

      const groups = groupSessionTree([root, a, b]);

      expect(groups).toHaveLength(1);
      const ids = groups[0]?.rows.map((r) => r.session.id).sort();
      expect(ids).toEqual(['a', 'b']);
    });

    it('a session that is its own parent does not loop or leak — it nests via its stored root', () => {
      const root = s('root');
      const selfParent = s('z1', { parent: 'z1', root: 'root' });
      const groups = groupSessionTree([root, selfParent]);

      expect(groups).toHaveLength(1);
      expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['z1']);
    });

    it('a session with parent set but root absent nests fine when the parent itself resolves', () => {
      const root = s('root');
      const child = s('c1', { parent: 'root' }); // root omitted — the invariant violation
      const groups = groupSessionTree([root, child]);

      expect(groups).toHaveLength(1);
      expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['c1']);
    });

    it('a session with parent set but root absent AND an unresolvable parent renders as its own group rather than leaking flat among real roots', () => {
      const root = s('root');
      const child = s('c1', { parent: 'root', root: 'root' });
      const totallyLost = s('w1', { parent: 'ghost' }); // no root at all, parent unresolvable
      const groups = groupSessionTree([root, child, totallyLost]);

      expect(groups).toHaveLength(2);
      const rootGroup = groups.find((g) => g.header.id === 'root');
      expect(rootGroup?.rows.map((r) => r.session.id)).toEqual(['c1']);
      const lostGroup = groups.find((g) => g.header.id === 'w1');
      expect(lostGroup).toBeDefined();
    });

    it('every session in a mixed hostile batch is accounted for exactly once — total classification', () => {
      const root = s('root');
      const child = s('c1', { parent: 'root', root: 'root' });
      const grandchild = s('g1', { parent: 'c1', root: 'root' });
      const otherRoot = s('other');
      const orphanParent = s('x1', { parent: 'ghost', root: 'root' });
      const unresolvable = s('y1', { parent: 'ghost', root: 'ghost-root' });
      const a = s('a', { parent: 'b', root: 'root' });
      const b = s('b', { parent: 'a', root: 'root' });
      const selfParent = s('z1', { parent: 'z1', root: 'root' });
      const noRoot = s('w1', { parent: 'root' });
      const allSessions = [
        root,
        child,
        grandchild,
        otherRoot,
        orphanParent,
        unresolvable,
        a,
        b,
        selfParent,
        noRoot,
      ];

      const groups = groupSessionTree(allSessions);
      const rendered = groups.flatMap((g) => [g.header, ...g.rows.map((r) => r.session)]);

      // Every session renders, none twice, none dropped.
      expect(rendered.map((x) => x.id).sort()).toEqual(allSessions.map((x) => x.id).sort());
      // Every row that is NOT a group's header nests at depth >= 1 — nothing that
      // structurally IS a child (has a `parent`) can appear un-indented.
      for (const g of groups) {
        for (const row of g.rows) expect(row.depth).toBeGreaterThanOrEqual(1);
      }
    });
  });

  it('is a total no-op (byte-identical) for a flat list with no lineage at all', () => {
    const a = s('a');
    const b = s('b');
    const groups = groupSessionTree([a, b]);
    expect(groups).toEqual([
      { header: a, rows: [], costUsd: undefined },
      { header: b, rows: [], costUsd: undefined },
    ]);
  });
});

describe('sessionGroupFor', () => {
  it('finds the tree a nested member belongs to, not just a header match', () => {
    const root = s('root');
    const child = s('c1', { parent: 'root', root: 'root' });
    const groups = groupSessionTree([root, child]);
    expect(sessionGroupFor(groups, 'c1')?.header.id).toBe('root');
    expect(sessionGroupFor(groups, 'root')?.header.id).toBe('root');
    expect(sessionGroupFor(groups, 'nope')).toBeUndefined();
  });
});

describe('withAncestors', () => {
  it('pulls a matched child’s parent back in even though the parent itself was filtered out', () => {
    const root = s('root');
    const child = s('c1', { parent: 'root', root: 'root' });
    const unrelated = s('other'); // present in the full data, NOT matched
    // Only the child matched the query — a search-filtered `hits` list.
    const withParent = withAncestors([root, child, unrelated], [child]);
    expect(withParent.map((x) => x.id).sort()).toEqual(['c1', 'root']); // never 'other'
    // Feeding it into groupSessionTree now finds the real root, not a singleton.
    const groups = groupSessionTree(withParent);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.header.id).toBe('root');
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['c1']);
  });

  it('resolves the WHOLE ancestor chain, not just the immediate parent — a matched grandchild whose parent AND grandparent both fail the query', () => {
    // A one-level case (parent only) can't distinguish "pulls the immediate parent"
    // from "resolves the whole chain" — this is the two-level case that can.
    const root = s('root');
    const child = s('c1', { parent: 'root', root: 'root' });
    const grandchild = s('g1', { parent: 'c1', root: 'root' });
    // Only the grandchild matched; neither 'root' nor 'c1' is in the matched set.
    const pulled = withAncestors([root, child, grandchild], [grandchild]);
    expect(pulled.map((x) => x.id).sort()).toEqual(['c1', 'g1', 'root']);

    const groups = groupSessionTree(pulled);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.header.id).toBe('root');
    expect(groups[0]?.rows.map((r) => [r.session.id, r.depth])).toEqual([
      ['c1', 1],
      ['g1', 2],
    ]);
  });

  it('falls back to the stored root when a mid-chain parent link is broken — a deleted mid-tree session, mirroring groupSessionTree’s own pass 2', () => {
    // A grandchild whose immediate parent was deleted (a real, supported action —
    // Browser.tsx's `remove()`), but whose `root` still names a session present in
    // the full data set. The parent walk alone dead-ends at the deleted id; without
    // the root fallback the grandchild is left out entirely and falls through to
    // groupSessionTree's pass-3 floor, rendering as its own apparent root — the
    // exact asymmetry a no-search render of the SAME data doesn't have, because
    // groupSessionTree's own pass 2 already recovers via root there.
    const root = s('root');
    // 'deleted-mid' is intentionally NOT in allSessions — it once existed, isn't now.
    const grandchild = s('g1', { parent: 'deleted-mid', root: 'root' });
    const pulled = withAncestors([root, grandchild], [grandchild]);
    expect(pulled.map((x) => x.id).sort()).toEqual(['g1', 'root']);

    const groups = groupSessionTree(pulled);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.header.id).toBe('root');
    expect(groups[0]?.rows.map((r) => r.session.id)).toEqual(['g1']);
  });

  it('stops at a broken or cyclic link rather than looping — never throws, never hangs', () => {
    const selfParent = s('z1', { parent: 'z1' }); // its own parent, never resolves further
    const ghostParent = s('x1', { parent: 'ghost-parent' }); // parent id not in the data
    const pulled = withAncestors([selfParent, ghostParent], [selfParent, ghostParent]);
    expect(pulled.map((x) => x.id).sort()).toEqual(['x1', 'z1']); // no phantom rows added
  });

  it('is a no-op when every ancestor is already present (the ordinary empty-query case)', () => {
    const root = s('root');
    const child = s('c1', { parent: 'root', root: 'root' });
    expect(withAncestors([root, child], [root, child])).toEqual([root, child]);
  });

  it('recovers via the MATCHED session’s own root, not a walk pointer’s — a break past the first hop with an intermediate that has no .root at all', () => {
    // root (no parent) <- mid1 (parent: dead grandparent id, and — critically —
    // NO .root field of its own) <- ggc (parent: mid1, root: 'root', resolvable).
    // The parent walk climbs ggc -> mid1 cleanly (one hop), THEN breaks on mid1's
    // dead parent. A fallback that reads the WALK POINTER's root at the break
    // (mid1.root, which is undefined) silently no-ops and leaves ggc unresolved —
    // ggc's own perfectly valid root: 'root' is never consulted. Only reading the
    // originally-matched session's (ggc's) own root closes this.
    const root = s('root');
    const mid1 = s('mid1', { parent: 'deleted-grandparent' }); // no .root at all
    const ggc = s('ggc', { parent: 'mid1', root: 'root' });
    const allSessions = [root, mid1, ggc];

    const pulled = withAncestors(allSessions, [ggc]);
    const searchedGroups = groupSessionTree(pulled);
    const noSearchGroups = groupSessionTree(allSessions);

    // Same data, no query at all: ggc nests under root.
    expect(sessionGroupFor(noSearchGroups, 'ggc')?.header.id).toBe('root');
    // Same data, searched for ggc alone: must nest identically, not leak as a root.
    expect(sessionGroupFor(searchedGroups, 'ggc')?.header.id).toBe('root');
    expect(searchedGroups.find((g) => g.header.id === 'ggc')).toBeUndefined();
  });

  describe('property: search-filtered grouping never differs from the unfiltered grouping', () => {
    /** A parent chain root -> n1 -> n2 -> ... -> n(depth). Only the DEEPEST node
     *  (the one always searched for below) carries a `.root` denormalized to the
     *  true root — every intermediate node has NO `.root` field at all, mirroring
     *  a record written before that field existed. This is what actually
     *  distinguishes "recover via the matched session's own root" from "recover
     *  via whichever node the walk happens to be standing on": if intermediates
     *  carried a correct root too, a walk-pointer read would coincidentally find
     *  the right answer and the property would pass either way. `missing` is a
     *  set of 1-based chain positions to omit from `allSessions` entirely,
     *  simulating deleted mid-tree sessions: any node whose `parent` named a
     *  missing position now has a broken link, exactly like a real delete leaves
     *  behind. The chain's own root (position 0) is never removed. */
    function chain(depth: number, missing: readonly number[]): SessionSummary[] {
      const root = s('n0');
      const nodes: SessionSummary[] = [root];
      for (let i = 1; i <= depth; i++) {
        const extra = i === depth ? { parent: `n${i - 1}`, root: 'n0' } : { parent: `n${i - 1}` };
        nodes.push(s(`n${i}`, extra));
      }
      const missingSet = new Set(missing);
      return nodes.filter((_, i) => !missingSet.has(i));
    }

    for (let depth = 2; depth <= 6; depth++) {
      for (let breakAt = 0; breakAt < depth; breakAt++) {
        const missing = breakAt === 0 ? [] : [breakAt];
        it(`depth ${depth}, break at position ${breakAt || 'none'} — deepest node nests identically searched vs. unsearched`, () => {
          const allSessions = chain(depth, missing);
          const deepest = allSessions[allSessions.length - 1]!;
          expect(deepest.id).toBe(`n${depth}`); // never itself the removed node

          const noSearchGroups = groupSessionTree(allSessions);
          const searchedGroups = groupSessionTree(withAncestors(allSessions, [deepest]));

          const noSearchHeader = sessionGroupFor(noSearchGroups, deepest.id)?.header.id;
          const searchedHeader = sessionGroupFor(searchedGroups, deepest.id)?.header.id;

          // The chain's real root ('n0') is never removed, so a resolvable
          // ancestor always exists — the deepest node must never render as an
          // apparent root of its own under search, and the two paths must agree.
          expect(searchedHeader).toBe('n0');
          expect(searchedHeader).toBe(noSearchHeader);
          expect(searchedGroups.find((g) => g.header.id === deepest.id)).toBeUndefined();
        });
      }
    }

    it('multiple non-adjacent breaks in one long chain still resolve to the shared root, searched or not', () => {
      const allSessions = chain(8, [2, 5]);
      const deepest = allSessions[allSessions.length - 1]!;

      const noSearchGroups = groupSessionTree(allSessions);
      const searchedGroups = groupSessionTree(withAncestors(allSessions, [deepest]));

      expect(sessionGroupFor(noSearchGroups, deepest.id)?.header.id).toBe('n0');
      expect(sessionGroupFor(searchedGroups, deepest.id)?.header.id).toBe('n0');
      expect(searchedGroups.find((g) => g.header.id === deepest.id)).toBeUndefined();
    });
  });
});
