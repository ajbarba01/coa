import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentSummary, CapabilitySet, NeutralConfig, Push } from '@coa/shared';
import type { BackendConfig, CanUseTool, RuntimeAdapter, StopPredicate } from '@coa/spi';
import type { SessionLibraryPort } from '../library/injection.js';
import { createConversationStore, type ConversationStore } from './conversation-store.js';
import { LiveSessionRegistry } from './live-registry.js';
import { SessionService } from './session-service.js';
import { renderInvokedSkill } from './skill-invocation.js';
import type { AssemblePiecesContext, SessionAdapterInit, SessionDeps } from './session.js';

/**
 * The library → session integration: an agent's configured skills resolve
 * through the injected library port into the queued turn, reaching (a) the
 * assembly (Pieces), (b) the drift-relevant stored compilation (selection),
 * (c) the adapter init (MCP map), and (d) the turn input + durable log (an
 * explicit invocation) — with the port absent, everything stays floor-identical.
 */

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

class RecordingAdapter implements RuntimeAdapter {
  constructor(readonly init: SessionAdapterInit) {}
  renderNative(): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(_c: CanUseTool): void {}
  interceptStop(_s: StopPredicate): void {}
  async runLoop(): Promise<void> {
    this.init.onTurn?.({ t: 'text', text: 'ok' });
    this.init.onSettle(this.init.sessionId, { tokensIn: 1, tokensOut: 1, costUsd: 0 });
  }
}

function agent(skills: { name: string; delivery: 'auto' | 'disclosure' }[]): AgentSummary {
  return {
    ref: 'helper',
    scope: 'builtin',
    name: 'Helper',
    description: 'test agent',
    icon: 'bot',
    color: 'slate',
    skills,
  };
}

/** A library port double: `ghost` never resolves; everything else maps 1:1. */
function fakePort(): SessionLibraryPort {
  return {
    resolveSkills: (configs) => {
      const known = configs.filter((c) => c.name !== 'ghost');
      return {
        pieces: known.map((c) => ({
          name: c.name,
          description: `${c.name} skill`,
          body: `body of ${c.name}`,
          axes: {
            delivery: c.delivery === 'auto' ? ('push' as const) : ('pull' as const),
            salience: 'never' as const,
            provenance: 'authored' as const,
          },
        })),
        selection: known.map((c) => ({ name: c.name, delivery: c.delivery })),
        missing: configs.filter((c) => c.name === 'ghost').map((c) => c.name),
      };
    },
    invoke: (name) =>
      name.toLowerCase() === 'commits' ? { name: 'commits', body: 'SKILL BODY' } : undefined,
    mcpServers: () => ({ gh: { transport: 'http', url: 'https://mcp.example' } }),
  };
}

describe('SessionService × the library port', () => {
  let dir: string;
  let store: ConversationStore;
  let registry: LiveSessionRegistry;
  let adapters: RecordingAdapter[];
  let assembled: AssemblePiecesContext[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-lib-sess-'));
    store = createConversationStore(dir);
    registry = new LiveSessionRegistry();
    adapters = [];
    assembled = [];
  });
  afterEach(() => {
    registry.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  function sessionDeps(): SessionDeps {
    return {
      newSessionId: () => 'sess-lib',
      bindWorktree: () => '/wt',
      releaseWorktree: () => {},
      assemblePieces: (ctx) => {
        assembled.push(ctx);
        return { pieces: [], frame: { allow: [], deny: [] } };
      },
      compile: () => NEUTRAL,
      sandboxPolicy: () => SANDBOX,
      charge: () => {},
      perToolDeny: () => undefined,
      gate: () => ({ allow: true }),
      catalogue: [],
      baseCatalogue: [],
      checkpoint: () => {},
      createAdapter: (init) => {
        const a = new RecordingAdapter(init);
        adapters.push(a);
        return a;
      },
    };
  }

  function service(library?: SessionLibraryPort): SessionService {
    return new SessionService({
      deps: sessionDeps(),
      registry,
      store,
      listAgents: () => [agent([{ name: 'commits', delivery: 'auto' }])],
      ...(library !== undefined ? { library } : {}),
    });
  }

  /** Send and wait for the turn's terminal status (the drive loop is async). */
  async function sendAndSettle(
    svc: SessionService,
    req: Parameters<SessionService['send']>[0],
  ): Promise<void> {
    let settle!: () => void;
    const done = new Promise<void>((r) => (settle = r));
    const sink = (push: Push): void => {
      if (push.kind === 'status' && (push.state === 'done' || push.state === 'error')) settle();
    };
    await svc.send({ ...req, subscribe: { sink, onAttached: () => {} } });
    await done;
  }

  it("resolves the conversation agent's skills into the turn: pieces to assembly, selection to the stored compilation, MCP to the adapter", async () => {
    store.create({ id: 'c1', agentRef: 'helper', title: 't', scope: '' });
    await sendAndSettle(service(fakePort()), {
      conversationId: 'c1',
      input: 'go',
      role: 'swe',
      scope: '',
    });

    // (a) the resolved Piece rode the existing AgentSpec.skills seam
    expect(assembled[0]?.skills?.map((p) => p.name)).toEqual(['commits']);
    // (b) the frozen compilation records the selection — the drift key's skill slice
    expect(store.getCompilation('c1')?.config.skills).toEqual([
      { name: 'commits', delivery: 'auto' },
    ]);
    // (c) the external MCP map reached the adapter init
    expect(adapters[0]?.init.mcpServers).toEqual({
      gh: { transport: 'http', url: 'https://mcp.example' },
    });
  });

  it('an explicit per-send selection overrides the agent definition', async () => {
    store.create({ id: 'c2', agentRef: 'helper', title: 't', scope: '' });
    await sendAndSettle(service(fakePort()), {
      conversationId: 'c2',
      input: 'go',
      role: 'swe',
      scope: '',
      skills: [{ name: 'review', delivery: 'disclosure' }],
    });
    expect(store.getCompilation('c2')?.config.skills).toEqual([
      { name: 'review', delivery: 'disclosure' },
    ]);
  });

  it('a configured skill that fails to resolve is EXCLUDED from the selection (the prompt reflects reality)', async () => {
    store.create({ id: 'c3', agentRef: 'helper', title: 't', scope: '' });
    await sendAndSettle(service(fakePort()), {
      conversationId: 'c3',
      input: 'go',
      role: 'swe',
      scope: '',
      skills: [
        { name: 'commits', delivery: 'auto' },
        { name: 'ghost', delivery: 'auto' },
      ],
    });
    expect(store.getCompilation('c3')?.config.skills).toEqual([
      { name: 'commits', delivery: 'auto' },
    ]);
  });

  it('an invoked skill reaches the turn: composed model input + system frame above the user frame', async () => {
    store.create({ id: 'c4', agentRef: 'helper', title: 't', scope: '' });
    await sendAndSettle(service(fakePort()), {
      conversationId: 'c4',
      input: 'commit this',
      role: 'swe',
      scope: '',
      invokeSkills: ['commits'],
    });

    const block = renderInvokedSkill({ name: 'commits', body: 'SKILL BODY' });
    // The model saw the body ABOVE the user's words, this turn.
    expect(adapters[0]?.init.input).toBe(`${block}\n\ncommit this`);
    // The durable log carries the same facts as two frames, in the same order.
    const frames = store.reload('c4').turns.map((t) => t.frame);
    expect(frames).toContainEqual({ t: 'text', text: block, role: 'system' });
    const sysIndex = frames.findIndex((f) => f.t === 'text' && f.role === 'system');
    const userIndex = frames.findIndex((f) => f.t === 'text' && f.role === 'user');
    expect(sysIndex).toBeGreaterThanOrEqual(0);
    expect(sysIndex).toBeLessThan(userIndex);
  });

  it('refuses an unknown invoked skill with an error (an explicit ask never silently vanishes)', async () => {
    store.create({ id: 'c5', agentRef: 'helper', title: 't', scope: '' });
    await expect(
      service(fakePort()).send({
        conversationId: 'c5',
        input: 'go',
        role: 'swe',
        scope: '',
        invokeSkills: ['nope'],
      }),
    ).rejects.toThrow(/unknown skill "nope"/);
  });

  it('with no library port, everything stays floor-identical and invocation refuses honestly', async () => {
    store.create({ id: 'c6', agentRef: 'helper', title: 't', scope: '' });
    await sendAndSettle(service(), { conversationId: 'c6', input: 'go', role: 'swe', scope: '' });
    expect(assembled[0]?.skills).toBeUndefined();
    expect(adapters[0]?.init.mcpServers).toBeUndefined();
    expect(store.getCompilation('c6')?.config.skills).toBeUndefined();

    await expect(
      service().send({
        conversationId: 'c6',
        input: 'go',
        role: 'swe',
        scope: '',
        invokeSkills: ['commits'],
      }),
    ).rejects.toThrow(/no skill library is wired/);
  });
});
