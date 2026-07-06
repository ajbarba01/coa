// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { AgentSummary } from '@coa/console-viewmodel';
import { deserializeAgents, serializeAgents } from './agentsStore.js';

describe('agents store serialization', () => {
  it('round-trips through JSON: what the writer persists, the reader restores', () => {
    // The exact wipe-on-reload bug: the writer persists a self-describing envelope
    // ({ schema_version, agents }), so the reader must parse that envelope — not the
    // bare array. If the two disagree, every reload reads an empty list.
    const agents: AgentSummary[] = [
      {
        ref: 'roles/reviewer',
        name: 'reviewer',
        icon: 'search',
        color: 'teal',
        scope: 'project',
        model: 'sonnet',
        roles: ['researcher'],
      },
      { ref: 'personal/scratch', name: 'scratch', icon: 'bot', color: 'slate', scope: 'personal' },
    ];
    // Simulate the on-disk hop (writeJson's JSON.stringify → readJson's JSON.parse).
    const onDisk = JSON.parse(JSON.stringify(serializeAgents(agents)));
    expect(deserializeAgents(onDisk)).toEqual(agents);
  });

  it('degrades a missing / corrupt / unknown-version store to an empty list', () => {
    expect(deserializeAgents(undefined)).toEqual([]);
    expect(deserializeAgents('garbage')).toEqual([]);
    expect(deserializeAgents({ schema_version: 99, agents: [] })).toEqual([]);
  });
});
