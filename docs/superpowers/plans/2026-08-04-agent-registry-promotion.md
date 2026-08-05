# Agent Registry Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the agent object from a console-local mock to a daemon-owned registry of reusable definitions, merged across built-in, personal and project scopes, with a required `description`.

**Architecture:** Definitions live one-per-file as YAML under `~/.coa/agents/` (personal) and `<repo>/.coa/agents/` (project); the filename stem is the `ref` and the directory is the `scope`, so neither is a field in the file. A loader reads one scope directory into definitions plus diagnostics; a merge folds built-in ∪ personal ∪ project with project winning. The daemon exposes read and write verbs; the console stops owning storage and becomes a client of both.

**Tech Stack:** TypeScript (strict), Zod schemas in `@coa/shared`, `yaml` (already a `@coa/core` dependency), Vitest, JSON-RPC over the existing named-pipe transport.

## Global Constraints

- TypeScript `strict`, **no `any`**. Validate all external data at the edges with Zod; M0 (`@coa/shared`) owns the schemas.
- `pnpm typecheck` must stay clean. `pnpm test` baseline is 10 known failures (5 deepseek + 5 longcat, "streaming response had no body") — **this number may not grow**.
- Commits: subject-only Conventional Commits. **No body, no `Co-Authored-By`, no "Generated with" trailer.** No project-internal identifiers in the subject (no module ids, phase numbers, or plan names).
- Stage files **by name**. Never `git add -A`.
- Single `main` branch. Commit only after the task's tests pass.
- A missing scope directory is the strict-superset floor: empty list, no error, no diagnostic.
- Run a single test file with `pnpm vitest run <path>`; the full suite with `pnpm test`.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/shared/src/agent.ts` (modify) | The on-disk file schema, the resolved wire summary, the scope enum, the diagnostic schema |
| `packages/core/src/session/agent-defs.ts` (create) | Scope loading, merge-with-precedence, and the `AgentRegistry` store (read + write) |
| `packages/core/src/session/builtin-agents.ts` (create) | The two code-shipped definitions |
| `packages/core/src/rpc/console-handlers.ts` (modify) | `listAgents` / `saveAgent` / `deleteAgent` handler map |
| `apps/cli/src/cli.ts` (modify) | Construct the registry and register its handlers |
| `packages/console-viewmodel/src/agents.ts` (modify) | Re-export the shared schemas instead of defining its own |
| `apps/desktop/src/main/agentsStore.ts` (delete) | Storage moves to the daemon |

Naming note: `packages/core/src/session/agent-registry.ts` already exists and holds the **package/role** starter registry — a different concept. The new module is `agent-defs.ts` and must not be merged into it.

---

### Task 1: The agent schemas in M0

**Files:**
- Modify: `packages/shared/src/agent.ts`
- Test: `packages/shared/src/agent.test.ts` (create)

**Interfaces:**
- Consumes: `claudeReasoningSchema` from `./config.js` (already exported by `@coa/shared`)
- Produces: `agentFileSchema` / `AgentFile`, `agentSummarySchema` / `AgentSummary`, `agentScopeSchema` / `AgentScope`, `agentDiagnosticSchema` / `AgentDiagnostic`, `AGENT_ICON_NAMES`, `AGENT_COLOR_NAMES`, `agentIconSchema`, `agentColorSchema`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/agent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { agentFileSchema, agentSummarySchema } from './agent.js';

describe('agentFileSchema', () => {
  it('requires a name and a description', () => {
    expect(agentFileSchema.safeParse({ name: 'Worker' }).success).toBe(false);
    expect(agentFileSchema.safeParse({ description: 'does work' }).success).toBe(false);
  });

  it('rejects an empty description — the field delegation depends on', () => {
    expect(agentFileSchema.safeParse({ name: 'Worker', description: '' }).success).toBe(false);
  });

  it('defaults icon and color, and degrades unknown vocabulary rather than failing', () => {
    const parsed = agentFileSchema.parse({ name: 'Worker', description: 'does work' });
    expect(parsed.icon).toBe('bot');
    expect(parsed.color).toBe('slate');
    const odd = agentFileSchema.parse({
      name: 'Worker',
      description: 'does work',
      icon: 'not-a-real-icon',
      color: 'chartreuse',
    });
    expect(odd.icon).toBe('bot');
    expect(odd.color).toBe('slate');
  });

  it('does not carry ref or scope — the filename and directory supply those', () => {
    const parsed = agentFileSchema.parse({ name: 'Worker', description: 'does work' });
    expect('ref' in parsed).toBe(false);
    expect('scope' in parsed).toBe(false);
  });
});

describe('agentSummarySchema', () => {
  it('is the file shape plus a resolved ref and scope', () => {
    const parsed = agentSummarySchema.parse({
      ref: 'worker',
      scope: 'project',
      name: 'Worker',
      description: 'does work',
    });
    expect(parsed.ref).toBe('worker');
    expect(parsed.scope).toBe('project');
  });

  it('admits the builtin scope', () => {
    expect(
      agentSummarySchema.safeParse({
        ref: 'general-purpose',
        scope: 'builtin',
        name: 'General purpose',
        description: 'does work',
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/src/agent.test.ts`
Expected: FAIL — `agentFileSchema` is not exported from `./agent.js`.

- [ ] **Step 3: Write the schemas**

Append to `packages/shared/src/agent.ts`:

```ts
/**
 * An agent definition — the reusable object a parent names when it dispatches.
 * Distinct from {@link Role}: a role is a composition of packages, an agent is a
 * named, described, model-bound selection over roles and packages.
 *
 * `ref` and `scope` are deliberately NOT file fields. The filename stem is the ref
 * and the directory is the scope, so a definition cannot disagree with where it
 * lives, and two files in one scope cannot claim the same ref.
 */

export const AGENT_ICON_NAMES = [
  'bot', 'hammer', 'wrench', 'flask', 'shield', 'book', 'bug', 'search',
  'pen', 'branch', 'terminal', 'database', 'layers', 'eye', 'compass', 'sparkles',
] as const;
export const agentIconSchema = z.enum(AGENT_ICON_NAMES).catch('bot');
export type AgentIcon = z.infer<typeof agentIconSchema>;

export const AGENT_COLOR_NAMES = [
  'slate', 'sky', 'blue', 'teal', 'green', 'mauve', 'violet', 'coral',
] as const;
export const agentColorSchema = z.enum(AGENT_COLOR_NAMES).catch('slate');
export type AgentColor = z.infer<typeof agentColorSchema>;

export const agentFileSchema = z.object({
  name: z.string().min(1),
  /** What this agent is for. Required: it is what a parent reads to decide. */
  description: z.string().min(1),
  icon: agentIconSchema.default('bot'),
  color: agentColorSchema.default('slate'),
  model: z.string().optional(),
  provider: z.string().optional(),
  reasoning: claudeReasoningSchema.optional(),
  roles: z.array(z.string()).optional(),
  packageIds: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});
export type AgentFile = z.infer<typeof agentFileSchema>;

export const agentScopeSchema = z.enum(['builtin', 'personal', 'project']);
export type AgentScope = z.infer<typeof agentScopeSchema>;

export const agentSummarySchema = agentFileSchema.extend({
  ref: z.string().min(1),
  scope: agentScopeSchema,
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

/** A load problem, surfaced rather than swallowed — never a silent pick. */
export const agentDiagnosticSchema = z.object({
  scope: agentScopeSchema,
  ref: z.string(),
  path: z.string(),
  problem: z.enum(['invalid', 'duplicate-ref', 'ref-in-file']),
  detail: z.string(),
});
export type AgentDiagnostic = z.infer<typeof agentDiagnosticSchema>;
```

Add the import at the top of the file if absent:

```ts
import { claudeReasoningSchema } from './config.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/shared/src/agent.test.ts`
Expected: PASS (7 assertions across 6 tests).

- [ ] **Step 5: Export from the package index**

Confirm `packages/shared/src/index.ts` re-exports `./agent.js`. If it uses an explicit export list rather than `export *`, add the new names to it.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agent.ts packages/shared/src/agent.test.ts packages/shared/src/index.ts
git commit -m "feat: add agent definition schemas with a required description"
```

---

### Task 2: Load one scope directory

**Files:**
- Create: `packages/core/src/session/agent-defs.ts`
- Test: `packages/core/src/session/agent-defs.test.ts` (create)

**Interfaces:**
- Consumes: `agentFileSchema`, `AgentSummary`, `AgentDiagnostic`, `AgentScope` from `@coa/shared`
- Produces: `LoadedAgents { agents: AgentSummary[]; diagnostics: AgentDiagnostic[] }`, `agentScopeDir(home, root, scope): string`, `loadAgentScope(dir: string, scope: AgentScope): LoadedAgents`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/session/agent-defs.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAgentScope } from './agent-defs.js';

function scopeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'coa-agents-'));
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

describe('loadAgentScope', () => {
  it('is empty and silent when the directory does not exist', () => {
    const loaded = loadAgentScope(join(tmpdir(), 'coa-agents-absent-xyz'), 'project');
    expect(loaded.agents).toEqual([]);
    expect(loaded.diagnostics).toEqual([]);
  });

  it('takes the ref from the filename and the scope from the caller', () => {
    const dir = scopeDir({ 'reviewer.yaml': 'name: Reviewer\ndescription: reviews code\n' });
    const loaded = loadAgentScope(dir, 'project');
    expect(loaded.agents).toHaveLength(1);
    expect(loaded.agents[0]?.ref).toBe('reviewer');
    expect(loaded.agents[0]?.scope).toBe('project');
    expect(loaded.agents[0]?.description).toBe('reviews code');
  });

  it('reports an invalid file and keeps the valid ones', () => {
    const dir = scopeDir({
      'good.yaml': 'name: Good\ndescription: fine\n',
      'bad.yaml': 'name: Bad\n',
    });
    const loaded = loadAgentScope(dir, 'personal');
    expect(loaded.agents.map((a) => a.ref)).toEqual(['good']);
    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.diagnostics[0]?.problem).toBe('invalid');
    expect(loaded.diagnostics[0]?.ref).toBe('bad');
  });

  it('flags a ref field in the file rather than honouring it', () => {
    const dir = scopeDir({ 'real.yaml': 'ref: pretend\nname: Real\ndescription: fine\n' });
    const loaded = loadAgentScope(dir, 'project');
    expect(loaded.agents[0]?.ref).toBe('real');
    expect(loaded.diagnostics[0]?.problem).toBe('ref-in-file');
  });

  it('flags a case-folded duplicate instead of picking silently', () => {
    const dir = scopeDir({
      'Worker.yaml': 'name: Upper\ndescription: one\n',
      'worker.yaml': 'name: Lower\ndescription: two\n',
    });
    const loaded = loadAgentScope(dir, 'project');
    expect(loaded.agents).toHaveLength(1);
    expect(loaded.diagnostics.some((d) => d.problem === 'duplicate-ref')).toBe(true);
  });

  it('ignores files that are not .yaml', () => {
    const dir = scopeDir({
      'notes.md': 'not an agent',
      'keeper.yaml': 'name: Keeper\ndescription: fine\n',
    });
    expect(loadAgentScope(dir, 'project').agents.map((a) => a.ref)).toEqual(['keeper']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/session/agent-defs.test.ts`
Expected: FAIL — cannot resolve `./agent-defs.js`.

- [ ] **Step 3: Write the loader**

Create `packages/core/src/session/agent-defs.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse } from 'yaml';
import {
  agentFileSchema,
  type AgentDiagnostic,
  type AgentScope,
  type AgentSummary,
} from '@coa/shared';

/**
 * The agent-definition registry: user-authored agents read from a scope directory.
 * One YAML file per agent, the filename stem is the `ref`. Distinct from
 * `agent-registry.ts`, which registers packages and roles.
 *
 * Every failure is REPORTED, never swallowed and never silently resolved: an
 * unparseable file, a file that tries to name its own ref, and a case-folded
 * duplicate each produce a diagnostic while the rest of the scope still loads.
 */

export interface LoadedAgents {
  readonly agents: AgentSummary[];
  readonly diagnostics: AgentDiagnostic[];
}

/** Where a scope's definitions live. `home`/`root` are injectable so tests use temp dirs. */
export function agentScopeDir(home: string, root: string, scope: AgentScope): string {
  return scope === 'personal' ? join(home, '.coa', 'agents') : join(root, '.coa', 'agents');
}

/** Read one scope directory. A missing directory is the floor, not an error. */
export function loadAgentScope(dir: string, scope: AgentScope): LoadedAgents {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { agents: [], diagnostics: [] };
  }

  const agents: AgentSummary[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  const seen = new Set<string>();

  // Sorted so two machines reading the same directory agree on which duplicate won.
  for (const entry of entries.filter((e) => extname(e) === '.yaml').sort()) {
    const path = join(dir, entry);
    const ref = basename(entry, '.yaml');
    const key = ref.toLowerCase();

    if (seen.has(key)) {
      diagnostics.push({
        scope,
        ref,
        path,
        problem: 'duplicate-ref',
        detail: `another file in this scope already defines "${key}"`,
      });
      continue;
    }

    let raw: unknown;
    try {
      raw = parse(readFileSync(path, 'utf8'));
    } catch (err) {
      diagnostics.push({
        scope,
        ref,
        path,
        problem: 'invalid',
        detail: err instanceof Error ? err.message : 'unreadable',
      });
      continue;
    }

    if (raw !== null && typeof raw === 'object' && 'ref' in raw) {
      diagnostics.push({
        scope,
        ref,
        path,
        problem: 'ref-in-file',
        detail: 'the filename is the ref; the field is ignored',
      });
    }

    const parsed = agentFileSchema.safeParse(raw);
    if (!parsed.success) {
      diagnostics.push({ scope, ref, path, problem: 'invalid', detail: parsed.error.message });
      continue;
    }

    seen.add(key);
    agents.push({ ...parsed.data, ref, scope });
  }

  return { agents, diagnostics };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/session/agent-defs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/agent-defs.ts packages/core/src/session/agent-defs.test.ts
git commit -m "feat: load agent definitions from a scope directory"
```

---

### Task 3: Merge the scopes with precedence

**Files:**
- Modify: `packages/core/src/session/agent-defs.ts`
- Test: `packages/core/src/session/agent-defs.test.ts:end`

**Interfaces:**
- Consumes: `LoadedAgents` from Task 2
- Produces: `mergeAgentScopes(scopes: readonly LoadedAgents[]): LoadedAgents` — later scopes win

- [ ] **Step 1: Write the failing test**

Append the block below to `packages/core/src/session/agent-defs.test.ts`, moving its two `import` lines up into the file's existing top-of-file import block (`mergeAgentScopes` joins the `./agent-defs.js` import; `AgentSummary` becomes a new type import):

```ts
import { mergeAgentScopes } from './agent-defs.js';
import type { AgentSummary } from '@coa/shared';

function agent(ref: string, scope: AgentSummary['scope'], name: string): AgentSummary {
  return { ref, scope, name, description: `${name} description`, icon: 'bot', color: 'slate' };
}

describe('mergeAgentScopes', () => {
  it('unions the scopes', () => {
    const merged = mergeAgentScopes([
      { agents: [agent('builtin-one', 'builtin', 'B')], diagnostics: [] },
      { agents: [agent('personal-one', 'personal', 'P')], diagnostics: [] },
      { agents: [agent('project-one', 'project', 'R')], diagnostics: [] },
    ]);
    expect(merged.agents.map((a) => a.ref).sort()).toEqual([
      'builtin-one',
      'personal-one',
      'project-one',
    ]);
  });

  it('lets a later scope win a ref collision', () => {
    const merged = mergeAgentScopes([
      { agents: [agent('worker', 'builtin', 'Built in')], diagnostics: [] },
      { agents: [agent('worker', 'personal', 'Personal')], diagnostics: [] },
      { agents: [agent('worker', 'project', 'Project')], diagnostics: [] },
    ]);
    expect(merged.agents).toHaveLength(1);
    expect(merged.agents[0]?.name).toBe('Project');
    expect(merged.agents[0]?.scope).toBe('project');
  });

  it('carries every scope’s diagnostics through', () => {
    const merged = mergeAgentScopes([
      { agents: [], diagnostics: [] },
      {
        agents: [],
        diagnostics: [
          { scope: 'personal', ref: 'x', path: '/x.yaml', problem: 'invalid', detail: 'boom' },
        ],
      },
    ]);
    expect(merged.diagnostics).toHaveLength(1);
  });

  it('returns a stable ref-sorted order', () => {
    const merged = mergeAgentScopes([
      { agents: [agent('zeta', 'builtin', 'Z'), agent('alpha', 'builtin', 'A')], diagnostics: [] },
    ]);
    expect(merged.agents.map((a) => a.ref)).toEqual(['alpha', 'zeta']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/session/agent-defs.test.ts`
Expected: FAIL — `mergeAgentScopes` is not exported.

- [ ] **Step 3: Write the merge**

Append to `packages/core/src/session/agent-defs.ts`:

```ts
/**
 * Fold scopes into one effective set. Pass them in precedence order — built-in,
 * personal, project — and the LAST occurrence of a ref wins (most specific), the
 * same posture as coa's built-in ∪ user merge (docs/adr/0003). Cross-scope
 * collisions are intentional overrides and are not diagnostics; within-scope
 * duplicates were already reported by the loader.
 */
export function mergeAgentScopes(scopes: readonly LoadedAgents[]): LoadedAgents {
  const byRef = new Map<string, AgentSummary>();
  const diagnostics: AgentDiagnostic[] = [];
  for (const scope of scopes) {
    for (const agent of scope.agents) byRef.set(agent.ref, agent);
    diagnostics.push(...scope.diagnostics);
  }
  const agents = [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref));
  return { agents, diagnostics };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/session/agent-defs.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/agent-defs.ts packages/core/src/session/agent-defs.test.ts
git commit -m "feat: merge agent scopes with most-specific-wins precedence"
```

---

### Task 4: The built-in definitions

**Files:**
- Create: `packages/core/src/session/builtin-agents.ts`
- Test: `packages/core/src/session/builtin-agents.test.ts` (create)

**Interfaces:**
- Consumes: `AgentSummary` from `@coa/shared`; the role ids `swe` and `researcher` from `agent-registry.ts`
- Produces: `BUILTIN_AGENTS: readonly AgentSummary[]`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/session/builtin-agents.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { agentSummarySchema } from '@coa/shared';
import { BUILTIN_AGENTS } from './builtin-agents.js';
import { STARTER_ROLES } from './agent-registry.js';

describe('BUILTIN_AGENTS', () => {
  it('ships a general-purpose worker and a read-only explorer', () => {
    expect(BUILTIN_AGENTS.map((a) => a.ref).sort()).toEqual(['explorer', 'general-purpose']);
  });

  it('are all valid summaries in the builtin scope', () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(agentSummarySchema.safeParse(agent).success).toBe(true);
      expect(agent.scope).toBe('builtin');
    }
  });

  it('every named role exists in the starter registry', () => {
    const known = new Set(STARTER_ROLES.map((r) => r.id));
    for (const agent of BUILTIN_AGENTS) {
      for (const role of agent.roles ?? []) expect(known.has(role)).toBe(true);
    }
  });

  it('the explorer names no editing role', () => {
    const explorer = BUILTIN_AGENTS.find((a) => a.ref === 'explorer');
    expect(explorer?.roles).toEqual(['researcher']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/session/builtin-agents.test.ts`
Expected: FAIL — cannot resolve `./builtin-agents.js`.

- [ ] **Step 3: Write the definitions**

Create `packages/core/src/session/builtin-agents.ts`:

```ts
import type { AgentSummary } from '@coa/shared';

/**
 * The code-shipped agent definitions, always in scope. These are what make one
 * dispatch path tolerable: there is no ad-hoc "give me a worker on model X" call,
 * so a generic worker and a read-only explorer are the escape hatch. A user
 * definition with the same ref overrides these (most specific wins).
 *
 * Descriptions are written for a MODEL to choose between, not for a settings pane:
 * they say what the agent is for and what it will not do.
 */
export const BUILTIN_AGENTS: readonly AgentSummary[] = [
  {
    ref: 'general-purpose',
    scope: 'builtin',
    name: 'General purpose',
    description:
      'A general worker for multi-step tasks: reads, searches, plans, and edits code. Use it when the work needs changes made, or when no more specific agent fits.',
    icon: 'bot',
    color: 'slate',
    roles: ['swe'],
  },
  {
    ref: 'explorer',
    scope: 'builtin',
    name: 'Explorer',
    description:
      'A read-only investigator for questions that need many files read before answering. It searches, reads, and reports what it found; it never edits.',
    icon: 'search',
    color: 'sky',
    roles: ['researcher'],
  },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/session/builtin-agents.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/builtin-agents.ts packages/core/src/session/builtin-agents.test.ts
git commit -m "feat: ship a general-purpose worker and a read-only explorer"
```

---

### Task 5: The registry store

**Files:**
- Modify: `packages/core/src/session/agent-defs.ts`
- Test: `packages/core/src/session/agent-defs.test.ts:end`

**Interfaces:**
- Consumes: `loadAgentScope`, `mergeAgentScopes`, `agentScopeDir`, `BUILTIN_AGENTS`
- Produces: `class AgentRegistry` with `constructor(home: string, root: string)`, `list(): LoadedAgents`, `save(ref: string, file: AgentFile, scope: 'personal' | 'project'): void`, `remove(ref: string, scope: 'personal' | 'project'): boolean`

- [ ] **Step 1: Write the failing test**

Append the block below to `packages/core/src/session/agent-defs.test.ts`, again folding its import into the existing top-of-file `./agent-defs.js` import rather than adding a second one:

```ts
import { AgentRegistry } from './agent-defs.js';

describe('AgentRegistry', () => {
  function registry(): { reg: AgentRegistry; home: string; root: string } {
    const home = mkdtempSync(join(tmpdir(), 'coa-home-'));
    const root = mkdtempSync(join(tmpdir(), 'coa-root-'));
    return { reg: new AgentRegistry(home, root), home, root };
  }

  it('lists the built-ins when nothing is on disk', () => {
    const { reg } = registry();
    expect(reg.list().agents.map((a) => a.ref).sort()).toEqual(['explorer', 'general-purpose']);
  });

  it('round-trips a saved personal agent', () => {
    const { reg } = registry();
    reg.save('reviewer', { name: 'Reviewer', description: 'reviews code', icon: 'eye', color: 'teal' }, 'personal');
    const found = reg.list().agents.find((a) => a.ref === 'reviewer');
    expect(found?.description).toBe('reviews code');
    expect(found?.scope).toBe('personal');
  });

  it('lets a project agent override a built-in ref', () => {
    const { reg } = registry();
    reg.save('explorer', { name: 'Our explorer', description: 'ours', icon: 'bot', color: 'slate' }, 'project');
    const found = reg.list().agents.find((a) => a.ref === 'explorer');
    expect(found?.name).toBe('Our explorer');
    expect(found?.scope).toBe('project');
  });

  it('removes an agent and reports whether anything was removed', () => {
    const { reg } = registry();
    reg.save('temp', { name: 'Temp', description: 'temporary', icon: 'bot', color: 'slate' }, 'project');
    expect(reg.remove('temp', 'project')).toBe(true);
    expect(reg.remove('temp', 'project')).toBe(false);
    expect(reg.list().agents.some((a) => a.ref === 'temp')).toBe(false);
  });

  it('refuses a ref that would escape its scope directory', () => {
    const { reg } = registry();
    expect(() =>
      reg.save('../escape', { name: 'X', description: 'x', icon: 'bot', color: 'slate' }, 'project'),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/session/agent-defs.test.ts`
Expected: FAIL — `AgentRegistry` is not exported.

- [ ] **Step 3: Write the store**

First **extend the existing import statements** at the top of `packages/core/src/session/agent-defs.ts` — do not add second imports from the same module, which the lint rules reject:

- `node:fs` → `import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';`
- `yaml` → `import { parse, stringify } from 'yaml';`
- `@coa/shared` → add `type AgentFile` to the existing type import list
- add `import { BUILTIN_AGENTS } from './builtin-agents.js';`

Then append:

```ts
/** A ref must be a single path segment: it becomes a filename. */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The daemon-owned agent registry. Reads are always fresh from disk so an agent
 * authored by another window — or by the user editing a file directly — is visible
 * without a restart.
 */
export class AgentRegistry {
  readonly #home: string;
  readonly #root: string;

  constructor(home: string, root: string) {
    this.#home = home;
    this.#root = root;
  }

  /** The effective set: built-in ∪ personal ∪ project, project winning. */
  list(): LoadedAgents {
    return mergeAgentScopes([
      { agents: [...BUILTIN_AGENTS], diagnostics: [] },
      loadAgentScope(agentScopeDir(this.#home, this.#root, 'personal'), 'personal'),
      loadAgentScope(agentScopeDir(this.#home, this.#root, 'project'), 'project'),
    ]);
  }

  save(ref: string, file: AgentFile, scope: 'personal' | 'project'): void {
    const path = this.#pathFor(ref, scope);
    mkdirSync(agentScopeDir(this.#home, this.#root, scope), { recursive: true });
    writeFileSync(path, stringify(file), 'utf8');
  }

  /** `false` when there was nothing to remove — a double delete is not an error. */
  remove(ref: string, scope: 'personal' | 'project'): boolean {
    const path = this.#pathFor(ref, scope);
    try {
      rmSync(path);
      return true;
    } catch {
      return false;
    }
  }

  #pathFor(ref: string, scope: 'personal' | 'project'): string {
    if (!SAFE_REF.test(ref)) throw new Error(`invalid agent ref: ${ref}`);
    return join(agentScopeDir(this.#home, this.#root, scope), `${ref}.yaml`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/session/agent-defs.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/agent-defs.ts packages/core/src/session/agent-defs.test.ts
git commit -m "feat: add a daemon-owned agent registry store"
```

---

### Task 6: The daemon verbs

**Files:**
- Modify: `packages/core/src/rpc/console-handlers.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/cli/src/cli.ts:231-234`
- Test: `packages/core/src/rpc/console-handlers.test.ts:end`

**Interfaces:**
- Consumes: `AgentRegistry` from Task 5; `rpcMethod`, `RpcHandlers` from `./router.js`
- Produces: `AgentRegistryPorts`, `buildAgentRegistryHandlers(ports): RpcHandlers` exposing `listAgents`, `saveAgent`, `deleteAgent`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/rpc/console-handlers.test.ts`:

```ts
import { buildAgentRegistryHandlers } from './console-handlers.js';
import type { AgentFile, AgentScope, AgentSummary } from '@coa/shared';

describe('buildAgentRegistryHandlers', () => {
  function ports() {
    const saved: { ref: string; file: AgentFile; scope: string }[] = [];
    const agents: AgentSummary[] = [
      { ref: 'explorer', scope: 'builtin' as AgentScope, name: 'Explorer', description: 'reads', icon: 'search', color: 'sky' },
    ];
    return {
      saved,
      handlers: buildAgentRegistryHandlers({
        listAgents: () => ({ agents, diagnostics: [] }),
        saveAgent: (ref, file, scope) => saved.push({ ref, file, scope }),
        deleteAgent: () => true,
      }),
    };
  }

  it('listAgents returns the merged set and its diagnostics', async () => {
    const { handlers } = ports();
    const result = (await handlers['listAgents']!.handle(undefined)) as {
      agents: AgentSummary[];
      diagnostics: unknown[];
    };
    expect(result.agents[0]?.ref).toBe('explorer');
    expect(result.diagnostics).toEqual([]);
  });

  it('saveAgent validates the file before writing', async () => {
    const { handlers, saved } = ports();
    await handlers['saveAgent']!.handle({
      ref: 'reviewer',
      scope: 'personal',
      file: { name: 'Reviewer', description: 'reviews' },
    });
    expect(saved[0]?.ref).toBe('reviewer');
    expect(saved[0]?.file.description).toBe('reviews');
  });

  it('saveAgent rejects a definition with no description', async () => {
    const { handlers } = ports();
    await expect(
      handlers['saveAgent']!.handle({ ref: 'bad', scope: 'personal', file: { name: 'Bad' } }),
    ).rejects.toThrow();
  });

  it('saveAgent refuses the builtin scope', async () => {
    const { handlers } = ports();
    await expect(
      handlers['saveAgent']!.handle({
        ref: 'x',
        scope: 'builtin',
        file: { name: 'X', description: 'x' },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/rpc/console-handlers.test.ts`
Expected: FAIL — `buildAgentRegistryHandlers` is not exported.

- [ ] **Step 3: Write the handlers**

Append to `packages/core/src/rpc/console-handlers.ts`:

```ts
/**
 * The agent-definition registry verbs. Reads are always fresh (an agent authored
 * elsewhere is visible without a restart); writes are validated at this edge, so a
 * definition can never reach disk without the `description` delegation depends on.
 * `builtin` is not a writable scope — those definitions ship in code.
 */
export interface AgentRegistryPorts {
  listAgents: () => { agents: AgentSummary[]; diagnostics: AgentDiagnostic[] };
  saveAgent: (ref: string, file: AgentFile, scope: 'personal' | 'project') => void;
  deleteAgent: (ref: string, scope: 'personal' | 'project') => boolean;
}

const writableScope = z.enum(['personal', 'project']);
const saveAgentParams = z.object({
  ref: z.string().min(1),
  scope: writableScope,
  file: agentFileSchema,
});
const deleteAgentParams = z.object({ ref: z.string().min(1), scope: writableScope });

export function buildAgentRegistryHandlers(ports: AgentRegistryPorts): RpcHandlers {
  return {
    listAgents: rpcMethod(noParams, () => ports.listAgents()),
    saveAgent: rpcMethod(saveAgentParams, (p) => {
      ports.saveAgent(p.ref, p.file, p.scope);
      return { ok: true };
    }),
    deleteAgent: rpcMethod(deleteAgentParams, (p) => ({
      removed: ports.deleteAgent(p.ref, p.scope),
    })),
  };
}
```

Add to the imports at the top of the file:

```ts
import { agentFileSchema, type AgentDiagnostic, type AgentFile, type AgentSummary } from '@coa/shared';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/rpc/console-handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Export and wire into the daemon**

Add `buildAgentRegistryHandlers` and `AgentRegistry` to the export list in `packages/core/src/index.ts` alongside the existing `buildRegistryHandlers` export.

In `apps/cli/src/cli.ts`, immediately after the existing `registryHandlers` block (around line 234), add:

```ts
  // The agent-definition registry: built-in ∪ ~/.coa/agents ∪ <repo>/.coa/agents.
  const agentRegistry = new AgentRegistry(homedir(), process.cwd());
  const agentHandlers = buildAgentRegistryHandlers({
    listAgents: () => agentRegistry.list(),
    saveAgent: (ref, file, scope) => agentRegistry.save(ref, file, scope),
    deleteAgent: (ref, scope) => agentRegistry.remove(ref, scope),
  });
```

Then add `...agentHandlers` to the handler object that already spreads `...registryHandlers` when the server is bound, and add `AgentRegistry` / `buildAgentRegistryHandlers` to the `@coa/core` import list at the top of `cli.ts`.

- [ ] **Step 6: Verify the whole suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; test failures still exactly the 10 known baseline failures.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rpc/console-handlers.ts packages/core/src/rpc/console-handlers.test.ts packages/core/src/index.ts apps/cli/src/cli.ts
git commit -m "feat: expose agent registry reads and writes over rpc"
```

---

### Task 7: The console becomes a client

**Files:**
- Modify: `packages/console-viewmodel/src/agents.ts`
- Modify: `packages/console-viewmodel/src/agents.test.ts`
- Delete: `apps/desktop/src/main/agentsStore.ts`, `apps/desktop/src/main/agentsStore.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/panels/state.ts`

**Interfaces:**
- Consumes: the `listAgents` / `saveAgent` / `deleteAgent` verbs from Task 6
- Produces: no new exports — `AgentSummary` and friends are re-exported from `@coa/shared`

- [ ] **Step 1: Re-point the view model at the shared schemas**

In `packages/console-viewmodel/src/agents.ts`, delete the local `AGENT_ICON_NAMES`, `AgentIconSchema`, `AGENT_COLOR_NAMES`, `AgentColorSchema`, `AgentSummarySchema`, `PersistedAgentsSchema`, and `parsePersistedAgents` definitions. Replace them with a re-export, matching how the file already re-exports `roleSummarySchema`:

```ts
export {
  AGENT_ICON_NAMES,
  AGENT_COLOR_NAMES,
  agentIconSchema,
  agentColorSchema,
  agentFileSchema,
  agentSummarySchema,
  agentScopeSchema,
  agentDiagnosticSchema,
  type AgentIcon,
  type AgentColor,
  type AgentFile,
  type AgentSummary,
  type AgentScope,
  type AgentDiagnostic,
} from '@coa/shared';

export const AgentListSchema = z.array(agentSummarySchema);
export const DEFAULT_AGENT_LIST: AgentSummary[] = [];

/** Parse the daemon's `listAgents` payload at the edge; any invalid payload
 *  degrades to the empty floor so the console boots to "No agents yet". */
export function parseAgents(raw: unknown): AgentSummary[] {
  const parsed = AgentListSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : DEFAULT_AGENT_LIST;
}
```

Keep `SessionSummarySchema` and the role/package re-exports exactly as they are.

- [ ] **Step 2: Update the view-model tests**

In `packages/console-viewmodel/src/agents.test.ts`, delete every test covering `parsePersistedAgents`, `PersistedAgentsSchema`, and ref-deduplication (the daemon now guarantees unique refs, and the persisted-envelope format is gone). Keep and, where needed, extend the `parseAgents` tests. Add:

```ts
it('drops a payload whose agents are missing a description', () => {
  expect(parseAgents([{ ref: 'x', scope: 'project', name: 'X' }])).toEqual([]);
});
```

Run: `pnpm vitest run packages/console-viewmodel/src/agents.test.ts`
Expected: PASS.

- [ ] **Step 3: Delete the desktop store**

```bash
git rm apps/desktop/src/main/agentsStore.ts apps/desktop/src/main/agentsStore.test.ts
```

In `apps/desktop/src/main/index.ts`, remove the `agentsStore` import and every read/write of `agents.json`. Replace the IPC handlers that served the renderer's agent list with pass-throughs to the daemon client, alongside the existing daemon RPC calls: `listAgents` for reads, `saveAgent` and `deleteAgent` for the editor's save and delete actions.

- [ ] **Step 4: Point the renderer at the new reads**

In `apps/desktop/src/renderer/panels/state.ts`, replace the local agent-list state source with the `listAgents` result, and make the editor's save and delete paths call the new IPC channels instead of mutating renderer-local state. The agents panel's `scope` selector gains a third, non-editable value: a `builtin` agent renders read-only, with the editor's save and delete controls disabled.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: typecheck clean; exactly the 10 baseline test failures; lint no worse than the 9 baseline errors.

- [ ] **Step 6: Drive the app**

Start the daemon and the console:

```bash
node apps/cli/dist/bin.js serve
```

Then launch the desktop app (remember `env -u ELECTRON_RUN_AS_NODE` when starting it from a tool shell). Confirm: the two built-in agents appear and are read-only; creating a personal agent writes `~/.coa/agents/<ref>.yaml`; creating a project agent writes `<repo>/.coa/agents/<ref>.yaml`; a project agent sharing a built-in's ref overrides it; and deleting removes the file.

- [ ] **Step 7: Commit**

```bash
git add packages/console-viewmodel/src/agents.ts packages/console-viewmodel/src/agents.test.ts apps/desktop/src/main/index.ts apps/desktop/src/renderer/panels/state.ts
git commit -m "feat: read and write agents through the daemon instead of console storage"
```

---

### Task 8: Documentation

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/REPO_LAYOUT.md`

- [ ] **Step 1: Record the shipped state**

Update `ROADMAP.md` to move registry promotion from remaining work to done, noting that discovery and dispatch are still ahead of it.

- [ ] **Step 2: Record the new files**

Add `packages/core/src/session/agent-defs.ts` and `builtin-agents.ts` to `docs/REPO_LAYOUT.md` where that file maps the session package, and note the `.coa/agents/` and `~/.coa/agents/` locations.

- [ ] **Step 3: Verify the router still passes**

Run: `pnpm docs:check`
Expected: the only unreachable file is the gitignored `TEMP.md` (the known baseline).

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md docs/REPO_LAYOUT.md
git commit -m "docs: record the agent registry locations and state"
```

---

## Notes for the implementer

**Why the filename is the ref.** Claude Code resolves same-directory duplicate agent names by undocumented filesystem read order and patches over it with a `/doctor` check. Making the filename authoritative means two files in one scope structurally cannot claim one ref — the only residual case is a case-folding collision between a repo authored on Linux and read on Windows, which the loader reports.

**Why diagnostics rather than the flag pipeline.** The design calls a within-scope duplicate "a compile error surfaced as a flag". Routing it through M3's `FlagPipeline` needs a producer, a severity assignment, and dedup keys — real work whose shape belongs with the flag surface, not with storage. Returning diagnostics on the read satisfies "surfaced, never silent" today and leaves the pipeline integration as a deliberate follow-up.

**What this plan does not build.** No `find_agent`, no agent-list Piece, no `spawn_agent`, no depth handling — those belong to discovery and dispatch, which is gated on the orchestration slice. No `author_agent`, which is gated on the approval channel.
