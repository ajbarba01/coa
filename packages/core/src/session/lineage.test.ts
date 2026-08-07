import { describe, expect, it } from 'vitest';
import { descendantsOf } from './lineage.js';

describe('descendantsOf', () => {
  // Three levels, two branches under root-1, plus an unrelated second tree.
  // `root` is carried too (as a real LiveSession would) to prove the bug is in
  // the walk direction, not a missing field.
  const sessions = [
    { id: 'root-1', parent: undefined, root: 'root-1' },
    { id: 'kid-a', parent: 'root-1', root: 'root-1' },
    { id: 'kid-b', parent: 'root-1', root: 'root-1' },
    { id: 'grandkid', parent: 'kid-a', root: 'root-1' },
    { id: 'root-2', parent: undefined, root: 'root-2' },
    { id: 'other-kid', parent: 'root-2', root: 'root-2' },
  ];

  it('returns every session under the root, at every depth, except the root itself', () => {
    expect(descendantsOf('root-1', sessions).sort()).toEqual(['grandkid', 'kid-a', 'kid-b']);
  });

  it('returns everything beneath an INTERMEDIATE node, not just leaves directly under it', () => {
    expect(descendantsOf('kid-a', sessions)).toEqual(['grandkid']);
  });

  it('returns nothing for a leaf', () => {
    expect(descendantsOf('grandkid', sessions)).toEqual([]);
  });

  it('does not cross into an unrelated tree', () => {
    expect(descendantsOf('root-2', sessions)).toEqual(['other-kid']);
  });

  it('returns nothing for a root with no children', () => {
    expect(descendantsOf('root-1', [{ id: 'root-1', parent: undefined, root: 'root-1' }])).toEqual(
      [],
    );
  });

  it('returns nothing for an id that appears in no session (unknown id)', () => {
    expect(descendantsOf('nonexistent', sessions)).toEqual([]);
  });

  it('terminates on a cycle in the parent links instead of hanging', () => {
    const cyclic = [
      { id: 'a', parent: 'c' },
      { id: 'b', parent: 'a' },
      { id: 'c', parent: 'b' },
    ];
    expect(descendantsOf('a', cyclic).sort()).toEqual(['b', 'c']);
  }, 2000);

  it('terminates on a self-parented session instead of hanging', () => {
    expect(descendantsOf('a', [{ id: 'a', parent: 'a' }])).toEqual([]);
  }, 2000);
});
