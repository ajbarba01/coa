import type {
  CanonicalizationProfile,
  FlagRecord,
  Patch,
  Producer,
  ProducerInput,
} from '@coa/shared';
import { canonicalize } from '@coa/code-intel';

/**
 * M4 / L-GEN — the SSOT-as-constraint producer (GEN-3), the rank-1 deterministic
 * replacement for the staleness *guess*. Per declared relation it regenerates the
 * target from its source (pinned generator, via the injected runner) → canonicalizes
 * both the fresh output and the checked-in copy (M2 G0) → byte-compares. Different
 * ⇒ a Type-1, may-block, auto-patchable `generated-stale:<name>` flag whose `fix`
 * writes the fresh output. Identical ⇒ PASS (zero tokens, zero judgment). It is
 * sound because it runs the same generator+version the build uses and is purely
 * deterministic (P1) — no model on this path.
 *
 * Soundness is proven before it is claimed (GEN-8): at construction each relation
 * runs the reproducibility self-test (regenerate twice from unchanged source; if
 * the canonical forms differ the generator is non-reproducible) and binary /
 * non-canonicalizable output is detected. A relation that fails either is REFUSED
 * a Type-1 constraint and reported in `degraded` for the detection-only path
 * (origin_anchor / L-DET) to pick up — coa never ships a Type-1 it cannot prove.
 *
 * The generator invocation itself is the injected {@link GenerationRunner} (the
 * GEN-2 `coa generate` runner orchestrates real generators in a fixed environment);
 * this producer stays a pure function of the runner's output so it is fully
 * testable and never shells out itself.
 */

/** One declared source→target generation relation (a row of `.coa/generate.yaml`). */
export interface GenerationRelation {
  readonly name: string;
  readonly source: string;
  readonly target: string;
  /** The target's `lang` id, for the M2 canonicalization profile. */
  readonly lang: string;
  /** GEN-8 `strip-banner` normalization (drops a volatile leading codegen banner). */
  readonly stripBanner?: boolean;
  /**
   * GEN-8 `sort-keys` normalization (parse → re-serialize sorted, defeats unstable ordering).
   * Threaded to the M2 canonicalization profile; canonicalize defers the actual reorder to a
   * later tier, so until then a relation that relies on it self-tests as non-reproducible and
   * degrades to detection-only — never a false Type-1.
   */
  readonly sortKeys?: boolean;
  /** GEN-8 named, bounded ignore-regions (blanked before canonicalization). */
  readonly ignoreRegions?: ReadonlyArray<readonly [number, number]>;
}

/** The runner's regenerate result: canonicalizable text, or non-canonicalizable binary. */
export type RegenOutput =
  | { readonly kind: 'text'; readonly bytes: string }
  | { readonly kind: 'binary' };

/** The injected generator port — regenerate fresh output, and read the checked-in copy. */
export interface GenerationRunner {
  /** Regenerate the relation's output fresh from current source (pinned version, fixed env). */
  regenerate(relation: GenerationRelation): RegenOutput;
  /** Read the relation target's current checked-in bytes. */
  readTarget(relation: GenerationRelation): string;
}

/** A relation refused a Type-1 constraint by the GEN-8 self-test, routed to the detection-only path. */
export interface DegradedRelation {
  readonly name: string;
  readonly reason: 'non-reproducible' | 'non-canonicalizable';
}

export interface SsotConstraintProducer {
  /** The M3 Type-1 producer over the reproducible relations. */
  readonly producer: Producer;
  /** Relations excluded from the Type-1 producer (origin_anchor / L-DET territory). */
  readonly degraded: readonly DegradedRelation[];
}

const RULE_PREFIX = 'generated-stale';
const GOLDEN_GOOD = '__coa_ssot_golden_good__';
const GOLDEN_BAD = '__coa_ssot_golden_bad__';

/**
 * Build the SSOT-constraint producer over `relations`, gating each on the GEN-8
 * reproducibility self-test. Returns the Type-1 producer plus the relations that
 * degraded to detection-only.
 */
export function createSsotConstraintProducer(
  relations: readonly GenerationRelation[],
  runner: GenerationRunner,
): SsotConstraintProducer {
  const reproducible: GenerationRelation[] = [];
  const degraded: DegradedRelation[] = [];

  for (const relation of relations) {
    const reason = selfTest(relation, runner);
    if (reason === undefined) reproducible.push(relation);
    else degraded.push({ name: relation.name, reason });
  }

  const byName = new Map(reproducible.map((relation) => [relation.name, relation]));

  const producer: Producer = {
    id: 'ssot-constraint',
    kind: 'deterministic',
    activation: 'on-source-change',
    run: (input) => run(input, reproducible, runner),
    fix: (flag) => fixFor(flag, byName, runner),
    golden: {
      good: { kind: 'scope', scope: GOLDEN_GOOD },
      bad: { kind: 'scope', scope: GOLDEN_BAD },
    },
  };

  return { producer, degraded };
}

/** GEN-8 — regenerate twice from unchanged source; binary or differing canonical forms fail. */
function selfTest(
  relation: GenerationRelation,
  runner: GenerationRunner,
): DegradedRelation['reason'] | undefined {
  const first = runner.regenerate(relation);
  const second = runner.regenerate(relation);
  if (first.kind === 'binary' || second.kind === 'binary') return 'non-canonicalizable';
  if (canon(relation, first.bytes) !== canon(relation, second.bytes)) return 'non-reproducible';
  return undefined;
}

function run(
  input: ProducerInput,
  relations: readonly GenerationRelation[],
  runner: GenerationRunner,
): FlagRecord[] {
  if (input.kind === 'scope') {
    if (input.scope === GOLDEN_GOOD) return goldenCase('identical');
    if (input.scope === GOLDEN_BAD) return goldenCase('drifted');
    return relations.flatMap((relation) => check(relation, runner));
  }
  if (input.kind === 'change') {
    const path = 'path' in input.event ? input.event.path : undefined;
    return relations
      .filter((relation) => relation.source === path || relation.target === path)
      .flatMap((relation) => check(relation, runner));
  }
  return [];
}

/** Regenerate, canonicalize fresh vs checked-in, and emit a stale flag on a real (post-G0) drift. */
function check(relation: GenerationRelation, runner: GenerationRunner): FlagRecord[] {
  const fresh = runner.regenerate(relation);
  if (fresh.kind === 'binary') return [];
  if (canon(relation, fresh.bytes) === canon(relation, runner.readTarget(relation))) return [];
  return [staleFlag(relation, fresh.bytes)];
}

function staleFlag(relation: GenerationRelation, fresh: string): FlagRecord {
  const ruleId = `${RULE_PREFIX}:${relation.name}`;
  return {
    ruleId,
    location: relation.target,
    severity: 'high',
    message: `${relation.target} is stale: regenerating from ${relation.source} produces different output — apply the fix to refresh it.`,
    fix: { target: relation.target, diff: { form: 'whole-file', body: fresh } },
    fingerprint: `${ruleId}:${relation.target}`,
    type: 1,
    confidence: 'high',
    concernKey: ruleId,
  };
}

/** CF-3 — the visible auto-patch: the captured fresh output, or a fresh regeneration as fallback. */
function fixFor(
  flag: FlagRecord,
  byName: ReadonlyMap<string, GenerationRelation>,
  runner: GenerationRunner,
): Patch {
  if (flag.fix !== undefined) return flag.fix;
  const relation = byName.get(nameFromRuleId(flag.ruleId));
  if (relation !== undefined) {
    const fresh = runner.regenerate(relation);
    if (fresh.kind === 'text') {
      return { target: relation.target, diff: { form: 'whole-file', body: fresh.bytes } };
    }
  }
  return { target: flag.location, diff: { form: 'whole-file', body: '' } };
}

/** The CF-6 golden pair exercises the real canonicalize+compare discrimination, runner-independent. */
function goldenCase(kind: 'identical' | 'drifted'): FlagRecord[] {
  const relation: GenerationRelation = {
    name: '__golden__',
    source: '__golden.src__',
    target: '__golden.ts__',
    lang: 'typescript',
  };
  const fresh = 'const x = 1;';
  const checkedIn = kind === 'identical' ? 'const x = 1;' : 'const x = 2;';
  if (canon(relation, fresh) === canon(relation, checkedIn)) return [];
  return [staleFlag(relation, fresh)];
}

function canon(relation: GenerationRelation, bytes: string): string {
  const profile: CanonicalizationProfile = {
    lang: relation.lang,
    ...(relation.stripBanner !== undefined ? { stripBanner: relation.stripBanner } : {}),
    ...(relation.sortKeys !== undefined ? { sortKeys: relation.sortKeys } : {}),
    ...(relation.ignoreRegions !== undefined
      ? {
          ignoreRegions: relation.ignoreRegions.map(
            ([start, end]) => [start, end] as [number, number],
          ),
        }
      : {}),
  };
  return canonicalize(bytes, profile).canonicalBytes;
}

function nameFromRuleId(ruleId: FlagRecord['ruleId']): string {
  const id = Array.isArray(ruleId) ? (ruleId[0] ?? '') : ruleId;
  return id.startsWith(`${RULE_PREFIX}:`) ? id.slice(RULE_PREFIX.length + 1) : id;
}
