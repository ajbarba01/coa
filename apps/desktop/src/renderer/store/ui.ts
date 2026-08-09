import { create } from 'zustand';
import type { ModelSelection } from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../../shared/settings.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';

/**
 * The console-ui slice: local view state that is not daemon data — settings, the raw
 * toggle, editor selection, and the per-session notice/override bookkeeping the chat
 * derivations read. Nothing here is written by pushes or polls; it moves only on user
 * action, so its subscribers never re-render for stream traffic.
 */
interface UiState {
  settings: ConsoleSettings;
  /** When true the conversation renders the unfiltered loop (raw is always available). */
  rawMode: boolean;
  /** Inert local record of mock approvals the operator resolved (advisory: surfacing
   *  only — the daemon owns the real decision). */
  resolvedApprovals: Record<string, 'approved' | 'denied'>;
  /** The agent open in the Agents editor (not the chat's — that follows the session). */
  selectedAgentRef?: string | undefined;
  /** A per-session in-chat model/provider override the user set deliberately. Wins over
   *  the session pin for the next send (which then persists it), and drives the
   *  predictive cache banner. */
  modelOverride: Record<string, ModelSelection>;
  /** The config key the user dismissed the drift banner for, per session — suppression
   *  state for a derived banner; a changed config is a new key, so it re-shows. */
  dismissedDrift: Record<string, string>;
  /** The cache key the user dismissed the prompt-cache notice for, per session. */
  dismissedCache: Record<string, string>;
  /** Console-local "switched model" notes per session, positioned by the count of
   *  turn-derived frames already appended when the note was recorded. */
  notesBySession: Record<string, { afterCount: number; text: string }[]>;
}

export const useConsoleUi = create<UiState>(() => ({
  settings: DEFAULT_SETTINGS,
  rawMode: false,
  resolvedApprovals: {},
  selectedAgentRef: undefined,
  modelOverride: {},
  dismissedDrift: {},
  dismissedCache: {},
  notesBySession: {},
}));

export function setUiSettings(settings: ConsoleSettings): void {
  useConsoleUi.setState({ settings });
}

export function toggleRawMode(): void {
  useConsoleUi.setState((s) => ({ rawMode: !s.rawMode }));
}

export function resolveApproval(requestId: string, decision: 'approved' | 'denied'): void {
  useConsoleUi.setState((s) => ({
    resolvedApprovals: { ...s.resolvedApprovals, [requestId]: decision },
  }));
}

export function setSelectedAgent(ref: string | undefined): void {
  useConsoleUi.setState({ selectedAgentRef: ref });
}

/** MERGE the incoming partial into any existing override: the two composer controls each
 *  emit a partial (`onPickModel` → `{model, provider}`, `onPickEffort` → `{reasoning}`).
 *  Replacing meant a later effort pick wiped the model out of the override, so the send
 *  fell back to the agent's default model. Accumulating keeps the selection a coherent
 *  `{provider, model, reasoning}` unit. */
export function mergeModelOverride(sessionId: string, selection: ModelSelection): void {
  useConsoleUi.setState((s) => ({
    modelOverride: {
      ...s.modelOverride,
      [sessionId]: { ...s.modelOverride[sessionId], ...selection },
    },
  }));
}

export function clearModelOverride(sessionId: string): void {
  useConsoleUi.setState((s) => {
    if (s.modelOverride[sessionId] === undefined) return s;
    const modelOverride = { ...s.modelOverride };
    delete modelOverride[sessionId];
    return { modelOverride };
  });
}

export function setDismissedDrift(sessionId: string, key: string | undefined): void {
  useConsoleUi.setState((s) => {
    const dismissedDrift = { ...s.dismissedDrift };
    if (key === undefined) delete dismissedDrift[sessionId];
    else dismissedDrift[sessionId] = key;
    return { dismissedDrift };
  });
}

export function setDismissedCache(sessionId: string, key: string): void {
  useConsoleUi.setState((s) => ({
    dismissedCache: { ...s.dismissedCache, [sessionId]: key },
  }));
}

export function appendSessionNote(
  sessionId: string,
  note: { afterCount: number; text: string },
): void {
  useConsoleUi.setState((s) => ({
    notesBySession: {
      ...s.notesBySession,
      [sessionId]: [...(s.notesBySession[sessionId] ?? []), note],
    },
  }));
}

/** Session-delete housekeeping: drop every per-session record this slice holds (these
 *  used to accumulate forever — the module-map leak, now evicted with the session). */
export function evictUiSession(sessionId: string): void {
  useConsoleUi.setState((s) => {
    const modelOverride = { ...s.modelOverride };
    const dismissedDrift = { ...s.dismissedDrift };
    const dismissedCache = { ...s.dismissedCache };
    const notesBySession = { ...s.notesBySession };
    delete modelOverride[sessionId];
    delete dismissedDrift[sessionId];
    delete dismissedCache[sessionId];
    delete notesBySession[sessionId];
    return { modelOverride, dismissedDrift, dismissedCache, notesBySession };
  });
}

/** Test seam. */
export function resetConsoleUi(): void {
  useConsoleUi.setState(
    {
      settings: DEFAULT_SETTINGS,
      rawMode: false,
      resolvedApprovals: {},
      selectedAgentRef: undefined,
      modelOverride: {},
      dismissedDrift: {},
      dismissedCache: {},
      notesBySession: {},
    },
    true,
  );
}
