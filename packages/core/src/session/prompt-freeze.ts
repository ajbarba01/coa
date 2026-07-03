import { createHash } from 'node:crypto';
import type { CapabilityFrame, NeutralConfig } from '@coa/shared';

/**
 * M8 — prompt freezing (SPEC: caching is a prefix match; any byte change in the
 * prefix invalidates everything after it). A session compiles its system prompt
 * ONCE, at the first turn, and every later turn reuses that frozen compilation
 * verbatim — so the provider's prompt cache stays warm and the prompt never drifts
 * silently under the conversation. Recompiling is a deliberate, user-raised act
 * (the drift banner), not a per-turn side effect.
 *
 * The frozen compilation is the backend-neutral {@link NeutralConfig} plus the
 * {@link CapabilityFrame} it was built with (tools are part of the cached prefix
 * too, so they freeze together). `promptVersion` is a stable content hash of the
 * neutral config — the identity the resume stamp and drift check compare against.
 */
export interface FrozenCompilation {
  neutral: NeutralConfig;
  frame: CapabilityFrame;
  /** Stable content hash of {@link neutral} — bumped only on a deliberate recompile. */
  promptVersion: string;
  /** The drift key: hash of the config that PRODUCED this prompt (role + package
   *  selection, never the model). On a later send, a differing current configHash
   *  means the governance config changed under the frozen prompt — the signal the
   *  drift banner raises (recompile / apply-as-update / keep). */
  configHash: string;
  /** The source config the running prompt was compiled from (role + package selection).
   *  Exposed to the console (via the session summary) so it can detect drift predictively
   *  — comparing the config a send WOULD use against what the running prompt reflects. */
  config: PromptConfig;
}

/**
 * The drift-relevant slice of a session's prompt configuration — the inputs that
 * SHAPE the compiled prompt (the role and the package selection layered on it),
 * deliberately excluding the model/reasoning (which must never change the prompt)
 * and the dynamic runtime facts (worktree/date). Two sessions with the same
 * {@link configHashOf} compile to the same governance prompt.
 */
export interface PromptConfig {
  role: string;
  /** The chosen roles (canonical going forward); a sorted copy so selection order
   *  never spuriously trips drift. Absent ⇒ falls back to `role` (single-role callers). */
  roles?: readonly string[] | undefined;
  packageIds?: readonly string[] | undefined;
  exclude?: readonly string[] | undefined;
}

/** Deterministic JSON (object keys sorted at every depth) so the hash is stable
 *  regardless of key insertion order — the same silent-invalidator discipline the
 *  cache itself needs. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** The stable identity of a compiled prompt — two configs that render to the same
 *  bytes share a version; any material change produces a new one. */
export function promptVersionOf(neutral: NeutralConfig): string {
  return createHash('sha256').update(stableStringify(neutral)).digest('hex').slice(0, 16);
}

/** Order- and duplicate-independent, side-effect-free hash of the drift-relevant
 *  config. Package selections are treated as sets (deduped + sorted) so a mere
 *  reordering is never counted as drift; an omitted selection hashes like an empty
 *  one. Never folds in the model, so a model switch leaves this hash unchanged. */
export function configHashOf(config: PromptConfig): string {
  const asSet = (ids: readonly string[] | undefined): string[] => [...new Set(ids ?? [])].sort();
  // Roles are the canonical role selection; a config with no `roles` falls back to
  // the singular `role` so legacy single-role configs still hash correctly.
  const roles = config.roles ?? (config.role !== '' ? [config.role] : []);
  const canonical = {
    role: config.role,
    roles: asSet(roles),
    packageIds: asSet(config.packageIds),
    exclude: asSet(config.exclude),
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex').slice(0, 16);
}

/** Whether the current config would compile a different prompt than the frozen one —
 *  the deterministic drift signal. Dismissal ("keep") is banner state, not detection,
 *  so this stays a pure comparison. */
export function promptHasDrifted(frozen: { configHash: string }, current: PromptConfig): boolean {
  return frozen.configHash !== configHashOf(current);
}
