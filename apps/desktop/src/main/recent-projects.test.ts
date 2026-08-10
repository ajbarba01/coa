import { describe, expect, it } from 'vitest';
import { recordRecentProject } from './recent-projects.js';
import type { RecentProject } from '../shared/projects.js';

const canon = (root: string): string => root.toLowerCase();

const entry = (root: string, lastOpenedAt: number): RecentProject => ({
  root,
  name: root.split('\\').at(-1) ?? root,
  lastOpenedAt,
});

describe('recordRecentProject', () => {
  it('adds a brand-new project to the front', () => {
    const out = recordRecentProject([], entry('C:\\repos\\alpha', 1), canon);
    expect(out).toEqual([entry('C:\\repos\\alpha', 1)]);
  });

  it('moves an existing project to the front instead of duplicating it', () => {
    const alpha1 = entry('C:\\repos\\alpha', 1);
    const beta = entry('C:\\repos\\beta', 2);
    const alpha2 = entry('C:\\repos\\alpha', 3);
    const out = recordRecentProject([beta, alpha1], alpha2, canon);
    expect(out).toEqual([alpha2, beta]);
  });

  it('dedupes by canonical identity, not raw string equality', () => {
    const original = entry('C:\\Repos\\Alpha', 1);
    const reopened = entry('c:\\repos\\alpha', 2);
    const out = recordRecentProject([original], reopened, canon);
    expect(out).toEqual([reopened]);
  });

  it('caps the list at 20 entries, dropping the one at the back (oldest position)', () => {
    // Index 0 = most recent (recordRecentProject always conses onto the front), so a
    // properly-maintained list has its OLDEST entry at the back — index 19 here.
    const recent = Array.from({ length: 20 }, (_, i) => entry(`C:\\repos\\p${i}`, 19 - i));
    const fresh = entry('C:\\repos\\new', 100);
    const out = recordRecentProject(recent, fresh, canon);
    expect(out).toHaveLength(20);
    expect(out[0]).toEqual(fresh);
    expect(out.some((r) => r.root === 'C:\\repos\\p19')).toBe(false); // the back entry dropped
  });
});
