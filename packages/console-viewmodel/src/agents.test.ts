import { describe, expect, it } from 'vitest';
import {
  AGENT_COLOR_NAMES,
  AGENT_ICON_NAMES,
  agentColorSchema,
  AgentListSchema,
  agentSummarySchema,
  DEFAULT_AGENT_LIST,
  parseAgents,
  SessionListSchema,
  SessionSummarySchema,
} from './agents.js';

describe('agent summary schema', () => {
  it('accepts a well-formed agent and strips unknown fields', () => {
    const agent = {
      ref: 'roles/reviewer',
      name: 'reviewer',
      description: 'Reviews pull requests.',
      icon: 'search',
      color: 'teal',
      scope: 'project',
      model: 'claude-sonnet-5',
    };
    expect(agentSummarySchema.parse({ ...agent, extra: 1 })).toEqual(agent);
  });

  it('defaults identity when icon/color are absent', () => {
    const a = agentSummarySchema.parse({
      ref: 'r',
      name: 'n',
      description: 'd',
      scope: 'personal',
    });
    expect(a.icon).toBe('bot');
    expect(a.color).toBe('slate');
  });

  it('degrades unknown icon/color names to the defaults instead of failing', () => {
    const a = agentSummarySchema.parse({
      ref: 'r',
      name: 'n',
      description: 'd',
      scope: 'project',
      icon: 'octopus',
      color: 'chartreuse',
    });
    expect(a.icon).toBe('bot');
    expect(a.color).toBe('slate');
  });

  it('accepts the builtin scope alongside personal/project', () => {
    const a = agentSummarySchema.parse({ ref: 'r', name: 'n', description: 'd', scope: 'builtin' });
    expect(a.scope).toBe('builtin');
  });

  it('rejects an unknown scope', () => {
    expect(() =>
      agentSummarySchema.parse({ ref: 'r', name: 'n', description: 'd', scope: 'team' }),
    ).toThrow();
  });

  it('requires a description', () => {
    expect(() => agentSummarySchema.parse({ ref: 'r', name: 'n', scope: 'project' })).toThrow();
  });

  it('brass is not an agent color', () => {
    expect(agentColorSchema.parse('brass')).toBe('slate');
    expect(AGENT_ICON_NAMES).toHaveLength(16);
    expect(AGENT_COLOR_NAMES).not.toContain('brass');
    expect(AGENT_COLOR_NAMES).toHaveLength(8);
  });

  it('parses an agent list', () => {
    expect(
      AgentListSchema.parse([{ ref: 'a', name: 'a', description: 'd', scope: 'project' }]),
    ).toHaveLength(1);
  });

  it('accepts a role list and drops a legacy singular role', () => {
    const a = agentSummarySchema.parse({
      ref: 'r',
      name: 'n',
      description: 'd',
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

  it('drops a payload whose agents are missing a description', () => {
    expect(parseAgents([{ ref: 'x', scope: 'project', name: 'X' }])).toEqual([]);
  });

  it('parseAgents keeps a complete icon/color and degrades unknown names via .catch', () => {
    const parsed = parseAgents([
      { ref: 'roles/reviewer', name: 'reviewer', description: 'Reviews code.', scope: 'project' },
      {
        ref: 'personal/scrap',
        name: 'scrap',
        description: 'A scratch agent.',
        icon: 'octopus',
        color: 'chartreuse',
        scope: 'personal',
      },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      ref: 'roles/reviewer',
      name: 'reviewer',
      description: 'Reviews code.',
      icon: 'bot',
      color: 'slate',
      scope: 'project',
    });
    expect(parsed[1]).toEqual({
      ref: 'personal/scrap',
      name: 'scrap',
      description: 'A scratch agent.',
      icon: 'bot',
      color: 'slate',
      scope: 'personal',
    });
  });

  it('parseAgents keeps a builtin agent as-is', () => {
    const parsed = parseAgents([
      {
        ref: 'general-purpose',
        name: 'General purpose',
        description: 'A general worker.',
        scope: 'builtin',
      },
    ]);
    expect(parsed).toEqual([
      {
        ref: 'general-purpose',
        name: 'General purpose',
        description: 'A general worker.',
        icon: 'bot',
        color: 'slate',
        scope: 'builtin',
      },
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

  it('accepts a spawned child’s lineage (parent/root) and its recorded spend', () => {
    const s = {
      id: 'child-1',
      agentRef: 'roles/reviewer',
      title: 'fix auth',
      updatedAt: '2026-07-01',
      parent: 'root-1',
      root: 'root-1',
      costUsd: 0.42,
    };
    expect(SessionSummarySchema.parse(s)).toEqual(s);
  });

  it('leaves a session with no lineage byte-identical (parent/root/costUsd stay absent)', () => {
    const s = { id: 's1', agentRef: 'roles/reviewer', title: 'fix auth', updatedAt: '2026-07-01' };
    const parsed = SessionSummarySchema.parse(s);
    expect(parsed).toEqual(s);
    expect('parent' in parsed).toBe(false);
    expect('root' in parsed).toBe(false);
    expect('costUsd' in parsed).toBe(false);
  });
});
