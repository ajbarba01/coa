import { describe, expect, it } from 'vitest';
import {
  AGENT_COLOR_NAMES,
  AGENT_ICON_NAMES,
  AgentColorSchema,
  AgentListSchema,
  AgentSummarySchema,
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
});
