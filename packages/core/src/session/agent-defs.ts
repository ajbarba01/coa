import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  agentFileSchema,
  type AgentDiagnostic,
  type AgentFile,
  type AgentScope,
  type AgentSummary,
} from '@coa/shared';
import { BUILTIN_AGENTS } from './builtin-agents.js';

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

/**
 * The filesystem calls `loadAgentScope` needs, factored out so tests can hand it
 * synthetic entries deterministically (e.g. two case-folded filenames) instead of
 * depending on the host filesystem's real case-folding behaviour. Optional and
 * defaulted to real `node:fs`, so the public `loadAgentScope(dir, scope)` call
 * shape is unchanged for every other caller.
 */
export interface AgentScopeIO {
  readonly readdirSync: (dir: string) => string[];
  readonly readFileSync: (path: string) => string;
}

const defaultIO: AgentScopeIO = {
  readdirSync: (dir) => readdirSync(dir),
  readFileSync: (path) => readFileSync(path, 'utf8'),
};

/** Where a scope's definitions live. `home`/`root` are injectable so tests use temp dirs. */
export function agentScopeDir(home: string, root: string, scope: AgentScope): string {
  return scope === 'personal' ? join(home, '.coa', 'agents') : join(root, '.coa', 'agents');
}

/** Read one scope directory. A missing directory is the floor, not an error. */
export function loadAgentScope(
  dir: string,
  scope: AgentScope,
  io: AgentScopeIO = defaultIO,
): LoadedAgents {
  let entries: string[];
  try {
    entries = io.readdirSync(dir);
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
      raw = parse(io.readFileSync(path));
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

/**
 * Fold scopes into one effective set. Pass them in precedence order — built-in,
 * personal, project — and the LAST occurrence of a ref wins (most specific), the
 * same posture as coa's built-in ∪ user merge. Cross-scope
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

  /**
   * Delete one definition. `false` means there was nothing there to delete — a second
   * delete of the same agent is a no-op, not a failure. Every OTHER filesystem error
   * (the YAML file open in an editor, a read-only directory) is THROWN so the caller
   * sees it: answering "removed nothing" to a delete that actually FAILED is
   * indistinguishable from the benign case, and upstream that reads as success — a
   * cross-scope move whose old copy is still on disk reports as a clean move.
   */
  remove(ref: string, scope: 'personal' | 'project'): boolean {
    const path = this.#pathFor(ref, scope);
    try {
      rmSync(path);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  #pathFor(ref: string, scope: 'personal' | 'project'): string {
    if (!SAFE_REF.test(ref)) throw new Error(`invalid agent ref: ${ref}`);
    return join(agentScopeDir(this.#home, this.#root, scope), `${ref}.yaml`);
  }
}

/** True for the errno codes that mean "this path is not there" — including a parent
 *  component that is missing or is itself a file (which surfaces as ENOTDIR). */
function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
