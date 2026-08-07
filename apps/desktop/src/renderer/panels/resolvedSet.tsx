import { cx } from '@coa/console-kit';
import type { AgentSummary, PackageSummary, RoleSummary } from '@coa/console-viewmodel';

/**
 * One row grammar for anything the resolver assembles (roles, packages, and later the
 * declaration plane's own sets). App-level, not a kit member — same precedent as
 * `fields.tsx`: it earns a shared module the moment a second surface needs it (Tasks 4,
 * 6, 7), not before.
 */

type PackagePatch = Partial<Pick<AgentSummary, 'packageIds' | 'exclude'>>;

/**
 * The packages an agent currently includes: the `default` packages + the UNION of
 * every selected role's opt-ins + the user's added opt-ins, minus the user's
 * exclusions. Mirrors the daemon-side resolver so the picker shows exactly what the backend
 * would assemble.
 */
export function includedPackageIds(
  packages: PackageSummary[],
  roles: RoleSummary[],
  agent: Pick<AgentSummary, 'packageIds' | 'exclude'>,
): Set<string> {
  const excluded = new Set(agent.exclude ?? []);
  const base = new Set<string>();
  for (const p of packages) if (p.inclusion === 'default') base.add(p.id);
  for (const role of roles) for (const id of role.packageIds ?? []) base.add(id);
  for (const id of agent.packageIds ?? []) base.add(id);
  return new Set([...base].filter((id) => !excluded.has(id)));
}

/** The advised-but-absent packages — coa's nudge list (a hint, never a block). */
export function packageAdvisories(
  packages: PackageSummary[],
  included: ReadonlySet<string>,
): PackageSummary[] {
  return packages.filter((p) => p.advise === true && !included.has(p.id));
}

/**
 * The patch toggling one package on/off, respecting how it entered the set: a
 * purely user-added opt-in leaves via `packageIds`; anything a default or any
 * selected role brings in must be actively excluded (and re-including it clears
 * that exclusion).
 */
export function togglePackage(
  packages: PackageSummary[],
  roles: RoleSummary[],
  agent: Pick<AgentSummary, 'packageIds' | 'exclude'>,
  id: string,
): PackagePatch {
  const packageIds = agent.packageIds ?? [];
  const exclude = agent.exclude ?? [];
  const isDefault = packages.some((p) => p.id === id && p.inclusion === 'default');
  const fromRole = roles.some((role) => (role.packageIds ?? []).includes(id));
  if (includedPackageIds(packages, roles, agent).has(id)) {
    if (!isDefault && !fromRole) return { packageIds: packageIds.filter((p) => p !== id) };
    return { exclude: [...exclude, id] };
  }
  if (exclude.includes(id)) return { exclude: exclude.filter((p) => p !== id) };
  return { packageIds: [...packageIds, id] };
}

/**
 * The declared reach: the tool and MCP grants of every INCLUDED package, unioned.
 * Mirrors `assembleAgent`'s own union (`packages/core/src/session/assemble-agent.ts`,
 * `dedupe(included.flatMap(...))`) — the frame the Claude adapter renders straight to
 * `allowedTools` — so this is what the agent can actually reach, not a decorative
 * summary. Deduped while preserving first-seen order, so the list reads stably rather
 * than reshuffling as packages toggle.
 */
export function reachOf(
  packages: PackageSummary[],
  included: ReadonlySet<string>,
): { tools: string[]; mcp: string[] } {
  const chosen = packages.filter((p) => included.has(p.id));
  return {
    tools: [...new Set(chosen.flatMap((p) => p.toolRefs))],
    mcp: [...new Set(chosen.flatMap((p) => p.mcpServers ?? []))],
  };
}

export type Membership = 'added' | 'inherited' | 'available' | 'excluded';

/** How an id got into (or out of) the resolved set. `excluded` is the state today's flat
 *  checkboxes erase: a default or role-supplied item the user actively turned off reads
 *  identically to one they never wanted, which is the confusion this vocabulary removes. */
export function packageMembership(
  packages: PackageSummary[],
  roles: RoleSummary[],
  agent: Pick<AgentSummary, 'packageIds' | 'exclude'>,
  id: string,
): Membership {
  const included = includedPackageIds(packages, roles, agent);
  if (included.has(id)) return (agent.packageIds ?? []).includes(id) ? 'added' : 'inherited';
  return (agent.exclude ?? []).includes(id) ? 'excluded' : 'available';
}

/** The provenance a row's meta column shows: the name of the role that brought the
 *  package, `'default'` when it needs no role (a default package), or nothing when the
 *  package sits on the set only because the user opted it in themselves. */
export function membershipSource(
  packages: PackageSummary[],
  roles: RoleSummary[],
  id: string,
): string | undefined {
  const role = roles.find((r) => (r.packageIds ?? []).includes(id));
  if (role !== undefined) return role.name;
  const pkg = packages.find((p) => p.id === id);
  return pkg?.inclusion === 'default' ? 'default' : undefined;
}

/** The decorative indicator: a filled check for `added`, a dash for `inherited` (the
 *  "mixed" read — present, but not because you asked), a quiet × for `excluded`, and
 *  a fully empty box for `available` — the one state with nothing drawn in it. The
 *  headline claim of this vocabulary is that turning something off reads differently
 *  from never having wanted it; before this mark the row's strikethrough carried that
 *  alone, and `excluded`/`available` drew the identical (invisible) box. `excluded`
 *  stays in the same quiet family as `available` — an unfilled box, no background —
 *  it just stops hiding its own glyph behind `text-transparent`. Purely
 *  presentational — `SetRow` carries the real semantics. */
export function SetBox({ membership }: { membership: Membership }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cx(
        'flex h-3.5 w-3.5 flex-none items-center justify-center rounded-r1 border font-mono text-caps leading-none',
        membership === 'added' && 'border-s10 bg-s10 text-s1',
        membership === 'inherited' && 'border-s7 bg-s7 text-s2',
        membership === 'excluded' && 'border-s6 text-s7',
        membership === 'available' && 'border-s5 text-transparent',
      )}
    >
      {membership === 'added' && '✓'}
      {membership === 'inherited' && '–'}
      {membership === 'excluded' && '×'}
    </span>
  );
}

export interface SetRowProps {
  name: string;
  description?: string;
  membership: Membership;
  /** Trailing-edge text — typically `membershipSource`'s answer ("default", a role
   *  name) or an explanation of a past state (e.g. "was default"). */
  meta?: string;
  onToggle: () => void;
}

/** A real tri-state checkbox for one resolved-set row: `aria-checked` is `true` once
 *  the user has added it, `mixed` when something else (a default, a role) brings it in,
 *  `false` otherwise. `added`/`inherited` rows sit on the s3 ground so an included item
 *  reads as included at a glance; `excluded` strikes the name; `available` stays quiet.
 *  The accessible name is the visible name, set directly via `aria-label` so the
 *  description/meta text riding alongside it never leaks into the name. */
export function SetRow({
  name,
  description,
  membership,
  meta,
  onToggle,
}: SetRowProps): React.JSX.Element {
  const included = membership === 'added' || membership === 'inherited';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={membership === 'added' ? true : membership === 'inherited' ? 'mixed' : false}
      aria-label={name}
      onClick={onToggle}
      className={cx(
        'slip slip-press flex w-full cursor-pointer items-center gap-2.5 rounded-r2 px-2.5 py-1.5 text-left active:scale-[0.97]',
        included ? 'bg-s3 hover:bg-s4' : 'hover:bg-s3',
      )}
    >
      <SetBox membership={membership} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span
          className={cx(
            'truncate text-sec',
            membership === 'excluded'
              ? 'text-s7 line-through'
              : membership === 'available'
                ? 'text-s9'
                : 'text-s11',
          )}
        >
          {name}
        </span>
        {description !== undefined && (
          <span className="truncate text-meta text-s7">{description}</span>
        )}
      </span>
      {meta !== undefined && (
        <span className="flex-none truncate pl-2 font-mono text-meta text-s7">{meta}</span>
      )}
    </button>
  );
}
