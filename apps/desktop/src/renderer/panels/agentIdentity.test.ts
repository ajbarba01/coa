import { describe, expect, it } from 'vitest';
import { nextAgentIdentity } from './agentIdentity.js';

describe('nextAgentIdentity', () => {
  it('starts at untitled-agent — a bare ref, no scope prefix (the ref IS the filename)', () => {
    expect(nextAgentIdentity([])).toEqual({ ref: 'untitled-agent', name: 'untitled-agent' });
  });

  it('never reuses an existing ref even after the original was renamed away from its suffix', () => {
    // The duplicate-agent bug: an agent created as untitled-agent (ref untitled-agent) then
    // renamed to "Alice" frees the NAME "untitled-agent" while its REF persists. A name-only
    // uniqueness check would mint untitled-agent a second time — two agents, one ref, one
    // React key, and (now) one file silently overwriting the other.
    const existing = [{ ref: 'untitled-agent' }];
    const next = nextAgentIdentity(existing);
    expect(next.ref).not.toBe('untitled-agent');
    expect(next).toEqual({ ref: 'untitled-agent-2', name: 'untitled-agent-2' });
  });

  it('skips refs already taken across sequential creates', () => {
    const first = nextAgentIdentity([]);
    const second = nextAgentIdentity([first]);
    expect(second).toEqual({ ref: 'untitled-agent-2', name: 'untitled-agent-2' });
  });

  it('dedupes against a built-in ref too — a new agent must never silently shadow one', () => {
    const next = nextAgentIdentity([{ ref: 'untitled-agent' }, { ref: 'general-purpose' }]);
    expect(next.ref).toBe('untitled-agent-2');
  });
});
