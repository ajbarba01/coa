import type {
  AuthView,
  InvocableSkill,
  LibrarySummary,
  LibraryView,
  LoginSnapshot,
  ModelCatalogView,
  ReasoningProfile,
} from '@coa/console-viewmodel';
import type { Remote } from './state.js';

/**
 * The auth surface's RPC callers. These don't flow through the console controller's
 * injected `ConsoleBridge` — the auth store (`panels/authStore.ts`) is a standalone
 * zustand store (shared by the auth surface, the usage surface, and the nav HUD), so it
 * reaches the preload bridge directly. Exported (rather than inlined in the store) so a
 * test can `vi.mock` this module and hand the store a fake — the store itself never
 * talks to `window.coa`.
 */
export const rpcAuthView = (): Promise<AuthView> => window.coa.authView();
export const rpcAddProvider = (providerId: string): Promise<AuthView> =>
  window.coa.addProvider({ providerId });
export const rpcRemoveProvider = (
  providerId: string,
  removeProfiles?: boolean,
): Promise<AuthView> =>
  window.coa.removeProvider({
    providerId,
    ...(removeProfiles !== undefined ? { removeProfiles } : {}),
  });
export const rpcAddCredential = (
  providerId: string,
  label: string,
  secret: string,
): Promise<AuthView> => window.coa.addCredential({ providerId, label, secret });
export const rpcReplaceSecret = (id: string, secret: string): Promise<AuthView> =>
  window.coa.replaceSecret({ id, secret });
export const rpcRenameCredential = (id: string, label: string): Promise<AuthView> =>
  window.coa.renameCredential({ id, label });
export const rpcRemoveCredential = (id: string, removeProfile?: boolean): Promise<AuthView> =>
  window.coa.removeCredential({ id, ...(removeProfile !== undefined ? { removeProfile } : {}) });
export const rpcSetIsolatedBrowserLogins = (on: boolean): Promise<AuthView> =>
  window.coa.setIsolatedBrowserLogins({ on });
export const rpcSetBrowserPath = (path: string): Promise<AuthView> =>
  window.coa.setBrowserPath({ path });
export const rpcReclaimBrowserProfiles = (names: string[]): Promise<AuthView> =>
  window.coa.reclaimBrowserProfiles({ names });
export const rpcSetProviderEnabled = (providerId: string, on: boolean): Promise<AuthView> =>
  window.coa.setProviderEnabled({ providerId, on });
export const rpcSetCredentialDisabled = (id: string, disabled: boolean): Promise<AuthView> =>
  window.coa.setCredentialDisabled({ id, disabled });
export const rpcMakeActive = (id: string): Promise<AuthView> => window.coa.makeActive({ id });
export const rpcClearCooldown = (id: string): Promise<AuthView> => window.coa.clearCooldown({ id });
/** Named distinctly from the console controller's `refresh` (a different read entirely) —
 *  this re-reads every pointer locator (identity, expiry, limits) for the auth surface's ⟳. */
export const rpcRefreshAuth = (): Promise<AuthView> => window.coa.refresh();

/**
 * The driven-login flow's RPC callers, mirroring the block above — the `loginStore`
 * (`panels/loginStore.ts`) reaches the preload bridge only through these.
 */
export const rpcStartLogin = (params: {
  email: string;
  credentialId?: string;
}): Promise<LoginSnapshot> => window.coa.startLogin(params);
export const rpcLoginState = (): Promise<LoginSnapshot> => window.coa.loginState();
export const rpcSubmitLoginCode = (code: string): Promise<LoginSnapshot> =>
  window.coa.submitLoginCode({ code });
export const rpcCancelLogin = (): Promise<LoginSnapshot> => window.coa.cancelLogin();
export const rpcResolveLoginMismatch = (action: 'keep' | 'retry'): Promise<LoginSnapshot> =>
  window.coa.resolveLoginMismatch({ action });
export const rpcProbeHealth = (): Promise<AuthView> => window.coa.probeHealth();
export const rpcReportAuthFailure = (credentialId: string): Promise<AuthView> =>
  window.coa.reportAuthFailure({ credentialId });

/**
 * The model catalog surface's RPC callers, mirroring the `rpcAuthView` block above — the
 * `modelsStore` (`panels/modelsStore.ts`) reaches the preload bridge only through these.
 */
export const rpcModelCatalog = (): Promise<ModelCatalogView> => window.coa.modelCatalog();
export const rpcAddModels = (p: { providerId: string; ids: string[] }): Promise<ModelCatalogView> =>
  window.coa.addModels(p);
export const rpcAddCustomModel = (p: {
  providerId: string;
  id: string;
  label?: string;
  reasoning?: ReasoningProfile;
}): Promise<ModelCatalogView> => window.coa.addCustomModel(p);
export const rpcEditModel = (p: {
  providerId: string;
  id: string;
  label?: string;
  reasoning?: ReasoningProfile;
}): Promise<ModelCatalogView> => window.coa.editModel(p);
export const rpcRemoveModel = (p: { providerId: string; id: string }): Promise<ModelCatalogView> =>
  window.coa.removeModel(p);
export const rpcSetModelHidden = (p: {
  providerId: string;
  id: string;
  hidden: boolean;
}): Promise<ModelCatalogView> => window.coa.setModelHidden(p);

/**
 * The skills/MCP library's RPC callers, mirroring the `rpcAuthView` block above — the
 * `libraryStore` (`panels/libraryStore.ts`) reaches the preload bridge only through these.
 */
export const rpcListLibrary = (): Promise<LibraryView> => window.coa.listLibrary();
export const rpcRescanLibrary = (): Promise<LibraryView> => window.coa.rescanLibrary();
export const rpcListSkills = (): Promise<{ skills: InvocableSkill[] }> => window.coa.listSkills();
export const rpcLinkLibrary = (p: {
  kind: 'skill' | 'mcp';
  scope: 'personal' | 'project';
  source: { path: string; serverName?: string };
  name?: string;
}): Promise<LibrarySummary> => window.coa.linkLibrary(p);
export const rpcCopyLibrary = (p: {
  kind: 'skill' | 'mcp';
  source: { path: string; serverName?: string };
  name?: string;
}): Promise<LibrarySummary> => window.coa.copyLibrary(p);
export const rpcUnlinkLibrary = (p: {
  kind: 'skill' | 'mcp';
  scope: 'personal' | 'project';
  name: string;
}): Promise<{ removed: boolean }> => window.coa.unlinkLibrary(p);
export const rpcSetLibraryEnabled = (p: {
  kind: 'skill' | 'mcp';
  scope: 'personal' | 'project';
  name: string;
  enabled: boolean;
}): Promise<LibrarySummary> => window.coa.setLibraryEnabled(p);

/** The effective-skills hook: the library store registers its own invocable-list getter
 *  so the drift-dismissal key can fold in the SAME resolvable skill slice the chat banner
 *  compares — without the console controller importing the store, which imports these rpc
 *  wrappers (a static cycle the dependency ruleset forbids). It rides here rather than
 *  beside the controller's other hooks precisely because this module is the store's own
 *  seam: registrant and reader meet at the leaf, so neither end imports the other.
 *
 *  It is the store's whole `Remote` read, not just its rows: the dismissal key must drop
 *  the skill slice on an unsettled read exactly as the banner does, or a dismissal would
 *  stop matching the banner it was meant to suppress. */
let invocableSkillsSource: () => Remote<InvocableSkill[]> = () => ({ status: 'loading' });
export const onInvocableSkills = (fn: () => Remote<InvocableSkill[]>): void => {
  invocableSkillsSource = fn;
};
export const invocableSkills = (): Remote<InvocableSkill[]> => invocableSkillsSource();
