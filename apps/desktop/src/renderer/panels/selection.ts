import type { ModelSelection } from '@coa/console-viewmodel';

/** The provider/model/reasoning fields shared by a session pin and an agent config. */
interface SelectionSource {
  provider?: string | undefined;
  model?: string | undefined;
  reasoning?: ModelSelection['reasoning'] | undefined;
}

/** Whether a session has already been pinned to a backend (it has run at least once). */
function isPinned(session: SelectionSource | undefined): session is SelectionSource {
  return (
    session !== undefined &&
    (session.provider !== undefined ||
      session.model !== undefined ||
      session.reasoning !== undefined)
  );
}

/**
 * Resolve the model selection to send for a turn — as a COHERENT UNIT from a single
 * source, never field-by-field across sources. An already-pinned session keeps
 * routing to the backend its memory lives in (its whole `(provider, model, reasoning)`
 * pin wins); the agent config only seeds a brand-new, unpinned session.
 *
 * Resolving field-by-field was the `haiku → deepseek` crash: a session pinned to a
 * Claude model with no provider recorded would take the model from the session but the
 * provider from a since-switched agent, sending the mismatched pair `{deepseek, haiku}`
 * to the backend. Taking the selection as a unit makes that impossible.
 */
export function resolveSelection(
  session: SelectionSource | undefined,
  agent: SelectionSource | undefined,
): ModelSelection {
  const src = isPinned(session) ? session : agent;
  return {
    ...(src?.provider !== undefined ? { provider: src.provider } : {}),
    ...(src?.model !== undefined ? { model: src.model } : {}),
    ...(src?.reasoning !== undefined ? { reasoning: src.reasoning } : {}),
  };
}
