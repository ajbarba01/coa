import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createSdkMcpServer,
  query,
  tool,
  type HookInput,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { sessionAuthEnv } from '../auth-env.js';
import { toSdkPrompt } from '../session-input.js';
import {
  resolveLiveLocator,
  createPushQueue,
  delay,
  withTimeoutMessage,
} from '../live-smoke-helpers.js';

/**
 * Control-spike stages 3-4 — LIVE probes. These need a real backend round-trip and
 * are the part of this task the offline file (stage-3-4-turn-control.test.ts)
 * could not settle: hooks and canUseTool are dispatched over the SDK's stdio
 * control protocol, invisible to the argv-only stub-CLI harness, so the questions
 * that matter most for stage 3-4 verdicts — does canUseTool see every call
 * (built-in AND MCP), can PreToolUse's updatedInput actually rewrite what runs,
 * does a Stop-hook block genuinely keep the loop open, does maxTurns override a
 * blocking Stop hook or the reverse, what TerminalReason a coa-initiated interrupt
 * produces — only a live query() answers.
 *
 * These probes drive the RAW SDK `query()` directly rather than going through
 * ClaudeSdkAdapter: the adapter only wires the two hooks coa actually uses today
 * (canUseTool → its own predicate, Stop → the close-gate), and this file needs to
 * register hooks and MCP servers coa's adapter does not yet expose a seam for.
 * That is itself consistent with this task's scope — findings feed P1, no adapter
 * behaviour changes here (AGENTS.md / the plan's global constraints).
 *
 * SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 *
 * `COA_LIVE` unset ⇒ the whole file is skipped, so `pnpm vitest run
 * packages/adapter-claude-sdk` stays green with no account and CI never runs it.
 * Every test spends real subscription tokens — prompts are kept tiny and
 * single-purpose. Written but NOT run as part of this task; running it is Task 9's
 * serialised live pass.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/control/stage-3-4-turn-control.live.test.ts
 */
// A live model turn cannot finish inside vitest's 5s default, so every probe in this
// file would fail on the clock rather than on its claim. The repo's existing smokes pass
// a per-test timeout; setting it once per file is the same contract with less repetition.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(!process.env['COA_LIVE'])('stage 3-4 — live turn control', () => {
  function liveEnv(): Record<string, string | undefined> | undefined {
    return sessionAuthEnv(resolveLiveLocator());
  }

  function probeWorktree(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix));
  }

  // --- Stage 3: does canUseTool see EVERY call, built-in and MCP-served alike? ---

  it('canUseTool fires for both a built-in tool call and an MCP-served tool call', async () => {
    const worktree = probeWorktree('coa-live-canusetool-');
    writeFileSync(join(worktree, 'marker.txt'), 'COA_PROBE_MARKER_7f3a', 'utf8');

    const echoTool = tool(
      'echo',
      'Echoes the given value back verbatim.',
      { value: z.string() },
      async (args) => ({ content: [{ type: 'text', text: args.value }] }),
    );
    const probeServer = createSdkMcpServer({ name: 'probe', tools: [echoTool] });

    const seenToolNames: string[] = [];
    const options: Options = {
      settingSources: [],
      cwd: worktree,
      allowedTools: ['Read', 'mcp__probe__echo'],
      mcpServers: { probe: probeServer },
      // The allow result must ECHO the input back. A bare `{behavior:'allow'}` is type-valid
      // but the real CLI treats it as a permission error for every tool, so nothing executes
      // and the probe measures the callback's own bug instead of the SDK's behaviour.
      canUseTool: async (toolName, input) => {
        seenToolNames.push(toolName);
        return { behavior: 'allow', updatedInput: input };
      },
      env: liveEnv(),
    };

    const emitted: string[] = [];
    const q = query({
      prompt:
        'Read the file marker.txt in the current directory, then call the echo tool ' +
        'with value set to exactly "PROBE_DONE". Do nothing else.',
      options,
    });
    for await (const message of q) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') emitted.push(block.name);
        }
      }
    }

    // "canUseTool saw nothing" has two unrelated causes — the model never called a tool, or
    // it did and the callback was not consulted. Without this the assertion cannot tell them
    // apart, and the answer to the load-bearing question below would be a coin flip.
    const diagnostic = `canUseTool saw ${JSON.stringify(seenToolNames)}; model emitted ${JSON.stringify(emitted)}`;

    // The load-bearing question: does the SAME canUseTool predicate see a
    // built-in (Read) AND an MCP-served tool (mcp__probe__echo)? If either is
    // missing, coa's "canUseTool is the universal per-tool lever" assumption
    // (the assumption checklist's last bullet) is wrong for that tool class.
    // OBSERVED, and the original expectation was WRONG in a way that matters more than the
    // question being asked. The model emitted `Read`, `ToolSearch` and `mcp__probe__echo`,
    // and `canUseTool` was consulted for NONE of them:
    //
    //     canUseTool saw []; model emitted ["Read","ToolSearch","mcp__probe__echo"]
    //
    // The cause is `allowedTools` itself. It means AUTO-APPROVE, so a tool listed there is
    // pre-permitted and never reaches the permission callback. The companion probe below
    // isolates that. Recorded as the observed truth rather than trimmed to the tidy answer.
    expect(seenToolNames, diagnostic).toEqual([]);
    expect(emitted, diagnostic).toContain('Read');
    expect(emitted, diagnostic).toContain('mcp__probe__echo');
  }, 60_000);

  it('is suppressed by allowedTools — the same call reaches canUseTool once the tool is no longer auto-approved', async () => {
    // The probe above showed `canUseTool` seeing nothing while the model called tools freely.
    // This isolates the cause by changing ONE thing: dropping `allowedTools`. If the callback
    // now fires for the same calls, then coa's allow-intent silently disables coa's own
    // per-call gate — a governance hole in shipped code, since `resolveToolTransport` maps
    // coa's allow set onto `allowedTools` and M3/M7 decisions ride `canUseTool`.
    const worktree = probeWorktree('coa-live-canusetool-noallow-');
    writeFileSync(join(worktree, 'marker.txt'), 'COA_PROBE_MARKER_7f3a', 'utf8');

    const seenToolNames: string[] = [];
    const emitted: string[] = [];
    const q = query({
      prompt: 'Read the file marker.txt in the current directory. Do nothing else.',
      options: {
        settingSources: [],
        cwd: worktree,
        canUseTool: async (toolName, input) => {
          seenToolNames.push(toolName);
          return { behavior: 'allow', updatedInput: input };
        },
        env: liveEnv(),
      },
    });
    for await (const message of q) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') emitted.push(block.name);
        }
      }
    }

    const diagnostic = `canUseTool saw ${JSON.stringify(seenToolNames)}; model emitted ${JSON.stringify(emitted)}`;
    expect(seenToolNames.length, diagnostic).toBeGreaterThan(0);
  }, 60_000);

  // --- Stage 3: does PreToolUse's updatedInput actually rewrite what executes? ---

  it('a PreToolUse hook returning updatedInput changes what the tool actually receives', async () => {
    const received: string[] = [];
    const echoTool = tool(
      'echo',
      'Echoes the given value back verbatim.',
      { value: z.string() },
      async (args) => {
        received.push(args.value);
        return { content: [{ type: 'text', text: args.value }] };
      },
    );
    const probeServer = createSdkMcpServer({ name: 'probe', tools: [echoTool] });

    const options: Options = {
      settingSources: [],
      allowedTools: ['mcp__probe__echo'],
      mcpServers: { probe: probeServer },
      canUseTool: async () => ({ behavior: 'allow' }),
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input: HookInput) => {
                if ('tool_name' in input && input.tool_name === 'mcp__probe__echo') {
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      updatedInput: { value: 'REWRITTEN_BY_HOOK' },
                    },
                  };
                }
                return {};
              },
            ],
          },
        ],
      },
      env: liveEnv(),
    };

    const q = query({
      prompt:
        'Call the echo tool with value set to exactly "ORIGINAL_FROM_MODEL". Do nothing else.',
      options,
    });
    for await (const _message of q) {
      // Drain.
    }

    // The negative half (offline) already showed PreToolUse cannot return a
    // result. This is the positive half: does updatedInput at least let coa
    // REWRITE the call before it runs? If `received` still shows the model's
    // original value, updatedInput is `Shaped` at best (advisory) rather than
    // `Owned`; if it shows the rewritten value, PreToolUse genuinely substitutes
    // the executed arguments even though it cannot substitute the RESULT.
    expect(received).toEqual(['REWRITTEN_BY_HOOK']);
  }, 60_000);

  // --- Stage 4: does {decision:'block',reason} on Stop genuinely keep the loop open? ---

  it('a Stop hook returning {decision:"block",reason} blocks the close and the agent continues (re-verifies sdk-options.ts:44-56 on 0.3.196)', async () => {
    let stopHookCalls = 0;
    const observedResultSubtypes: string[] = [];

    const options: Options = {
      settingSources: [],
      canUseTool: async () => ({ behavior: 'allow' }),
      hooks: {
        Stop: [
          {
            hooks: [
              async () => {
                stopHookCalls += 1;
                // Block exactly once, then let the close through — mirrors
                // toStopHookOutput's shape from sdk-options.ts.
                return stopHookCalls === 1
                  ? { decision: 'block' as const, reason: 'coa: not done yet, keep going' }
                  : { continue: true };
              },
            ],
          },
        ],
      },
      env: liveEnv(),
    };

    const q = query({ prompt: 'Say the single word DONE and stop.', options });
    for await (const message of q) {
      if (message.type === 'result') observedResultSubtypes.push(message.subtype);
    }

    // If {decision:'block',reason} still blocks the close on 0.3.196, the Stop
    // hook must have been asked at least TWICE (once blocked, once let through) —
    // a single call would mean the harness stopped regardless of the hook's
    // answer, which is exactly the SPEC-draft-wrong scenario the existing comment
    // says it corrected.
    expect(stopHookCalls).toBeGreaterThanOrEqual(2);
  }, 60_000);

  // --- Stage 4: maxTurns vs. a permanently-blocking Stop hook — which wins? ---

  it('maxTurns and an always-blocking Stop hook disagree on when to end — records which one wins', async () => {
    let stopHookCalls = 0;
    let sawMaxTurnsResult = false;
    let sawStopHookPreventedReason = false;

    const options: Options = {
      settingSources: [],
      maxTurns: 1,
      canUseTool: async () => ({ behavior: 'allow' }),
      hooks: {
        Stop: [
          {
            hooks: [
              async () => {
                stopHookCalls += 1;
                // Blocks EVERY time — the direct conflict with maxTurns:1.
                return { decision: 'block' as const, reason: 'coa: never actually done' };
              },
            ],
          },
        ],
      },
      env: liveEnv(),
    };

    // The outcome does not arrive as a `result` frame to inspect — the SDK RAISES it. Draining
    // without catching therefore fails the probe on the very event it was written to observe.
    let thrown: Error | undefined;
    const q = query({
      prompt: 'Say the single word DONE and stop. Keep it to one short reply.',
      options,
    });
    try {
      for await (const message of q) {
        if (message.type === 'result') {
          if (message.subtype !== 'success' && message.subtype === 'error_max_turns') {
            sawMaxTurnsResult = true;
          }
          if (message.terminal_reason === 'max_turns') sawMaxTurnsResult = true;
          if (message.terminal_reason === 'stop_hook_prevented') sawStopHookPreventedReason = true;
        }
      }
    } catch (err) {
      thrown = err instanceof Error ? err : new Error(String(err));
      if (/maximum number of turns/i.test(thrown.message)) sawMaxTurnsResult = true;
    }

    // No a-priori expectation asserted as fact — this is the open question the
    // plan flags ("Does maxTurns interact with the Stop hook, and which wins?").
    // The meaningful assertion is that the query TERMINATES at all (it must not
    // hang forever fighting itself), which one of the two mutually exclusive
    // outcomes fires, and that stopHookCalls/sawMaxTurnsResult together tell us
    // which lever the harness honours first. A future run reads these three
    // values off the console output and reports the winner; this probe's job is
    // to make that observation possible without guessing it here.
    // ANSWERED: `maxTurns` wins. With `maxTurns: 1` against a Stop hook that blocks every
    // time, the run ends on the turn cap — raised as `Reached maximum number of turns (1)` —
    // and never reaches a `stop_hook_prevented` terminal reason. The two levers are not peers:
    // the turn cap is the outer bound and the close-gate argues only inside it, so coa's gate
    // cannot hold a session open past `maxTurns`.
    const diagnostic = `stopHookCalls = ${stopHookCalls}; maxTurns = ${sawMaxTurnsResult}; stopHookPrevented = ${sawStopHookPreventedReason}; thrown = ${thrown?.message}`;
    expect(sawMaxTurnsResult, diagnostic).toBe(true);
    expect(sawStopHookPreventedReason, diagnostic).toBe(false);
  }, 60_000);

  // --- Stage 4: what TerminalReason does a coa-initiated interrupt produce? ---

  it('records the terminal_reason for a coa-initiated interrupt vs. a natural completion, on the SAME session', async () => {
    const queue = createPushQueue();
    const resultsByPromptIndex: Array<{ subtype: string; terminal_reason?: string }> = [];

    const options: Options = {
      settingSources: [],
      canUseTool: async () => ({ behavior: 'allow' }),
      env: liveEnv(),
    };

    const q = query({ prompt: toSdkPrompt(queue), options });

    const drain = (async () => {
      for await (const message of q as AsyncIterable<SDKMessage>) {
        if (message.type === 'result') {
          resultsByPromptIndex.push({
            subtype: message.subtype,
            terminal_reason: message.terminal_reason,
          });
        }
      }
    })();

    // Turn A: long enough to interrupt mid-flight (mirrors barge-in-smoke.live.test.ts).
    queue.push(
      'Write a long, detailed essay of at least 500 words about the history of the ' +
        'number zero across civilizations. Take your time; do not stop early.',
    );
    await delay(4_000);
    await q.interrupt();

    // Turn B: a short, naturally-completing follow-up for comparison.
    queue.push('Reply with exactly one word: BANANA.');
    await delay(8_000);
    queue.close();

    await withTimeoutMessage(drain, 30_000, 'the live session never drained after interrupt+close');

    // The interrupted turn A and the naturally-completed turn B should each carry
    // a `result` message. What this probe reports (rather than assumes): whether
    // terminal_reason distinguishes "coa interrupted this" from "the model just
    // finished" — none of TerminalReason's 13 members is literally named
    // "interrupted" or "user_stop", so the live value here is the finding.
    expect(resultsByPromptIndex.length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
