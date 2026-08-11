import type { ConsoleActions } from '../panels/state.js';

/**
 * The console's action surface — a stable module-level object, deliberately OUTSIDE any
 * store state. The controller installs the real implementations at boot; components
 * import `consoleActions` and keep the same function identities for the app's whole
 * lifetime, so an action can be threaded into memoized rows without ever invalidating
 * them. Before installation every action is a safe no-op (the same placeholder contract
 * the old controller's `initialState` actions had).
 */
const noop = (): void => {};

const UNINSTALLED: ConsoleActions = {
  setRoute: noop,
  refresh: noop,
  switchAccount: noop,
  setSettings: noop,
  toggleRaw: noop,
  respondApproval: noop,
  setPermissionMode: noop,
  selectAgent: noop,
  createAgent: noop,
  updateAgent: noop,
  deleteAgent: noop,
  togglePinAgent: noop,
  selectSession: noop,
  newSession: noop,
  deleteSession: noop,
  sendMessage: noop,
  onBannerAction: noop,
  setSessionModel: noop,
  openPath: () => Promise.resolve({ ok: false }),
  openExternal: () => Promise.resolve({ ok: false }),
  interruptSession: noop,
  steerSession: noop,
  reapWorktree: noop,
};

let impl: ConsoleActions = UNINSTALLED;

/** Install the live implementations (the controller, once per boot). */
export function installActions(actions: ConsoleActions): void {
  impl = actions;
}

/** Test seam: drop back to the inert placeholders. */
export function resetActions(): void {
  impl = UNINSTALLED;
}

/**
 * The one action object components hold. Delegates per call, so installation never
 * changes any consumer-visible identity.
 *
 * Every delegate forwards its arguments POSITIONALLY and in full — an optional argument
 * dropped here (staged attachments, an invoked skill) would vanish silently between the
 * composer and the daemon, with the send still looking like it worked.
 */
export const consoleActions: ConsoleActions = {
  setRoute: (panelId) => impl.setRoute(panelId),
  refresh: () => impl.refresh(),
  switchAccount: (label, provider) => impl.switchAccount(label, provider),
  setSettings: (patch) => impl.setSettings(patch),
  toggleRaw: () => impl.toggleRaw(),
  respondApproval: (requestId, decision) => impl.respondApproval(requestId, decision),
  setPermissionMode: (sessionId, mode) => impl.setPermissionMode(sessionId, mode),
  selectAgent: (ref) => impl.selectAgent(ref),
  createAgent: (scope) => impl.createAgent(scope),
  updateAgent: (ref, patch) => impl.updateAgent(ref, patch),
  deleteAgent: (ref) => impl.deleteAgent(ref),
  togglePinAgent: (ref) => impl.togglePinAgent(ref),
  selectSession: (id) => impl.selectSession(id),
  newSession: (agentRef) => impl.newSession(agentRef),
  deleteSession: (id) => impl.deleteSession(id),
  sendMessage: (text, attachments, invokeSkills) =>
    impl.sendMessage(text, attachments, invokeSkills),
  onBannerAction: (sessionId, bannerId, actionId) =>
    impl.onBannerAction(sessionId, bannerId, actionId),
  setSessionModel: (sessionId, selection) => impl.setSessionModel(sessionId, selection),
  openPath: (path, line, sessionId) => impl.openPath(path, line, sessionId),
  openExternal: (url) => impl.openExternal(url),
  interruptSession: (sessionId) => impl.interruptSession(sessionId),
  steerSession: (sessionId, text) => impl.steerSession(sessionId, text),
  reapWorktree: (sessionId) => impl.reapWorktree(sessionId),
};
