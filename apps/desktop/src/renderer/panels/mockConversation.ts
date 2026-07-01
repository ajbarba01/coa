import type { TurnFrame } from '@coa/console-viewmodel';

/** A realistic mock conversation covering every frame kind the transcript renders.
 *  Shaped exactly like the future turn-store read (§21.3) so swapping this constant
 *  for the daemon verb is a one-line data-source change. The cost-cap deny frame is a
 *  MOCK that validates the SC-1 DenyNotice surface — the console gates nothing. */
export const MOCK_TURNS: TurnFrame[] = [
  {
    id: 'u1',
    role: 'you',
    kind: 'text',
    text: 'Refactor the auth module to use the new token helper.',
  },
  {
    id: 'a1',
    role: 'agent',
    kind: 'text',
    text: "I'll read src/auth.ts and the token helper first.",
  },
  {
    id: 'a2',
    role: 'agent',
    kind: 'tool-use',
    tool: 'read_file',
    input: '{\n  "path": "src/auth.ts"\n}',
  },
  {
    id: 'a3',
    role: 'agent',
    kind: 'tool-result',
    tool: 'read_file',
    output: 'export function authenticate(req) {\n  // 42 lines\n}',
    ok: true,
  },
  { id: 'a4', role: 'agent', kind: 'text', text: 'Swapping the imports and the helper call now.' },
  {
    id: 'a5',
    kind: 'approval',
    requestId: 'req-auth-1',
    tool: 'write_file',
    summary: 'src/auth.ts',
    diffStat: '+42 -18',
  },
  {
    id: 's1',
    role: 'subagent',
    kind: 'text',
    text: 'review · checking the change against the SSOT constraint',
    depth: 1,
  },
  {
    id: 'd1',
    kind: 'deny',
    denyKind: 'cost-cap',
    reason: 'Session paused: the daemon cost cap was reached.',
  },
];
