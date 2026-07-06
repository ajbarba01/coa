import { describe, expect, it } from 'vitest';
import {
  AGENT_COLOR_NAMES,
  AGENT_ICON_NAMES,
  AgentColorSchema,
  AgentListSchema,
  AgentSummarySchema,
  DEFAULT_AGENT_LIST,
  PersistedAgentsSchema,
  parseAgents,
  parsePersistedAgents,
  SessionListSchema,
  SessionSummarySchema,
} from './agents.js';

describe('agent summary schema', () => {
  it('accepts a well-formed agent and strips unknown fields', () => {
    const agent = {
      ref: 'roles/reviewer',
      name: 'reviewer',
      icon: 'search',
      color: 'teal',
      scope: 'project',
      model: 'claude-sonnet-5',
    };
    expect(AgentSummarySchema.parse({ ...agent, extra: 1 })).toEqual(agent);
  });

  it('defaults identity when icon/color are absent', () => {
    const a = AgentSummarySchema.parse({ ref: 'r', name: 'n', scope: 'personal' });
    expect(a.icon).toBe('bot');
    expect(a.color).toBe('slate');
  });

  it('degrades unknown icon/color names to the defaults instead of failing', () => {
    const a = AgentSummarySchema.parse({
      ref: 'r',
      name: 'n',
      scope: 'project',
      icon: 'octopus',
      color: 'chartreuse',
    });
    expect(a.icon).toBe('bot');
    expect(a.color).toBe('slate');
  });

  it('rejects an unknown scope', () => {
    expect(() => AgentSummarySchema.parse({ ref: 'r', name: 'n', scope: 'team' })).toThrow();
  });

  it('brass is not an agent color', () => {
    expect(AgentColorSchema.parse('brass')).toBe('slate');
    expect(AGENT_ICON_NAMES).toHaveLength(16);
    expect(AGENT_COLOR_NAMES).not.toContain('brass');
    expect(AGENT_COLOR_NAMES).toHaveLength(8);
  });

  it('parses an agent list', () => {
    expect(AgentListSchema.parse([{ ref: 'a', name: 'a', scope: 'project' }])).toHaveLength(1);
  });

  it('accepts a role list and drops a legacy singular role', () => {
    const a = AgentSummarySchema.parse({
      ref: 'r',
      name: 'n',
      scope: 'project',
      roles: ['swe', 'researcher'],
      role: 'swe',
    });
    expect(a.roles).toEqual(['swe', 'researcher']);
    expect(a).not.toHaveProperty('role');
  });
});

describe('agent list parsing', () => {
  it('parseAgents defaults an empty/corrupt input to an empty list (full-defaults-on-issue)', () => {
    expect(parseAgents(undefined)).toEqual([]);
    expect(parseAgents(null)).toEqual([]);
    expect(parseAgents('garbage')).toEqual([]);
    expect(parseAgents([{ not: 'an agent' }])).toEqual([]);
    expect(DEFAULT_AGENT_LIST).toEqual([]);
  });

  it('parseAgents keeps a complete icon/color and degrades unknown names via .catch', () => {
    const parsed = parseAgents([
      { ref: 'roles/reviewer', name: 'reviewer', scope: 'project' },
      { ref: 'personal/scrap', name: 'scrap', icon: 'octopus', color: 'chartreuse', scope: 'personal' },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ ref: 'roles/reviewer', name: 'reviewer', icon: 'bot', color: 'slate', scope: 'project' });
    expect(parsed[1]).toEqual({
      ref: 'personal/scrap',
      name: 'scrap',
      icon: 'bot',
      color: 'slate',
      scope: 'personal',
    });
  });

  it('parsePersistedAgents rejects missing/corrupt/unknown-version to undefined (quarantine posture)', () => {
    expect(parsePersistedAgents(undefined)).toBeUndefined();
    expect(parsePersistedAgents(null)).toBeUndefined();
    expect(parsePersistedAgents('garbage')).toBeUndefined();
    expect(parsePersistedAgents({ schema_version: 99, agents: [] })).toBeUndefined();
    expect(parsePersistedAgents({ nope: true })).toBeUndefined();
  });

  it('parsePersistedAgents accepts a v1 list and defaults an empty envelope', () => {
    expect(parsePersistedAgents({ schema_version: 1, agents: [] })).toEqual([]);
    expect(parsePersistedAgents({ schema_version: 1 })).toEqual([]);
    expect(
      parsePersistedAgents({ schema_version: 1, agents: [{ ref: 'r', name: 'n', scope: 'project' }] }),
    ).toEqual([{ ref: 'r', name: 'n', icon: 'bot', color: 'slate', scope: 'project' }]);
  });

  it('PersistedAgentsSchema self-describes schema_version = 1 with WAL-style quarantine hooks', () => {
    expect(PersistedAgentsSchema.parse({ agents: [] }).schema_version).toBe(1);
    expect(PersistedAgentsSchema.parse({ schema_version: 1, agents: [] }).schema_version).toBe(1);
  });

  it('drops duplicate refs on read, keeping the first — self-heals a corrupted store', () => {
    // A past ref-collision bug could persist two agents under one ref (one React key).
    // Reading must collapse them so the UI never renders duplicate keys; the first wins.
    const dupes = [
      { ref: 'roles/untitled-agent', name: 'Alice', scope: 'project' },
      { ref: 'roles/untitled-agent', name: 'untitled-agent', scope: 'project' },
    ];
    expect(parseAgents(dupes)).toEqual([
      { ref: 'roles/untitled-agent', name: 'Alice', icon: 'bot', color: 'slate', scope: 'project' },
    ]);
    expect(parsePersistedAgents({ schema_version: 1, agents: dupes })).toEqual([
      { ref: 'roles/untitled-agent', name: 'Alice', icon: 'bot', color: 'slate', scope: 'project' },
    ]);
  });
});

describe('session summary schema', () => {
  it('accepts a session bound to an agent', () => {
    const s = { id: 's1', agentRef: 'roles/reviewer', title: 'fix auth', updatedAt: '2026-07-01' };
    expect(SessionSummarySchema.parse(s)).toEqual(s);
    expect(SessionListSchema.parse([s])).toHaveLength(1);
  });

  it('rejects a session without an agent', () => {
    expect(() => SessionSummarySchema.parse({ id: 's1', title: 't', updatedAt: 'now' })).toThrow();
  });

  it('accepts a promptConfig with a role list', () => {
    const s = {
      id: 's1',
      agentRef: 'roles/reviewer',
      title: 'fix auth',
      updatedAt: '2026-07-01',
      promptConfig: { roles: ['researcher', 'swe'] },
    };
    expect(SessionSummarySchema.parse(s)).toEqual(s);
  });
});
