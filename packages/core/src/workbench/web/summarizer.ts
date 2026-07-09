import type { CompleteFn, DriverMessage } from '@coa/loop-driver';
import type { RuntimeUsage } from '@coa/spi';
import type { Summarizer } from '../web-tools.js';

const DEFAULT_SYSTEM =
  'You summarize a fetched web page to answer the user prompt. Be faithful to the page; do not invent facts.';

/**
 * A minimal summarizer agent over the shared `complete()` primitive. Bound at the
 * wiring layer to a cheap model (e.g. DeepSeek V4 flash); its cost is recorded to
 * the M7 ledger via `recordCost`. It offers no tools — one round-trip, text out.
 */
export function makeSummarizer(config: {
  complete: CompleteFn;
  recordCost?: (usage: RuntimeUsage) => void;
  systemPrompt?: string;
}): Summarizer {
  return {
    async summarize(req): Promise<string> {
      const messages: DriverMessage[] = [
        { role: 'system', content: config.systemPrompt ?? DEFAULT_SYSTEM },
        { role: 'user', content: `Prompt: ${req.prompt}\n\nPage:\n${req.markdown}` },
      ];
      // The summarizer has no UI to stream to, so it drains the generator without
      // surfacing deltas — a non-streaming complete() (D85 degrade) yields nothing and
      // this loop settles on the first `next()`.
      const it = config.complete(messages, []);
      let step = await it.next();
      while (step.done !== true) step = await it.next();
      const result = step.value;
      config.recordCost?.(result.usage);
      return result.text;
    },
  };
}
