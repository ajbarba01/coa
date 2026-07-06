import { describe, expect, it } from 'vitest';
import { nextAgentIdentity } from './agentIdentity.js';

describe('nextAgentIdentity', () => {
  it('starts at untitled-agent, prefixed by scope', () => {
    expect(nextAgentIdentity([], 'project')).toEqual({
      ref: 'roles/untitled-agent',
      name: 'untitled-agent',
    });
    expect(nextAgentIdentity([], 'personal')).toEqual({
      ref: 'personal/untitled-agent',
      name: 'untitled-agent',
    });
  });

  it('never reuses an existing ref even after the original was renamed away from its suffix', () => {
    // The duplicate-agent bug: an agent created as untitled-agent (ref roles/untitled-agent)
    // then renamed to "Alice" frees the NAME "untitled-agent" while its REF persists. A
    // name-only uniqueness check would mint roles/untitled-agent a second time — two agents,
    // one ref, one React key.
    const existing = [{ ref: 'roles/untitled-agent', name: 'Alice' }];
    const next = nextAgentIdentity(existing, 'project');
    expect(next.ref).not.toBe('roles/untitled-agent');
    expect(next).toEqual({ ref: 'roles/untitled-agent-2', name: 'untitled-agent-2' });
  });

  it('skips refs already taken across sequential creates', () => {
    const first = nextAgentIdentity([], 'project');
    const second = nextAgentIdentity([first], 'project');
    expect(second).toEqual({ ref: 'roles/untitled-agent-2', name: 'untitled-agent-2' });
  });
});
