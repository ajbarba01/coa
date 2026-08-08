import type {
  Accounts,
  ActiveAccount,
  AgentFile,
  AuthView,
  CapState,
  Checkpoint,
  FeedView,
  LoginSnapshot,
  ModelCatalogView,
  ModelDescriptor,
  ModelSelection,
  PackageSummary,
  ReloadedConversationWire,
  ReasoningProfile,
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
      /** The auth surface's live read: providers added, their credentials, the active
       *  login per backend, the benched flags, and the tool-service chains. */
      authView(): Promise<AuthView>;
      addProvider(params: { providerId: string }): Promise<AuthView>;
      /** Removing a provider takes every credential under it with it; `removeProfiles`
       *  opts into deleting the isolated browser profile dirs it leaves behind. */
      removeProvider(params: { providerId: string; removeProfiles?: boolean }): Promise<AuthView>;
      addCredential(params: {
        providerId: string;
        label: string;
        secret: string;
      }): Promise<AuthView>;
      /** The only write to an existing secret: an add that supersedes. Never an edit. */
      replaceSecret(params: { id: string; secret: string }): Promise<AuthView>;
      renameCredential(params: { id: string; label: string }): Promise<AuthView>;
      /** `removeProfile` opts into deleting the isolated browser profile dir for
       *  this credential's account — deletion is never implied by the removal itself. */
      removeCredential(params: { id: string; removeProfile?: boolean }): Promise<AuthView>;
      setProviderEnabled(params: { providerId: string; on: boolean }): Promise<AuthView>;
      setCredentialDisabled(params: { id: string; disabled: boolean }): Promise<AuthView>;
      makeActive(params: { id: string }): Promise<AuthView>;
      clearCooldown(params: { id: string }): Promise<AuthView>;
      /** The global "sign logins in through a dedicated browser profile" toggle. */
      setIsolatedBrowserLogins(params: { on: boolean }): Promise<AuthView>;
      /** The browser-binary override; an empty path clears it back to auto-detection. */
      setBrowserPath(params: { path: string }): Promise<AuthView>;
      /** Delete browser profiles no account resolves to. Only ever runs on a user's click —
       *  coa never sweeps profiles on its own initiative (profile cleanup only ever happens at the user's explicit request). */
      reclaimBrowserProfiles(params: { names: string[] }): Promise<AuthView>;
      /** Re-read every pointer locator — identity, expiry, limits — on demand. */
      refresh(): Promise<AuthView>;
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
      reloadConversation(params: { id: string }): Promise<ReloadedConversationWire>;
      deleteSession(params: { id: string }): Promise<{ ok: boolean }>;
      recompilePrompt(params: { sessionId: string }): Promise<{ recompiled: boolean }>;
      /** The Stop/Esc affordance — proxies the daemon's cooperative `interruptSession`.
       *  Advisory (advisory — a user stop, never a governance block). */
      interruptSession(params: { id: string }): Promise<{ interrupted: boolean }>;
      /** Steer a running turn — proxies the daemon's `steerSession`. Delivered at the turn's
       *  next round trip, discarding nothing (advisory — a user redirect, never a block). */
      steerSession(params: { id: string; text: string }): Promise<{ steered: boolean }>;
      /** Console reattach — proxies the daemon's `subscribeSession`, which
       *  immediately hydrates this connection with the session's CURRENT run-status. */
      subscribeSession(params: { id: string }): Promise<{ subscribed: boolean }>;
      listModels(): Promise<ModelDescriptor[]>;
      modelCatalog(): Promise<ModelCatalogView>;
      addModels(params: { providerId: string; ids: string[] }): Promise<ModelCatalogView>;
      addCustomModel(params: {
        providerId: string;
        id: string;
        label?: string;
        reasoning?: ReasoningProfile;
      }): Promise<ModelCatalogView>;
      editModel(params: {
        providerId: string;
        id: string;
        label?: string;
        reasoning?: ReasoningProfile;
      }): Promise<ModelCatalogView>;
      removeModel(params: { providerId: string; id: string }): Promise<ModelCatalogView>;
      setModelHidden(params: {
        providerId: string;
        id: string;
        hidden: boolean;
      }): Promise<ModelCatalogView>;
      listRoles(): Promise<RoleSummary[]>;
      listPackages(): Promise<PackageSummary[]>;
      /** Reveal a touched file in the editor/OS at an optional line (a tool card's path
       *  link). Confined to the named session's worktree; advisory (never blocks). */
      openPath(params: { path: string; line?: number; sessionId?: string }): Promise<{
        ok: boolean;
        revealed?: 'editor' | 'folder';
        reason?: string;
      }>;
      /** Open a web URL (a tool card's WebSearch/WebFetch link) in the default browser.
       *  Validated to http(s) only; advisory (never blocks). */
      openExternal(params: { url: string }): Promise<{ ok: boolean; reason?: string }>;
      /** The native directory picker (a directory field's browse affordance). Cancelling
       *  returns no path — the caller keeps whatever the field already held. */
      pickDirectory(params: { defaultPath?: string }): Promise<{ path?: string }>;
      /** The edit menu's actions — main drives Chromium's native editing commands on the
       *  focused element (the renderer never touches the clipboard itself). */
      editCommand(params: { command: 'cut' | 'copy' | 'paste' | 'selectAll' }): Promise<void>;
      /** The daemon's registered agents (built-in ∪ personal ∪ project, project
       *  winning) — proxies the daemon `listAgents`. A `builtin` agent ships in code
       *  and is never a `saveAgent`/`deleteAgent` target. Typed `unknown`: re-validated
       *  at the renderer edge with Zod rather than trusted structurally. */
      listAgents(): Promise<unknown>;
      /** Write one agent definition — proxies the daemon `saveAgent`. Only
       *  `personal`/`project` are writable scopes. */
      saveAgent(params: {
        ref: string;
        scope: 'personal' | 'project';
        file: AgentFile;
      }): Promise<{ ok: boolean }>;
      /** Remove one agent definition — proxies the daemon `deleteAgent`. `removed` is
       *  `false` when there was nothing to remove (a double delete is not an error). */
      deleteAgent(params: {
        ref: string;
        scope: 'personal' | 'project';
      }): Promise<{ removed: boolean }>;
      /** Kick off the driven-login flow (a fresh add, or a relogin against an
       *  existing credential) — proxies the daemon `startLogin`. */
      startLogin(params: { email: string; credentialId?: string }): Promise<LoginSnapshot>;
      /** Poll the in-flight login flow's current snapshot — proxies `loginState`. */
      loginState(): Promise<LoginSnapshot>;
      /** Submit the OAuth code pasted back by the user — proxies `submitLoginCode`. */
      submitLoginCode(params: { code: string }): Promise<LoginSnapshot>;
      /** Abandon the in-flight login flow — proxies `cancelLogin`. */
      cancelLogin(): Promise<LoginSnapshot>;
      /** Resolve an email/identity mismatch surfaced mid-flow — proxies `resolveLoginMismatch`. */
      resolveLoginMismatch(params: { action: 'keep' | 'retry' }): Promise<LoginSnapshot>;
      /** Re-probe every credential's health on demand — proxies `probeHealth`. */
      probeHealth(): Promise<AuthView>;
      /** Report a credential's auth failure observed mid-session — proxies `reportAuthFailure`. */
      reportAuthFailure(params: { credentialId: string }): Promise<AuthView>;
      /** Subscribe to the daemon push stream; returns an unsubscribe. */
      onPush(listener: (payload: unknown) => void): () => void;
      /** The open project (name + root), derived by main from the daemon's cwd. */
      getWorkspace(): Promise<{ name: string; root: string }>;
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
