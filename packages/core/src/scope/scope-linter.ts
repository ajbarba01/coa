import type { Scope, ScopeExpr } from '@coa/shared';

/**
 * SCO-5 — the scope linter (anti-silent-failure, anti-rot; load-bearing, not a
 * nicety). The universal failure of glob-scoped rule systems is silent
 * non-attachment (a leaf matches nothing, nothing tells you) and rot (leaves
 * reference moved/deleted paths). The linter surfaces these as findings — the flag pipeline
 * later wraps them as ordinary Type-2 flags (surfaced, never blocking). Drift
 * detection (members no longer sharing their dependency cluster) is deferred.
 */
export interface ScopeLintFinding {
  scope: string;
  kind: 'empty-leaf' | 'dangling-dependency' | 'missing-attach';
  detail: string;
}

export interface ScopeLintContext {
  resolve: (scope: Scope) => { degraded?: string[] | undefined };
  isPiece: (ref: string) => boolean;
  isNode: (id: string) => boolean;
}

export function lintScopes(scopes: Iterable<Scope>, ctx: ScopeLintContext): ScopeLintFinding[] {
  const findings: ScopeLintFinding[] = [];
  for (const scope of scopes) {
    for (const detail of ctx.resolve(scope).degraded ?? []) {
      findings.push({ scope: scope.name, kind: 'empty-leaf', detail });
    }
    for (const target of dependsOnTargets(scope)) {
      if (!ctx.isNode(target))
        findings.push({ scope: scope.name, kind: 'dangling-dependency', detail: target });
    }
    for (const ref of scope.attach ?? []) {
      if (!ctx.isPiece(ref))
        findings.push({ scope: scope.name, kind: 'missing-attach', detail: ref });
    }
  }
  return findings;
}

function dependsOnTargets(scope: Scope): string[] {
  const targets: string[] = [];
  const walk = (expr: ScopeExpr): void => {
    if ('dependsOn' in expr) targets.push(expr.dependsOn);
    else if ('any' in expr) expr.any.forEach(walk);
    else if ('all' in expr) expr.all.forEach(walk);
  };
  walk(scope.include);
  if (scope.exclude) walk(scope.exclude);
  return targets;
}
