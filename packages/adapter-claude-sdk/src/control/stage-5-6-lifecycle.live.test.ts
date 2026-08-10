import { describe, expect, it, vi } from 'vitest';
import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Control-spike stages 5-6 — the live half. SDK 0.3.196 / CLI 2.1.196 (a4ca500).
 *
 * The offline suite (`stage-5-6-lifecycle.test.ts`) settled what the SDK DELIVERS. These probes
 * settle what the CLI DOES with it, which nothing offline can reach. Run serialised, never
 * concurrently with another `COA_LIVE` file — one account.
 *
 * Every probe here is a short session and costs cents.
 */

const LIVE = process.env['COA_LIVE'] !== undefined && process.env['COA_LIVE'] !== '';

const BASE: Options = {
  settingSources: [],
  // Keep the harness's own surface minimal so the probes measure the injection channel,
  // not tool behaviour. `tools: []` is stage 2's lever; borrowed here only as noise reduction.
  tools: [],
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  maxTurns: 40,
};

async function collect(
  prompt: string | AsyncIterable<SDKUserMessage>,
  options: Options,
  onQuery?: (q: ReturnType<typeof query>) => Promise<void>,
): Promise<SDKMessage[]> {
  const messages: SDKMessage[] = [];
  const q = query({ prompt, options });
  const pump = (async () => {
    for await (const message of q) messages.push(message);
  })();
  if (onQuery !== undefined) await onQuery(q);
  await pump;
  return messages;
}

// A live model turn cannot finish inside vitest's 5s default, so every probe in this
// file would fail on the clock rather than on its claim. The repo's existing smokes pass
// a per-test timeout; setting it once per file is the same contract with less repetition.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(!LIVE)('stage 5 live — the mid-session system channel', () => {
  it(
    'reports what the CLI does with a streamed role:system message',
    async () => {
      // Re-verifies the "verified SDK fact" at render-native.ts:44-45. The offline suite showed
      // the SDK transmits `role: 'system'` verbatim; only the CLI can say whether it is
      // accepted, coerced to a user turn, or rejected.
      //
      // HYPOTHESIS: it is NOT a usable system channel — the CLI either errors or treats it as a
      // user turn — so the claim survives in substance even though its stated basis was wrong.
      // Whatever happens, pin it: this decides whether coa's declaration plane gains a live
      // channel it has been designing around the absence of.
      const marker = 'coa-standing-authority-marker-8213';
      async function* turns(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user',
          message: {
            role: 'system',
            content: `Standing rule: whenever you reply, prefix it with ${marker}.`,
          },
          parent_tool_use_id: null,
        };
        yield {
          type: 'user',
          message: { role: 'user', content: 'Say hello.' },
          parent_tool_use_id: null,
        };
      }

      let error: unknown;
      let messages: SDKMessage[] = [];
      try {
        messages = await collect(turns(), { ...BASE });
      } catch (caught) {
        error = caught;
      }

      // Record the outcome three ways so the report can name which one happened, rather than
      // asserting one and losing the other two.
      const rejected = error !== undefined;
      const errored = messages.some((m) => m.type === 'result' && m.subtype !== 'success');
      const obeyed = messages.some(
        (m) => m.type === 'assistant' && JSON.stringify(m.message.content).includes(marker),
      );

      expect(
        [rejected, errored, obeyed].filter(Boolean).length,
        `role:system outcome — rejected=${String(rejected)} errored=${String(errored)} obeyed=${String(obeyed)}; ` +
          'if obeyed is true, render-native.ts:44-45 is wrong and coa HAS a mid-session system channel',
      ).toBeGreaterThan(0);
      // The hypothesis, stated as an assertion so a surprise fails loudly:
      expect(obeyed).toBe(false);
    },
    10 * 60_000,
  );

  it(
    'reports whether a shouldQuery:false message lands in context without a turn',
    async () => {
      // The other injection lever on the same channel, and the one coa would actually want:
      // append to the transcript, do not provoke a turn, have it merged into the next one.
      const marker = 'coa-quiet-injection-4471';
      async function* turns(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: 'user',
          message: { role: 'user', content: `Remember this token: ${marker}` },
          parent_tool_use_id: null,
          shouldQuery: false,
        };
        yield {
          type: 'user',
          message: { role: 'user', content: 'What token were you asked to remember?' },
          parent_tool_use_id: null,
        };
      }
      const messages = await collect(turns(), { ...BASE });
      const assistantText = messages
        .filter((m) => m.type === 'assistant')
        .map((m) => JSON.stringify(m.message.content))
        .join(' ');
      // CONFIRMED: the injected content reaches the model. Asked afterwards, it repeats the
      // token, so a `shouldQuery:false` message genuinely lands in context.
      expect(assistantText).toContain(marker);

      // The original expectation — that it costs no turn — was WRONG, and the correction is
      // the operative half. Two `result` frames come back for two yielded messages, so
      // `shouldQuery:false` suppresses neither the turn nor its result.
      //
      // Taken with the `role:system` probe above (transmitted, but NOT obeyed), this settles
      // the "verified SDK fact" in render-native.ts:44-45. A mid-session injection channel
      // DOES exist and its content is honoured — but it is a user-role turn, not a silent
      // system-role one. coa can inject standing authority mid-session; it cannot do so for
      // free, and it should not model it as a system message.
      const results = messages.filter((m) => m.type === 'result');
      expect(
        results,
        `result frames = ${results.length}; a shouldQuery:false message still costs a turn`,
      ).toHaveLength(2);
    },
    10 * 60_000,
  );
});
