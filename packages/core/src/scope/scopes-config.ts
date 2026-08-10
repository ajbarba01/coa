import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { scopeSchema, type Scope, type ScopeExpr } from '@coa/shared';

/**
 * SCO-3 — scope definitions live in a committed, portable `.coa/scopes.yaml`,
 * **validated at load**: a malformed expression, a reference to an unknown scope,
 * or a cycle in scope-composition is **rejected loudly**, never loaded as a
 * silent no-op. Tags are stored as `tag → globs` bulk rules here (committed, so
 * they travel); the graph-edge-backed per-file tag annotation that follows
 * renames (SCO-3 (b)) needs a shared-schema tag relation and is deferred — flagged for the
 * maintainer.
 */
export interface ScopesConfig {
  scopes: Map<string, Scope>;
  tags: Map<string, string[]>;
}

const scopeBodySchema = scopeSchema.omit({ name: true });
const configSchema = z.object({
  scopes: z.record(z.string(), scopeBodySchema).optional(),
  tags: z.record(z.string(), z.array(z.string())).optional(),
});

export function validateScopesConfig(raw: unknown): ScopesConfig {
  const parsed = configSchema.parse(raw);
  const scopes = new Map<string, Scope>();
  for (const [name, body] of Object.entries(parsed.scopes ?? {})) {
    scopes.set(name, { name, ...body });
  }

  for (const scope of scopes.values()) assertReferencesResolve(scope, scopes);
  assertNoCompositionCycle(scopes);

  return { scopes, tags: new Map(Object.entries(parsed.tags ?? {})) };
}

/** Load + validate a scopes file; an absent file is an empty (valid) config. */
export function loadScopesFile(path: string): ScopesConfig {
  if (!existsSync(path)) return { scopes: new Map(), tags: new Map() };
  return validateScopesConfig(parseYaml(readFileSync(path, 'utf8')) ?? {});
}

function assertReferencesResolve(scope: Scope, scopes: Map<string, Scope>): void {
  for (const ref of scopeRefsIn(scope)) {
    if (!scopes.has(ref))
      throw new Error(`scope "${scope.name}" references unknown scope "${ref}"`);
  }
}

function assertNoCompositionCycle(scopes: Map<string, Scope>): void {
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string): void => {
    state.set(name, 'visiting');
    const scope = scopes.get(name);
    for (const ref of scope ? scopeRefsIn(scope) : []) {
      const s = state.get(ref);
      if (s === 'visiting') throw new Error(`scope composition cycle through "${ref}"`);
      if (s === undefined) visit(ref);
    }
    state.set(name, 'done');
  };
  for (const name of scopes.keys()) if (!state.has(name)) visit(name);
}

/** Every scope name referenced by a `{ scope }` leaf within a definition. */
function scopeRefsIn(scope: Scope): string[] {
  const refs: string[] = [];
  const walk = (expr: ScopeExpr): void => {
    if ('scope' in expr) refs.push(expr.scope);
    else if ('any' in expr) expr.any.forEach(walk);
    else if ('all' in expr) expr.all.forEach(walk);
  };
  walk(scope.include);
  if (scope.exclude) walk(scope.exclude);
  return refs;
}
