import { create } from 'zustand';
import type { Credential } from './mockAuth.js';
import { providerById } from './providers.js';

/**
 * MOCKUP SPINE for the "in-app Claude login/relogin + attention badges" design
 * (docs/superpowers/specs/2026-07-18-in-app-login-relogin-badges-design.md). Renderer-only,
 * so Gate 0 can be clicked through before the login-driver + health-probe are built (TDD, on
 * the Claude-adapter seam). coa stays credential-blind: this never holds a token, it models
 * watching the login DIRECTORY and probing health, exactly as the real thing will.
 *
 * GATE-1 SPIKE RESULT (2026-07-18, attended, real `claude` 2.1.214):
 *   · Login: `claude auth login --claudeai` (subscription), honoring `CLAUDE_CONFIG_DIR`.
 *   · It AUTO-OPENS the browser AND PRINTS the full OAuth authorize URL to stdout ("If the
 *     browser didn't open, visit: <url>"). A "Paste code here if prompted >" is a FALLBACK for
 *     when the browser can't redirect back; the normal flow completes without it.
 *   · Health: `claude auth status --json` → {loggedIn, authMethod, apiProvider} — a purpose-
 *     built, non-interactive probe honoring CLAUDE_CONFIG_DIR.
 *   ⇒ The real flow is a HYBRID (guided browser + coa showing the captured URL in-app + a
 *     code-paste fallback), NOT a guided-vs-embedded choice. This mock renders that flow.
 */

/* -------------------------------- login health --------------------------------- */

export type Health = 'healthy' | 'needs-relogin';

/* -------------------------------- the login flow ------------------------------- */

export type LoginPhase = 'launching' | 'awaiting' | 'watching' | 'registered' | 'failed';

export interface LoginFlow {
  providerId: string;
  /** A fresh login into a new managed dir, or relogin aimed at an existing one. */
  mode: 'new' | 'relogin';
  /** The account label being (re)logged-in — the managed dir is ~/.coa/logins/<label>/. */
  label: string;
  /** The credential a relogin targets (so health can flip back to healthy on success). */
  credentialId?: string;
  phase: LoginPhase;
  /** The OAuth URL coa captured from the login process's stdout — shown in-app (the
   *  "browser didn't open?" affordance). Present from `awaiting` on. */
  oauthUrl?: string;
  /** The identity that landed, shown on `registered`. */
  identity?: string;
}

interface MockLoginState {
  /** credentialId → probe-derived health. Absent ⇒ assumed healthy (never probed / logged-in). */
  health: Record<string, Health>;
  /** The active driven-login flow, or undefined when no login is running. */
  flow: LoginFlow | undefined;

  seedDemoHealth: (credentials: Credential[], activeByProvider: Record<string, string>) => void;
  setHealth: (credentialId: string, health: Health) => void;
  /** The strongest signal: a live-session auth failure flips that account to needs-relogin. */
  reportAuthFailure: (credentialId: string) => void;
  startLogin: (args: {
    providerId: string;
    mode: 'new' | 'relogin';
    label: string;
    credentialId?: string;
  }) => void;
  advance: () => void;
  cancelLogin: () => void;
  failLogin: () => void;
}

// The real shape of the URL the CLI prints (client_id/scope/PKCE elided for the mock).
const OAUTH_URL =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a…&scope=user%3Ainference+user%3Asessions%3Aclaude_code';
const DEMO_IDENTITY = 'alex@barba.org · pro';

export const useMockLogin = create<MockLoginState>((set, get) => ({
  health: {},
  flow: undefined,

  // A deterministic demo seed so the badges always have something to show. Flags the ACTIVE
  // Claude login as needs-relogin — the headline case: a broken active account is FLAGGED, not
  // auto-switched (silently rerouting would hide the problem). One seed lights all three badge
  // surfaces (nav tab, provider row, account HUD) plus the "active · needs relogin" row state.
  seedDemoHealth: (credentials, activeByProvider) =>
    set((s) => {
      if (Object.keys(s.health).length > 0) return s;
      const claudeLogins = credentials.filter(
        (c) => providerById(c.providerId)?.locator === 'config-dir',
      );
      if (claudeLogins.length === 0) return s;
      const activeId = activeByProvider['claude'];
      const target = claudeLogins.find((c) => c.id === activeId) ?? claudeLogins[0];
      return target === undefined ? s : { health: { [target.id]: 'needs-relogin' } };
    }),

  setHealth: (credentialId, health) =>
    set((s) => ({ health: { ...s.health, [credentialId]: health } })),

  reportAuthFailure: (credentialId) =>
    set((s) => ({ health: { ...s.health, [credentialId]: 'needs-relogin' } })),

  startLogin: ({ providerId, mode, label, credentialId }) => {
    const flow: LoginFlow = { providerId, mode, label, phase: 'launching' };
    if (credentialId !== undefined) flow.credentialId = credentialId;
    set({ flow });
  },

  // The mock stepper — launching → awaiting (browser opens, coa captures the URL) → watching
  // (poll `claude auth status --json` until loggedIn) → registered. In the real driver these
  // are the spawn, the stdout URL capture, the status poll, and the credentials landing.
  advance: () =>
    set((s) => {
      const f = s.flow;
      if (f === undefined) return s;
      if (f.phase === 'launching') return { flow: { ...f, phase: 'awaiting', oauthUrl: OAUTH_URL } };
      if (f.phase === 'awaiting') return { flow: { ...f, phase: 'watching' } };
      if (f.phase === 'watching') {
        // Success: `status --json` reports loggedIn; health flips healthy for a relogin target.
        const health =
          f.credentialId !== undefined
            ? { ...s.health, [f.credentialId]: 'healthy' as Health }
            : s.health;
        return { flow: { ...f, phase: 'registered', identity: DEMO_IDENTITY }, health };
      }
      return s;
    }),

  failLogin: () => set((s) => (s.flow ? { flow: { ...s.flow, phase: 'failed' } } : s)),

  cancelLogin: () => set({ flow: undefined }),
}));

/* -------------------------------- badge derivation ------------------------------- */

/** The attention count for a provider: its logins currently needing relogin. Generic on
 *  purpose — future reasons (missing key, expired API key) add to the same channel. */
export function providerAttention(
  credentials: Credential[],
  providerId: string,
  health: Record<string, Health>,
): number {
  return credentials.filter((c) => c.providerId === providerId && health[c.id] === 'needs-relogin')
    .length;
}

/** The whole-surface attention count — what the Auth nav tab wears. Zero renders nothing. */
export function totalAttention(
  credentials: Credential[],
  health: Record<string, Health>,
): number {
  return credentials.filter((c) => health[c.id] === 'needs-relogin').length;
}

/** Whether a provider's ACTIVE login is the broken one — the case the badge flags without
 *  auto-switching (silently rerouting would hide the problem). */
export function activeNeedsRelogin(
  activeByProvider: Record<string, string>,
  providerId: string,
  health: Record<string, Health>,
): boolean {
  const activeId = activeByProvider[providerId];
  return activeId !== undefined && health[activeId] === 'needs-relogin';
}
