import type {
  Accounts,
  ActiveAccount,
  AgentFile,
  ApprovalDecision,
  Attachment,
  AuthView,
  CapState,
  Checkpoint,
  FeedView,
  LoginSnapshot,
  ModelCatalogView,
  ModelDescriptor,
  ModelMetadataView,
  ModelSelection,
  PackageSummary,
  PermissionMode,
  ReloadedConversationWire,
  ReasoningProfile,
  RoleSummary,
  SessionSummary,
} from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../shared/settings.js';
import type { DaemonReport } from '../shared/methods.js';
import type { RecentProject } from '../shared/projects.js';

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
        /** Attachments on this send's user message; the daemon refuses them for a
         *  backend with no attachment seam (never a silent drop). */
        attachments?: Attachment[];
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
      /** F2 — live-switch a session's permission mode; proxies the daemon `setMode`.
       *  Takes effect starting with the NEXT tool call. The chip's own reflection
       *  updates from the resulting `mode` push, not this response. */
      setMode(params: { id: string; mode: PermissionMode }): Promise<{ set: boolean }>;
      /** F2 — answer a pending ask (the composer's docked approve/deny gate);
       *  proxies the daemon `respondApproval`. `resolved: false` ⇒ unknown session
       *  id, or no pending request with that id (a harmless no-op, not an error). */
      respondApproval(params: {
        id: string;
        requestId: string;
        decision: ApprovalDecision;
      }): Promise<{ resolved: boolean }>;
      /** F2 — a session's current permission-mode snapshot (mode/effectiveMode/every
       *  ask still awaiting a reply); proxies the daemon `sessionMode`. For reattach
       *  hydration, without waiting on the next live push. */
      sessionMode(params: { id: string }): Promise<
        | { found: false }
        | {
            found: true;
            mode: PermissionMode;
            effectiveMode: PermissionMode;
            pending: Array<{
              requestId: string;
              tool: string;
              summary: string;
              input: Record<string, unknown>;
            }>;
          }
      >;
      listModels(): Promise<ModelDescriptor[]>;
      modelCatalog(): Promise<ModelCatalogView>;
      /** Per-model info (context window/pricing/modalities/reasoning) — the context
       *  ring, the model-picker hover card, and attach gating all read this. */
      modelMetadata(params?: { provider?: string }): Promise<ModelMetadataView>;
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
      /** F11 — open/switch/focus a project. `target: 'new'` always opens a fresh window;
       *  `target: 'current'` swaps THIS window in place. If `root` is already open in some
       *  window, that window is focused instead, regardless of `target` — coa never runs
       *  two daemons over the same project. The caller must confirm with the user BEFORE
       *  calling this with `target: 'current'` while its own project has a turn actively
       *  running (main performs the swap unconditionally once called; it does not itself
       *  gate on in-flight work — only the caller knows whether one is running). */
      openProject(params: { root: string; target: 'current' | 'new' }): Promise<{
        opened: 'new' | 'current' | 'focused-existing';
        workspace: { name: string; root: string };
      }>;
      /** The recent-projects MRU (picker backing list), each entry decorated with a live
       *  `open` flag (true iff some window currently has it open) computed at call time. */
      listRecentProjects(): Promise<Array<RecentProject & { open: boolean }>>;
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
       *  `false` ONLY when there was nothing there to remove (a double delete is not an
       *  error); a remove that actually failed REJECTS, so the caller can say so. */
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
      /** Title-bar daemon lifecycle control + a one-way status subscription. Every report
       *  carries the reason behind a failure, so the gate can say why and not just that. */
      daemon: {
        status(): Promise<DaemonReport>;
        start(): Promise<void>;
        /** Attach to an already-serving daemon; never spawns one. */
        adopt(): Promise<void>;
        stop(): Promise<void>;
        restart(): Promise<void>;
        onStatus(listener: (report: DaemonReport) => void): () => void;
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
