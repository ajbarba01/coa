import type {
  Accounts,
  ActiveAccount,
  CapState,
  Checkpoint,
  FeedView,
  ModelDescriptor,
  ModelSelection,
  PackageSummary,
  PersistedTurnWire,
  RoleSummary,
  SessionSummary,
} from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../shared/settings.js';
import type { DaemonStatus } from '../shared/methods.js';

export {};
declare global {
  interface Window {
    coa: {
      /** 'darwin' | 'win32' | other. */
      platform: string;
      capState(): Promise<CapState>;
      flagsForUser(): Promise<FeedView>;
      listTimeline(): Promise<Checkpoint[]>;
      listAccounts(): Promise<Accounts>;
      currentAccount(): Promise<ActiveAccount>;
      useAccount(params: { label: string; provider?: string }): Promise<ActiveAccount>;
      startSession(params: {
        input: string;
        conversationId?: string;
        roles?: string[];
        scope?: string;
        model?: ModelSelection;
        packageIds?: string[];
        exclude?: string[];
      }): Promise<{ sessionId: string; worktree: string }>;
      newSession(params: { agentRef: string; scope?: string }): Promise<{ id: string }>;
      listSessions(): Promise<SessionSummary[]>;
      reloadConversation(params: { id: string }): Promise<PersistedTurnWire[]>;
      renameSession(params: { id: string; title: string }): Promise<{ ok: boolean }>;
      deleteSession(params: { id: string }): Promise<{ ok: boolean }>;
      recompilePrompt(params: { sessionId: string }): Promise<{ recompiled: boolean }>;
      /** The Stop/Esc affordance — proxies the daemon's cooperative `interruptSession`.
       *  Advisory (SC-1 — a user stop, never a governance block). */
      interruptSession(params: { id: string }): Promise<{ interrupted: boolean }>;
      listModels(): Promise<ModelDescriptor[]>;
      listRoles(): Promise<RoleSummary[]>;
      listPackages(): Promise<PackageSummary[]>;
      /** Reveal a touched file in the editor/OS at an optional line (a tool card's path
       *  link). Confined to the named session's worktree; advisory (never blocks — SC-1). */
      openPath(params: { path: string; line?: number; sessionId?: string }): Promise<{
        ok: boolean;
        revealed?: 'editor' | 'folder';
        reason?: string;
      }>;
      /** Open a web URL (a tool card's WebSearch/WebFetch link) in the default browser.
       *  Validated to http(s) only; advisory (never blocks — SC-1). */
      openExternal(params: { url: string }): Promise<{ ok: boolean; reason?: string }>;
      /** The user's persisted agents (console-local identity + launch selection — the
       *  `roles/<id>` / `personal/<id>` ref is authoritative, icon/color/model/reasoning
       *  round-trip). Missing/corrupt file degrades to an empty list ("No agents yet"). */
      listAgents(): Promise<unknown>;
      /** Persist the full, mutated agent list (console-validated `Agent[]`). */
      writeAgents(params: unknown): Promise<void>;
      /** Subscribe to the daemon push stream; returns an unsubscribe. */
      onPush(listener: (payload: unknown) => void): () => void;
      getLayout(): Promise<unknown>;
      saveLayout(descriptor: unknown): Promise<void>;
      getSettings(): Promise<ConsoleSettings>;
      saveSettings(settings: ConsoleSettings): Promise<void>;
      /** Title-bar daemon lifecycle control + a one-way status subscription. */
      daemon: {
        status(): Promise<DaemonStatus>;
        start(): Promise<void>;
        stop(): Promise<void>;
        restart(): Promise<void>;
        onStatus(listener: (status: DaemonStatus) => void): () => void;
      };
      /** Custom (DOM) window controls + a one-way maximized-state subscription. */
      window: {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<void>;
        close(): Promise<void>;
        onMaximizeChange(listener: (maximized: boolean) => void): () => void;
      };
    };
  }
}
