import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackendMessage, TurnFrame } from '@coa/shared';
import { createConversationStore, type ConversationStore } from './conversation-store.js';

/** A monotonic ISO clock so recency ordering is deterministic in tests. */
function fakeClock(): () => string {
  let t = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString();
}

const text = (s: string): TurnFrame => ({ t: 'text', text: s });

describe('conversation store (R-7)', () => {
  let dir: string;
  let store: ConversationStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-conv-'));
    store = createConversationStore(dir, fakeClock());
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a session and lists it back with its metadata', () => {
    const meta = store.create({ id: 'c1', agentRef: 'roles/reviewer', title: 'audit auth', scope: 'src' });
    expect(meta).toMatchObject({ id: 'c1', agentRef: 'roles/reviewer', title: 'audit auth', scope: 'src' });
    expect(store.getMeta('c1')).toMatchObject({ id: 'c1', title: 'audit auth' });
    expect(store.list().map((m) => m.id)).toEqual(['c1']);
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

  it('renames a session and records the backend session id', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 'new session', scope: '' });
    store.rename('c1', 'refactor the auth module');
    store.setBackendSession('c1', 'sdk-uuid-123');
    expect(store.getMeta('c1')).toMatchObject({
      title: 'refactor the auth module',
      backendSessionId: 'sdk-uuid-123',
    });
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
    // a garbage line between valid turns is skipped by reload
    appendFileSync(join(dir, 'good', 'turns.ndjson'), 'not-json\n', 'utf8');
    store.append('good', [{ seq: 5, frame: text('after') }]);
    expect(store.list().map((m) => m.id)).toEqual(['good']);
    expect(store.reload('good')).toEqual([{ seq: 5, frame: { t: 'text', text: 'after' } }]);
  });

  it('returns undefined/empty for unknown ids', () => {
    expect(store.getMeta('nope')).toBeUndefined();
    expect(store.reload('nope')).toEqual([]);
    expect(store.loadBackendMessages('nope')).toEqual([]);
  });

  it('round-trips the pure-API backend transcript verbatim (tool calls + results kept)', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    const messages: BackendMessage[] = [
      { role: 'user', content: 'find pay' },
      {
        role: 'assistant',
        content: 'looking',
        toolCalls: [{ id: 'c1', name: 'get_symbol', arguments: { name: 'pay' } }],
      },
      { role: 'tool', toolCallId: 'c1', content: '{"rows":3}' },
      { role: 'assistant', content: 'found it' },
    ];
    store.saveBackendMessages('c1', messages);
    expect(store.loadBackendMessages('c1')).toEqual(messages);
    // Rewritten in full each turn (not appended).
    store.saveBackendMessages('c1', [{ role: 'user', content: 'only me now' }]);
    expect(store.loadBackendMessages('c1')).toEqual([{ role: 'user', content: 'only me now' }]);
  });

  it('reads an unparseable transcript as no memory (all-or-nothing, never throws)', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    writeFileSync(join(dir, 'c1', 'messages.json'), '{ not json', 'utf8');
    expect(store.loadBackendMessages('c1')).toEqual([]);
  });
});
