import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMessageLog, type AgentMessage, type MessageLog } from './message-log.js';

const msg = (
  over: Partial<AgentMessage> & Pick<AgentMessage, 'id' | 'from' | 'to'>,
): AgentMessage => ({
  threadId: over.id,
  root: 'root-1',
  body: 'hello',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('message log', () => {
  let dir: string;
  let log: MessageLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-msg-'));
    log = createMessageLog(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appends and reads a message back for its root', () => {
    const m = msg({ id: 'm1', from: 'a', to: 'b' });
    log.append(m);
    expect(log.forRoot('root-1')).toEqual([m]);
  });

  it('keeps a different root entirely separate', () => {
    log.append(msg({ id: 'm1', from: 'a', to: 'b', root: 'root-1' }));
    log.append(msg({ id: 'm2', from: 'c', to: 'd', root: 'root-2' }));
    expect(log.forRoot('root-1').map((m) => m.id)).toEqual(['m1']);
    expect(log.forRoot('root-2').map((m) => m.id)).toEqual(['m2']);
  });

  it('preserves append order (dispatch ordering)', () => {
    log.append(msg({ id: 'm1', from: 'a', to: 'b' }));
    log.append(msg({ id: 'm2', from: 'b', to: 'a' }));
    log.append(msg({ id: 'm3', from: 'a', to: 'b' }));
    expect(log.forRoot('root-1').map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('resolves a message by id within its root, for thread lookup', () => {
    const m = msg({ id: 'm1', from: 'a', to: 'b', threadId: 'm1' });
    log.append(m);
    expect(log.get('root-1', 'm1')).toEqual(m);
    expect(log.get('root-1', 'nope')).toBeUndefined();
    expect(log.get('root-2', 'm1')).toBeUndefined();
  });

  it('returns an empty list for a root with no messages, never throws', () => {
    expect(log.forRoot('never-seen')).toEqual([]);
  });

  it('reads a fresh log instance back off disk (durability, not just an in-process cache)', () => {
    log.append(msg({ id: 'm1', from: 'a', to: 'b' }));
    const reopened = createMessageLog(dir);
    expect(reopened.forRoot('root-1').map((m) => m.id)).toEqual(['m1']);
  });

  it('skips a corrupt line rather than throwing, re-materializing the rest', () => {
    log.append(msg({ id: 'm1', from: 'a', to: 'b' }));
    // Simulate a partial/garbage write directly against the file (never done by this
    // module itself — a crash/partial-flush scenario).
    appendFileSync(join(dir, 'root-1.ndjson'), 'not json at all\n', 'utf8');
    const reopened = createMessageLog(dir);
    expect(reopened.forRoot('root-1').map((m) => m.id)).toEqual(['m1']);
  });
});
