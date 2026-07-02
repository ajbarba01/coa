import type { Locator, ModelDescriptor } from '@coa/shared';
import type { ModelInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessionAuthEnv } from './auth-env.js';

/**
 * Backend capability discovery for models (M9). `modelInfoToDescriptor` is the
 * pure SDK→neutral map — kept faithful so each model's REAL `supportedEffortLevels`
 * reach the console (model-specific, not a flat set). `fetchClaudeModels` obtains
 * the account's live list via the SDK's control-plane `supportedModels()`: it opens
 * a streaming-input query (no turn is run — the input stream never yields), asks for
 * the models, and closes. Auth rides the same locator seam as a session.
 */
export function modelInfoToDescriptor(info: ModelInfo): ModelDescriptor {
  return {
    id: info.value,
    ...(info.displayName !== undefined ? { displayName: info.displayName } : {}),
    ...(info.description !== undefined && info.description !== ''
      ? { description: info.description }
      : {}),
    ...(info.supportsEffort !== undefined ? { supportsEffort: info.supportsEffort } : {}),
    ...(info.supportedEffortLevels !== undefined
      ? { supportedEffortLevels: info.supportedEffortLevels }
      : {}),
    ...(info.supportsAdaptiveThinking !== undefined
      ? { supportsAdaptiveThinking: info.supportsAdaptiveThinking }
      : {}),
  };
}

/** An input stream that never yields, kept open until `close()` — so opening the query runs no turn. */
function idleInput(): { input: AsyncIterable<SDKUserMessage>; close: () => void } {
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  const input: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await done;
        return { value: undefined as never, done: true };
      },
    }),
  };
  return { input, close: release };
}

/** Fetch the account's available models (+ per-model capabilities) via the SDK control plane. */
export async function fetchClaudeModels(locator?: Locator): Promise<ModelDescriptor[]> {
  const env = sessionAuthEnv(locator);
  const { input, close } = idleInput();
  const q = query({ prompt: input, options: { ...(env ? { env } : {}) } });
  try {
    const models = await q.supportedModels();
    return models.map(modelInfoToDescriptor);
  } finally {
    close();
    try {
      await q.return(undefined);
    } catch {
      // best-effort teardown of the capability query
    }
  }
}
