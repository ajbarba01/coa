// Archived (exploratory half) from
// packages/adapter-claude-sdk/src/control/stage-1-2-session-construction.test.ts.
// These probes measured levers no shipped code uses: toolAliases, the `agents`
// map, plugins, single-`agent` selection, and managedSettings. The
// `captureInitialize` stdio harness and `captureSpawn` they ran on remain in the
// in-tree suite, which keeps the probes shipped code relies on.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('stage 1 — what the model is (archived probes)', () => {
  it('a single named `agent` (main-thread agent selection, distinct from the `agents` map) reaches argv via --agent', async () => {
    // Options.agent (singular string) selects a predefined/registered agent for
    // the main thread and IS an argv-level lever, unlike Options.agents (the
    // Record<string,AgentDefinition> map — see stage 2 / stage 7, which is
    // stdio-protocol-only). Easy to conflate; kept as separate assertions.
    const capture = await captureSpawn({
      agent: 'code-reviewer',
      agents: { 'code-reviewer': { description: 'x', prompt: 'y' } },
      settingSources: [],
    });
    expect(capture.flag('--agent')).toBe('code-reviewer');
    // And the `agents` map itself is NOT on argv (confirmed generally in stage 2).
    expect(capture.argv.join(' ')).not.toContain("code-reviewer',");
  });

  it('managedSettings reaches argv via --managed-settings', async () => {
    // Read literally: sdk.mjs pushes `this.options.managedSettings` as the flag
    // VALUE directly (not JSON.stringify'd in the argv builder itself). Probe
    // the observed runtime shape rather than assuming either way.
    const capture = await captureSpawn({
      managedSettings: { model: 'claude-sonnet-4-6' },
      settingSources: [],
    });
    expect(capture.hasFlag('--managed-settings')).toBe(true);
  });
});

describe('stage 2 — what tools exist (archived probes)', () => {
  it('FINDING: toolAliases does NOT reach argv', async () => {
    // The plan's draft hypothesis (`expect(argv).toContain('mcp__coa__spawn_agent')`)
    // does not hold: toolAliases is stdio-protocol-only. This is the negative
    // half, backed directly by captureSpawn.
    const capture = await captureSpawn({
      toolAliases: { Agent: 'mcp__coa__spawn_agent' },
      settingSources: [],
    });
    expect(capture.argv.join(' ')).not.toContain('mcp__coa__spawn_agent');
    expect(capture.argv.some((a) => /alias/i.test(a))).toBe(false);
  });

  it('THE highest-value probe: toolAliases reaches the stdio initialize request verbatim, keyed by the native name', async () => {
    const capture = await captureInitialize({
      toolAliases: { Agent: 'mcp__coa__spawn_agent' },
      settingSources: [],
    });
    expect(capture.request).toBeDefined();
    expect(capture.request?.['toolAliases']).toEqual({ Agent: 'mcp__coa__spawn_agent' });
  });

  it('falsification: aliasing a name that is NOT a real native tool is sent through unvalidated by the SDK wrapper', async () => {
    // Does the SDK's own JS layer validate alias keys against a known-tool
    // list before it ever reaches the CLI? Observed: no — the wrapper does a
    // structural pass-through (`toolAliases: this.initConfig?.toolAliases`,
    // no filtering). This settles ONLY the SDK-wrapper half of the question;
    // whether the CLI BINARY then accepts, ignores, or errors on an alias for
    // a name that is not a real tool cannot be settled offline — the binary
    // never runs against this stub, and the stub never answers the control
    // protocol, so no control_response (success or error) is ever observed.
    // That half is pushed to the live probe file.
    const capture = await captureInitialize({
      toolAliases: {
        TotallyNotARealNativeTool: 'mcp__coa__spawn_agent',
        Bash: 'mcp__coa__bash',
      },
      settingSources: [],
    });
    expect(capture.request?.['toolAliases']).toEqual({
      TotallyNotARealNativeTool: 'mcp__coa__spawn_agent',
      Bash: 'mcp__coa__bash',
    });
  });

  it('a single-hop alias chain is passed through as given — the SDK wrapper does not resolve or reject chains itself', async () => {
    // Options docstring: "an alias that points at another aliased name resolves
    // that target literally rather than following a chain" — that resolution
    // is a CLI-side behavior. Offline, the only assertion available is that
    // the wrapper forwards the chain-shaped map unchanged; it does not detect
    // or collapse the cycle client-side.
    const capture = await captureInitialize({
      toolAliases: { A: 'B', B: 'A' },
      settingSources: [],
    });
    expect(capture.request?.['toolAliases']).toEqual({ A: 'B', B: 'A' });
  });

  it('agents (the Record<string,AgentDefinition> map) does NOT reach argv', async () => {
    const capture = await captureSpawn({
      agents: { worker: { description: 'a governed child', prompt: 'You are a worker.' } },
      settingSources: [],
    });
    expect(capture.argv.join(' ')).not.toContain('worker');
    expect(capture.hasFlag('--agents')).toBe(false);
  });

  it('agents reaches the stdio initialize request as the full definition object', async () => {
    const def = {
      description: 'a governed child',
      prompt: 'You are a coa-governed worker.',
      model: 'haiku',
      tools: ['Read'],
    };
    const capture = await captureInitialize({ agents: { worker: def }, settingSources: [] });
    expect(capture.request?.['agents']).toEqual({ worker: def });
  });

  it('plugins (local type) reach argv via --plugin-dir, unlike agents/skills-as-map/toolAliases', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-probe-plugin-'));
    const capture = await captureSpawn({
      plugins: [{ type: 'local', path: dir }],
      settingSources: [],
    });
    expect(capture.hasFlag('--plugin-dir')).toBe(true);
    expect(capture.flag('--plugin-dir')).toBe(dir);
  });

  it('a plugin with skipMcpDiscovery uses --plugin-dir-no-mcp instead', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coa-probe-plugin-nomcp-'));
    const capture = await captureSpawn({
      plugins: [{ type: 'local', path: dir, skipMcpDiscovery: true }],
      settingSources: [],
    });
    expect(capture.hasFlag('--plugin-dir-no-mcp')).toBe(true);
    expect(capture.hasFlag('--plugin-dir')).toBe(false);
  });
});

// ===========================================================================
// Falsification pass — try to break the positive results above
// ===========================================================================

describe('stage 1-2 — falsification', () => {
  it('an empty toolAliases object still reaches the initialize request (not coalesced away)', async () => {
    const capture = await captureInitialize({ toolAliases: {}, settingSources: [] });
    expect(capture.request?.['toolAliases']).toEqual({});
  });

  it('toolAliases and a real allowedTools/disallowedTools set do not interact on the wire (separate channels, as documented)', async () => {
    const capture = await captureInitialize({
      toolAliases: { Bash: 'mcp__coa__bash' },
      disallowedTools: ['Bash'],
      settingSources: [],
    });
    // Both reach their respective channels independently: disallowedTools is
    // argv (asserted via captureSpawn elsewhere in stage 7); toolAliases is
    // stdio. Neither one is silently dropped by the presence of the other.
    expect(capture.request?.['toolAliases']).toEqual({ Bash: 'mcp__coa__bash' });
    expect(capture.argv.join(',')).toContain('Bash');
  });

  it('an unrelated Options field set alongside toolAliases does not suppress the initialize request entirely', async () => {
    const capture = await captureInitialize({
      toolAliases: { Agent: 'mcp__coa__spawn_agent' },
      model: 'claude-opus-4-6',
      settingSources: [],
      strictMcpConfig: true,
    });
    expect(capture.request).toBeDefined();
    expect(capture.request?.['toolAliases']).toEqual({ Agent: 'mcp__coa__spawn_agent' });
  });
});
