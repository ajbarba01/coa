import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The dependency-cruiser canary. The ruleset is only worth anything if a forbidden
 * edge is actually REPORTED — and the failure mode is silent: if workspace imports
 * stop resolving to package sources (say, a package's `development` exports
 * condition is dropped so `@coa/*` resolves to excluded `dist` files again), every
 * cross-package rule quietly stops matching and `pnpm depcruise` keeps reporting a
 * green "no violations". This test plants deliberately-forbidden edges and asserts
 * the cruiser (a) resolves them to source and (b) reports the violation, so the
 * ruleset can never go decorative without a red test.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const depcruiseBin = join(root, 'node_modules', '.bin', 'depcruise');

// Named so a stray copy (a crashed run) is self-explanatory; cleaned in afterEach.
const rendererCanary = join(root, 'apps/desktop/src/renderer/__depcruise-canary__.ts');
const kitCanary = join(root, 'packages/console-kit/src/__depcruise-canary__.ts');

interface Violation {
  rule: { name: string };
  from: string;
  to: string;
}

function cruise(files: string[]): Violation[] {
  const result = spawnSync(
    depcruiseBin,
    ['--config', '.dependency-cruiser.cjs', '--output-type', 'json', ...files],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error !== undefined) throw result.error;
  const parsed = JSON.parse(result.stdout) as { summary: { violations: Violation[] } };
  return parsed.summary.violations;
}

afterEach(() => {
  rmSync(rendererCanary, { force: true });
  rmSync(kitCanary, { force: true });
});

describe('dependency-cruiser canary', () => {
  it('resolves a bare @coa/* import to package source and reports the forbidden edge', () => {
    // The renderer legitimately has @coa/core in its app's dependency closure, so the
    // bare specifier resolves the way a real offending import would — through the
    // package's exports map. renderer-isolation must catch it.
    writeFileSync(rendererCanary, "import '@coa/core';\n");

    const violations = cruise(['apps/desktop/src/renderer/__depcruise-canary__.ts']);
    const hit = violations.find((v) => v.rule.name === 'renderer-isolation');

    expect(hit, `expected renderer-isolation among: ${JSON.stringify(violations)}`).toBeDefined();
    // The honesty core: the edge resolved to the package's SOURCE. If this were
    // dist (excluded from the graph) or unresolvable, no rule could ever fire on
    // a real cross-package import.
    expect(hit?.to).toBe('packages/core/src/index.ts');
  }, 120_000);

  it('reports a kit → transcript edge (the split the kit rule exists to protect)', () => {
    writeFileSync(kitCanary, "import '../../console-transcript/src/index.js';\n");

    const violations = cruise(['packages/console-kit/src/__depcruise-canary__.ts']);
    const hit = violations.find((v) => v.rule.name === 'kit-never-depends-on-the-transcript');

    expect(
      hit,
      `expected kit-never-depends-on-the-transcript among: ${JSON.stringify(violations)}`,
    ).toBeDefined();
    expect(hit?.to).toBe('packages/console-transcript/src/index.ts');
  }, 120_000);
});
