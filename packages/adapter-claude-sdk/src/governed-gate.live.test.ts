import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCall, TurnFrame } from '@coa/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';
import {
  barebonesSandbox,
  collectText,
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
      // The live-suite money guard: the SDK's own budget stop, passed raw (not a coa governance surface).
      sdkOptions: { maxBudgetUsd: 0.25 },
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
   * Under the earlier two-seam design: `canUseTool` is never consulted for the native delegation call (`Task`/
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
  // RETIRED BY ITS OWN SUCCESS, 2026-08-03. This probe can no longer run: the built-in
  // floor removes delegation from the session, so the model has no
  // Task/Agent tool to attempt and the deny path is unreachable. The live run confirmed
  // exactly that — the model reported its tools as "Bash, Edit, Glob, Grep, Read,
  // WebFetch, WebSearch, and Write" and nothing else.
  //
  // Kept rather than deleted because P1c may deliberately reintroduce the name: aliasing
  // `Agent` onto a governed `spawn_agent` is a live design option, and the moment it lands
  // this probe becomes meaningful again. Un-skip it then.
  it.skip('denies a native delegation call (Task/Agent) via PreToolUse AND runs no child work', async () => {
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
      sdkOptions: { maxBudgetUsd: 0.1 },
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

    // HALF 1 — the PreToolUse seam is consulted for the delegation name
    // (`canUseTool` itself never sees this call, so this is the only seam that can).
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

/**
 * THE TWO PROBES THAT GATE THE ORCHESTRATION SLICE.
 *
 * All per-tool governance moved onto `PreToolUse`. That decision is verified
 * against TypeScript types only: `sdk.mjs` never reads `hookSpecificOutput`, the bundled
 * CLI binary does, so types cannot settle whether a type-valid deny is honoured.
 *
 * Both probes assert the EFFECT, not that a predicate fired. coa's predicate is consulted
 * from `PreToolUse` only — the native SDK `canUseTool` callback unconditionally allows
 * every call now (a same-commit fix: it used to also call the predicate, which was
 * harmless before F2 but became a double-fire of F2's stateful approval side effect for
 * one logical call) — so "the callback ran" still proves nothing about whether the CLI
 * obeyed the `PreToolUse` deny; only "the work did not happen" does.
 *
 * If either fails, the one-seam governance design loses its governance leg and coa-owned tool implementations
 * win by default. Neither is expensive: one capped turn each.
 */
describe.skipIf(!live)('the gate that one-seam per-tool governance rests on, live', () => {
  it('honours a PreToolUse deny for a built-in: the read never happens', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'coa-gate-deny-'));
    const marker = 'COA_DENY_MARKER_9f04';
    writeFileSync(join(worktree, 'secret.txt'), marker, 'utf8');

    const seen: string[] = [];
    const frames: TurnFrame[] = [];
    const adapter = new ClaudeSdkAdapter({
      sessionId: 'live-gate-deny',
      sandbox: barebonesSandbox(),
      input: 'Read the file secret.txt in the current directory and reply with its exact contents.',
      locator: resolveLiveLocator(),
      // The live-suite money guard: the SDK's own budget stop, passed raw (not a coa governance surface).
      sdkOptions: { maxBudgetUsd: 0.25 },
      onTurn: (frame) => frames.push(frame),
    });
    adapter.renderNative(minimalNeutralConfig());
    adapter.registerTools([]);
    // Deny EVERY tool. The model cannot obtain the marker except by a tool coa blocked.
    adapter.interceptTool((call: ToolCall) => {
      seen.push(call.tool);
      return { behavior: 'deny', message: 'denied by coa for this probe' };
    });
    adapter.interceptStop(neverStop);

    await adapter.runLoop({
      role: 'probe',
      scope: '.',
      worktree,
      capabilityFrame: { allow: [], deny: [] },
    });

    const text = collectText(frames);
    const diagnostic = `predicate saw ${JSON.stringify(seen)}; text = ${JSON.stringify(text)}`;

    // The gate must have been consulted at all — otherwise the run says nothing.
    expect(seen, diagnostic).not.toHaveLength(0);

    // THE DECIDING ASSERTION. The marker reaching the model's output means the read
    // executed despite coa denying it — the deny was NOT honoured, and every per-tool
    // deny in the system is decorative on this path.
    expect(text, diagnostic).not.toContain(marker);
  });

  it("honours a PreToolUse deny for coa's OWN mcp tool: the handler never runs", async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'coa-gate-mcp-'));

    // P1b measured the gate against a BUILT-IN Read only. P1c's `spawn_agent` will be a
    // coa-owned MCP tool, so whether the gate covers `mcp__coa__*` is the question that
    // decides if a governed spawn is governed at all.
    let handlerRuns = 0;
    const probeTool = {
      name: 'probe_echo',
      description: 'Echo a message back. Call this when asked to echo something.',
      partition: 'kernel' as const,
      inputSchema: { message: z.string() },
      invoke: (args: unknown) => {
        handlerRuns += 1;
        return { result: { echoed: args }, handle: 'probe:echo', pointer: 'echoed' };
      },
    };

    const seen: string[] = [];
    const frames: TurnFrame[] = [];
    const adapter = new ClaudeSdkAdapter({
      sessionId: 'live-gate-mcp',
      sandbox: barebonesSandbox(),
      input: 'Use the probe_echo tool to echo the word "hello". Do nothing else.',
      locator: resolveLiveLocator(),
      // The live-suite money guard: the SDK's own budget stop, passed raw (not a coa governance surface).
      sdkOptions: { maxBudgetUsd: 0.25 },
      onTurn: (frame) => frames.push(frame),
    });
    adapter.renderNative(minimalNeutralConfig());
    adapter.registerTools([probeTool]);
    adapter.interceptTool((call: ToolCall) => {
      seen.push(call.tool);
      return { behavior: 'deny', message: 'denied by coa for this probe' };
    });
    adapter.interceptStop(neverStop);

    await adapter.runLoop({
      role: 'probe',
      scope: '.',
      worktree,
      capabilityFrame: { allow: [], deny: [] },
    });

    const attempted = frames.some((f) => f.t === 'tool_use' && f.tool.includes('probe_echo'));
    const diagnostic =
      `predicate saw ${JSON.stringify(seen)}; handlerRuns=${handlerRuns}; ` +
      `attempted=${attempted}; text = ${JSON.stringify(collectText(frames))}`;

    // An unattempted call proves nothing about the deny — fail loudly rather than pass.
    if (!attempted) {
      throw new Error(
        `MCP GATE PROBE INCONCLUSIVE — the model never called probe_echo, so the deny ` +
          `path was never exercised. ${diagnostic}`,
      );
    }

    // THE DECIDING ASSERTION: coa denied it, so coa's own handler must not have run.
    expect(handlerRuns, diagnostic).toBe(0);
  });
});
