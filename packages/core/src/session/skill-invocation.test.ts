import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversationStore, type ConversationStore } from './conversation-store.js';
import { configKeyOf } from './held-open-driver.js';
import { LiveSession } from './live-session.js';
import { composeTurnInput, renderInvokedSkill } from './skill-invocation.js';
import { prepareTurnPersistence } from './turn-persistence.js';
import type { SeqBox } from './frame-recorder.js';

describe('composeTurnInput', () => {
  it('is the raw input when nothing was invoked (byte-identical floor)', () => {
    expect(composeTurnInput({ input: 'hello' })).toBe('hello');
    expect(composeTurnInput({ input: 'hello', invokedSkills: [] })).toBe('hello');
  });

  it('stacks invoked skill payload blocks above the user text', () => {
    const composed = composeTurnInput({
      input: 'commit this',
      invokedSkills: [{ name: 'commits', body: 'subject-only, no trailer' }],
    });
    expect(composed).toBe(
      '<invoked-skill name="commits">\nsubject-only, no trailer\n</invoked-skill>\n\ncommit this',
    );
  });
});

describe('invoked-skill persistence (the durable log mirrors the model input)', () => {
  let dir: string;
  let store: ConversationStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coa-skill-inv-'));
    store = createConversationStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists each invocation as a system frame ABOVE the raw user frame', () => {
    const session = new LiveSession('conv-1');
    const seqBox: SeqBox = { value: 0 };
    const turn = {
      input: 'commit this',
      invokedSkills: [{ name: 'commits', body: 'subject-only' }],
    };
    prepareTurnPersistence(turn, session, 'swe', store, seqBox);

    const { turns } = store.reload('conv-1');
    expect(turns.map((t) => t.frame)).toEqual([
      {
        t: 'text',
        text: renderInvokedSkill({ name: 'commits', body: 'subject-only' }),
        role: 'system',
      },
      { t: 'text', text: 'commit this', role: 'user' },
    ]);
    // The auto-title reads the RAW user input, never the skill payload.
    expect(store.getMeta('conv-1')?.title).toBe('commit this');
    // Replay memory carries both, in order — the model that resumes read the skill.
    const { messages } = store.loadBackendMessages('conv-1');
    expect(messages.map((m) => m.content)).toEqual([
      renderInvokedSkill({ name: 'commits', body: 'subject-only' }),
      'commit this',
    ]);
  });

  it('carries the resolved skill selection into the drift-relevant config', () => {
    const session = new LiveSession('conv-2');
    const prep = prepareTurnPersistence(
      {
        input: 'go',
        skillSelection: [{ name: 'commits', delivery: 'auto' as const }],
      },
      session,
      'swe',
      store,
      { value: 0 },
    );
    expect(prep.currentConfig.skills).toEqual([{ name: 'commits', delivery: 'auto' }]);
  });
});

describe('held-open configKeyOf (the pinned-query identity)', () => {
  it('differs when the skill selection changes or a delivery flips', () => {
    const base = configKeyOf({ input: 'x', role: 'swe' });
    const withSkill = configKeyOf({
      input: 'x',
      role: 'swe',
      skillSelection: [{ name: 'commits', delivery: 'auto' }],
    });
    const flipped = configKeyOf({
      input: 'x',
      role: 'swe',
      skillSelection: [{ name: 'commits', delivery: 'disclosure' }],
    });
    expect(withSkill).not.toBe(base);
    expect(flipped).not.toBe(withSkill);
  });

  it('is order-independent over the skill selection', () => {
    const a = configKeyOf({
      input: 'x',
      role: 'swe',
      skillSelection: [
        { name: 'a', delivery: 'auto' },
        { name: 'b', delivery: 'auto' },
      ],
    });
    const b = configKeyOf({
      input: 'x',
      role: 'swe',
      skillSelection: [
        { name: 'b', delivery: 'auto' },
        { name: 'a', delivery: 'auto' },
      ],
    });
    expect(a).toBe(b);
  });

  it('differs when the MCP server set changes (a query pinned its adapter servers)', () => {
    const none = configKeyOf({ input: 'x', role: 'swe' });
    const withServer = configKeyOf({
      input: 'x',
      role: 'swe',
      mcpServers: { gh: { transport: 'http', url: 'https://mcp.example' } },
    });
    const changed = configKeyOf({
      input: 'x',
      role: 'swe',
      mcpServers: { gh: { transport: 'http', url: 'https://other.example' } },
    });
    expect(withServer).not.toBe(none);
    expect(changed).not.toBe(withServer);
  });
});
