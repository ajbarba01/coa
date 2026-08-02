import {
  query,
  type HookJSONOutput,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { sessionAuthEnv } from '../auth-env.js';
import { resolveLiveLocator } from '../live-smoke-helpers.js';

/**
 * Control-spike stage 7 — **delegation**, the half that cannot be settled offline.
 *
 * `stage-7-delegation.test.ts` proves what the SDK *transmits*. It cannot prove what the CLI
 * *honours*, because the wrapper validates nothing and forwards `agents` verbatim (see the
 * `coaMadeThisUp` probe there). Everything below needs the real binary and a real account.
 *
 * Version under test: `@anthropic-ai/claude-agent-sdk` **0.3.196**, bundled CLI **2.1.196**
 * (commit `a4ca500badcac68511fb5f04303e32e4360f3dfb`).
 *
 * ## Running it
 *
 *     COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/control/stage-7-delegation.live.test.ts
 *
 * Gated exactly like the existing smokes: with `COA_LIVE` unset the whole file skips, so the
 * default suite stays green with no account. **These spend real subscription budget** and
 * several of them deliberately provoke a subagent spawn, which is the expensive kind of turn.
 * Prompts are kept minimal and every run carries `maxTurns` plus `maxBudgetUsd`.
 *
 * ## Every assertion here is a HYPOTHESIS
 *
 * Each probe states the belief it encodes and where that belief comes from. When a run
 * disagrees, **rewrite the assertion to the observed behaviour and record that the expectation
 * failed** — do not delete the probe. Failure messages carry the observed value so the rewrite
 * needs no second run.
 *
 * ## Known fragility
 *
 * The delegation probes depend on the model actually *choosing* to delegate. The prompts push
 * hard for it, but a refusal is a flaky run, not a finding. Re-run once before recording a
 * negative; if it refuses twice, record "the model declined to delegate" rather than "the
 * harness prevented it".
 *
 * ## What this file does NOT cover
 *
 * - Whether `toolAliases: { Agent: 'mcp__coa__…' }` actually reroutes a model-emitted `Agent`
 *   block to a coa MCP tool. It reaches the wire (offline probe), but exercising the reroute
 *   needs a registered in-process MCP server; `toolAliases` is stage 1–2's lever and belongs in
 *   that file.
 * - Whether `taskBudget`'s remaining-token count is decremented by a child's spend. Nothing in
 *   the SDK message stream exposes the API's `output_config.task_budget` accounting, so this is
 *   unobservable from here and needs the binary track or upstream docs. The **enforced** cap
 *   (`maxBudgetUsd`) is probed instead, since that is the one the arc's R4 is actually about.
 */

/** The two spellings this SDK version uses for the native delegation tool (arc risk R2). */
const DELEGATION_NAMES = ['Agent', 'Task'] as const;

interface InitInfo {
  readonly tools: readonly string[];
  readonly model: string;
  readonly agents: readonly string[];
}

interface LiveRun {
  readonly messages: readonly SDKMessage[];
  readonly init: InitInfo;
  readonly result: Extract<SDKMessage, { type: 'result' }> | undefined;
  /** Tool names the model actually emitted, in order. */
  readonly toolUses: readonly string[];
  /**
   * The error the SDK THREW out of the iteration, if any.
   *
   * Observed, not assumed: an error result does not arrive as a `result` frame to inspect —
   * `query()` raises it. A probe expecting `subtype: 'error_max_budget_usd'` therefore never
   * reaches its assertion, and would misread an enforced cap as an unenforced one. Capturing
   * the throw is what lets the budget probe read the outcome it was written for.
   */
  readonly thrown: Error | undefined;
}

function liveOptions(options: Options): Options {
  const locator = resolveLiveLocator();
  const env = sessionAuthEnv(locator);
  return {
    settingSources: [],
    strictMcpConfig: true,
    maxTurns: 6,
    maxBudgetUsd: 0.75,
    ...options,
    ...(env !== undefined ? { env } : {}),
  };
}

async function runLive(prompt: string, options: Options = {}): Promise<LiveRun> {
  const messages: SDKMessage[] = [];
  let thrown: Error | undefined;
  try {
    for await (const message of query({ prompt, options: liveOptions(options) })) {
      messages.push(message);
    }
  } catch (err) {
    thrown = err instanceof Error ? err : new Error(String(err));
  }

  const initMessage = messages.find(
    (m): m is Extract<SDKMessage, { type: 'system'; subtype: 'init' }> =>
      m.type === 'system' && m.subtype === 'init',
  );
  if (initMessage === undefined) {
    throw new Error('live run produced no system:init message — the session never started');
  }

  const toolUses: string[] = [];
  for (const message of messages) {
    if (message.type !== 'assistant') continue;
    for (const block of message.message.content) {
      if (block.type === 'tool_use') toolUses.push(block.name);
    }
  }

  return {
    messages,
    init: {
      tools: initMessage.tools,
      model: initMessage.model,
      agents: initMessage.agents ?? [],
    },
    result: messages.find((m): m is Extract<SDKMessage, { type: 'result' }> => m.type === 'result'),
    toolUses,
    thrown,
  };
}

/** The delegation tool name that actually appeared in `system:init.tools`, if any. */
function delegationNameIn(tools: readonly string[]): string | undefined {
  return DELEGATION_NAMES.find((name) => tools.includes(name));
}

const DELEGATE_PROMPT =
  'Delegate to a subagent named "tiny": ask it to reply with the single word ok, ' +
  'then reply with just that word yourself. Do not do the work yourself.';

const TINY_CHILD = {
  description: 'Answers one trivial question. Use for any delegated question.',
  prompt: 'Answer in one word. Do not use tools.',
  model: 'haiku',
  tools: [],
  maxTurns: 2,
} as const;

// A live model turn cannot finish inside vitest's 5s default, so every probe in this
// file would fail on the clock rather than on its claim. The repo's existing smokes pass
// a per-test timeout; setting it once per file is the same contract with less repetition.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(!process.env['COA_LIVE'])('stage 7 live — delegation against the real CLI', () => {
  describe('the Task/Agent rename (arc risk R2)', () => {
    it('advertises exactly ONE delegation spelling in system:init.tools', async () => {
      const run = await runLive('Reply with the single word: ok');
      const present = DELEGATION_NAMES.filter((name) => run.init.tools.includes(name));

      // HYPOTHESIS: the two spellings do not both appear. If they do, the demote set must
      // remove both, which is what the arc already plans for.
      expect(present, `system:init.tools = ${JSON.stringify(run.init.tools)}`).toHaveLength(1);

      // HYPOTHESIS (from the arc design): current SDK releases still emit `Task` in
      // `system:init` even though tool-use blocks say `Agent`. The offline probe showed the
      // shipped typings name the tool `Agent` everywhere the SCHEMA is declared, so this is
      // the assertion most likely to be wrong. If it fails, the arc's R2 note is stale and the
      // rename has fully landed — record that, it SIMPLIFIES the demote set.
      expect(present[0], `system:init.tools = ${JSON.stringify(run.init.tools)}`).toBe('Task');
    });

    it('emits `Agent` in the model’s tool_use block', async () => {
      const run = await runLive(DELEGATE_PROMPT, { agents: { tiny: TINY_CHILD } });

      // HYPOTHESIS (arc): tool-use blocks say `Agent` while system:init says `Task`. This is
      // the probe that proves or kills the "they disagree" claim, since it is taken from the
      // SAME run's sibling probe above.
      expect(run.toolUses, `tool_use names = ${JSON.stringify(run.toolUses)}`).toContain('Agent');
    });

    it('records the denial under whichever spelling canUseTool receives', async () => {
      // `canUseTool` sees the model-emitted name. HYPOTHESIS: `Agent`, matching the tool_use
      // block. Uses canUseTool rather than a PreToolUse deny on purpose: the SDK docs say
      // PreToolUse denies bypass canUseTool and produce no `permission_denied` record.
      const seen: string[] = [];
      const run = await runLive(DELEGATE_PROMPT, {
        agents: { tiny: TINY_CHILD },
        canUseTool: async (toolName) => {
          seen.push(toolName);
          return DELEGATION_NAMES.includes(toolName as (typeof DELEGATION_NAMES)[number])
            ? { behavior: 'deny', message: 'coa denied the spawn' }
            : { behavior: 'allow', updatedInput: {} };
        },
      });

      // Both original expectations were WRONG, and the way they were wrong is the finding.
      // Kept and inverted rather than deleted.
      const diagnostic = `canUseTool saw ${JSON.stringify(seen)}; model emitted ${JSON.stringify(run.toolUses)}; init advertised ${JSON.stringify(delegationNameIn(run.init.tools))}`;

      // FINDING 1 — the two spellings genuinely disagree WITHIN one live run, which is the
      // live confirmation of the arc's risk R2. `system:init.tools` advertises `Task`; the
      // model emits `Agent`. A demote set matching on one spelling misses the other, so it
      // must carry both, and a test asserting absence has to check the RENDERED FRAME rather
      // than trusting either name.
      expect(run.toolUses, diagnostic).toContain('Agent');
      expect(delegationNameIn(run.init.tools), diagnostic).toBe('Task');

      // FINDING 2 — and the more serious one. The model DID emit the delegation call, and
      // `canUseTool` was never consulted for it: coa's per-tool permission callback does not
      // see a native spawn. Every per-tool governance decision coa routes through `canUseTool`
      // is therefore blind to delegation, which is exactly the call most worth governing.
      // `PreToolUse` is the seam that does see it (probed offline in stage-7-delegation.test.ts);
      // this is why P1 cannot rely on `canUseTool` alone to gate a child.
      expect(seen, diagnostic).toEqual([]);
    });
  });

  describe('which lever removes the delegation tool from context', () => {
    it('leaves it present under the DEFAULT tool set', async () => {
      const run = await runLive('Reply with the single word: ok');
      expect(delegationNameIn(run.init.tools)).toBeDefined();
    });

    it('leaves it present when only `allowedTools` omits it', async () => {
      // HYPOTHESIS, and the probe that decides the arc's "the allowlist is the right lever"
      // claim. The offline probe showed `allowedTools` puts NOTHING availability-shaped on the
      // wire, and the SDK doc calls it auto-approve. So the tool should STILL be advertised.
      // If this fails — if the tool is gone — the arc was right and the doc is misleading.
      const run = await runLive('Reply with the single word: ok', { allowedTools: ['Read'] });
      expect(
        delegationNameIn(run.init.tools),
        `system:init.tools = ${JSON.stringify(run.init.tools)}`,
      ).toBeDefined();
    });

    it('removes it when `tools` states a built-in set without it', async () => {
      const run = await runLive('Reply with the single word: ok', { tools: ['Read', 'Grep'] });
      expect(
        delegationNameIn(run.init.tools),
        `system:init.tools = ${JSON.stringify(run.init.tools)}`,
      ).toBeUndefined();
    });

    it('removes it when `disallowedTools` names BOTH spellings', async () => {
      // HYPOTHESIS: the denylist works, contrary to the arc's "the denylist is the wrong
      // lever" — the SDK doc for `disallowedTools` says these tools are "removed from the
      // model's context and cannot be used".
      const run = await runLive('Reply with the single word: ok', {
        disallowedTools: [...DELEGATION_NAMES],
      });
      expect(
        delegationNameIn(run.init.tools),
        `system:init.tools = ${JSON.stringify(run.init.tools)}`,
      ).toBeUndefined();
    });
  });

  describe('a native subagent on a different model than the root', () => {
    it('runs the declared child on the declared model', async () => {
      const run = await runLive(DELEGATE_PROMPT, {
        model: 'sonnet',
        agents: { tiny: TINY_CHILD },
      });

      // The declaration reached the CLI and was accepted as a real agent type.
      expect(run.init.agents, `system:init.agents = ${JSON.stringify(run.init.agents)}`).toContain(
        'tiny',
      );

      // HYPOTHESIS — THE headline. The root ran sonnet; the child ran haiku; both appear in
      // the ROOT result's per-model usage. If this holds, cross-model delegation on the Claude
      // path is a declaration, not something coa has to build.
      const models = Object.keys(run.result?.modelUsage ?? {});
      expect(models.join(','), `modelUsage keys = ${JSON.stringify(models)}`).toMatch(/haiku/);
      expect(models.length, `modelUsage keys = ${JSON.stringify(models)}`).toBeGreaterThan(1);
    });

    it('does not reject an AgentDefinition field it does not know', async () => {
      // The other end of the offline "the wrapper validates nothing" finding: an unknown key
      // reaches the CLI verbatim. HYPOTHESIS: the CLI ignores it and the session starts. If it
      // errors, then forward-compatibility of `agents` is fragile and coa must whitelist
      // fields per SDK version.
      const withExtra = { ...TINY_CHILD, coaMadeThisUp: 42 } as unknown as Record<string, unknown>;
      const run = await runLive('Reply with the single word: ok', {
        agents: { tiny: withExtra as never },
      });
      expect(run.init.agents).toContain('tiny');
      expect(run.result?.subtype, `result = ${JSON.stringify(run.result?.subtype)}`).toBe(
        'success',
      );
    });
  });

  describe('the governance seam: can coa DENY a spawn, or only watch one', () => {
    it('fires SubagentStart and SubagentStop around a native subagent', async () => {
      const events: string[] = [];
      const run = await runLive(DELEGATE_PROMPT, {
        agents: { tiny: TINY_CHILD },
        hooks: {
          SubagentStart: [
            {
              hooks: [
                async (input): Promise<HookJSONOutput> => {
                  events.push(`start:${(input as { agent_type?: string }).agent_type ?? '?'}`);
                  return { continue: true };
                },
              ],
            },
          ],
          SubagentStop: [
            {
              hooks: [
                async (input): Promise<HookJSONOutput> => {
                  events.push(`stop:${(input as { agent_type?: string }).agent_type ?? '?'}`);
                  return { continue: true };
                },
              ],
            },
          ],
        },
      });

      expect(run.toolUses, `tool_use names = ${JSON.stringify(run.toolUses)}`).toContain('Agent');
      expect(
        events.filter((e) => e.startsWith('start:')),
        `events = ${JSON.stringify(events)}`,
      ).not.toHaveLength(0);
      expect(
        events.filter((e) => e.startsWith('stop:')),
        `events = ${JSON.stringify(events)}`,
      ).not.toHaveLength(0);
    });

    it('does NOT let SubagentStart block the spawn', async () => {
      // HYPOTHESIS, from the typings asymmetry the offline probe asserted:
      // `SubagentStartHookSpecificOutput` offers only `additionalContext`, while
      // `PreToolUseHookSpecificOutput` offers `permissionDecision`. Read as: SubagentStart is
      // an OBSERVE-and-inject point, not a gate. So a generic `{decision:'block'}` there
      // should be ignored and the subagent should still run to completion.
      //
      // If this FAILS — if the block is honoured — SubagentStart is a real second deny
      // channel, and that matters for SC-1: coa's constitution allows exactly two blocks, so a
      // new one must be routed through M9's single deny channel rather than used ad hoc.
      let started = false;
      let stopped = false;
      const run = await runLive(DELEGATE_PROMPT, {
        agents: { tiny: TINY_CHILD },
        hooks: {
          SubagentStart: [
            {
              hooks: [
                async (): Promise<HookJSONOutput> => {
                  started = true;
                  return { decision: 'block', reason: 'coa denies this spawn' };
                },
              ],
            },
          ],
          SubagentStop: [
            {
              hooks: [
                async (): Promise<HookJSONOutput> => {
                  stopped = true;
                  return { continue: true };
                },
              ],
            },
          ],
        },
      });

      expect(started, `tool_use names = ${JSON.stringify(run.toolUses)}`).toBe(true);
      expect(stopped, 'SubagentStop did not fire — the block may have prevented the spawn').toBe(
        true,
      );
    });

    it('DOES let a PreToolUse deny prevent the spawn', async () => {
      // HYPOTHESIS: intercepting the tool call is the real gate. This is the seam P1 would use
      // to govern a native subagent instead of replacing it.
      let started = false;
      const run = await runLive(DELEGATE_PROMPT, {
        agents: { tiny: TINY_CHILD },
        hooks: {
          PreToolUse: [
            {
              matcher: DELEGATION_NAMES.join('|'),
              hooks: [
                async (): Promise<HookJSONOutput> => ({
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: 'coa denies this spawn',
                  },
                }),
              ],
            },
          ],
          SubagentStart: [
            {
              hooks: [
                async (): Promise<HookJSONOutput> => {
                  started = true;
                  return { continue: true };
                },
              ],
            },
          ],
        },
      });

      expect(run.toolUses, `tool_use names = ${JSON.stringify(run.toolUses)}`).toContain('Agent');
      expect(started, 'SubagentStart fired despite a PreToolUse deny on the delegation tool').toBe(
        false,
      );
    });
  });

  describe('does a child’s spend land on the ROOT budget (arc risk R4)', () => {
    it('attributes the child’s tokens to the root result', async () => {
      // HYPOTHESIS: yes — `SDKResultMessage.modelUsage` is keyed by model and the root result
      // is the only result the SDK emits, so a child running on a different model shows up as
      // an extra key with non-zero tokens. R4 assumes the OPPOSITE (that fan-out escapes the
      // cap). If this passes, R4's premise is wrong for NATIVE subagents — though it stays
      // correct for coa-hosted children, which are separate sessions with separate results.
      const run = await runLive(DELEGATE_PROMPT, {
        model: 'sonnet',
        agents: { tiny: TINY_CHILD },
      });

      const usage = run.result?.modelUsage ?? {};
      const childKey = Object.keys(usage).find((k) => k.includes('haiku'));
      expect(childKey, `modelUsage = ${JSON.stringify(usage)}`).toBeDefined();
      const child = childKey === undefined ? undefined : usage[childKey];
      expect(child?.outputTokens ?? 0, `modelUsage = ${JSON.stringify(usage)}`).toBeGreaterThan(0);
      expect(run.result?.total_cost_usd ?? 0).toBeGreaterThan(0);
    });

    it('trips the root cost cap on a fan-out that a single turn would not reach', async () => {
      // Indicative rather than decisive — a cap this small can also be tripped by the root
      // alone. Its value is the ERROR SHAPE: `error_max_budget_usd` proves the cap is
      // enforced at all, and pairing it with the modelUsage probe above shows what it counts.
      const run = await runLive(
        'Delegate the same one-word question to the "tiny" subagent five times in a row.',
        { model: 'sonnet', agents: { tiny: TINY_CHILD }, maxBudgetUsd: 0.02, maxTurns: 12 },
      );
      // OBSERVED, correcting the original expectation: the cap IS enforced, but it does not
      // arrive as a `result` frame carrying `error_max_budget_usd`. The SDK RAISES it out of
      // the iteration ("Reached maximum budget ($0.02)"), so the run ends with a thrown error
      // and no inspectable result. That shape matters to coa beyond this probe: M7's cap is
      // one of the system's only two blocks, and on this path it surfaces as an exception, not
      // a frame — anything rendering it to a user has to catch, or SC-1 shows a crash where a
      // deliberate stop belongs.
      const outcome = run.thrown?.message ?? run.result?.subtype;
      expect(outcome, `thrown = ${run.thrown?.message}, subtype = ${run.result?.subtype}`).toMatch(
        /maximum budget|error_max_budget_usd/,
      );
    });
  });

  describe('forwardSubagentText — does child output reach coa’s frames', () => {
    it('emits only tool blocks from the child by DEFAULT', async () => {
      // The hypothesis here was WRONG and is recorded rather than deleted. It read the
      // option's doc to mean that without `forwardSubagentText` only tool_use/tool_result
      // blocks carry `parent_tool_use_id`, so coa would see THAT a child worked and not WHAT
      // it said. Observed: a child assistant text frame reaches coa on the DEFAULT path.
      //
      // The consequence runs the other way from the one the arc assumed. Child output is not
      // something coa must opt into surfacing — it arrives, so coa must decide what to DO
      // with it (attribute it, roll it up, or drop it) rather than deciding whether to ask.
      const run = await runLive(DELEGATE_PROMPT, { agents: { tiny: TINY_CHILD } });
      const childText = run.messages.filter(
        (m) =>
          m.type === 'assistant' &&
          m.parent_tool_use_id !== null &&
          m.message.content.some((b) => b.type === 'text'),
      );
      expect(
        childText.length,
        `child text frames on the default path = ${childText.length}`,
      ).toBeGreaterThan(0);
    });

    it('forwards the child’s own assistant text when the flag is on', async () => {
      const run = await runLive(DELEGATE_PROMPT, {
        agents: { tiny: TINY_CHILD },
        forwardSubagentText: true,
      });
      const childText = run.messages.filter(
        (m) =>
          m.type === 'assistant' &&
          m.parent_tool_use_id !== null &&
          m.message.content.some((b) => b.type === 'text'),
      );
      expect(childText.length, `child text frames = ${childText.length}`).toBeGreaterThan(0);
    });
  });
});
