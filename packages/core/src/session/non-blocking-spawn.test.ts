import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentSummary, CapabilitySet, NeutralConfig } from '@coa/shared';
import type { RuntimeAdapter } from '@coa/spi';
import { createConversationStore, type ConversationStore } from './conversation-store.js';
import { LiveSessionRegistry } from './live-registry.js';
import type { SessionDeps } from './session.js';
import { SessionService } from './session-service.js';

/**
 * A throwaway regression for the design's central, non-negotiable contract
 * (docs/superpowers/specs/2026-08-04-inter-agent-messaging-and-dispatch-design.md):
 * `spawn_agent` returns once the child STARTS, never once it FINISHES. This proves it
 * with real async ordering (a child adapter that only settles once this test explicitly
 * releases it), not just a synchronous state snapshot — the strongest guard against a
 * future change (e.g. to the new spawn-announcement hook this arc adds to `#startChild`)
 * accidentally awaiting something it shouldn't.
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

/** An adapter whose `runLoop` hangs until `release()` is called — models a child doing
 *  real, slow work, so "the parent's spawn call already returned" and "the child has
 *  finished" are observably different points in time. */
class DeferredAdapter implements RuntimeAdapter {
  #release!: () => void;
  readonly settled: Promise<void>;

  constructor(private readonly onSettle: () => void) {
    this.settled = new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }

  release(): void {
    this.#release();
  }

  renderNative() {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(): void {}
  interceptStop(): void {}
  async runLoop(): Promise<void> {
    await this.settled;
    this.onSettle();
  }
}

/** A macrotask tick, not just a microtask hop — the founding turn's start crosses
 *  several `await` boundaries (the turn loop's parked `nextTurn()`, the held-open
 *  driver's close, `runPerTurn`'s own prefix) before `createAdapter` is ever called, so
 *  a single `await Promise.resolve()` is not enough to observe it (mirrors
 *  `session-handlers.test.ts`'s own `flush`/`settleChild` helpers). */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const AGENTS: AgentSummary[] = [
  {
    ref: 'explorer',
    scope: 'builtin',
    name: 'Explorer',
    description: 'read-only',
    icon: 'search',
    color: 'sky',
    roles: ['researcher'],
  },
];

describe('non-blocking spawn contract', () => {
  let dir: string;
  let store: ConversationStore;
  let registry: LiveSessionRegistry;
  let adapters: DeferredAdapter[];
  let events: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-nbspawn-'));
    store = createConversationStore(dir);
    registry = new LiveSessionRegistry();
    adapters = [];
    events = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function buildService(): SessionService {
    let n = 0;
    const deps: SessionDeps = {
      newSessionId: () => `child-${++n}`,
      bindWorktree: (id) => `/wt/${id}`,
      releaseWorktree: () => {},
      assemblePieces: () => ({ pieces: [], frame: { allow: [], deny: [] } }),
      compile: () => NEUTRAL,
      sandboxPolicy: () => SANDBOX,
      charge: () => {},
      perToolDeny: () => undefined,
      gate: () => ({ allow: true }),
      catalogue: [],
      baseCatalogue: [],
      checkpoint: () => {},
      observeChanges: () => {},
      createAdapter: () => {
        const adapter = new DeferredAdapter(() => events.push('child-settled'));
        adapters.push(adapter);
        return adapter;
      },
    };
    return new SessionService({
      deps,
      registry,
      store,
      listAgents: () => AGENTS,
    });
  }

  it('startChild returns the child id before the child does any of its (real, slow) work', async () => {
    // Found the parent first, exactly like `send()` would.
    registry.getOrCreate('root-1');
    store.create({ id: 'root-1', agentRef: 'explorer', title: 'root', scope: '' });

    const service = buildService();
    const spawn = service.spawnFor('root-1');
    if (spawn === undefined) throw new Error('spawn port unavailable');

    events.push('before-start-child');
    const { sessionId } = spawn.startChild({
      agentRef: 'explorer',
      description: 'go look',
      prompt: 'investigate',
    });
    events.push('after-start-child');

    // The child's adapter has been constructed (its session exists) but its loop is
    // still hanging on `settled` — nothing about `startChild` waited for it.
    expect(events).toEqual(['before-start-child', 'after-start-child']);
    expect(registry.get(sessionId)).toBeDefined();
    expect(registry.get(sessionId)?.state).toBe('idle'); // not yet even running the founding turn

    // Only once this test explicitly releases the child does its work "complete" —
    // proving the two are genuinely different points in time, not an artifact of
    // synchronous inspection.
    await flush(); // let the founding turn actually start running
    const child = adapters[0];
    if (child === undefined) throw new Error('child adapter was never constructed');
    expect(events).not.toContain('child-settled');

    child.release();
    await child.settled;
    await flush(); // let the settlement/teardown machinery run
    expect(events).toEqual(['before-start-child', 'after-start-child', 'child-settled']);
  });
});
