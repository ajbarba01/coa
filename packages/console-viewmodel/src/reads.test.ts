import { describe, expect, it } from 'vitest';
import {
  AuthViewSchema,
  CheckpointSchema,
  CredentialViewSchema,
  FeedViewSchema,
  LoginSnapshotSchema,
  TimelineSchema,
  TurnFrameSchema,
  TurnStreamSchema,
} from './reads.js';

describe('console read schemas', () => {
  it('accepts a well-formed feed view', () => {
    const feed = { expanded: [], collapsed: [{ concernKey: 'k', count: 3, severity: 'med' }] };
    expect(FeedViewSchema.parse(feed)).toEqual(feed);
  });

  it('accepts a checkpoint list and strips unknown fields', () => {
    const cp = { id: 'c1', seq: 12, ts: '2026-07-01T00:00:00Z', worktree: 'wt', pinned: false };
    expect(TimelineSchema.parse([cp])).toEqual([cp]);
    expect(CheckpointSchema.parse({ ...cp, extra: 1 })).toEqual(cp);
  });
});

describe('turn frame schema', () => {
  it('accepts each governed frame kind', () => {
    const frames = [
      { id: '1', role: 'you', kind: 'text', text: 'go' },
      { id: '2', role: 'agent', kind: 'tool-use', tool: 'read_file', input: '{}' },
      { id: '3', role: 'agent', kind: 'tool-result', tool: 'read_file', output: 'ok', ok: true },
      { id: '4', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 's' },
      { id: '5', kind: 'deny', denyKind: 'close-gate', reason: 'open invariant' },
    ];
    expect(TurnStreamSchema.parse(frames)).toHaveLength(5);
  });

  it('rejects an unknown frame kind', () => {
    expect(() => TurnFrameSchema.parse({ id: 'x', kind: 'nope' })).toThrow();
  });

  it('carries optional subagent depth', () => {
    const f = TurnFrameSchema.parse({
      id: '6',
      role: 'subagent',
      kind: 'text',
      text: 'r',
      depth: 1,
    });
    expect(f).toMatchObject({ depth: 1 });
  });

  it('accepts a system-role text frame — a coa-authored notice, not the agent', () => {
    const f = TurnFrameSchema.parse({ id: 's1', role: 'system', kind: 'text', text: 'notice' });
    expect(f).toMatchObject({ role: 'system' });
  });

  it('parses the widened taxonomy: thinking, plan, error, subagent', () => {
    const frames = [
      { id: 'a', role: 'agent', kind: 'thinking', text: 'hmm' },
      { id: 'b', role: 'agent', kind: 'plan', items: [{ text: 'do it', status: 'in-progress' }] },
      { id: 'c', role: 'agent', kind: 'error', message: 'boom', origin: 'tool' },
      {
        id: 'd',
        kind: 'subagent',
        childWorktree: 'wt-1',
        event: 'rollup',
        rollup: { tools: 2, cost: 0.1 },
      },
      { id: 'e', role: 'agent', kind: 'tool-use', tool: 'Read', input: '{}', handle: 'h1' },
    ];
    expect(() => TurnStreamSchema.parse(frames)).not.toThrow();
  });
});

describe('auth view schema', () => {
  it('parses an auth view and keeps optional phase-2 fields absent', () => {
    const v = AuthViewSchema.parse({
      added: ['claude'],
      credentials: [
        {
          id: 'claude:worm',
          providerId: 'claude',
          label: 'worm',
          masked: '~/.claude',
          disabled: false,
        },
      ],
      activeByProvider: { claude: 'claude:worm' },
      enabled: { claude: true },
      chains: { search: ['tavily'], fetch: [] },
      browserSession: { enabled: false, available: false },
    });
    expect(v.credentials[0]?.identity).toBeUndefined();
  });

  it('carries the browser-session block and a credential profile flag', () => {
    const view = AuthViewSchema.parse({
      added: ['claude'],
      credentials: [
        {
          id: 'claude:worm',
          providerId: 'claude',
          label: 'worm',
          masked: '~/.claude',
          disabled: false,
          hasProfile: true,
        },
      ],
      activeByProvider: {},
      enabled: { claude: true },
      chains: {},
      browserSession: { enabled: true, available: true, detectedPath: 'C:\\chrome.exe' },
    });
    expect(view.credentials[0]?.hasProfile).toBe(true);
    expect(view.browserSession.detectedPath).toBe('C:\\chrome.exe');
    expect(view.browserSession.path).toBeUndefined();
  });

  it('accepts a credential carrying email + health and strips unknown fields', () => {
    const c = CredentialViewSchema.parse({
      id: 'claude:worm',
      providerId: 'claude',
      label: 'worm',
      masked: '~/.claude',
      disabled: false,
      email: 'worm@example.com',
      health: 'needs-relogin',
      bogus: 'nope',
    });
    expect(c).toEqual({
      id: 'claude:worm',
      providerId: 'claude',
      label: 'worm',
      masked: '~/.claude',
      disabled: false,
      email: 'worm@example.com',
      health: 'needs-relogin',
    });
  });
});

describe('login snapshot schema', () => {
  it('accepts the idle phase as a state, never an error', () => {
    const snap = LoginSnapshotSchema.parse({ phase: 'idle' });
    expect(snap).toEqual({ phase: 'idle' });
  });

  it('accepts an in-flight snapshot and strips unknown fields', () => {
    const snap = LoginSnapshotSchema.parse({
      phase: 'awaiting',
      mode: 'new',
      email: 'worm@example.com',
      oauthUrl: 'https://example.com/authorize',
      bogus: 'nope',
    });
    expect(snap).toEqual({
      phase: 'awaiting',
      mode: 'new',
      email: 'worm@example.com',
      oauthUrl: 'https://example.com/authorize',
    });
  });

  it('rejects an unknown phase', () => {
    expect(() => LoginSnapshotSchema.parse({ phase: 'bogus' })).toThrow();
  });
});
