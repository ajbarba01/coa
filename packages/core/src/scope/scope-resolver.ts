import type { Scope, ScopeExpr, ScopeResolution } from '@coa/shared';
import { matchGlob } from './glob.js';

/**
 * SCO-1/2 — the pure, deterministic scope resolver. Membership is a function of
 * (expression × graph × WAL) with **no model on any path**. It evaluates a
 * `ScopeExpr` over three leaf bases — `glob` (neutral floor), `tag` (cross-cutting),
 * and `dependsOn` (the one bounded graph leaf this round) — with `any`/`all`
 * set algebra, `exclude` difference, and `scope` composition. The degradation
 * ladder is honest: a leaf that resolves to nothing is recorded in `degraded`,
 * **never silently treated as "matches nothing"** (SCO-5, the #1 field failure).
 * `reachableFrom` and richer graph leaves are deferred (degraded, not failed).
 */
export interface ScopeContext {
  walPosition: number;
  /** The candidate file universe for `glob`/`tag` leaves. */
  paths: string[];
  tagMembers: (tag: string) => string[];
  /** The forward dependency closure for a `dependsOn` leaf. */
  forwardClosure: (node: string) => string[];
  getScope: (name: string) => Scope | undefined;
}

interface Evaluation {
  members: Set<string>;
  degraded: string[];
}

export function resolveScope(scope: Scope, ctx: ScopeContext): ScopeResolution {
  const { members, degraded } = resolveDefinition(scope, ctx, new Set([scope.name]));
  return {
    scope: scope.name,
    members: [...members].sort(),
    walPosition: ctx.walPosition,
    ...(degraded.length > 0 ? { degraded } : {}),
  };
}

function resolveDefinition(scope: Scope, ctx: ScopeContext, visiting: Set<string>): Evaluation {
  const include = evaluate(scope.include, ctx, visiting);
  const members = include.members;
  const degraded = [...include.degraded];
  if (scope.exclude) {
    const excluded = evaluate(scope.exclude, ctx, visiting);
    for (const member of excluded.members) members.delete(member);
    degraded.push(...excluded.degraded);
  }
  return { members, degraded };
}

function evaluate(expr: ScopeExpr, ctx: ScopeContext, visiting: Set<string>): Evaluation {
  if ('glob' in expr) {
    return leaf(
      ctx.paths.filter((p) => matchGlob(expr.glob, p)),
      `glob:${expr.glob}`,
    );
  }
  if ('tag' in expr) {
    return leaf(ctx.tagMembers(expr.tag), `tag:${expr.tag}`);
  }
  if ('dependsOn' in expr) {
    return leaf(ctx.forwardClosure(expr.dependsOn), `dependsOn:${expr.dependsOn}`);
  }
  if ('reachableFrom' in expr) {
    return { members: new Set(), degraded: [`reachableFrom:${expr.reachableFrom} (deferred)`] };
  }
  if ('scope' in expr) {
    if (visiting.has(expr.scope))
      return { members: new Set(), degraded: [`scope:${expr.scope} (cycle)`] };
    const def = ctx.getScope(expr.scope);
    if (!def) return { members: new Set(), degraded: [`scope:${expr.scope} (unknown)`] };
    return resolveDefinition(def, ctx, new Set([...visiting, expr.scope]));
  }
  if ('any' in expr) {
    const members = new Set<string>();
    const degraded: string[] = [];
    for (const sub of expr.any) {
      const result = evaluate(sub, ctx, visiting);
      for (const m of result.members) members.add(m);
      degraded.push(...result.degraded);
    }
    return { members, degraded };
  }
  // `all` — intersection of the sub-expressions.
  const evaluated = expr.all.map((sub) => evaluate(sub, ctx, visiting));
  const degraded = evaluated.flatMap((e) => e.degraded);
  const first = evaluated[0]?.members ?? new Set<string>();
  const members = new Set([...first].filter((m) => evaluated.every((e) => e.members.has(m))));
  return { members, degraded };
}

function leaf(matches: string[], label: string): Evaluation {
  return { members: new Set(matches), degraded: matches.length > 0 ? [] : [label] };
}
