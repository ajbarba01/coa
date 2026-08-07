import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { makeOpenAiCompatComplete } from './complete.js';
import { resolveApiKey } from './credentials.js';
import { longcatSpec } from './longcat.js';

/**
 * The live tool-call gate. Every other LongCat test mocks `fetch`, so every one of them
 * asserts against a stream shape coa AUTHORED — which is precisely how the streaming
 * tool-call bug survived a green suite: the real LongCat stream sets the already-known
 * fields to `null` on the argument-continuation fragments (`id: null`, `name: null`), the
 * null-blind schema failed the chunk's parse, the chunk was dropped, and the call arrived
 * NAMED but with EMPTY arguments — which the governed tool then rejected as `invalid-args`,
 * blaming the model for the adapter's own data loss.
 *
 * A mock can only ever confirm coa's own assumptions. This one talks to the real API with a
 * real tool schema and asserts the arguments SURVIVE the round-trip. Skipped (never failed)
 * when no LongCat key is configured, so CI without creds stays green.
 */
const apiKey = resolveApiKey(longcatSpec, {
  type: 'key-file',
  path: `${process.env['USERPROFILE'] ?? process.env['HOME'] ?? ''}/.coa/keys/lc`,
});

describe.skipIf(apiKey === undefined)('LongCat live tool call', () => {
  it('returns a streamed tool call with its arguments intact', async (ctx) => {
    const complete = makeOpenAiCompatComplete(longcatSpec, {
      apiKey: apiKey as string,
      model: 'LongCat-2.0',
      prices: {},
    });
    const stream = complete(
      [{ role: 'user', content: 'Run `ls -la` in the repo root using the Bash tool.' }],
      [
        {
          name: 'Bash',
          description: 'run a shell command in the worktree',
          parameters: {
            command: z.string(),
            timeout: z.number().optional(),
            description: z.string().optional(),
          },
        },
      ],
      undefined,
    );
    let step;
    try {
      step = await stream.next();
      while (step.done !== true) step = await stream.next();
    } catch (error) {
      // Same availability philosophy as the key-file skipIf above: a quota-exhausted
      // account means the round-trip could not be attempted, not that it failed. Any
      // other error — schema, stream, transport — stays fatal.
      const message = error instanceof Error ? error.message : String(error);
      if (/quota|rate_limit|too_many_requests|(^|\D)429(\D|$)|(^|\D)402(\D|$)/i.test(message)) {
        ctx.skip(`LongCat quota exhausted — live round-trip unavailable: ${message}`);
      }
      throw error;
    }

    const call = step.value.toolCalls[0];
    expect(call?.name).toBe('Bash');
    // The assertion that matters: the model's arguments reached us. An empty `{}` here is
    // the bug — the tool call is useless without them.
    expect(call?.arguments).toHaveProperty('command');
    expect(typeof (call?.arguments as { command?: unknown }).command).toBe('string');
  }, 60_000);
});
