import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCall, TurnFrame } from '@coa/shared';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';
import {
  barebonesSandbox,
  minimalNeutralConfig,
  neverStop,
  resolveLiveLocator,
} from './live-smoke-helpers.js';

/**
 * The one live gate on the foundation fixes. SDK 0.3.196 / CLI 2.1.196.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/governed-gate.live.test.ts
 *
 * Two shipped defects cancelled each other: coa's allow-intent auto-approved every tool
 * (so `canUseTool` never fired) while the allow result omitted `updatedInput` (so, when it
 * did fire, the real CLI refused the call). Both are type-valid and both pass offline.
 * This asserts BOTH halves in one run — the callback was consulted, AND the tool actually
 * executed — because either alone can pass while the system is broken.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const live = process.env['COA_LIVE'] === '1';

describe.skipIf(!live)('the governed gate, live', () => {
  it('consults canUseTool for a built-in call AND lets the call execute', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'coa-gate-'));
    const marker = 'COA_GATE_MARKER_4b21';
    writeFileSync(join(worktree, 'marker.txt'), marker, 'utf8');

    const seen: string[] = [];
    const frames: TurnFrame[] = [];
    const adapter = new ClaudeSdkAdapter({
      sessionId: 'live-gate',
      sandbox: barebonesSandbox(),
      input:
        'Read the file marker.txt in the current directory and reply with its exact contents. Do nothing else.',
      locator: resolveLiveLocator(),
      maxBudgetUsd: 0.25,
      onTurn: (frame) => frames.push(frame),
    });
    adapter.renderNative(minimalNeutralConfig());
    adapter.registerTools([]);
    adapter.interceptTool((call: ToolCall) => {
      seen.push(call.tool);
      return { behavior: 'allow' };
    });
    adapter.interceptStop(neverStop);

    await adapter.runLoop({
      role: 'probe',
      scope: '.',
      worktree,
      capabilityFrame: { allow: [], deny: [] },
    });

    const text = frames
      .filter((f): f is Extract<TurnFrame, { t: 'text' }> => f.t === 'text')
      .map((f) => f.text)
      .join(' ');
    const diagnostic = `canUseTool saw ${JSON.stringify(seen)}; text = ${JSON.stringify(text)}`;

    // HALF 1 — the gate runs. Before the fix, `allowedTools` auto-approved the call and
    // this array was empty while the model used tools freely.
    expect(seen, diagnostic).toContain('Read');

    // HALF 2 — and the call still worked. Before the fix, an allow without `updatedInput`
    // produced a permission error, so half 1 could pass with nothing executing.
    expect(text, diagnostic).toContain(marker);
  });

  /**
   * THE DELEGATION HALF — a separate live probe, distinct from the primary gate above.
   * Kept in its own `it` so a flaky or inconclusive result here never casts doubt on the
   * built-in-tool assertions proven above.
   *
   * docs/adr/0028: `canUseTool` is never consulted for the native delegation call (`Task`/
   * `Agent`), so coa denies it through a second seam — a `PreToolUse` hook that judges ONLY
   * delegation and abstains on everything else (`gateDelegation` in session-options.ts).
   * That deny is verified against TypeScript types only: `sdk.mjs` never reads
   * `hookSpecificOutput`, the bundled CLI binary does, so types cannot settle whether a
   * type-valid `{ permissionDecision: 'deny' }` is actually honoured. This is exactly the
   * failure mode the whole plan exists to close, so the delegation gate does not get to
   * ship on types alone.
   *
   * The model may simply never attempt a delegation call — that proves nothing about
   * whether a deny would have been honoured, so it must not read as a pass. If no
   * delegation attempt is observed, this test FAILS LOUDLY with a diagnostic that names
   * exactly what the model emitted instead, so a human can tell "the deny was honoured"
   * apart from "the model never tried" apart from "the deny was NOT honoured".
   */
  it('denies a native delegation call (Task/Agent) via PreToolUse AND runs no child work', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'coa-gate-delegation-'));

    const seenDelegation: string[] = [];
    const seenOther: string[] = [];
    const frames: TurnFrame[] = [];
    const adapter = new ClaudeSdkAdapter({
      sessionId: 'live-gate-delegation',
      sandbox: barebonesSandbox(),
      input:
        'You have a Task/Agent tool for delegating work to a sub-agent. Use that tool right ' +
        'now to delegate this exact trivial task to a sub-agent: reply with the single word ' +
        '"delegated". Call the delegation tool yourself — do not answer directly and do not ' +
        'do the work yourself.',
      locator: resolveLiveLocator(),
      // A few cents is plenty: either the deny fires on the first attempt, or the model
      // never attempts one — nothing here should run long enough to need more.
      maxBudgetUsd: 0.1,
      onTurn: (frame) => frames.push(frame),
    });
    adapter.renderNative(minimalNeutralConfig());
    adapter.registerTools([]);
    adapter.interceptTool((call: ToolCall) => {
      if (call.tool === 'Task' || call.tool === 'Agent') {
        seenDelegation.push(call.tool);
        return { behavior: 'deny', message: 'delegation is not authorised in this probe' };
      }
      seenOther.push(call.tool);
      return { behavior: 'allow' };
    });
    adapter.interceptStop(neverStop);

    await adapter.runLoop({
      role: 'probe',
      scope: '.',
      worktree,
      capabilityFrame: { allow: [], deny: [] },
    });

    const toolUses = frames.filter(
      (f): f is Extract<TurnFrame, { t: 'tool_use' }> => f.t === 'tool_use',
    );
    const toolResults = frames.filter(
      (f): f is Extract<TurnFrame, { t: 'tool_result' }> => f.t === 'tool_result',
    );
    const text = frames
      .filter((f): f is Extract<TurnFrame, { t: 'text' }> => f.t === 'text')
      .map((f) => f.text)
      .join(' ');
    const emittedToolUses = toolUses.map((f) => f.tool);
    const diagnostic =
      `predicate saw delegation calls: ${JSON.stringify(seenDelegation)}; ` +
      `predicate saw other calls: ${JSON.stringify(seenOther)}; ` +
      `model emitted tool_use for: ${JSON.stringify(emittedToolUses)}; ` +
      `text = ${JSON.stringify(text)}`;

    // Neither the PreToolUse hook nor the model's own tool_use content block saw a
    // delegation attempt — this run proves NOTHING about whether the deny is honoured.
    // Fail loudly rather than let an unattempted call read as a silent pass.
    const attempted =
      seenDelegation.length > 0 || emittedToolUses.some((t) => t === 'Task' || t === 'Agent');
    if (!attempted) {
      throw new Error(
        `DELEGATION PROBE INCONCLUSIVE — the model never attempted a Task/Agent call, ` +
          `so the deny path was never exercised. ${diagnostic}`,
      );
    }

    // HALF 1 — the PreToolUse seam is consulted for the delegation name (docs/adr/0028;
    // `canUseTool` itself never sees this call, so this is the only seam that can).
    expect(seenDelegation, diagnostic).not.toHaveLength(0);

    // HALF 2 — and the deny actually reached the CLI: no child work ran. A denied
    // PreToolUse call still surfaces the model's tool_use request, but its paired
    // tool_result must report failure, not a completed delegation.
    const delegationHandles = new Set(
      toolUses.filter((f) => f.tool === 'Task' || f.tool === 'Agent').map((f) => f.handle),
    );
    const delegationResults = toolResults.filter((f) => delegationHandles.has(f.handle));
    expect(delegationResults.length, diagnostic).toBeGreaterThan(0);
    expect(
      delegationResults.every((f) => f.ok === false),
      diagnostic,
    ).toBe(true);
  });
});
