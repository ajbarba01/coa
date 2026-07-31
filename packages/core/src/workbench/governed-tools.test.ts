import { describe, expect, test, it } from 'vitest';
import type { InjectionBundle, SymbolRecord } from '@coa/shared';
import { buildGovernedTools, type GovernedToolDeps } from './governed-tools.js';
import type { BaseToolDeps } from './base-tools.js';

const RECORD: SymbolRecord = { name: 'parseConfig', definedIn: 'src/config.ts' };
const BUNDLE: InjectionBundle = { groups: [{ concernKey: 'c1', flags: [] }] };

function makeDeps(over: Partial<DepOverrides> = {}): GovernedToolDeps {
  return {
    sessionId: 's1',
    retrieve: {
      worktreeRoot: '/wt',
      lookupSymbol: over.lookupSymbol ?? (() => undefined),
      outline: () => [],
      references: () => [],
      resolvePiece: () => undefined,
    },
    mutate: {
      worktreeRoot: '/wt',
      worktree: 'wt',
      readFile: () => '',
      writeFile: () => {},
      emit: () => 1,
    },
    inspect: {
      runChecks: () => ({ expanded: [], collapsed: [] }),
      capState: () => ({ remaining: null, capHit: false }),
      decisionsByTarget: () => [],
      readDecision: () => undefined,
    },
    enrich: {
      oracle: {
        lookup: over.lookupSymbol ?? (() => undefined),
        fuzzyMatch: () => [],
        walPosition: () => 0,
      },
      flagsForAgent: over.flagsForAgent ?? (() => ({ groups: [] })),
    },
  };
}

interface DepOverrides {
  lookupSymbol: (name: string) => SymbolRecord | undefined;
  flagsForAgent: (scope?: string) => InjectionBundle;
}

describe('buildGovernedTools', () => {
  test('get_symbol routes to the retrieve read and enriches with gated flags', async () => {
    const tools = buildGovernedTools(
      makeDeps({
        lookupSymbol: (n) => (n === 'parseConfig' ? RECORD : undefined),
        flagsForAgent: () => BUNDLE,
      }),
    );
    const tool = tools.find((t) => t.name === 'get_symbol');
    const res = await tool!.invoke({ ref: { name: 'parseConfig' } });
    expect(res.result).toEqual({ found: true, symbol: RECORD });
    expect(res.flags).toEqual(BUNDLE);
  });

  test('a malformed input is rejected as an unapplied result, never thrown (D141(c)/SC-1)', async () => {
    const tools = buildGovernedTools(makeDeps());
    const tool = tools.find((t) => t.name === 'get_symbol');
    const res = await tool!.invoke({ ref: { wrong: 'shape' } });
    expect(res.result).toMatchObject({ applied: false, error: { code: 'invalid-args' } });
    expect(res.handle).toBe('get_symbol:invalid-args');
  });

  test('edit_symbol dispatches through producer ① and emits one change-event', async () => {
    const emitted: string[] = [];
    const deps = makeDeps();
    deps.mutate.readFile = () => 'export const a = 1;\n';
    deps.mutate.writeFile = () => {};
    deps.mutate.emit = (draft) => {
      emitted.push(draft.path);
      return 7;
    };
    const tool = buildGovernedTools(deps).find((t) => t.name === 'edit_symbol');
    const res = await tool!.invoke({
      ref: { path: 'src/a.ts' },
      diff: { form: 'search-replace', hunks: [{ find: 'const a = 1', replace: 'const a = 2' }] },
    });
    expect(res.result).toEqual({ applied: true, path: 'src/a.ts', seq: 7 });
    expect(emitted).toEqual(['src/a.ts']);
  });

  test('a symbol near-miss attaches an advisory grounding block (F6/L-GND)', async () => {
    const deps = makeDeps({ lookupSymbol: () => undefined });
    deps.enrich.oracle.fuzzyMatch = () => [
      {
        symbol: { name: 'parseConfig', definedIn: 'src/config.ts' },
        confidence: 0.9,
        why: 'edit distance 1',
      },
    ];
    const tool = buildGovernedTools(deps).find((t) => t.name === 'get_symbol');
    const res = await tool!.invoke({ ref: { name: 'parseConfgi' } });
    expect(res.grounding?.named).toBe('parseConfgi');
    expect(res.grounding?.suggestions[0]?.symbol).toBe('parseConfig');
  });

  test('builds exactly the v1 catalogue, carrying each tool its manifest partition', () => {
    const tools = buildGovernedTools(makeDeps());
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'apply_patch',
        'context_status',
        'edit_symbol',
        'find_references',
        'get_decision',
        'get_piece',
        'get_spec',
        'get_symbol',
        'outline',
        'run_checks',
        'why',
      ].sort(),
    );
    expect(tools.find((t) => t.name === 'edit_symbol')?.partition).toBe('kernel');
    expect(tools.find((t) => t.name === 'why')?.partition).toBe('on-demand');
  });
});

const BASE_NAMES = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'];

function baseDeps(): BaseToolDeps {
  return {
    worktreeRoot: '/repo',
    worktree: 'main',
    readFile: () => '',
    writeFile: () => {},
    fileExists: () => false,
    listFiles: () => [],
    searchFiles: () => [],
    exec: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    emit: () => 0,
  };
}

describe('buildGovernedTools — web-tool gate', () => {
  const webDeps = () => ({
    searchChain: async () => ({
      status: 'ok' as const,
      value: [{ title: 'T', url: 'https://x.test', snippet: 'S' }],
      clean: true,
    }),
    fetchChain: async () => ({ status: 'ok' as const, value: 'hi', clean: false }),
  });

  it('omits web tools by default', () => {
    const names = buildGovernedTools(makeDeps()).map((t) => t.name);
    expect(names).not.toContain('WebSearch');
    expect(names).not.toContain('WebFetch');
  });

  it('includes WebSearch/WebFetch when deps.web is set', () => {
    const names = buildGovernedTools(
      { ...makeDeps(), web: webDeps() },
      { includeWebTools: true },
    ).map((t) => t.name);
    expect(names).toContain('WebSearch');
    expect(names).toContain('WebFetch');
  });

  it('awaits the async WebSearch dispatch so enrich sees the resolved response, not a Promise', async () => {
    const tools = buildGovernedTools({ ...makeDeps(), web: webDeps() }, { includeWebTools: true });
    const tool = tools.find((t) => t.name === 'WebSearch');
    const res = await tool!.invoke({ query: 'q' });
    expect(res.result).toEqual({ results: [{ title: 'T', url: 'https://x.test', snippet: 'S' }] });
  });
});

describe('buildGovernedTools — base-tool gate', () => {
  it('omits base tools by default', () => {
    const names = buildGovernedTools(makeDeps()).map((t) => t.name);
    for (const n of BASE_NAMES) expect(names).not.toContain(n);
  });

  it('includes the six base tools when includeBaseTools is set', () => {
    const names = buildGovernedTools(
      { ...makeDeps(), base: baseDeps() },
      { includeBaseTools: true },
    ).map((t) => t.name);
    for (const n of BASE_NAMES) expect(names).toContain(n);
  });

  it('a base tool invoke returns an unapplied result on a bad path (SC-1, never throws)', async () => {
    const tools = buildGovernedTools(
      { ...makeDeps(), base: baseDeps() },
      { includeBaseTools: true },
    );
    const read = tools.find((t) => t.name === 'Read');
    const res = await read?.invoke({ path: '../escape' });
    expect((res?.result as { found: boolean }).found).toBe(false);
  });
});
