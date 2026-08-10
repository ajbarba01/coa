import { describe, expect, it } from 'vitest';
import type { NeutralConfig } from '@coa/shared';
import type { BackendConfig, RuntimeAdapter } from '@coa/spi';
import { Governance } from '../governance/governance.js';
import { FlagPipeline } from '../flags/pipeline.js';
import { compile } from '../compiler/compile.js';
import { TOOL_CATALOGUE } from '../workbench/catalogue.js';
import { createSession } from './session.js';
import { composeSessionDeps, type DaemonCore, type SessionWiring } from './composition.js';
import type { SessionAdapterInit } from './session.js';

/** A real flags/compiler/catalogue/governance core (only the spine checkpoint stubbed — its FS construction is the daemon host's job). */
function realCore(): DaemonCore & { governance: Governance } {
  const governance = new Governance();
  const flags = new FlagPipeline();
  return {
    governance,
    checkpoint: () => {},
    perToolDeny: (tool, input) => flags.perToolDeny(tool, input),
    gate: () => flags.gate(),
    capState: () => governance.capState(),
    charge: (sessionId, costUsd) => governance.charge(sessionId, costUsd),
    record: (event) => governance.record(event),
    sandboxPolicy: (ctx) => governance.sandboxPolicy(ctx),
    compile: (pieces, frame) => compile(pieces, frame).config,
    catalogue: TOOL_CATALOGUE,
    baseCatalogue: [],
  };
}

class FakeAdapter implements RuntimeAdapter {
  constructor(readonly init: SessionAdapterInit) {}
  renderNative(_c: NeutralConfig): BackendConfig {
    return { systemPrompt: '', allowedTools: [], disallowedTools: [], perAgent: {} };
  }
  registerTools(): void {}
  denyBuiltins(): void {}
  interceptTool(): void {}
  interceptStop(): void {}
  async runLoop(): Promise<void> {
    this.init.onSettle(this.init.sessionId, { tokensIn: 0, tokensOut: 0, costUsd: 1 });
  }
}

const wiring = (over: Partial<SessionWiring> = {}): SessionWiring => ({
  createAdapter: (init) => new FakeAdapter(init),
  bindWorktree: () => '/repo/.coa/wt/s',
  ...over,
});

describe('composeSessionDeps', () => {
  it('adapts the settlement usage into the cost charge (charge takes costUsd)', () => {
    const charges: { sessionId: string; costUsd: number }[] = [];
    const core = realCore();
    const deps = composeSessionDeps(
      { ...core, charge: (sessionId, costUsd) => charges.push({ sessionId, costUsd }) },
      wiring(),
    );
    deps.charge('s', { tokensIn: 0, tokensOut: 0, costUsd: 1 });
    expect(charges).toEqual([{ sessionId: 's', costUsd: 1 }]);
  });

  it('defaults assemblePieces to the empty frame that compiles to the vanilla config', () => {
    const deps = composeSessionDeps(realCore(), wiring());
    const { pieces, frame } = deps.assemblePieces({ role: 'dev', scope: 'src', worktree: '/w' });
    const config = deps.compile(pieces, frame);
    expect(pieces).toEqual([]);
    expect(config.prefixHead).toEqual([]);
    expect(config.onDemandPullable).toEqual([]);
  });

  it('passes the real flag-pipeline gate through (allows with no blocking flags)', () => {
    const deps = composeSessionDeps(realCore(), wiring());
    expect(deps.gate()).toEqual({ allow: true });
  });

  it('drives createSession over the real core and charges the spend counter at settlement', async () => {
    const charges: { sessionId: string; costUsd: number }[] = [];
    const core = realCore();
    const deps = composeSessionDeps(
      { ...core, charge: (sessionId, costUsd) => charges.push({ sessionId, costUsd }) },
      wiring(),
    );
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, deps);
    expect(charges).toHaveLength(1);
    expect(charges[0]?.costUsd).toBe(1);
  });

  it('passes resolveSpawn through from wiring, unmodified', () => {
    const resolveSpawn = (sessionId: string) => ({
      listAgents: () => [],
      startChild: () => ({ sessionId }),
    });
    const deps = composeSessionDeps(realCore(), wiring({ resolveSpawn }));
    expect(deps.resolveSpawn).toBe(resolveSpawn);
  });

  it('omits resolveSpawn/catalogueFor/baseCatalogueFor when neither core nor wiring supplies them', () => {
    const deps = composeSessionDeps(realCore(), wiring());
    expect(deps.resolveSpawn).toBeUndefined();
    expect(deps.catalogueFor).toBeUndefined();
    expect(deps.baseCatalogueFor).toBeUndefined();
  });

  it('passes catalogueFor/baseCatalogueFor through from the core', () => {
    const core = realCore();
    const catalogueFor = () => [];
    const baseCatalogueFor = () => [];
    const deps = composeSessionDeps({ ...core, catalogueFor, baseCatalogueFor }, wiring());
    expect(deps.catalogueFor).toBe(catalogueFor);
    expect(deps.baseCatalogueFor).toBe(baseCatalogueFor);
  });
});
