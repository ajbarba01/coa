import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENTS,
  type HookEvent,
  type PreToolUseHookSpecificOutput,
  type SyncHookJSONOutput,
  type TerminalReason,
} from '@anthropic-ai/claude-agent-sdk';
import type { BackendConfig } from '@coa/spi';
import type { CapabilitySet } from '@coa/shared';
import { captureSpawn } from './probe-kit.js';
import { toSdkPermission, toStopHookOutput } from '../sdk-options.js';
import { assembleSessionOptions } from '../session-options.js';

/**
 * Control-spike stages 3-4 — per-call interception and the turn boundary.
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 *
 * The load-bearing finding of this file: `Options.hooks` and `Options.canUseTool`
 * are dispatched over the SDK's stdio control protocol, not argv. `captureSpawn`
 * only ever sees the CLI's argv, so it is structurally blind to hook callbacks —
 * confirmed below by registering every one of the 30 hook events and observing
 * zero argv diff. `canUseTool` is the one exception that leaves an argv trace: it
 * flips on `--permission-prompt-tool stdio`, but the per-call decision itself
 * still travels the same invisible protocol. That split is why stages 3-4 are
 * "largely live-only" — most of this task's real weight sits in
 * stage-3-4-turn-control.live.test.ts, not here.
 */

const emptyBackend = (): BackendConfig => ({
  systemPrompt: '',
  allowedTools: [],
  disallowedTools: [],
  perAgent: {},
  files: [],
});

const emptySandbox = (): CapabilitySet => ({
  allowedTools: [],
  denyRules: [],
  permissionMode: 'default',
  denyRead: [],
});

/**
 * The full HookEvent union as shipped on SDK 0.3.196. The `satisfies` clause is a
 * compile-time tripwire: if a future SDK removes a member, this assignment stops
 * compiling (`pnpm typecheck` fails). If one is added, the length assertion below
 * fails instead. Either way the ledger learns its stage-3/4 row expired.
 */
const KNOWN_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
  'MessageDisplay',
] as const satisfies readonly HookEvent[];

describe('stage 3 — per-call interception', () => {
  describe('the hook-event inventory', () => {
    it('pins the hook-event inventory for this SDK version', () => {
      expect(KNOWN_HOOK_EVENTS).toHaveLength(30);
    });

    it("matches the SDK's own exported HOOK_EVENTS constant — a runtime source of truth stronger than the type alone", () => {
      // The package exports HOOK_EVENTS as a runtime array alongside the HookEvent
      // type. Cross-checking against it means a future SDK bump that changes the
      // set fails HERE, at test time, even in a hypothetical world where a typo
      // kept the TYPE union technically satisfiable.
      expect([...HOOK_EVENTS].sort()).toEqual([...KNOWN_HOOK_EVENTS].sort());
    });

    it('registers exactly two of the thirty available hook events today (session-options.ts wires Stop + PreToolUse)', () => {
      // A real call through the production assembler — not a text scrape — so a
      // future change that wires a third event moves this EXPECTATION, and that
      // diff is the thing a reviewer sees. PreToolUse joined Stop once the native
      // spawn call turned out to bypass canUseTool entirely (docs/adr/0028); it
      // judges only the delegation spellings, so it is not a general-purpose gate.
      const options = assembleSessionOptions({
        sessionId: 'probe',
        backend: emptyBackend(),
        sandbox: emptySandbox(),
        canUseTool: () => ({ behavior: 'allow' }),
        stopPredicate: () => ({ allow: true }),
      });
      const registered = Object.keys(options.hooks ?? {});
      expect(registered).toEqual(['Stop', 'PreToolUse']);

      // The gap is the finding in its own right: PreCompact/PostCompact bear on
      // stage 5 (context over time), SubagentStart/SubagentStop on stage 7
      // (delegation), and PermissionRequest/PermissionDenied on the arc's own
      // deny channel — all available, none wired.
      const unregistered = KNOWN_HOOK_EVENTS.filter((event) => !registered.includes(event));
      expect(unregistered).toHaveLength(28);
      expect(unregistered).toEqual(
        expect.arrayContaining([
          'PreCompact',
          'PostCompact',
          'SubagentStart',
          'SubagentStop',
          'PermissionRequest',
          'PermissionDenied',
        ]),
      );
    });
  });

  describe('hook registration is invisible to argv; canUseTool is not', () => {
    it('registers a PreToolUse callback without it reaching argv', async () => {
      const capture = await captureSpawn({
        settingSources: [],
        hooks: { PreToolUse: [{ hooks: [() => Promise.resolve({ continue: true })] }] },
      });
      // Hooks are callbacks over the control protocol, not argv. Assert the
      // observed reality rather than assuming either way.
      expect(capture.argv).toBeDefined();
    });

    it('produces byte-identical argv whether or not a PreToolUse hook is registered', async () => {
      const baseline = await captureSpawn({ settingSources: [] });
      const withHook = await captureSpawn({
        settingSources: [],
        hooks: { PreToolUse: [{ hooks: [() => Promise.resolve({ continue: true })] }] },
      });
      expect(withHook.argv).toEqual(baseline.argv);
    });

    it('produces byte-identical argv even when all thirty hook events are registered at once', async () => {
      // The falsification attempt: if hooks left ANY argv trace, registering every
      // event at once is the case most likely to surface it (a count, a flag, a
      // JSON blob). It does not.
      const baseline = await captureSpawn({ settingSources: [] });
      const allHooks = Object.fromEntries(
        KNOWN_HOOK_EVENTS.map((event) => [
          event,
          [{ hooks: [() => Promise.resolve({ continue: true })] }],
        ]),
      );
      const withAllHooks = await captureSpawn({ settingSources: [], hooks: allHooks });
      expect(withAllHooks.argv).toEqual(baseline.argv);
    });

    it('pushes --permission-prompt-tool stdio onto argv when canUseTool is set', async () => {
      // Unlike hooks, canUseTool DOES leave an argv trace — the SDK wrapper routes
      // it through the same "permission prompt tool" mechanism a CLI-configured
      // prompt tool would use, just pointed at stdio (i.e. back at this process).
      const capture = await captureSpawn({
        settingSources: [],
        canUseTool: () => Promise.resolve({ behavior: 'allow' }),
      });
      expect(capture.hasFlag('--permission-prompt-tool')).toBe(true);
      expect(capture.flag('--permission-prompt-tool')).toBe('stdio');
    });

    it('omits --permission-prompt-tool when canUseTool is absent', async () => {
      const capture = await captureSpawn({ settingSources: [] });
      expect(capture.hasFlag('--permission-prompt-tool')).toBe(false);
    });

    it('adding hooks alongside canUseTool changes nothing beyond the canUseTool marker itself', async () => {
      const canUseToolOnly = await captureSpawn({
        settingSources: [],
        canUseTool: () => Promise.resolve({ behavior: 'allow' }),
      });
      const canUseToolPlusHooks = await captureSpawn({
        settingSources: [],
        canUseTool: () => Promise.resolve({ behavior: 'allow' }),
        hooks: { Stop: [{ hooks: [() => Promise.resolve({ continue: true })] }] },
      });
      expect(canUseToolPlusHooks.argv).toEqual(canUseToolOnly.argv);
    });
  });

  describe('per-tool decision mapping (canUseTool result ↔ SDK PermissionResult)', () => {
    it('maps an allow decision to the SDK allow shape, echoing the input back', () => {
      const input = { file_path: 'a.ts' };
      expect(toSdkPermission({ behavior: 'allow' }, input)).toEqual({
        behavior: 'allow',
        updatedInput: input,
      });
    });

    it('maps a deny decision to the SDK deny shape, carrying the message', () => {
      expect(toSdkPermission({ behavior: 'deny', message: 'cost cap exceeded' }, {})).toEqual({
        behavior: 'deny',
        message: 'cost cap exceeded',
      });
    });
  });

  describe('PreToolUse cannot substitute a tool result on this SDK version', () => {
    it('has exactly the known field set — no result-bearing field exists', () => {
      // Required<> forces every optional field of the type to be present. If the
      // SDK ever adds a new field to PreToolUseHookSpecificOutput — a
      // result-substituting one, in particular — this object literal stops
      // satisfying the type until updated, so `pnpm typecheck` catches the new
      // lever (or the loss of an old one) instead of it going unnoticed.
      const full: Required<PreToolUseHookSpecificOutput> = {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'probe',
        updatedInput: { file_path: '/tmp/x' },
        additionalContext: 'probe',
      };
      expect(Object.keys(full).sort()).toEqual(
        [
          'additionalContext',
          'hookEventName',
          'permissionDecision',
          'permissionDecisionReason',
          'updatedInput',
        ].sort(),
      );
      expect(Object.keys(full)).not.toContain('toolResult');
      expect(Object.keys(full)).not.toContain('result');
      expect(Object.keys(full)).not.toContain('output');
    });
  });

  // Cannot be settled offline: whether canUseTool actually observes EVERY tool
  // call, including MCP-served ones and built-ins. captureSpawn only sees the
  // argv-level --permission-prompt-tool marker asserted above; the calls
  // themselves travel the control-protocol channel the stub CLI never speaks.
  // See stage-3-4-turn-control.live.test.ts.
});

describe('stage 4 — turn boundary', () => {
  describe('the Stop-hook close-gate mapping (sdk-options.ts:44-56)', () => {
    it('maps a coa close-gate denial to a blocking Stop-hook output', () => {
      expect(toStopHookOutput({ allow: false, message: 'unfinished work' })).toEqual({
        decision: 'block',
        reason: 'unfinished work',
      });
    });

    it('maps a coa close-gate allow to continue:true', () => {
      expect(toStopHookOutput({ allow: true })).toEqual({ continue: true });
    });

    it('the {decision:"block",reason} shape still type-checks as a live SyncHookJSONOutput on 0.3.196', () => {
      // Re-verifies the TYPE half of the sdk-options.ts:44-56 SPEC-fold-in
      // correction: `decision`/`reason` are still TOP-LEVEL fields on
      // SyncHookJSONOutput on this version, not nested under
      // hookSpecificOutput.StopHookSpecificOutput (which carries only
      // `additionalContext`, no decision). If the SDK ever moved `decision` out of
      // this shape, the assignment below would stop compiling.
      const blocked: SyncHookJSONOutput = { decision: 'block', reason: 'unfinished work' };
      expect(blocked).toEqual(toStopHookOutput({ allow: false, message: 'unfinished work' }));
      // What this probe CANNOT settle: whether the CLI binary that CONSUMES this
      // JSON still treats decision:'block' as "prevent the close" at RUNTIME. The
      // existing code comment claims that was re-verified live; this file
      // re-verifies only the type shape. stage-3-4-turn-control.live.test.ts
      // carries the runtime re-verification.
    });
  });

  describe('maxTurns', () => {
    it('pins --max-turns as the argv flag maxTurns maps to', async () => {
      const capture = await captureSpawn({ settingSources: [], maxTurns: 5 });
      expect(capture.hasFlag('--max-turns')).toBe(true);
      expect(capture.flag('--max-turns')).toBe('5');
    });

    it('omits --max-turns when unset', async () => {
      const capture = await captureSpawn({ settingSources: [] });
      expect(capture.hasFlag('--max-turns')).toBe(false);
    });

    it('maxTurns and the Stop hook are wired through entirely separate channels (argv vs. protocol) — which WINS at runtime is unsettled here', async () => {
      // Both levers can be set simultaneously with no conflict at the option-
      // construction layer: maxTurns lands in argv up front, the Stop hook is
      // negotiated per-turn over the control protocol later. That independence is
      // as far as an offline probe can go — whether the CLI honours maxTurns even
      // when a Stop hook is trying to keep the loop open (or vice versa) is a
      // live-only question. See stage-3-4-turn-control.live.test.ts.
      const capture = await captureSpawn({
        settingSources: [],
        maxTurns: 1,
        hooks: { Stop: [{ hooks: [() => Promise.resolve({ decision: 'block' as const })] }] },
      });
      expect(capture.flag('--max-turns')).toBe('1');
    });
  });

  describe('TerminalReason — the observable vocabulary', () => {
    /**
     * The full TerminalReason union as shipped on SDK 0.3.196. Same tripwire
     * pattern as KNOWN_HOOK_EVENTS above.
     */
    const KNOWN_TERMINAL_REASONS = [
      'blocking_limit',
      'rapid_refill_breaker',
      'prompt_too_long',
      'image_error',
      'model_error',
      'aborted_streaming',
      'aborted_tools',
      'stop_hook_prevented',
      'hook_stopped',
      'tool_deferred',
      'max_turns',
      'background_requested',
      'completed',
    ] as const satisfies readonly TerminalReason[];

    it('pins the TerminalReason union for this SDK version', () => {
      expect(KNOWN_TERMINAL_REASONS).toHaveLength(13);
    });

    it('carries a distinct member for a Stop-hook block versus a maxTurns cutoff, at the type level', () => {
      // stop_hook_prevented and max_turns are separate union members, so the TYPE
      // supports telling the two apart — and, on the same evidence, the type has a
      // THIRD distinct member (hook_stopped) whose relationship to
      // stop_hook_prevented is not documented anywhere in the shipped .d.ts.
      // Whether the harness actually POPULATES terminal_reason with the right one
      // per case, and what separates hook_stopped from stop_hook_prevented, is
      // unverifiable from types — see stage-3-4-turn-control.live.test.ts.
      expect(KNOWN_TERMINAL_REASONS).toContain('stop_hook_prevented');
      expect(KNOWN_TERMINAL_REASONS).toContain('hook_stopped');
      expect(KNOWN_TERMINAL_REASONS).toContain('max_turns');
    });

    it('coa now reads terminal_reason — turn-frames.ts reports it on the boundary (docs/adr/0028)', () => {
      // This survey originally found the opposite: turn-frames.ts derived its error frame
      // from `subtype` alone, so stop_hook_prevented vs. max_turns vs. completed were
      // indistinguishable to coa regardless of what the wire sent. That gap is closed —
      // confirmed here the same way the original finding was, by scanning coa's own source
      // (not the SDK's) for the literal field name, so this flips the moment the field is
      // read again.
      const turnFramesSrc = readFileSync(
        fileURLToPath(new URL('../turn-frames.ts', import.meta.url)),
        'utf8',
      );
      expect(turnFramesSrc).toContain('terminal_reason');
    });
  });
});
