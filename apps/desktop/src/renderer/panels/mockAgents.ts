import type { AgentSummary, SessionSummary, TurnFrame } from '@coa/console-viewmodel';
import { MOCK_TURNS } from './mockConversation.js';

/** Mock agents shaped like the future `listRoles` read (an agent = a Role,
 *  SPEC CON-1). Project agents live committed in `.coa/`; personal agents are
 *  user-level. Swapping these for the daemon verbs is a data-source change. */
export const MOCK_AGENTS: AgentSummary[] = [
  {
    ref: 'roles/reviewer',
    name: 'reviewer',
    icon: 'search',
    color: 'teal',
    scope: 'project',
    model: 'sonnet',
    roles: ['researcher'],
  },
  {
    ref: 'roles/tdd-implementer',
    name: 'tdd-implementer',
    icon: 'flask',
    color: 'blue',
    scope: 'project',
    model: 'sonnet',
    roles: ['swe'],
  },
  {
    ref: 'roles/refactor-bot',
    name: 'refactor-bot',
    icon: 'wrench',
    color: 'coral',
    scope: 'project',
    model: 'opus',
    roles: ['swe'],
  },
  {
    ref: 'personal/scratch-helper',
    name: 'scratch-helper',
    icon: 'sparkles',
    color: 'violet',
    scope: 'personal',
    model: 'haiku',
  },
];

/** Mock sessions, newest first per agent. Every session belongs to one agent —
 *  that binding is what lets the rail and the switcher share one selection. */
export const MOCK_SESSIONS: SessionSummary[] = [
  {
    id: 's-auth-refactor',
    agentRef: 'roles/refactor-bot',
    title: 'refactor auth module',
    updatedAt: '2026-07-01T15:10:00Z',
  },
  {
    id: 's-audit-auth',
    agentRef: 'roles/reviewer',
    title: 'audit auth flow',
    updatedAt: '2026-07-01T13:00:00Z',
  },
  {
    id: 's-ledger-tests',
    agentRef: 'roles/tdd-implementer',
    title: 'harden ledger tests',
    updatedAt: '2026-07-01T09:30:00Z',
  },
  {
    id: 's-review-bridge',
    agentRef: 'roles/reviewer',
    title: 'review governed dispatch',
    updatedAt: '2026-06-30T18:00:00Z',
  },
];

/** The session the console opens on (the newest). */
export const DEFAULT_SESSION_ID = 's-auth-refactor';

const AUDIT_TURNS: TurnFrame[] = [
  { id: 'b1', role: 'you', kind: 'text', text: 'Audit the auth flow for SSOT drift.' },
  {
    id: 'b2',
    role: 'agent',
    kind: 'tool-use',
    tool: 'graph_read',
    input: '{\n  "scope": "src/auth/**"\n}',
  },
  {
    id: 'b3',
    role: 'agent',
    kind: 'tool-result',
    tool: 'graph_read',
    output: '3 anchors verified · 1 relation degraded',
    ok: true,
  },
  {
    id: 'b4',
    role: 'agent',
    kind: 'text',
    text: 'One origin anchor is unverifiable — flagging it for an eyeball pass.',
  },
];

const LEDGER_TURNS: TurnFrame[] = [
  { id: 'c1', role: 'you', kind: 'text', text: 'Add failing tests for the ledger allow-list.' },
  {
    id: 'c2',
    role: 'agent',
    kind: 'text',
    text: 'Writing the red tests against the D135 projection first.',
  },
];

const BRIDGE_TURNS: TurnFrame[] = [
  { id: 'e1', role: 'you', kind: 'text', text: 'Review the governed dispatch wiring.' },
  {
    id: 'e2',
    role: 'agent',
    kind: 'text',
    text: 'The MCP registration looks sound; checking the deny channel next.',
  },
];

/** Per-session turn streams (the future turn-store read is per-session). */
export const MOCK_SESSION_TURNS: Record<string, TurnFrame[]> = {
  's-auth-refactor': MOCK_TURNS,
  's-audit-auth': AUDIT_TURNS,
  's-ledger-tests': LEDGER_TURNS,
  's-review-bridge': BRIDGE_TURNS,
};
