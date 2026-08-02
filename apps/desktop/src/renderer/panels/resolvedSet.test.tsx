// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentSummary, PackageSummary, RoleSummary } from '@coa/console-viewmodel';
import {
  SetRow,
  includedPackageIds,
  membershipSource,
  packageAdvisories,
  packageMembership,
  reachOf,
  togglePackage,
} from './resolvedSet.js';

export const PKGS: PackageSummary[] = [
  { id: 'core', name: 'Core', description: 'The floor.', inclusion: 'default', toolRefs: ['Read'] },
  { id: 'coding', name: 'Coding', description: 'Edits.', inclusion: 'opt-in', toolRefs: ['Edit'] },
  { id: 'research', name: 'Research', description: 'Search.', inclusion: 'opt-in', toolRefs: [] },
];
const ROLES: RoleSummary[] = [
  { id: 'swe', name: 'Software Engineer', description: 'Writes code.', packageIds: ['coding'] },
];
const agent = (p: Partial<AgentSummary>): Pick<AgentSummary, 'packageIds' | 'exclude'> => ({
  packageIds: p.packageIds ?? [],
  exclude: p.exclude ?? [],
});

describe('packageMembership', () => {
  it('calls a default inherited', () => {
    expect(packageMembership(PKGS, [], agent({}), 'core')).toBe('inherited');
  });

  it('calls a role-supplied package inherited', () => {
    expect(packageMembership(PKGS, ROLES, agent({}), 'coding')).toBe('inherited');
  });

  it('calls a user opt-in added', () => {
    expect(packageMembership(PKGS, [], agent({ packageIds: ['research'] }), 'research')).toBe(
      'added',
    );
  });

  it('calls an untouched opt-in available', () => {
    expect(packageMembership(PKGS, [], agent({}), 'research')).toBe('available');
  });

  it('calls a turned-off default excluded, not available', () => {
    expect(packageMembership(PKGS, [], agent({ exclude: ['core'] }), 'core')).toBe('excluded');
  });
});

describe('membershipSource', () => {
  it('names the role that brings a package', () => {
    expect(membershipSource(PKGS, ROLES, 'coding')).toBe('Software Engineer');
  });

  it('names a default as its own source', () => {
    expect(membershipSource(PKGS, ROLES, 'core')).toBe('default');
  });

  it('has no source for a package nothing brings', () => {
    expect(membershipSource(PKGS, ROLES, 'research')).toBeUndefined();
  });
});

describe('SetRow', () => {
  it('exposes membership through a checkbox a screen reader can read', () => {
    render(<SetRow name="Core" membership="inherited" meta="default" onToggle={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Core' });
    expect(box).toHaveAttribute('aria-checked', 'mixed');
  });

  it('reports an excluded row as unchecked and says so in its meta', () => {
    render(<SetRow name="Core" membership="excluded" meta="was default" onToggle={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Core' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('was default')).toBeInTheDocument();
  });

  it('toggles on click', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<SetRow name="Coding" membership="available" onToggle={onToggle} />);
    await user.click(screen.getByRole('checkbox', { name: 'Coding' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('draws a quiet mark for an excluded row — turning something off must not look like never having wanted it', () => {
    // Same name on both so only the box (the aria-hidden glyph SetRow leads with) can
    // account for a difference — `available` draws nothing (`text-transparent`, no
    // glyph); `excluded` used to match it exactly. It must not any more.
    const { container: excluded } = render(
      <SetRow name="Core" membership="excluded" onToggle={() => {}} />,
    );
    const { container: available } = render(
      <SetRow name="Core" membership="available" onToggle={() => {}} />,
    );
    const excludedBox = excluded.querySelector('[aria-hidden]');
    const availableBox = available.querySelector('[aria-hidden]');
    expect(excludedBox?.textContent).not.toBe('');
    expect(excludedBox?.textContent).not.toBe(availableBox?.textContent);
  });
});

describe('reachOf', () => {
  it('unions the tools of the included packages, deduped and stable', () => {
    const pkgs: PackageSummary[] = [
      { id: 'a', name: 'A', description: '', inclusion: 'default', toolRefs: ['Read', 'Grep'] },
      { id: 'b', name: 'B', description: '', inclusion: 'opt-in', toolRefs: ['Grep', 'Edit'] },
    ];
    expect(reachOf(pkgs, new Set(['a', 'b'])).tools).toEqual(['Read', 'Grep', 'Edit']);
  });

  it('ignores packages that are not included', () => {
    const pkgs: PackageSummary[] = [
      { id: 'a', name: 'A', description: '', inclusion: 'default', toolRefs: ['Read'] },
      { id: 'b', name: 'B', description: '', inclusion: 'opt-in', toolRefs: ['Bash'] },
    ];
    expect(reachOf(pkgs, new Set(['a'])).tools).toEqual(['Read']);
  });

  it('collects mcp servers where a package declares them', () => {
    const pkgs: PackageSummary[] = [
      {
        id: 'a',
        name: 'A',
        description: '',
        inclusion: 'opt-in',
        toolRefs: [],
        mcpServers: ['fs'],
      },
    ];
    expect(reachOf(pkgs, new Set(['a'])).mcp).toEqual(['fs']);
  });
});

/* -------- moved from AgentsPanel.test.tsx unchanged when the resolver moved here -------- */

const RESOLVE_ROLES: RoleSummary[] = [
  { id: 'swe', name: 'Software Engineer', description: '', packageIds: ['coding', 'planning'] },
  { id: 'researcher', name: 'Researcher', description: '', packageIds: ['research', 'planning'] },
];
const RESOLVE_PACKAGES: PackageSummary[] = [
  { id: 'core', name: 'Core', description: '', inclusion: 'default', advise: true, toolRefs: [] },
  {
    id: 'coa-orientation',
    name: 'coa orientation',
    description: '',
    inclusion: 'default',
    advise: true,
    toolRefs: [],
  },
  { id: 'coding', name: 'Coding', description: '', inclusion: 'opt-in', toolRefs: [] },
  { id: 'planning', name: 'Planning', description: '', inclusion: 'opt-in', toolRefs: [] },
  { id: 'research', name: 'Research', description: '', inclusion: 'opt-in', toolRefs: [] },
];
const resolveSwe = RESOLVE_ROLES[0]!;
const resolveResearcher = RESOLVE_ROLES[1]!;

describe('includedPackageIds', () => {
  it('unions the defaults with the role’s opt-ins', () => {
    const set = includedPackageIds(RESOLVE_PACKAGES, [resolveSwe], {});
    expect([...set].sort()).toEqual(['coa-orientation', 'coding', 'core', 'planning']);
  });

  it('adds the user’s extra opt-ins and drops the user’s exclusions', () => {
    const set = includedPackageIds(RESOLVE_PACKAGES, [resolveSwe], {
      packageIds: ['research'],
      exclude: ['core'],
    });
    expect(set.has('research')).toBe(true);
    expect(set.has('core')).toBe(false);
  });

  it('is defaults-only with no roles selected', () => {
    expect([...includedPackageIds(RESOLVE_PACKAGES, [], {})].sort()).toEqual([
      'coa-orientation',
      'core',
    ]);
  });

  it('unions every selected role’s opt-ins', () => {
    const set = includedPackageIds(RESOLVE_PACKAGES, [resolveSwe, resolveResearcher], {});
    expect([...set].sort()).toEqual(['coa-orientation', 'coding', 'core', 'planning', 'research']);
  });
});

describe('packageAdvisories', () => {
  it('reports advised packages that ended up absent (a nudge)', () => {
    const included = includedPackageIds(RESOLVE_PACKAGES, [resolveSwe], { exclude: ['core'] });
    expect(packageAdvisories(RESOLVE_PACKAGES, included).map((p) => p.id)).toEqual(['core']);
  });

  it('is empty when every advised package is present', () => {
    expect(
      packageAdvisories(RESOLVE_PACKAGES, includedPackageIds(RESOLVE_PACKAGES, [resolveSwe], {})),
    ).toEqual([]);
  });
});

describe('togglePackage', () => {
  it('excludes a default package that is currently included', () => {
    expect(togglePackage(RESOLVE_PACKAGES, [resolveSwe], {}, 'core')).toEqual({
      exclude: ['core'],
    });
  });

  it('excludes a role-supplied opt-in rather than fighting the role', () => {
    expect(togglePackage(RESOLVE_PACKAGES, [resolveSwe], {}, 'coding')).toEqual({
      exclude: ['coding'],
    });
  });

  it('adds a fresh opt-in via packageIds', () => {
    expect(togglePackage(RESOLVE_PACKAGES, [resolveSwe], {}, 'research')).toEqual({
      packageIds: ['research'],
    });
  });

  it('removes a user opt-in from packageIds when turned back off', () => {
    expect(
      togglePackage(RESOLVE_PACKAGES, [resolveSwe], { packageIds: ['research'] }, 'research'),
    ).toEqual({
      packageIds: [],
    });
  });

  it('re-includes an excluded package by clearing the exclusion', () => {
    expect(togglePackage(RESOLVE_PACKAGES, [resolveSwe], { exclude: ['core'] }, 'core')).toEqual({
      exclude: [],
    });
  });
});
