import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentSummary, CapabilitySet, NeutralConfig, TurnFrame } from '@coa/shared';
import type { RuntimeAdapter, SessionConfig } from '@coa/spi';
import { createConversationStore, type ConversationStore } from './conversation-store.js';
import { createMessageLog, type MessageLog } from './message-log.js';
import { LiveSessionRegistry } from './live-registry.js';
import type { SessionDeps } from './session.js';
import { SessionService } from './session-service.js';

/**
 * `SessionService.messagingFor` wired end to end against a REAL registry/store/message
 * log (docs/adr/0039) — the glue `message-dispatch.test.ts` cannot exercise, since that
 * suite stubs every dependency. Mirrors `non-blocking-spawn.test.ts`'s
 * `DeferredAdapter` harness so a session can be held deliberately mid-turn.
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

/** Settles immediately with one settled `text` frame, unless held — mirrors
 *  `session-handlers.test.ts`'s `FrameAdapter` but scoped to only what this suite needs. */
class TestAdapter implements RuntimeAdapter {
  #release: (() => void) | undefined;
  #gate: Promise<void>;
  configsSeen: SessionConfig[] = [];

  constructor(
    private readonly init: { onTurn?: (frame: TurnFrame) => void },
    hold: boolean,
  ) {
    this.#gate = hold
      ? new Promise<void>((resolve) => {
          this.#release = resolve;
        })
      : Promise.resolve();
  }

  release(): void {
    this.#release?.();
  }

  renderNative() {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(): void {}
  interceptStop(): void {}
  async runLoop(config: SessionConfig): Promise<void> {
    this.configsSeen.push(config);
    await this.#gate;
    this.init.onTurn?.({ t: 'text', text: 'ok' });
  }
}

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

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('inter-agent messaging — wired end to end', () => {
  let dir: string;
  let store: ConversationStore;
  let registry: LiveSessionRegistry;
  let messageLog: MessageLog;
  let adapters: TestAdapter[];
  let holdNext: boolean;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-msg-int-'));
    store = createConversationStore(dir);
    registry = new LiveSessionRegistry();
    messageLog = createMessageLog(join(dir, 'messages'));
    adapters = [];
    holdNext = false;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function buildService(): SessionService {
    let n = 0;
    const deps: SessionDeps = {
      newSessionId: () => `sess-${++n}`,
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
      createAdapter: (init) => {
        const adapter = new TestAdapter(init, holdNext);
        adapters.push(adapter);
        return adapter;
      },
    };
    return new SessionService({ deps, registry, store, listAgents: () => AGENTS, messageLog });
  }

  it('delivers to a MID-TURN receiver via its delivery queue, without starting a new turn', async () => {
    const service = buildService();

    // Found the sender.
    registry.getOrCreate('sender-1');
    store.create({ id: 'sender-1', agentRef: 'explorer', title: 't', scope: '' });

    // Found the receiver and hold its turn open (mid-turn).
    holdNext = true;
    const spawn = service.spawnFor('sender-1');
    if (spawn === undefined) throw new Error('spawn unavailable');
    const { sessionId: receiverId } = spawn.startChild({
      agentRef: 'explorer',
      description: 'stand by',
      prompt: 'wait for input',
    });
    await flush();
    expect(registry.get(receiverId)?.state).toBe('running');

    const messaging = service.messagingFor('sender-1');
    if (messaging === undefined) throw new Error('messaging unavailable');
    const outcome = messaging.send({ to: receiverId, body: 'status check' });
    expect(outcome).toMatchObject({ applied: true, plan: { kind: 'mid-turn' } });

    const pending = registry.get(receiverId)?.deliveries.drain() ?? [];
    expect(pending).toHaveLength(1);
    expect(pending[0]?.origin).toBe('system');
    expect(pending[0]?.text).toContain('status check');
    expect(pending[0]?.text).toContain('sender-1');

    // No SECOND turn was started for the receiver — only its founding one (the mid-turn
    // delivery rode the existing queue, not a fresh `runLoop` call).
    expect(adapters.filter((a) => a.configsSeen.length > 0)).toHaveLength(1);
  });

  it('wakes a receiver that is not currently running with a fresh turn carrying the message', async () => {
    const service = buildService();
    registry.getOrCreate('sender-1');
    store.create({ id: 'sender-1', agentRef: 'explorer', title: 't', scope: '' });
    // A receiver KNOWN to the store, sharing the sender's root (as if it had been
    // spawned earlier), but never live-registered in THIS process — the idle-evicted /
    // not-yet-started case.
    store.create({
      id: 'receiver-1',
      agentRef: 'explorer',
      title: 't',
      scope: '',
      root: 'sender-1',
    });
    expect(registry.get('receiver-1')).toBeUndefined();

    const messaging = service.messagingFor('sender-1');
    if (messaging === undefined) throw new Error('messaging unavailable');
    const outcome = messaging.send({ to: 'receiver-1', body: 'wake up' });
    expect(outcome).toMatchObject({ applied: true, plan: { kind: 'wake' } });

    await flush();
    expect(registry.get('receiver-1')).toBeDefined();
    // The sender never ran a turn of its own in this test — the wake is the ONLY
    // adapter constructed, and it actually ran (`runLoop` was called).
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.configsSeen.length).toBeGreaterThan(0);
  });

  it('refuses a send across family trees even when both ids are otherwise known', async () => {
    const service = buildService();
    registry.getOrCreate('sender-1');
    store.create({ id: 'sender-1', agentRef: 'explorer', title: 't', scope: '' });
    registry.getOrCreate('other-root');
    store.create({ id: 'other-root', agentRef: 'explorer', title: 't', scope: '' });

    const messaging = service.messagingFor('sender-1');
    if (messaging === undefined) throw new Error('messaging unavailable');
    const outcome = messaging.send({ to: 'other-root', body: 'hi' });
    expect(outcome).toMatchObject({ applied: false, error: { code: 'out-of-tree' } });
  });

  it('the roster reflects real tree membership and relation to the caller', async () => {
    const service = buildService();
    registry.getOrCreate('root-1');
    store.create({ id: 'root-1', agentRef: 'explorer', title: 't', scope: '' });

    const spawn = service.spawnFor('root-1');
    if (spawn === undefined) throw new Error('spawn unavailable');
    const { sessionId: childId } = spawn.startChild({
      agentRef: 'explorer',
      description: 'x',
      prompt: 'y',
    });
    await flush();

    const messaging = service.messagingFor('root-1');
    if (messaging === undefined) throw new Error('messaging unavailable');
    const roster = messaging.roster();
    const byId = new Map(roster.map((r) => [r.sessionId, r]));
    expect(byId.get('root-1')?.relation).toBe('self');
    expect(byId.get(childId)?.relation).toBe('child');
  });

  it('appends every dispatched message to the durable log under the tree’s root', async () => {
    const service = buildService();
    registry.getOrCreate('root-1');
    store.create({ id: 'root-1', agentRef: 'explorer', title: 't', scope: '' });
    store.create({ id: 'peer-1', agentRef: 'explorer', title: 't', scope: '', root: 'root-1' });

    const messaging = service.messagingFor('root-1');
    if (messaging === undefined) throw new Error('messaging unavailable');
    messaging.send({ to: 'peer-1', body: 'first' });
    messaging.send({ to: 'peer-1', body: 'second' });

    const logged = messageLog.forRoot('root-1');
    expect(logged.map((m) => m.body)).toEqual(['first', 'second']);
  });
});

describe('subagent announcement frames — live push, never persisted', () => {
  let dir: string;
  let store: ConversationStore;
  let registry: LiveSessionRegistry;
  let messageLog: MessageLog;
  let holdNext: boolean;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-msg-announce-'));
    store = createConversationStore(dir);
    registry = new LiveSessionRegistry();
    messageLog = createMessageLog(join(dir, 'messages'));
    holdNext = false;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function buildService(): SessionService {
    let n = 0;
    const deps: SessionDeps = {
      newSessionId: () => `sess-${++n}`,
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
      createAdapter: (init) => new TestAdapter(init, holdNext),
    };
    return new SessionService({ deps, registry, store, listAgents: () => AGENTS, messageLog });
  }

  it('announces subagent-spawn on the parent once the child’s founding turn is bound', async () => {
    const service = buildService();
    const { session: parent } = registry.getOrCreate('root-1');
    store.create({ id: 'root-1', agentRef: 'explorer', title: 't', scope: '' });
    const pushes: unknown[] = [];
    parent.subscribe((p) => pushes.push(p));

    const spawn = service.spawnFor('root-1');
    if (spawn === undefined) throw new Error('spawn unavailable');
    spawn.startChild({ agentRef: 'explorer', description: 'go look', prompt: 'x' });
    await flush();

    const frames = pushes.flatMap((p) =>
      typeof p === 'object' && p !== null && 'kind' in p && (p as { kind: string }).kind === 'turn'
        ? [(p as { frame: { t: string } }).frame]
        : [],
    );
    const spawnFrame = frames.find((f) => f.t === 'subagent-spawn');
    expect(spawnFrame).toBeDefined();
  });

  it('announces subagent-completion on the parent once the child finishes', async () => {
    const service = buildService();
    const { session: parent } = registry.getOrCreate('root-1');
    store.create({ id: 'root-1', agentRef: 'explorer', title: 't', scope: '' });
    const pushes: unknown[] = [];
    parent.subscribe((p) => pushes.push(p));

    const spawn = service.spawnFor('root-1');
    if (spawn === undefined) throw new Error('spawn unavailable');
    spawn.startChild({ agentRef: 'explorer', description: 'go look', prompt: 'x' });
    await flush();
    await flush();

    const frames = pushes.flatMap((p) =>
      typeof p === 'object' && p !== null && 'kind' in p && (p as { kind: string }).kind === 'turn'
        ? [(p as { frame: { t: string; reason?: string } }).frame]
        : [],
    );
    const doneFrame = frames.find((f) => f.t === 'subagent-completion');
    expect(doneFrame).toMatchObject({ reason: 'completed' });
  });

  it('announces subagent-message on BOTH the sender and the receiver’s own live streams', async () => {
    const service = buildService();
    const { session: sender } = registry.getOrCreate('sender-1');
    store.create({ id: 'sender-1', agentRef: 'explorer', title: 't', scope: '' });
    const { session: receiver } = registry.getOrCreate('receiver-1', { root: 'sender-1' });
    store.create({
      id: 'receiver-1',
      agentRef: 'explorer',
      title: 't',
      scope: '',
      root: 'sender-1',
    });

    const senderPushes: unknown[] = [];
    const receiverPushes: unknown[] = [];
    sender.subscribe((p) => senderPushes.push(p));
    receiver.subscribe((p) => receiverPushes.push(p));

    const messaging = service.messagingFor('sender-1');
    if (messaging === undefined) throw new Error('messaging unavailable');
    messaging.send({ to: 'receiver-1', body: 'ping' });

    const frameOf = (pushes: unknown[]): { direction?: string } | undefined =>
      pushes
        .flatMap((p) =>
          typeof p === 'object' &&
          p !== null &&
          'kind' in p &&
          (p as { kind: string }).kind === 'turn'
            ? [(p as { frame: { t: string; direction?: string } }).frame]
            : [],
        )
        .find((f) => f.t === 'subagent-message');

    expect(frameOf(senderPushes)).toMatchObject({ direction: 'sent' });
    expect(frameOf(receiverPushes)).toMatchObject({ direction: 'received' });
  });
});
