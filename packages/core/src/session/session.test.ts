import { describe, expect, it } from 'vitest';
import type { CapabilitySet, NeutralConfig, Piece } from '@coa/shared';
import type {
  BackendConfig,
  CanUseTool,
  RegisteredTool,
  RuntimeAdapter,
  RuntimeUsage,
  StopPredicate,
} from '@coa/spi';
import { SKILL_INDEX_PIECE_NAME } from '../library/injection.js';
import {
  createSession,
  closeSession,
  type SessionAdapterInit,
  type SessionDeps,
} from './session.js';

const AXES = {
  delivery: 'push',
  salience: 'never',
  provenance: 'authored',
} as const satisfies Piece['axes'];

/** One library skill delivered on demand (a `pull` Piece — no renderer folds it in). */
const pullSkill = (name: string): Piece => ({
  name,
  description: `${name} skill`,
  body: 'b',
  axes: { ...AXES, delivery: 'pull' },
});

/** The aggregated advertisement `resolveSkillConfigs` appends for a disclosure set. */
const skillIndex = (): Piece => ({
  name: SKILL_INDEX_PIECE_NAME,
  description: 'the on-demand skills available to this agent',
  body: 'load its full instructions with the get_piece tool',
  axes: AXES,
});

const NEUTRAL: NeutralConfig = {
  prefixHead: [],
  systemReminders: [],
  onDemandPullable: [],
  scopePushed: [],
  toolIntents: { allow: [], deny: [] },
};

const SANDBOX: CapabilitySet = {
  allowedTools: [],
  denyRules: [],
  permissionMode: 'default',
  denyRead: [],
};

class FakeAdapter implements RuntimeAdapter {
  readonly calls: string[] = [];
  canUseTool: CanUseTool | undefined;
  stopPredicate: StopPredicate | undefined;
  ranWith: { worktree: string } | undefined;
  constructor(readonly init: SessionAdapterInit) {}
  renderNative(config: NeutralConfig): BackendConfig {
    this.calls.push('renderNative');
    void config;
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {
    this.calls.push('registerTools');
  }
  denyBuiltins(): void {
    this.calls.push('denyBuiltins');
  }
  interceptTool(canUseTool: CanUseTool): void {
    this.calls.push('interceptTool');
    this.canUseTool = canUseTool;
  }
  interceptStop(stopPredicate: StopPredicate): void {
    this.calls.push('interceptStop');
    this.stopPredicate = stopPredicate;
  }
  async runLoop(config: { worktree: string }): Promise<void> {
    this.calls.push('runLoop');
    this.ranWith = { worktree: config.worktree };
    // Simulate the SDK settling a result so the onSettle → charge wire is exercised.
    this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 2, costUsd: 0.5 });
  }
}

interface Stats {
  charged: { sessionId: string; usage: RuntimeUsage }[];
  released: string[];
  checkpoints: number;
}

function harness(over: Partial<SessionDeps> = {}): {
  deps: SessionDeps;
  stats: Stats;
  adapter: () => FakeAdapter | undefined;
} {
  const stats: Stats = { charged: [], released: [], checkpoints: 0 };
  let built: FakeAdapter | undefined;
  const deps: SessionDeps = {
    newSessionId: () => 'sess-1',
    bindWorktree: () => '/repo/.coa/wt/sess-1',
    releaseWorktree: (wt) => stats.released.push(wt),
    assemblePieces: () => ({ pieces: [], frame: { allow: [], deny: [] } }),
    compile: () => NEUTRAL,
    sandboxPolicy: () => SANDBOX,
    charge: (sessionId, usage) => stats.charged.push({ sessionId, usage }),
    perToolDeny: () => undefined,
    gate: () => ({ allow: true }),
    catalogue: [],
    baseCatalogue: [],
    checkpoint: () => {
      stats.checkpoints += 1;
    },
    createAdapter: (init) => {
      built = new FakeAdapter(init);
      return built;
    },
    ...over,
  };
  return { deps, stats, adapter: () => built };
}

describe('createSession', () => {
  it('binds, compiles, renders, wires both hooks, then runs the loop in order', async () => {
    const h = harness();
    const session = await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    const adapter = h.adapter();

    expect(session.id).toBe('sess-1');
    expect(session.worktree).toBe('/repo/.coa/wt/sess-1');
    expect(adapter?.ranWith).toEqual({ worktree: '/repo/.coa/wt/sess-1' });
    expect(adapter?.calls).toEqual([
      'renderNative',
      'denyBuiltins',
      'registerTools',
      'interceptTool',
      'interceptStop',
      'runLoop',
    ]);
  });

  it('threads the assembly selection (packageIds + exclude) into assemblePieces', async () => {
    let seen: Parameters<SessionDeps['assemblePieces']>[0] | undefined;
    const h = harness({
      assemblePieces: (ctx) => {
        seen = ctx;
        return { pieces: [], frame: { allow: [], deny: [] } };
      },
    });
    await createSession(
      { role: 'swe', scope: 'src', input: 'go', packageIds: ['research'], exclude: ['core'] },
      h.deps,
    );
    expect(seen).toMatchObject({ packageIds: ['research'], exclude: ['core'] });
  });

  it('threads library skill Pieces into assemblePieces and the MCP map into the adapter init', async () => {
    let seen: Parameters<SessionDeps['assemblePieces']>[0] | undefined;
    const h = harness({
      assemblePieces: (ctx) => {
        seen = ctx;
        return { pieces: [], frame: { allow: [], deny: [] } };
      },
    });
    const skill = {
      name: 'commits',
      description: 'd',
      body: 'b',
      axes: {
        delivery: 'push' as const,
        salience: 'never' as const,
        provenance: 'authored' as const,
      },
    };
    const mcpServers = { gh: { transport: 'http' as const, url: 'https://mcp.example' } };
    await createSession(
      { role: 'swe', scope: 'src', input: 'go', skills: [skill], mcpServers },
      h.deps,
    );
    expect(seen?.skills).toEqual([skill]);
    expect(h.adapter()?.init.mcpServers).toEqual(mcpServers);
  });

  it('surfaces a package-referenced MCP server the library did not resolve (never silent)', async () => {
    const h = harness({
      assemblePieces: () => ({
        pieces: [],
        frame: { allow: [], deny: [] },
        mcpServers: ['gh', 'ghost'],
      }),
    });
    const frames: unknown[] = [];
    await createSession(
      {
        role: 'swe',
        scope: 'src',
        input: 'go',
        mcpServers: { gh: { transport: 'http', url: 'https://mcp.example' } },
        onTurn: (frame) => frames.push(frame),
      },
      h.deps,
    );
    expect(frames).toContainEqual(
      expect.objectContaining({
        t: 'error',
        origin: 'daemon',
        message: expect.stringContaining('ghost'),
      }),
    );
    // The resolved server is NOT named as unavailable.
    const messages = frames.map((f) => (f as { message?: string }).message ?? '');
    expect(messages.some((m) => m.includes('gh,') || m.includes(' gh '))).toBe(false);
  });

  it('compiles no on-demand-skill advertisement when the frame grants no pull tool, and says so', async () => {
    // The advertisement names `get_piece`; a role whose packages do not grant it
    // would otherwise be told to pull with a tool the session never registers.
    const pieces = [pullSkill('commits'), skillIndex()];
    let compiled: Piece[] | undefined;
    const h = harness({
      assemblePieces: () => ({ pieces, frame: { allow: ['Read', 'Edit'], deny: [] } }),
      compile: (p) => {
        compiled = p;
        return NEUTRAL;
      },
    });
    const frames: unknown[] = [];
    await createSession(
      { role: 'swe', scope: 'src', input: 'go', onTurn: (frame) => frames.push(frame) },
      h.deps,
    );
    expect(compiled?.map((p) => p.name)).toEqual(['commits']);
    expect(frames).toContainEqual(
      expect.objectContaining({
        t: 'error',
        origin: 'daemon',
        message: expect.stringContaining('commits'),
      }),
    );
  });

  it('keeps the on-demand-skill advertisement when the frame grants the pull tool', async () => {
    const pieces = [pullSkill('commits'), skillIndex()];
    let compiled: Piece[] | undefined;
    const h = harness({
      assemblePieces: () => ({ pieces, frame: { allow: ['get_piece'], deny: [] } }),
      compile: (p) => {
        compiled = p;
        return NEUTRAL;
      },
    });
    const frames: unknown[] = [];
    await createSession(
      { role: 'swe', scope: 'src', input: 'go', onTurn: (frame) => frames.push(frame) },
      h.deps,
    );
    expect(compiled?.map((p) => p.name)).toEqual(['commits', SKILL_INDEX_PIECE_NAME]);
    expect(frames).toEqual([]);
  });

  it('reuses a frozen compilation without re-surfacing MCP resolution (assembly skipped)', async () => {
    let assembled = 0;
    const h = harness({
      assemblePieces: () => {
        assembled += 1;
        return { pieces: [], frame: { allow: [], deny: [] }, mcpServers: ['ghost'] };
      },
    });
    const frames: unknown[] = [];
    await createSession(
      {
        role: 'swe',
        scope: 'src',
        input: 'go',
        frozen: { neutral: NEUTRAL, frame: { allow: [], deny: [] } },
        onTurn: (frame) => frames.push(frame),
      },
      h.deps,
    );
    expect(assembled).toBe(0);
    expect(frames).toEqual([]);
  });

  it('wires the settlement callback to the cost charge', async () => {
    const h = harness();
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(h.stats.charged).toEqual([
      { sessionId: 'sess-1', usage: { tokensIn: 1, tokensOut: 2, costUsd: 0.5 } },
    ]);
  });

  it('threads attachments + the resolved vision fact into the adapter init', async () => {
    const h = harness();
    const attachments = [{ kind: 'image' as const, mimeType: 'image/png', data: 'aWJt' }];
    await createSession(
      { role: 'dev', scope: 'src', input: 'go', attachments, visionSupported: true },
      h.deps,
    );
    expect(h.adapter()?.init.attachments).toEqual(attachments);
    expect(h.adapter()?.init.visionSupported).toBe(true);
  });

  it('omits attachments/visionSupported from the init when the request carries none', async () => {
    const h = harness();
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect('attachments' in (h.adapter()?.init ?? {})).toBe(false);
    expect('visionSupported' in (h.adapter()?.init ?? {})).toBe(false);
  });

  it('mirrors each settlement to onUsage alongside the charge (the context ring feed)', async () => {
    const h = harness();
    const seen: RuntimeUsage[] = [];
    await createSession(
      { role: 'dev', scope: 'src', input: 'go', onUsage: (usage) => seen.push(usage) },
      h.deps,
    );
    // The SAME usage the charge saw — one settlement channel, mirrored, never a
    // second tracking mechanism.
    expect(seen).toEqual([{ tokensIn: 1, tokensOut: 2, costUsd: 0.5 }]);
    expect(h.stats.charged).toHaveLength(1);
  });

  it('wires the per-tool deny rules into the canUseTool predicate on the tool hook', async () => {
    const h = harness({ perToolDeny: () => ({ behavior: 'deny', message: 'no secrets' }) });
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    const decision = await h
      .adapter()
      ?.canUseTool?.({ tool: 'apply_patch', args: {}, sessionId: 'sess-1' });
    expect(decision?.behavior).toBe('deny');
  });

  it('resolveMode is absent by default — mode enforcement off, byte-identical to before F2', async () => {
    const h = harness();
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    const decision = await h
      .adapter()
      ?.canUseTool?.({ tool: 'Bash', args: {}, sessionId: 'sess-1' });
    expect(decision).toEqual({ behavior: 'allow' });
  });

  it('wires resolveMode into the canUseTool predicate, resolved with the sessionId and provider', async () => {
    const seen: { sessionId: string; provider: string }[] = [];
    const h = harness({
      resolveMode: (sessionId, provider) => {
        seen.push({ sessionId, provider });
        return {
          getMode: () => 'plan',
          hasApprovalSeam: () => true,
          classify: () => 'write',
          requestApproval: () => Promise.resolve('allow'),
        };
      },
    });
    await createSession(
      { role: 'dev', scope: 'src', input: 'go', model: { provider: 'deepseek' } },
      h.deps,
    );
    expect(seen).toEqual([{ sessionId: 'sess-1', provider: 'deepseek' }]);
    const decision = await h
      .adapter()
      ?.canUseTool?.({ tool: 'Write', args: { path: 'a.ts' }, sessionId: 'sess-1' });
    // plan mode blocks a write outright — proves the resolved ModeDeps actually
    // reached the composed predicate, not just that resolveMode was called.
    expect(decision?.behavior).toBe('deny');
  });

  it('resolveMode returning undefined (unknown session id) leaves mode enforcement off', async () => {
    const h = harness({ resolveMode: () => undefined });
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    const decision = await h
      .adapter()
      ?.canUseTool?.({ tool: 'Bash', args: {}, sessionId: 'sess-1' });
    expect(decision).toEqual({ behavior: 'allow' });
  });

  it('threads the active account locator into the adapter init and stamps the session label', async () => {
    const h = harness({
      activeAccount: () => ({ label: 'work', locator: { type: 'config-dir', dir: '/d' } }),
    });
    const session = await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(h.adapter()?.init.locator).toEqual({ type: 'config-dir', dir: '/d' });
    expect(session.account).toBe('work');
  });

  it('stamps ambient and passes no locator when the active account is ambient', async () => {
    const h = harness({ activeAccount: () => ({ label: 'ambient' }) });
    const session = await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(h.adapter()?.init.locator).toBeUndefined();
    expect(session.account).toBe('ambient');
  });

  it('omits the account entirely when account selection is not wired (strict superset)', async () => {
    const h = harness();
    const session = await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(h.adapter()?.init.locator).toBeUndefined();
    expect(session.account).toBeUndefined();
  });

  it('records settled spend attributed to the active account label', async () => {
    const spend: unknown[] = [];
    const h = harness({
      activeAccount: () => ({ label: 'work', locator: { type: 'config-dir', dir: '/d' } }),
      recordSpend: (record) => spend.push(record),
    });
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(spend).toEqual([{ costUsd: 0.5, tokensIn: 1, tokensOut: 2, account: 'work' }]);
  });

  it('records settled spend attributed to the request-supplied family-tree root', async () => {
    const spend: unknown[] = [];
    const h = harness({
      activeAccount: () => ({ label: 'work' }),
      recordSpend: (record) => spend.push(record),
    });
    await createSession({ role: 'dev', scope: 'src', input: 'go', root: 'root-1' }, h.deps);
    expect(spend).toEqual([
      { costUsd: 0.5, tokensIn: 1, tokensOut: 2, account: 'work', root: 'root-1' },
    ]);
  });

  it('omits root from settled spend for a session with no lineage — byte-identical to before root existed', async () => {
    const spend: unknown[] = [];
    const h = harness({
      activeAccount: () => ({ label: 'work' }),
      recordSpend: (record) => spend.push(record),
    });
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, h.deps);
    expect(spend).toEqual([{ costUsd: 0.5, tokensIn: 1, tokensOut: 2, account: 'work' }]);
  });

  it('registers the base catalogue for a non-claude provider and the plain one for claude', async () => {
    const registered: Record<string, string[]> = {};
    const makeAdapter =
      (label: string) =>
      (init: SessionAdapterInit): RuntimeAdapter => {
        const adapter = new FakeAdapter(init);
        adapter.registerTools = (cat) => {
          registered[label] = cat.map((t) => t.name);
        };
        return adapter;
      };

    const h = harness({
      catalogue: [{ name: 'edit_symbol' } as RegisteredTool],
      baseCatalogue: [
        { name: 'edit_symbol' } as RegisteredTool,
        { name: 'Read' } as RegisteredTool,
      ],
    });

    await createSession(
      { role: 'coder', scope: '.', input: 'x', model: { provider: 'deepseek', model: 'x' } },
      { ...h.deps, createAdapter: makeAdapter('deepseek') },
    );
    await createSession(
      { role: 'coder', scope: '.', input: 'x', model: { provider: 'claude', model: 'y' } },
      { ...h.deps, createAdapter: makeAdapter('claude') },
    );

    expect(registered['deepseek']).toContain('Read');
    expect(registered['claude']).not.toContain('Read');
  });

  it('prefers the session-scoped catalogue (catalogueFor) over the shared one, resolving spawn with the real sessionId', async () => {
    const registered: Record<string, string[]> = {};
    const makeAdapter =
      (label: string) =>
      (init: SessionAdapterInit): RuntimeAdapter => {
        const adapter = new FakeAdapter(init);
        adapter.registerTools = (cat) => {
          registered[label] = cat.map((t) => t.name);
        };
        return adapter;
      };
    const catalogueForCalls: Array<{ sessionId: string; spawn: unknown }> = [];
    const baseCatalogueForCalls: Array<{ sessionId: string; spawn: unknown }> = [];
    const h = harness({
      catalogue: [{ name: 'edit_symbol' } as RegisteredTool],
      baseCatalogue: [{ name: 'Read' } as RegisteredTool],
      catalogueFor: (sessionId, spawn) => {
        catalogueForCalls.push({ sessionId, spawn });
        return [{ name: 'spawn_agent' } as RegisteredTool];
      },
      baseCatalogueFor: (sessionId, spawn) => {
        baseCatalogueForCalls.push({ sessionId, spawn });
        return [{ name: 'spawn_agent' } as RegisteredTool, { name: 'Read' } as RegisteredTool];
      },
      resolveSpawn: () => ({ listAgents: () => [], startChild: () => ({ sessionId: 'kid' }) }),
    });

    await createSession(
      { role: 'coder', scope: '.', input: 'x', model: { provider: 'claude' } },
      { ...h.deps, createAdapter: makeAdapter('claude') },
    );
    await createSession(
      { role: 'coder', scope: '.', input: 'x', model: { provider: 'deepseek' } },
      { ...h.deps, createAdapter: makeAdapter('deepseek') },
    );

    // Both catalogues went through the session-scoped path, not the plain arrays.
    expect(registered['claude']).toEqual(['spawn_agent']);
    expect(registered['deepseek']).toEqual(['spawn_agent', 'Read']);
    expect(catalogueForCalls).toHaveLength(1);
    expect(catalogueForCalls[0]?.sessionId).toBe('sess-1');
    expect(catalogueForCalls[0]?.spawn).toBeDefined();
    expect(baseCatalogueForCalls).toHaveLength(1);
    expect(baseCatalogueForCalls[0]?.sessionId).toBe('sess-1');
  });

  it('falls back to the shared catalogue/baseCatalogue unchanged when catalogueFor/resolveSpawn are absent', async () => {
    const registered: Record<string, string[]> = {};
    const makeAdapter =
      (label: string) =>
      (init: SessionAdapterInit): RuntimeAdapter => {
        const adapter = new FakeAdapter(init);
        adapter.registerTools = (cat) => {
          registered[label] = cat.map((t) => t.name);
        };
        return adapter;
      };
    const h = harness({ catalogue: [{ name: 'edit_symbol' } as RegisteredTool] });

    await createSession(
      { role: 'coder', scope: '.', input: 'x' },
      { ...h.deps, createAdapter: makeAdapter('claude') },
    );

    expect(registered['claude']).toEqual(['edit_symbol']);
  });
});

describe('closeSession', () => {
  it('checkpoints at the boundary and releases the worktree', () => {
    const h = harness();
    closeSession(
      {
        id: 'sess-1',
        config: {
          role: 'dev',
          scope: 'src',
          worktree: '/wt',
          capabilityFrame: { allow: [], deny: [] },
        },
        worktree: '/wt',
      },
      h.deps,
    );
    expect(h.stats.released).toEqual(['/wt']);
    expect(h.stats.checkpoints).toBe(1);
  });
});
