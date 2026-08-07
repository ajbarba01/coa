import { describe, expect, it } from 'vitest';
import type { NeutralConfig } from '@coa/shared';
import {
  barebonesProfile,
  type BackendConfig,
  type RuntimeAdapter,
  type RuntimeUsage,
} from '@coa/spi';
import { Governance } from '../governance/governance.js';
import { FlagPipeline } from '../flags/pipeline.js';
import { compile } from '../compiler/compile.js';
import { TOOL_CATALOGUE } from '../workbench/catalogue.js';
import { createSession } from './session.js';
import { composeSessionDeps, type DaemonCore, type SessionWiring } from './composition.js';
import type { SessionAdapterInit } from './session.js';

/** A real flags/compiler/catalogue/governance core (only the spine checkpoint stubbed — its FS construction is the daemon host's job). */
function realCore(ceilingUsd?: number): DaemonCore & { governance: Governance } {
  const governance = new Governance(ceilingUsd !== undefined ? { ceilingUsd } : {});
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
  deliverReminder(): void {}
  render_context(): void {}
  inject_runtime(): void {}
  cache_control(): void {}
  usageTelemetry(): RuntimeUsage {
    return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  }
  capabilityProfile() {
    return barebonesProfile;
  }
  refs() {
    return null;
  }
  runEval() {
    return Promise.reject(new Error('no eval'));
  }
}

const wiring = (over: Partial<SessionWiring> = {}): SessionWiring => ({
  createAdapter: (init) => new FakeAdapter(init),
  bindWorktree: () => '/repo/.coa/wt/s',
  ...over,
});

describe('composeSessionDeps', () => {
  it('adapts the settlement usage into the real cost cap (charge takes costUsd)', () => {
    const core = realCore(1);
    const deps = composeSessionDeps(core, wiring());
    deps.charge('s', { tokensIn: 0, tokensOut: 0, costUsd: 1 });
    expect(core.governance.capState().capHit).toBe(true);
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

  it('drives createSession over the real core and charges the real cap at settlement', async () => {
    const core = realCore(1);
    const deps = composeSessionDeps(core, wiring());
    await createSession({ role: 'dev', scope: 'src', input: 'go' }, deps);
    expect(core.governance.capState().capHit).toBe(true);
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
