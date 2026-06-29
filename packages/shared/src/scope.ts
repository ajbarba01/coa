import { z } from 'zod';
import type { ScopeRef } from './ids.js';

/**
 * Scope membership (the SCO-* family). A scope's membership is a composable
 * expression over tag / glob / graph-query leaves with set algebra and
 * composition (SCO-1); M1 owns resolution, M0 owns the type.
 */

/** A composable membership expression (SCO-1). Recursive via `any`/`all`/`scope`. */
export type ScopeExpr =
  | { tag: string }
  | { glob: string }
  | { dependsOn: string }
  | { reachableFrom: string }
  | { scope: ScopeRef }
  | { any: ScopeExpr[] }
  | { all: ScopeExpr[] };

export const scopeExprSchema: z.ZodType<ScopeExpr> = z.lazy(() =>
  z.union([
    z.object({ tag: z.string() }),
    z.object({ glob: z.string() }),
    z.object({ dependsOn: z.string() }),
    z.object({ reachableFrom: z.string() }),
    z.object({ scope: z.string() }),
    z.object({ any: z.array(scopeExprSchema) }),
    z.object({ all: z.array(scopeExprSchema) }),
  ]),
);

/** A named scope (SCO-1; supersedes glob-only D32). `attach` = SCO-4 delivery; `mayDependOn` = SCO-6 (deferred-enforce). */
export const scopeSchema = z.object({
  name: z.string(),
  include: scopeExprSchema,
  exclude: scopeExprSchema.optional(),
  attach: z.array(z.string()).optional(),
  mayDependOn: z.array(z.string()).optional(),
});
export type Scope = z.infer<typeof scopeSchema>;

/** The cached membership projection + WAL freshness stamp (SCO-2). `degraded` records leaves that resolved to nothing. */
export const scopeResolutionSchema = z.object({
  scope: z.string(),
  members: z.array(z.string()),
  walPosition: z.number(),
  degraded: z.array(z.string()).optional(),
});
export type ScopeResolution = z.infer<typeof scopeResolutionSchema>;

/** A record of one SCO-4 delivery firing (which scope, what was injected/suppressed, and why) — SCO-4/5. */
export const scopeActivationSchema = z.object({
  scope: z.string(),
  trigger: z.enum(['read', 'edit', 'mention', 'session']),
  injected: z.array(z.string()),
  suppressed: z.array(z.string()),
  why: z.string(),
});
export type ScopeActivation = z.infer<typeof scopeActivationSchema>;
