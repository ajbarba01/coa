import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_BUILTINS, NOT_MODEL_VISIBLE } from '../tool-frame.js';

/**
 * Tool-catalogue drift guard. SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 *
 * `KNOWN_BUILTINS` decides which tool names survive into the transport; a name missing
 * from it is silently dropped, which is how a granted `Agent` disappeared. Upstream ships
 * ~27 releases a month, so the list needs a tripwire rather than good intentions: every
 * `<Name>Input` schema the SDK generates must be classified as either a grantable tool or
 * explicitly not model-visible. A new or renamed tool fails here and names itself.
 *
 * Only `Input` is scanned: `TaskOutput` has an input schema and no output schema, so
 * matching on both would miss it.
 */

/** Schema type names that do not equal the model-visible tool name. */
const SCHEMA_ALIASES: Readonly<Record<string, string>> = {
  FileRead: 'Read',
  FileWrite: 'Write',
  FileEdit: 'Edit',
};

function sdkToolSchemaNames(): string[] {
  const require_ = createRequire(import.meta.url);
  // Resolve the package's entry point, not its manifest: the SDK's `exports` map does
  // not expose `./package.json`, so resolving it directly throws
  // `ERR_PACKAGE_PATH_NOT_EXPORTED`. The entry point sits in the same directory as
  // `sdk-tools.d.ts`, so its dirname works just as well.
  const entry = require_.resolve('@anthropic-ai/claude-agent-sdk');
  const raw = readFileSync(join(dirname(entry), 'sdk-tools.d.ts'), 'utf8');
  const names = new Set<string>();
  for (const m of raw.matchAll(/^export (?:interface|declare type) ([A-Za-z]+)Input\b/gm)) {
    const schema = m[1]!;
    names.add(SCHEMA_ALIASES[schema] ?? schema);
  }
  return [...names].sort();
}

describe('the pinned SDK tool catalogue', () => {
  it('generates the schema count this classification was built against', () => {
    // A bare count change is the cheapest possible drift signal and localises the failure
    // before the per-name assertion below produces a longer diff.
    expect(sdkToolSchemaNames()).toHaveLength(39);
  });

  it('classifies every generated tool schema as grantable or not model-visible', () => {
    const unclassified = sdkToolSchemaNames().filter(
      (name) => !KNOWN_BUILTINS.has(name) && !NOT_MODEL_VISIBLE.has(name),
    );
    expect(
      unclassified,
      `The SDK generates tool schemas coa has not classified: ${unclassified.join(', ')}. ` +
        'Add each to KNOWN_BUILTINS (a name coa may grant) or NOT_MODEL_VISIBLE (internal ' +
        'plumbing) in tool-frame.ts, then re-stamp the version in this file.',
    ).toEqual([]);
  });

  it('grants no name the pinned SDK does not ship, except the legacy delegation spelling', () => {
    // `Task` has no generated schema — it survives only as the name `system:init` still
    // advertises. Every other grantable name must correspond to a real schema.
    const shipped = new Set(sdkToolSchemaNames());
    const orphans = [...KNOWN_BUILTINS].filter((name) => !shipped.has(name) && name !== 'Task');
    expect(
      orphans,
      `coa grants names the pinned SDK no longer ships: ${orphans.join(', ')}`,
    ).toEqual([]);
  });
});
