import { describe, expect, it, vi } from 'vitest';
import type * as ClaudeSdkModule from '@coa/adapter-claude-sdk';
import type * as OpenAiCompatModule from '@coa/adapter-openai-compat';
import { deepseekSpec, longcatSpec } from '@coa/adapter-openai-compat';
import type { SessionAdapterInit } from '@coa/core';
import { createClaudeAdapter, createOpenAiCompatAdapter, fetchModels } from './adapter-factory.js';

/**
 * The init object each backend constructor actually received. Hoisted because vitest
 * lifts the `vi.mock` factories below above the imports, so they cannot close over an
 * ordinary module-level binding. Held as `unknown` and narrowed at the assertion — the
 * point is to inspect the object as data, not to re-state the adapter's own init type.
 */
const captured = vi.hoisted(() => ({
  claude: [] as unknown[],
  deepseek: [] as unknown[],
  longcat: [] as unknown[],
}));

// Each mock SUBCLASSES the real adapter rather than replacing it: every other test in
// this file exercises genuine adapter behaviour (the runLoop precondition), and only
// the constructor argument is observed.
vi.mock('@coa/adapter-claude-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof ClaudeSdkModule>();
  return {
    ...actual,
    ClaudeSdkAdapter: class extends actual.ClaudeSdkAdapter {
      constructor(init: ConstructorParameters<typeof actual.ClaudeSdkAdapter>[0]) {
        super(init);
        captured.claude.push(init);
      }
    },
  };
});

// The unified adapter serves BOTH pure-API providers; the captured init is routed by
// the spec the factory constructed it with, so the per-provider forwarding assertions
// below stay per-provider.
vi.mock('@coa/adapter-openai-compat', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenAiCompatModule>();
  return {
    ...actual,
    OpenAiCompatAdapter: class extends actual.OpenAiCompatAdapter {
      constructor(
        spec: ConstructorParameters<typeof actual.OpenAiCompatAdapter>[0],
        init: ConstructorParameters<typeof actual.OpenAiCompatAdapter>[1],
      ) {
        super(spec, init);
        if (spec.id === 'deepseek' || spec.id === 'longcat') captured[spec.id].push(init);
      }
    },
  };
});

const init = (over: Partial<SessionAdapterInit> = {}): SessionAdapterInit => ({
  sessionId: 's1',
  sandbox: { allowedTools: [], denyRules: [], permissionMode: 'default', denyRead: [] },
  input: 'go',
  onSettle: () => {},
  ...over,
});

describe('createClaudeAdapter', () => {
  it('constructs a runtime adapter exposing the driven port surface', () => {
    const adapter = createClaudeAdapter(init());
    expect(typeof adapter.renderNative).toBe('function');
    expect(typeof adapter.runLoop).toBe('function');
  });

  it('rejects runLoop before renderNative is wired (the adapter precondition)', async () => {
    const adapter = createClaudeAdapter(init());
    await expect(
      adapter.runLoop({
        role: 'dev',
        scope: 'src',
        worktree: '/wt',
        capabilityFrame: { allow: [], deny: [] },
      }),
    ).rejects.toThrow();
  });
});

describe('fetchModels — deepseek', () => {
  it('throws (rather than silently returning []) when no key resolves from the locator', async () => {
    await expect(
      fetchModels({
        label: 'ds-ambient',
        provider: 'deepseek',
        locator: { type: 'env-var', name: 'COA_TEST_UNSET_DEEPSEEK_KEY_XYZ' },
      }),
    ).rejects.toThrow(/no api key resolved/i);
  });
});

describe('createOpenAiCompatAdapter — longcat', () => {
  it('constructs a runtime adapter exposing the driven port surface', () => {
    const adapter = createOpenAiCompatAdapter(
      longcatSpec,
      init({ model: { provider: 'longcat', model: 'LongCat-2.0' } }),
    );
    expect(typeof adapter.renderNative).toBe('function');
    expect(typeof adapter.runLoop).toBe('function');
  });
});

describe('fetchModels — longcat', () => {
  it('throws (rather than silently returning []) when no key resolves from the locator', async () => {
    await expect(
      fetchModels({
        label: 'lc-ambient',
        provider: 'longcat',
        locator: { type: 'env-var', name: 'COA_TEST_UNSET_LONGCAT_KEY_XYZ' },
      }),
    ).rejects.toThrow(/no api key resolved/i);
  });
});

/**
 * Every field of {@link SessionAdapterInit}, each an identity-distinguishable sentinel
 * (every function is its own literal, so a field mapped onto the WRONG key is caught
 * too). Typed `Required<…>` on purpose: adding a field to the interface breaks the
 * typecheck here until it is given a sentinel and classified below, so no future field
 * can reach this seam unclassified.
 */
const FULL_INIT: Required<SessionAdapterInit> = {
  sessionId: 's-full',
  sandbox: { allowedTools: ['Read'], denyRules: [], permissionMode: 'default', denyRead: [] },
  input: 'go',
  model: { provider: 'claude', model: 'sentinel-model' },
  maxBudgetUsd: 12.5,
  onSettle: () => {},
  observeChanges: () => {},
  onTurn: () => {},
  locator: { type: 'env-var', name: 'COA_TEST_SENTINEL_LOCATOR' },
  resume: 'backend-session-sentinel',
  onBackendSession: () => {},
  history: [{ role: 'user', content: 'earlier turn' }],
  deliverHistoryAsPreamble: true,
  signal: new AbortController().signal,
  drainDeliveries: () => [{ origin: 'user', text: 'mid-loop' }],
  onTurnInterrupt: () => {},
};

type InitKey = keyof SessionAdapterInit;

/**
 * The forwarding contract per factory. This file hand-maps every field with no spread,
 * so a field silently dropped here is a feature that ships DEAD while both the
 * typecheck (the field is optional) and the whole suite stay green — which is exactly
 * how `drainDeliveries` reached this seam untested.
 */
const FORWARDED: Record<'claude' | 'deepseek' | 'longcat', readonly InitKey[]> = {
  claude: [
    'sessionId',
    'sandbox',
    'input',
    'onSettle',
    'model',
    'onTurn',
    'maxBudgetUsd',
    'locator',
    'resume',
    'onBackendSession',
    'history',
    'deliverHistoryAsPreamble',
    'signal',
    'drainDeliveries',
  ],
  deepseek: [
    'sessionId',
    'input',
    'onSettle',
    'model',
    'onTurn',
    'maxBudgetUsd',
    'locator',
    'history',
    'signal',
    'drainDeliveries',
  ],
  longcat: [
    'sessionId',
    'input',
    'onSettle',
    'model',
    'onTurn',
    'maxBudgetUsd',
    'locator',
    'history',
    'signal',
    'drainDeliveries',
  ],
};

/**
 * The complement of {@link FORWARDED} — asserted only to be exhaustive, never to be
 * absent, so fixing one of the gaps below does not break a test.
 *
 * Most entries are fields the target backend's own init simply has no slot for (a
 * pure-API adapter takes no `sandbox`/`resume`/`onBackendSession`, the Claude adapter
 * steers through its held-open input feed and `drainDeliveries` rather than a per-turn
 * drain). Two are genuine gaps, deliberately left for their own commit rather than
 * folded into this coverage pass: `observeChanges` is accepted by all three adapter
 * inits and passed by none, and `onTurnInterrupt` is accepted by the Claude init and
 * not passed.
 */
const NOT_FORWARDED: Record<'claude' | 'deepseek' | 'longcat', readonly InitKey[]> = {
  claude: ['observeChanges', 'onTurnInterrupt'],
  deepseek: [
    'sandbox',
    'observeChanges',
    'resume',
    'onBackendSession',
    'deliverHistoryAsPreamble',
    'onTurnInterrupt',
  ],
  longcat: [
    'sandbox',
    'observeChanges',
    'resume',
    'onBackendSession',
    'deliverHistoryAsPreamble',
    'onTurnInterrupt',
  ],
};

const factories = {
  claude: createClaudeAdapter,
  deepseek: (i: SessionAdapterInit) => createOpenAiCompatAdapter(deepseekSpec, i),
  longcat: (i: SessionAdapterInit) => createOpenAiCompatAdapter(longcatSpec, i),
} as const;

describe('the session-core → adapter forwarding contract', () => {
  for (const backend of ['claude', 'deepseek', 'longcat'] as const) {
    it(`classifies every SessionAdapterInit field for ${backend}`, () => {
      expect([...FORWARDED[backend], ...NOT_FORWARDED[backend]].sort()).toEqual(
        Object.keys(FULL_INIT).sort(),
      );
    });

    it(`forwards every contracted field into the ${backend} adapter's init`, () => {
      const before = captured[backend].length;
      factories[backend](FULL_INIT);
      const seen = captured[backend][before] as Record<string, unknown> | undefined;
      expect(seen).toBeDefined();
      for (const key of FORWARDED[backend]) {
        // Identity, not deep equality: two distinct no-op functions compare EQUAL under
        // `toEqual`, which would let a dropped callback pass.
        expect(seen?.[key], `'${key}' never reached the ${backend} adapter`).toBe(FULL_INIT[key]);
      }
    });

    it(`forwards drainDeliveries into the ${backend} adapter, so a queued steer can reach the model`, () => {
      // Called out on its own because deleting exactly this line ships the mid-loop
      // delivery path DEAD: the queue fills, the steer is logged and acknowledged
      // `{ steered: true }`, and nothing ever drains it (delivery is one intent,
      // realized per backend — the drain hook is how a pure-API backend realizes it).
      const before = captured[backend].length;
      factories[backend](init({ drainDeliveries: FULL_INIT.drainDeliveries }));
      const seen = captured[backend][before] as Record<string, unknown> | undefined;
      expect(seen?.['drainDeliveries']).toBe(FULL_INIT.drainDeliveries);
    });
  }
});
