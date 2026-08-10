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
    expect(store.reload('c1')).toEqual({
      turns: [
        { seq: 0, frame: { t: 'text', text: 'hello' } },
        {
          seq: 1,
          frame: { t: 'tool_use', tool: 'graph_read', input: { scope: 'x' }, handle: 'h1' },
        },
        { seq: 2, frame: { t: 'text', text: 'done' } },
      ],
      skipped: 0,
    });
    expect(store.reload('c1', 1).turns.map((r) => r.seq)).toEqual([0, 1]);
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
    expect(store.reload('c1')).toEqual({ turns: [], skipped: 0 });
  });

  it('is durable across store instances (data lives on disk)', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.append('c1', [{ seq: 0, frame: text('persisted') }]);
    const reopened = createConversationStore(dir, fakeClock());
    expect(reopened.getMeta('c1')?.id).toBe('c1');
    expect(reopened.reload('c1')).toEqual({
      turns: [{ seq: 0, frame: { t: 'text', text: 'persisted' } }],
      skipped: 0,
    });
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
    expect(store.reload('good').turns).toEqual([{ seq: 5, frame: { t: 'text', text: 'after' } }]);
  });

  it('counts the events it could not read, and reports each unreadable file', () => {
    // The silence this replaces: an unreadable line was dropped with a bare `continue`,
    // so a partially-flushed append produced a transcript that looked whole and a model
    // resumed with less memory than it had. Now BOTH readers return the count alongside
    // what they could read — the console's turns and the model's transcript — so neither
    // consumer can pass a fragment on as the whole record. The floor is unchanged:
    // nothing throws, everything readable is still returned, and the loss is also
    // reported for the log.
    const dropped: { sessionId: string; file: string; count: number }[] = [];
    store = createConversationStore(dir, fakeClock(), {
      reportUnreadable: (d) => dropped.push(d),
    });
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.append('c1', [{ seq: 0, frame: { t: 'text', text: 'first', role: 'user' } }]);
    // a truncated JSON line (a half-written append) and a well-formed line that is not
    // an event at all (schema-invalid) — both used to vanish without trace
    appendFileSync(join(dir, 'c1', 'events.ndjson'), '{"seq":1,"frame":{"t":"te\n', 'utf8');
    appendFileSync(join(dir, 'c1', 'events.ndjson'), '{"nonsense":true}\n', 'utf8');
    store.append('c1', [{ seq: 3, frame: text('last') }]);

    const reloaded = store.reload('c1');
    expect(reloaded.turns.map((t) => t.seq)).toEqual([0, 3]);
    expect(reloaded.skipped).toBe(2);
    // The model's memory is folded from the same log, so it lost the same two events —
    // and the count comes back WITH the messages, so the resume path can say so instead
    // of handing the remainder to the model as the whole conversation.
    expect(store.loadBackendMessages('c1')).toEqual({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'last' },
      ],
      skipped: 2,
    });
    expect(dropped).toContainEqual({ sessionId: 'c1', file: 'events', count: 2 });

    // A metadata file that is present but unreadable is a session dropping out of the
    // listing — reported, where a session that simply does not exist is not.
    writeFileSync(join(dir, 'c1', 'meta.json'), '{ not json', 'utf8');
    dropped.length = 0;
    expect(store.getMeta('c1')).toBeUndefined();
    expect(store.getMeta('never-existed')).toBeUndefined();
    expect(dropped).toEqual([{ sessionId: 'c1', file: 'meta', count: 1 }]);

    // Same for a frozen prompt that will not parse: the next turn recompiles either way,
    // but a compilation that was there and is now unreadable is worth saying out loud.
    dropped.length = 0;
    writeFileSync(join(dir, 'c1', 'compilation.json'), 'not json at all', 'utf8');
    expect(store.getCompilation('c1')).toBeUndefined();
    expect(dropped).toEqual([{ sessionId: 'c1', file: 'compilation', count: 1 }]);
  });

  it('returns undefined/empty for unknown ids', () => {
    expect(store.getMeta('nope')).toBeUndefined();
    expect(store.reload('nope')).toEqual({ turns: [], skipped: 0 });
    expect(store.loadBackendMessages('nope')).toEqual({ messages: [], skipped: 0 });
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
    expect(store.loadBackendMessages('c1').messages).toEqual([
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
    expect(store.reload('c1').turns.map((t) => t.frame.t)).toEqual([
      'text',
      'tool_use',
      'tool_result',
      'text',
      'turn-boundary',
    ]);
    expect(store.reload('c1').turns.every((t) => !('full' in t))).toBe(true);
  });

  it('loadBackendMessages returns [] for a session with no events (fresh start; old files ignored)', () => {
    store.create({ id: 'c2', agentRef: 'r', title: 't', scope: '' });
    // A log that was never written lost nothing — an absent file is not a skipped event.
    expect(store.loadBackendMessages('c2')).toEqual({ messages: [], skipped: 0 });
  });

  it('getEvents returns the raw stream with `full` intact, unlike reload', () => {
    store.create({ id: 'c3', agentRef: 'r', title: 't', scope: '' });
    store.append('c3', [
      { seq: 0, frame: { t: 'text', text: 'hi', role: 'user' } },
      {
        seq: 1,
        frame: { t: 'tool_result', handle: 'h1', ok: true, pointer: 'ptr' },
        full: 'FULLBODY',
      },
    ]);
    expect(store.getEvents('c3')).toEqual({
      events: [
        { seq: 0, frame: { t: 'text', text: 'hi', role: 'user' } },
        {
          seq: 1,
          frame: { t: 'tool_result', handle: 'h1', ok: true, pointer: 'ptr' },
          full: 'FULLBODY',
        },
      ],
      skipped: 0,
    });
  });

  it('getEvents is empty for a session with no events, same floor as loadBackendMessages', () => {
    store.create({ id: 'c4', agentRef: 'r', title: 't', scope: '' });
    expect(store.getEvents('c4')).toEqual({ events: [], skipped: 0 });
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

  it('round-trips the injected skill selection on the stored compilation (the drift key survives a reopen)', () => {
    store.create({ id: 'c1', agentRef: 'r', title: 't', scope: '' });
    store.setCompilation('c1', {
      neutral: {
        prefixHead: [],
        systemReminders: [],
        onDemandPullable: ['review'],
        scopePushed: [],
        toolIntents: { allow: [], deny: [] },
      },
      frame: { allow: [], deny: [] },
      promptVersion: 'pv',
      configHash: 'cfg',
      config: {
        role: 'swe',
        skills: [
          { name: 'commits', delivery: 'auto' },
          { name: 'review', delivery: 'disclosure' },
        ],
      },
    });
    expect(createConversationStore(dir, fakeClock()).getCompilation('c1')?.config.skills).toEqual([
      { name: 'commits', delivery: 'auto' },
      { name: 'review', delivery: 'disclosure' },
    ]);
  });
});
