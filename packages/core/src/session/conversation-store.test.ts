import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TurnFrame } from '@coa/shared';
import { createConversationStore, type ConversationStore } from './conversation-store.js';

/** A monotonic ISO clock so recency ordering is deterministic in tests. */
function fakeClock(): () => string {
  let t = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString();
}

const text = (s: string): TurnFrame => ({ t: 'text', text: s });

describe('conversation store', () => {
  let dir: string;
  let store: ConversationStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-conv-'));
    store = createConversationStore(dir, fakeClock());
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a session and lists it back with its metadata', () => {
    const meta = store.create({
      id: 'c1',
      agentRef: 'roles/reviewer',
      title: 'audit auth',
      scope: 'src',
    });
    expect(meta).toMatchObject({
      id: 'c1',
      agentRef: 'roles/reviewer',
      title: 'audit auth',
      scope: 'src',
    });
    expect(store.getMeta('c1')).toMatchObject({ id: 'c1', title: 'audit auth' });
    expect(store.list().map((m) => m.id)).toEqual(['c1']);
  });

  it('persists parent and root links and reloads them', () => {
    store.create({ id: 'root-1', agentRef: 'general-purpose', title: 'Root', scope: 'repo' });
    store.create({
      id: 'kid-a',
      agentRef: 'explorer',
      title: 'A',
      scope: 'repo',
      parent: 'root-1',
      root: 'root-1',
    });
    store.create({
      id: 'kid-b',
      agentRef: 'explorer',
      title: 'B',
      scope: 'repo',
      parent: 'root-1',
      root: 'root-1',
    });
    expect(store.getMeta('root-1')?.parent).toBeUndefined();
    expect(store.getMeta('kid-b')?.parent).toBe('root-1');
    expect(store.getMeta('kid-b')?.root).toBe('root-1');
    expect(store.list().filter((m) => m.root === 'root-1')).toHaveLength(2);
  });

  it('still parses a meta written before lineage existed', () => {
    store.create({ id: 'legacy', agentRef: 'general-purpose', title: 'Old', scope: 'repo' });
    expect(store.getMeta('legacy')?.root).toBeUndefined();
  });

  it('persists and reloads the turn sequence, honoring toSeq', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.append('c1', [
      { seq: 0, frame: text('hello') },
      { seq: 1, frame: { t: 'tool_use', tool: 'graph_read', input: { scope: 'x' }, handle: 'h1' } },
      { seq: 2, frame: text('done') },
    ]);
    expect(store.reload('c1')).toEqual([
      { seq: 0, frame: { t: 'text', text: 'hello' } },
      { seq: 1, frame: { t: 'tool_use', tool: 'graph_read', input: { scope: 'x' }, handle: 'h1' } },
      { seq: 2, frame: { t: 'text', text: 'done' } },
    ]);
    expect(store.reload('c1', 1).map((r) => r.seq)).toEqual([0, 1]);
  });

  it('orders list by most-recently-active first, and appending bumps recency', () => {
    store.create({ id: 'a', agentRef: 'r', title: 'a', scope: '' });
    store.create({ id: 'b', agentRef: 'r', title: 'b', scope: '' });
    expect(store.list().map((m) => m.id)).toEqual(['b', 'a']); // b created after a
    store.append('a', [{ seq: 0, frame: text('hi') }]);
    expect(store.list().map((m) => m.id)).toEqual(['a', 'b']); // a is now the most recent
  });

  it('renames a session and records the backend session id with its resume stamp', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 'new session', scope: '' });
    store.rename('c1', 'refactor the auth module');
    store.setBackendSession('c1', 'sdk-uuid-123', { provider: 'claude', model: 'claude-opus-4-8' });
    expect(store.getMeta('c1')).toMatchObject({
      title: 'refactor the auth module',
      backendSessionId: 'sdk-uuid-123',
      resumeStamp: { provider: 'claude', model: 'claude-opus-4-8' },
    });
  });

  it('pins the session selection and replaces it wholesale on change', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.setSelection('c1', {
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoning: { mode: 'effort', effort: 'high' },
    });
    expect(store.getMeta('c1')).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoning: { mode: 'effort', effort: 'high' },
    });
    // Switching to a provider default (no model/reasoning) clears the stale pins.
    store.setSelection('c1', { provider: 'claude' });
    const meta = store.getMeta('c1')!;
    expect(meta.provider).toBe('claude');
    expect(meta.model).toBeUndefined();
    expect(meta.reasoning).toBeUndefined();
  });

  it('setSelection/setBackendSession are no-ops on an unknown session', () => {
    store.setSelection('ghost', { provider: 'claude' });
    store.setBackendSession('ghost', 'x', { provider: 'claude' });
    expect(store.getMeta('ghost')).toBeUndefined();
  });

  it('clearBackendSession drops the resume token so the next turn starts a fresh server session', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.setBackendSession('c1', 'sdk-1', {
      provider: 'claude',
      model: 'opus',
      promptVersion: 'v1',
    });
    store.clearBackendSession('c1');
    const meta = store.getMeta('c1')!;
    expect(meta.backendSessionId).toBeUndefined();
    expect(meta.resumeStamp).toBeUndefined();
    // The rest of the metadata survives.
    expect(meta.title).toBe('t');
  });

  it('clearCompilation removes the frozen prompt so the next turn recompiles', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.setCompilation('c1', {
      neutral: {
        prefixHead: [],
        systemReminders: [],
        onDemandPullable: [],
        scopePushed: [],
        toolIntents: { allow: [], deny: [] },
      },
      frame: { allow: [], deny: [] },
      promptVersion: 'pv',
      configHash: 'cfg',
      config: { role: 'swe' },
    });
    expect(store.getCompilation('c1')).toBeDefined();
    store.clearCompilation('c1');
    expect(store.getCompilation('c1')).toBeUndefined();
  });

  it('clearBackendSession/clearCompilation are no-ops on an unknown session', () => {
    expect(() => store.clearBackendSession('ghost')).not.toThrow();
    expect(() => store.clearCompilation('ghost')).not.toThrow();
  });

  it('removes a session entirely', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.append('c1', [{ seq: 0, frame: text('hi') }]);
    store.remove('c1');
    expect(store.getMeta('c1')).toBeUndefined();
    expect(store.list()).toEqual([]);
    expect(store.reload('c1')).toEqual([]);
  });

  it('is durable across store instances (data lives on disk)', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.append('c1', [{ seq: 0, frame: text('persisted') }]);
    const reopened = createConversationStore(dir, fakeClock());
    expect(reopened.getMeta('c1')?.id).toBe('c1');
    expect(reopened.reload('c1')).toEqual([{ seq: 0, frame: { t: 'text', text: 'persisted' } }]);
  });

  it('never throws on corrupt data: skips a bad meta dir and a garbage turn line', () => {
    store.create({ id: 'good', agentRef: 'r', title: 't', scope: '' });
    // a directory with no/broken meta.json is ignored by list
    mkdirSync(join(dir, 'orphan'), { recursive: true });
    writeFileSync(join(dir, 'orphan', 'meta.json'), '{ not json', 'utf8');
    // a garbage line between valid events is skipped by reload
    appendFileSync(join(dir, 'good', 'events.ndjson'), 'not-json\n', 'utf8');
    store.append('good', [{ seq: 5, frame: text('after') }]);
    expect(store.list().map((m) => m.id)).toEqual(['good']);
    expect(store.reload('good')).toEqual([{ seq: 5, frame: { t: 'text', text: 'after' } }]);
  });

  it('returns undefined/empty for unknown ids', () => {
    expect(store.getMeta('nope')).toBeUndefined();
    expect(store.reload('nope')).toEqual([]);
    expect(store.loadBackendMessages('nope')).toEqual([]);
  });

  it('append writes events.ndjson; loadBackendMessages folds it (no messages.json)', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.append('c1', [
      { seq: 0, frame: { t: 'text', text: 'hi', role: 'user' } },
      { seq: 1, frame: { t: 'tool_use', tool: 'Read', input: { p: 'a' }, handle: 'h1' } },
      {
        seq: 2,
        frame: { t: 'tool_result', handle: 'h1', ok: true, pointer: 'ptr' },
        full: 'FULLBODY',
      },
      { seq: 3, frame: { t: 'text', text: 'done' } },
      { seq: 4, frame: { t: 'turn-boundary', role: 'assistant' } },
    ]);
    // Transcript = the fold (full body preserved), NOT the pointer.
    expect(store.loadBackendMessages('c1')).toEqual([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'h1', name: 'Read', arguments: { p: 'a' } }],
      },
      { role: 'tool', toolCallId: 'h1', content: 'FULLBODY' },
      { role: 'assistant', content: 'done' },
    ]);
    // UI view = the frame stream (full dropped).
    expect(store.reload('c1').map((t) => t.frame.t)).toEqual([
      'text',
      'tool_use',
      'tool_result',
      'text',
      'turn-boundary',
    ]);
    expect(store.reload('c1').every((t) => !('full' in t))).toBe(true);
  });

  it('loadBackendMessages returns [] for a session with no events (fresh start; old files ignored)', () => {
    store.create({ id: 'c2', agentRef: 'r', title: 't', scope: '' });
    expect(store.loadBackendMessages('c2')).toEqual([]);
  });

  it('freezes and reloads a session compilation; a corrupt one reads as none', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    expect(store.getCompilation('c1')).toBeUndefined();
    const compilation = {
      neutral: {
        prefixHead: [],
        systemReminders: [],
        onDemandPullable: [],
        scopePushed: [],
        toolIntents: { allow: ['Read'], deny: [] },
      },
      frame: { allow: ['Read'], deny: [] },
      promptVersion: 'abc123',
      configHash: 'cfg789',
      config: { role: 'swe', packageIds: ['research'] },
    };
    store.setCompilation('c1', compilation);
    expect(store.getCompilation('c1')).toEqual(compilation);
    // Survives a reopen (lives on disk).
    expect(createConversationStore(dir, fakeClock()).getCompilation('c1')).toEqual(compilation);
    // Corrupt ⇒ undefined (the session recompiles fresh), never throws.
    writeFileSync(join(dir, 'c1', 'compilation.json'), '{ not json', 'utf8');
    expect(store.getCompilation('c1')).toBeUndefined();
  });
});
