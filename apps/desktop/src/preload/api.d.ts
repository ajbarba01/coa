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
        role?: string;
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
      listModels(): Promise<ModelDescriptor[]>;
      listRoles(): Promise<RoleSummary[]>;
      listPackages(): Promise<PackageSummary[]>;
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
    };
  }
}
