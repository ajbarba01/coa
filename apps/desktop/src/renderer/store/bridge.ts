import type {
  AgentFile,
  CapState,
  Checkpoint,
  FeedView,
  ModelDescriptor,
  ModelSelection,
  PackageSummary,
  ReloadedConversationWire,
  RoleSummary,
  SessionSummary,
} from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../../shared/settings.js';

/** The subset of `window.coa` the console controller needs (injected for testing —
 *  this is the one seam the store's contract tests drive everything through). */
export interface ConsoleBridge {
  capState(): Promise<CapState>;
  flagsForUser(): Promise<FeedView>;
  listTimeline(): Promise<Checkpoint[]>;
  listAccounts(): Promise<{
    accounts: { label: string; provider: string }[];
    active: Record<string, string>;
  }>;
  currentAccount(): Promise<{ active: Record<string, string> }>;
  useAccount(params: {
    label: string;
    provider?: string;
  }): Promise<{ active: Record<string, string> }>;
  startSession(params: {
    input: string;
    conversationId?: string;
    roles?: string[];
    model?: ModelSelection;
    packageIds?: string[];
    exclude?: string[];
  }): Promise<{ sessionId: string; worktree: string }>;
  listModels(): Promise<ModelDescriptor[]>;
  // The agent-assembly catalogue for the role/package picker.
  listRoles(): Promise<RoleSummary[]>;
  listPackages(): Promise<PackageSummary[]>;
  // Agents — the daemon-owned registry (built-in ∪ personal ∪ project). Degrades to
  // an empty list when the read fails/is malformed.
  listAgents(): Promise<unknown>;
  saveAgent(params: { ref: string; scope: 'personal' | 'project'; file: AgentFile }): Promise<{
    ok: boolean;
  }>;
  /** `removed: false` means there was nothing there to remove — the benign case. A
   *  remove that actually failed REJECTS instead, so the two are never confused. */
  deleteAgent(params: { ref: string; scope: 'personal' | 'project' }): Promise<{
    removed: boolean;
  }>;
  // Persistent sessions: the rail list + per-session transcript reload.
  listSessions(): Promise<SessionSummary[]>;
  newSession(params: { agentRef: string }): Promise<{ id: string }>;
  reloadConversation(params: { id: string }): Promise<ReloadedConversationWire>;
  deleteSession(params: { id: string }): Promise<{ ok: boolean }>;
  /** Drop a session's frozen prompt + resume token so the next send recompiles (the drift banner's recompile). */
  recompilePrompt(params: { sessionId: string }): Promise<{ recompiled: boolean }>;
  /** The Stop/Esc affordance — proxies the daemon's cooperative `interruptSession`.
   *  Advisory (a user stop, never a governance block): the pill clears via the
   *  daemon's own `'interrupted'` status Push, not this call's result. */
  interruptSession(params: { id: string }): Promise<{ interrupted: boolean }>;
  /** Steer a running turn — proxies the daemon's `steerSession`. Delivered at the turn's next
   *  round trip, discarding nothing (advisory — a user redirect, never a block). Queue-mode
   *  follow-ups never reach this call; they stay held console-side until the turn ends. */
  steerSession(params: { id: string; text: string }): Promise<{ steered: boolean }>;
  /** Console reattach — proxies the daemon's `subscribeSession`. The daemon immediately
   *  hydrates this connection with the session's CURRENT run-status, so a reload mid-run
   *  reads `running` from the daemon snapshot rather than from this renderer's own
   *  send-tracking (the daemon, not the renderer, owns the live session). */
  subscribeSession(params: { id: string }): Promise<{ subscribed: boolean }>;
  /** Reveal a touched file in the editor/OS at an optional line (confined to the session's
   *  worktree by main). Advisory — resolves a result; never blocks. */
  openPath(params: { path: string; line?: number; sessionId?: string }): Promise<{
    ok: boolean;
    revealed?: 'editor' | 'folder';
    reason?: string;
  }>;
  /** Open a web URL in the default browser (validated to http(s) by main). Advisory —
   *  resolves a result; never blocks. */
  openExternal(params: { url: string }): Promise<{ ok: boolean; reason?: string }>;
  /** Subscribe to the daemon push stream; returns an unsubscribe. */
  onPush(listener: (payload: unknown) => void): () => void;
  getSettings(): Promise<ConsoleSettings>;
  saveSettings(settings: ConsoleSettings): Promise<void>;
}

/** Run a read, mapping success/failure into a `Remote` (never throws). */
export async function settle<T>(
  read: () => Promise<T>,
): Promise<{ status: 'ok'; value: T } | { status: 'error'; message: string }> {
  try {
    return { status: 'ok', value: await read() };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
