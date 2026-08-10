import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { GenerationRelation } from './ssot-constraint.js';

/**
 * L-GEN (GEN-2) — the committed, portable `.coa/generate.yaml` registry that
 * maps each declared generator, **validated at load**: a malformed relation, an
 * unknown `run_on` trigger, or an unknown `normalize` mode is **rejected loudly**,
 * never loaded as a silent no-op (mirrors the SCO-3 `.coa/scopes.yaml` posture).
 *
 * A {@link GenerationEntry} is the producer-facing {@link GenerationRelation}
 * (name/source/target/lang + the GEN-8 normalize flags) **widened** with the
 * runner-facing execution detail (`command`, pinned `version`, `runOn`); because
 * it structurally extends the relation, an `GenerationEntry[]` is accepted wherever
 * a `GenerationRelation[]` is wanted (the SSOT-constraint producer reads only the
 * relation fields), while the runner reads `command`/`version` to regenerate.
 */

/** When the daemon regenerates a relation (GEN-2). The producer activation is `on-source-change`. */
export type RunTrigger = 'source-change' | 'idle' | 'demand';

/** A `.coa/generate.yaml` row: a {@link GenerationRelation} plus its runner execution detail. */
export interface GenerationEntry extends GenerationRelation {
  /** The pinned generator invocation the runner orchestrates (never reimplemented). */
  readonly command: string;
  /** The pinned generator version (a declared input; a bump is a separate attributed event). */
  readonly version: string;
  /** When the daemon regenerates this relation; defaults to `['source-change']`. */
  readonly runOn: readonly RunTrigger[];
}

const normalizeSchema = z.enum(['strip-banner', 'sort-keys']);
const runTriggerSchema = z.enum(['source-change', 'idle', 'demand']);

const entryBodySchema = z.object({
  source: z.string(),
  target: z.string(),
  lang: z.string(),
  command: z.string(),
  version: z.string(),
  run_on: z.array(runTriggerSchema).optional(),
  normalize: z.array(normalizeSchema).optional(),
  ignore_regions: z.array(z.tuple([z.number(), z.number()])).optional(),
});

const configSchema = z.object({
  relations: z.record(z.string(), entryBodySchema).optional(),
});

/** Parse + validate a raw `.coa/generate.yaml` document into typed entries. */
export function validateGenerateConfig(raw: unknown): GenerationEntry[] {
  const parsed = configSchema.parse(raw);
  return Object.entries(parsed.relations ?? {}).map(([name, body]) => toEntry(name, body));
}

/** Load + validate a generate file; an absent file is an empty (valid) registry. */
export function loadGenerateFile(path: string): GenerationEntry[] {
  if (!existsSync(path)) return [];
  return validateGenerateConfig(parseYaml(readFileSync(path, 'utf8')) ?? {});
}

function toEntry(name: string, body: z.infer<typeof entryBodySchema>): GenerationEntry {
  const normalize = body.normalize ?? [];
  return {
    name,
    source: body.source,
    target: body.target,
    lang: body.lang,
    command: body.command,
    version: body.version,
    runOn: body.run_on ?? ['source-change'],
    ...(normalize.includes('strip-banner') ? { stripBanner: true } : {}),
    ...(normalize.includes('sort-keys') ? { sortKeys: true } : {}),
    ...(body.ignore_regions !== undefined ? { ignoreRegions: body.ignore_regions } : {}),
  };
}
