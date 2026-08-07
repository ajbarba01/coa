import { describe, it, expect } from 'vitest';
import type { TurnFrame } from '@coa/shared';
import {
  foldEventsToTranscript,
  foldTreeToTranscript,
  repairUnpairedToolCalls,
  type PersistedEvent,
} from './transcript-projection.js';

const ev = (seq: number, frame: TurnFrame, full?: string): PersistedEvent =>
  full !== undefined ? { seq, frame, full } : { seq, frame };

describe('foldEventsToTranscript', () => {
  it('folds a clean turn: user, assistant text + tool_use, tool_result, assistant answer', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'do it', role: 'user' }),
      ev(1, { t: 'text', text: 'working' }),
      ev(2, { t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'h1' }),
      ev(3, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'short' }, 'FULL FILE BODY'),
      ev(4, { t: 'text', text: 'done' }),
      ev(5, { t: 'turn-boundary', role: 'assistant' }),
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: 'working',
        toolCalls: [{ id: 'h1', name: 'Read', arguments: { path: 'a' } }],
      },
      { role: 'tool', toolCallId: 'h1', content: 'FULL FILE BODY' },
      { role: 'assistant', content: 'done' },
    ]);
  });

  it('folds an interrupted marker into a user-visible notice so the model knows it was cut off', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'write a poem', role: 'user' }),
      ev(1, { t: 'text', text: 'The clockmaker' }), // the partial the model got out
      ev(2, { t: 'interrupted' }),
    ];
    // The interrupt closes the partial assistant turn and lands as an explicit notice, so the
    // NEXT turn's context shows the model its response was stopped (not that it completed).
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'write a poem' },
      { role: 'assistant', content: 'The clockmaker' },
      { role: 'user', content: '[Request interrupted by user]' },
    ]);
  });

  it('folds a deny frame into a user-visible notice carrying its reason, closing an open assistant turn first', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'finish the migration', role: 'user' }),
      ev(1, { t: 'text', text: 'Working on it' }), // the partial the model got out
      ev(2, { t: 'deny', denyKind: 'close-gate', reason: 'resolve or baseline before finishing' }),
    ];
    // A resumed conversation must read WHY the previous run ended, not just that it did —
    // the close-gate reason is instructional and would otherwise be lost on resume.
    const out = foldEventsToTranscript(events);
    expect(out).toEqual([
      { role: 'user', content: 'finish the migration' },
      { role: 'assistant', content: 'Working on it' },
      {
        role: 'user',
        content: expect.stringContaining('resolve or baseline before finishing'),
      },
    ]);
    expect(out[2]?.content).toContain('close-gate');
  });

  it('drops thinking/error/reconcile/permission/subagent frames (not in the transcript)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'hi', role: 'user' }),
      ev(1, { t: 'thinking', text: 'hmm' }),
      ev(2, { t: 'text', text: 'reply' }),
      ev(3, { t: 'error', message: 'boom', origin: 'loop' }),
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('uses `full` for the tool message content, falling back to the frame pointer when absent', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'x', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'T', input: {}, handle: 'h1' }),
      ev(2, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'PTR' }), // no full
    ];
    const out = foldEventsToTranscript(events);
    expect(out.find((m) => m.role === 'tool')).toEqual({
      role: 'tool',
      toolCallId: 'h1',
      content: 'PTR',
    });
  });

  it('repairs an interrupted trailing tool_use (synthesize a paired result, not drop the assistant turn)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'go', role: 'user' }),
      ev(1, { t: 'text', text: 'calling' }),
      ev(2, { t: 'tool_use', tool: 'Bash', input: { cmd: 'x' }, handle: 'h9' }), // no result → interrupted
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [{ id: 'h9', name: 'Bash', arguments: { cmd: 'x' } }],
      },
      { role: 'tool', toolCallId: 'h9', content: '[Tool execution was interrupted]' },
    ]);
  });

  it('skips a wholly-empty assistant turn (empty text, no tool calls) — matches the retired mapper', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'hi', role: 'user' }),
      ev(1, { t: 'text', text: '' }), // an empty assistant text block, nothing else in the turn
      ev(2, { t: 'turn-boundary', role: 'assistant' }),
    ];
    // The retired messageToBackendMessages returned [] for an empty assistant turn; the
    // fold must not emit a stray { role:'assistant', content:'' } (D85 parity).
    expect(foldEventsToTranscript(events)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('repairs a STRANDED non-last call in a parallel batch (set membership, not position)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'go', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'A', input: {}, handle: 'h1' }),
      ev(2, { t: 'tool_use', tool: 'B', input: {}, handle: 'h2' }),
      ev(3, { t: 'tool_result', handle: 'h2', ok: true, pointer: 'p' }, 'B-RESULT'), // h1 stranded
    ];
    const out = foldEventsToTranscript(events);
    // both calls are answered — h1 synthesized, h2 real — inserted after their assistant message
    expect(out.filter((m) => m.role === 'tool')).toEqual([
      { role: 'tool', toolCallId: 'h1', content: '[Tool execution was interrupted]' },
      { role: 'tool', toolCallId: 'h2', content: 'B-RESULT' },
    ]);
  });

  it('drops an ORPHANED tool_result (a result whose handle never had a matching tool_use)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'tool_result', handle: 'ghost', ok: true, pointer: 'p' }, 'GHOST-BODY'),
    ];
    // An orphaned result answers no assistant tool call and would invalidate the
    // transcript (an OpenAI-compatible endpoint 400s on it) — so it is dropped.
    expect(foldEventsToTranscript(events)).toEqual([]);
  });

  it('still emits a matched tool_result even alongside an orphan drop', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'x', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'T', input: {}, handle: 'h1' }),
      ev(2, { t: 'tool_result', handle: 'ghost', ok: true, pointer: 'g' }, 'GHOST'), // orphan → dropped
      ev(3, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'p' }, 'REAL'), // matched → kept
    ];
    expect(foldEventsToTranscript(events).filter((m) => m.role === 'tool')).toEqual([
      { role: 'tool', toolCallId: 'h1', content: 'REAL' },
    ]);
  });

  it('folds a `system` delivery notice to its own user-role message, never merged into the open assistant turn', () => {
    // Mirrors what the loop driver actually sends live: a `system` origin rides the
    // API's `user` role (the Messages API has no other slot for mid-conversation
    // input) but must never be attributed to the person, and must never be silently
    // folded into the assistant's own text — replay has to reproduce what was sent.
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'go', role: 'user' }),
      ev(1, { t: 'text', text: 'working on it' }), // assistant text, still open
      ev(2, { t: 'text', text: '[coa notice] explorer finished', role: 'system' }),
      ev(3, { t: 'text', text: 'more assistant text' }), // a fresh assistant turn after the notice
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'working on it' },
      { role: 'user', content: '[coa notice] explorer finished' },
      { role: 'assistant', content: 'more assistant text' },
    ]);
  });

  it('folds a TOOL-ONLY assistant turn (no preceding text) to an empty-content assistant message', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'go', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'h1' }),
      ev(2, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'p' }, 'BODY'),
    ];
    expect(foldEventsToTranscript(events)).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'h1', name: 'Read', arguments: { path: 'a' } }],
      },
      { role: 'tool', toolCallId: 'h1', content: 'BODY' },
    ]);
  });
});

describe('foldTreeToTranscript (join)', () => {
  it('projects byte-identically to foldEventsToTranscript for a root with no children (D85)', () => {
    const events: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'do it', role: 'user' }),
      ev(1, { t: 'text', text: 'working' }),
      ev(2, { t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'h1' }),
      ev(3, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'short' }, 'FULL FILE BODY'),
      ev(4, { t: 'text', text: 'done' }),
    ];
    // Compare against the existing function's OWN output, not a hand-written
    // expectation — the actual D85 assertion (a fresh expectation could drift from
    // foldEventsToTranscript and never notice).
    expect(foldTreeToTranscript(events, new Map())).toEqual(foldEventsToTranscript(events));
  });

  it('joins a root, two children, and a GRANDCHILD — every session appears, none stop at depth 1', () => {
    const rootEvents: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'root: spawn two helpers', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'spawn_agent', input: { agentRef: 'a' }, handle: 'spawn-1' }),
      ev(
        2,
        { t: 'tool_result', handle: 'spawn-1', ok: true, pointer: 'child-1' },
        'started child-1',
      ),
    ];
    // The map descendantsOf() would hand the join is FLAT — every id at every depth,
    // not just direct children — so a grandchild's events sit alongside a child's in
    // the very same map. An implementation that only walks depth 1 (e.g. by assuming
    // some parent-of relationship in the map shape) would still pass a two-child
    // fixture; only a real grandchild id proves the join doesn't special-case depth.
    const descendants = new Map<string, PersistedEvent[]>([
      [
        'child-1',
        [
          ev(0, { t: 'text', text: 'child1: doing the first task', role: 'user' }),
          ev(1, { t: 'text', text: 'child1: done' }),
        ],
      ],
      [
        'child-2',
        [
          ev(0, { t: 'text', text: 'child2: doing the second task', role: 'user' }),
          ev(1, { t: 'text', text: 'child2: done' }),
        ],
      ],
      [
        'grandchild-1',
        [
          ev(0, { t: 'text', text: 'grandchild1: deep work spawned by child-1', role: 'user' }),
          ev(1, { t: 'text', text: 'grandchild1: done' }),
        ],
      ],
    ]);
    const out = foldTreeToTranscript(rootEvents, descendants);
    const contents = out.map((m) => m.content).join('\n');
    expect(contents).toContain('root: spawn two helpers');
    expect(contents).toContain('child1: doing the first task');
    expect(contents).toContain('child2: doing the second task');
    expect(contents).toContain('grandchild1: deep work spawned by child-1');
    // Every descendant's final event here is a role-less `text` frame — it opens an
    // assistant turn and never closes it (no trailing `tool_result`/`turn-boundary`).
    // `toContain` alone can't catch a still-open trailing turn landing in the WRONG
    // position, so also assert the ACTUAL total order the function documents: every
    // seq-0 event (root, then each descendant, tied and broken by session id) sorts
    // before every seq-1 event, which sorts before root's own seq-2 continuation — a
    // still-open trailing turn is closed IN PLACE at its own seq, not deferred past
    // later-seq content from a different session (root's seq-2 tool result, here).
    const at = (needle: string): number => out.findIndex((m) => m.content.includes(needle));
    // seq 0, session-id order: '' < 'child-1' < 'child-2' < 'grandchild-1'.
    expect(at('root: spawn two helpers')).toBeLessThan(at('child1: doing the first task'));
    expect(at('child1: doing the first task')).toBeLessThan(at('child2: doing the second task'));
    expect(at('child2: doing the second task')).toBeLessThan(
      at('grandchild1: deep work spawned by child-1'),
    );
    // seq 1: root's own tool_use produces no message of its own (still-open, closed
    // later at seq 2); each descendant's still-open trailing turn closes here, in the
    // same session-id order — and all of it sorts before root's seq-2 continuation.
    expect(at('grandchild1: deep work spawned by child-1')).toBeLessThan(at('child1: done'));
    expect(at('child1: done')).toBeLessThan(at('child2: done'));
    expect(at('child2: done')).toBeLessThan(at('grandchild1: done'));
    // seq 2: root's own turn (opened at seq 1) finally closes, then its tool result —
    // sorting AFTER every descendant's seq-1 content, not before it. This is the
    // element that a deferred-tail-close bug would instead put BEFORE the three
    // '...done' messages (root's assistant/tool-result would land mid-array while all
    // three descendants' trailing turns got shoved to the very end).
    expect(at('child2: done')).toBeLessThan(at('started child-1'));
    expect(out[out.length - 1]?.content).toBe('started child-1');
  });

  it('closes a still-open trailing assistant turn IN PLACE, at its own seq position, not deferred to the end (the ordering the function documents)', () => {
    // The exact reproduction shape: a root with an open assistant turn at a LOW seq
    // (never closed — no tool_result/turn-boundary/interrupted/deny after it) beside a
    // child with events at that same seq and a higher one. Under the documented
    // `(seq, sessionId)` order, root ('' sentinel) ties child at seq 2 and sorts first,
    // and root's close must not be deferred past the child's seq-2/seq-3 content.
    const rootEvents: PersistedEvent[] = [
      ev(2, { t: 'text', text: 'root open turn, never closed' }), // role-less: assistant text
    ];
    const descendants = new Map<string, PersistedEvent[]>([
      [
        'child',
        [
          ev(2, { t: 'text', text: 'child at seq 2', role: 'user' }),
          ev(3, { t: 'text', text: 'child at seq 3', role: 'user' }),
        ],
      ],
    ]);
    const out = foldTreeToTranscript(rootEvents, descendants);
    const at = (needle: string): number => out.findIndex((m) => m.content.includes(needle));
    expect(at('root open turn, never closed')).toBeLessThan(at('child at seq 2'));
    expect(at('child at seq 2')).toBeLessThan(at('child at seq 3'));
  });

  it('throws when a descendant is keyed by the empty string (collides with the root sentinel)', () => {
    const rootEvents: PersistedEvent[] = [ev(0, { t: 'text', text: 'root', role: 'user' })];
    const descendants = new Map<string, PersistedEvent[]>([
      ['', [ev(0, { t: 'text', text: 'impostor', role: 'user' })]],
    ]);
    expect(() => foldTreeToTranscript(rootEvents, descendants)).toThrow(/empty string/);
  });

  it('keeps the `system`-role fold intact across a join: a system notice never merges into ANY open assistant turn', () => {
    // The root has an open assistant turn, then (later in ITS OWN log) a `system`
    // notice — the shape Task 6's renderChildEnded actually produces in a parent's
    // log. A sibling session has its own, unrelated open assistant turn at an
    // overlapping seq. The join must not let the system notice bleed into either.
    const rootEvents: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'root task', role: 'user' }),
      ev(5, { t: 'text', text: 'root thinking' }), // opens root's assistant turn, never closed by root
      ev(6, {
        t: 'text',
        text: '[coa notice] subagent helper (child-a) finished.',
        role: 'system',
      }),
    ];
    const descendants = new Map<string, PersistedEvent[]>([
      [
        'child-a',
        [
          ev(0, { t: 'text', text: 'child task', role: 'user' }),
          ev(5, { t: 'text', text: 'child thinking' }), // same seq as root's open turn, different session
        ],
      ],
    ]);
    const out = foldTreeToTranscript(rootEvents, descendants);
    const roots = out.filter((m) => m.role === 'assistant' && m.content === 'root thinking');
    const kids = out.filter((m) => m.role === 'assistant' && m.content === 'child thinking');
    const notice = out.filter((m) => m.role === 'user' && m.content.startsWith('[coa notice]'));
    expect(roots).toHaveLength(1);
    expect(kids).toHaveLength(1);
    expect(notice).toHaveLength(1);
    // The system notice is its own message — never concatenated onto either
    // session's open assistant text.
    expect(roots[0]?.content).toBe('root thinking');
    expect(kids[0]?.content).toBe('child thinking');
  });

  it('never pairs a tool call in one session with a result from another, even on a colliding handle', () => {
    // Root issues handle `h1` and NEVER gets a result (a genuine stranded call).
    // An unrelated child ALSO issues `h1` (tool-call handles are per-session, not
    // globally unique) and DOES get a real result. A join that merges `issued`/
    // `answered` state globally would wrongly treat root's h1 as "already answered"
    // by the child's real result and skip repairing it.
    const rootEvents: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'root go', role: 'user' }),
      ev(1, { t: 'tool_use', tool: 'Bash', input: { cmd: 'root-cmd' }, handle: 'h1' }),
      // no matching tool_result — genuinely stranded
    ];
    const descendants = new Map<string, PersistedEvent[]>([
      [
        'child-b',
        [
          ev(0, { t: 'text', text: 'child go', role: 'user' }),
          ev(1, { t: 'tool_use', tool: 'Bash', input: { cmd: 'child-cmd' }, handle: 'h1' }),
          ev(2, { t: 'tool_result', handle: 'h1', ok: true, pointer: 'p' }, 'CHILD REAL RESULT'),
        ],
      ],
    ]);
    const out = foldTreeToTranscript(rootEvents, descendants);
    const h1Results = out.filter((m) => m.role === 'tool' && m.toolCallId === 'h1');
    // Both calls are answered — root's synthesized, child's real — as TWO separate
    // messages, proving the repair stayed scoped per session.
    expect(h1Results).toHaveLength(2);
    const contents = h1Results.map((m) => m.content).sort();
    expect(contents).toEqual(['CHILD REAL RESULT', '[Tool execution was interrupted]'].sort());
  });

  it('breaks a same-seq tie between two non-root sessions by session id, deterministically', () => {
    const descendants = new Map<string, PersistedEvent[]>([
      ['zebra', [ev(0, { t: 'text', text: 'zebra text' })]],
      ['alpha', [ev(0, { t: 'text', text: 'alpha text' })]],
    ]);
    const out = foldTreeToTranscript([], descendants);
    const order = out.map((m) => m.content);
    expect(order.indexOf('alpha text')).toBeLessThan(order.indexOf('zebra text'));
  });

  it('handles an empty child log and a descendant id with no events without dropping anything else', () => {
    const rootEvents: PersistedEvent[] = [ev(0, { t: 'text', text: 'root only', role: 'user' })];
    const descendants = new Map<string, PersistedEvent[]>([
      ['empty-child', []],
      ['real-child', [ev(0, { t: 'text', text: 'real child text', role: 'user' })]],
    ]);
    const out = foldTreeToTranscript(rootEvents, descendants);
    expect(out).toEqual([
      { role: 'user', content: 'root only' },
      { role: 'user', content: 'real child text' },
    ]);
  });

  it("orders a child whose events all PREDATE the root's first event ahead of the root", () => {
    const rootEvents: PersistedEvent[] = [ev(10, { t: 'text', text: 'root later', role: 'user' })];
    const descendants = new Map<string, PersistedEvent[]>([
      ['early-child', [ev(1, { t: 'text', text: 'child earlier', role: 'user' })]],
    ]);
    const out = foldTreeToTranscript(rootEvents, descendants);
    expect(out.map((m) => m.content)).toEqual(['child earlier', 'root later']);
  });

  it('joins a descendant id that is not really part of the tree without special-casing it', () => {
    // The join takes whatever map it is given — it has no lineage awareness of its
    // own (that is the caller's job, via descendantsOf). An unrelated id is folded
    // like any other session, not dropped or merged into root.
    const rootEvents: PersistedEvent[] = [ev(0, { t: 'text', text: 'root', role: 'user' })];
    const descendants = new Map<string, PersistedEvent[]>([
      ['stray', [ev(0, { t: 'text', text: 'stray session text', role: 'user' })]],
    ]);
    const out = foldTreeToTranscript(rootEvents, descendants);
    expect(out.map((m) => m.content)).toContain('stray session text');
  });

  it('is deterministic: two runs over the same data (built independently, different Map insertion order) project identically', () => {
    const rootEvents: PersistedEvent[] = [
      ev(0, { t: 'text', text: 'root', role: 'user' }),
      ev(3, { t: 'text', text: 'root more' }),
    ];
    const buildDescendants = (order: 'ascending' | 'descending'): Map<string, PersistedEvent[]> => {
      const entries: [string, PersistedEvent[]][] = [
        ['child-1', [ev(1, { t: 'text', text: 'c1' })]],
        ['child-2', [ev(1, { t: 'text', text: 'c2' })]],
        ['child-3', [ev(0, { t: 'text', text: 'c3' })]],
      ];
      return new Map(order === 'ascending' ? entries : [...entries].reverse());
    };
    const runA = foldTreeToTranscript(rootEvents, buildDescendants('ascending'));
    const runB = foldTreeToTranscript(rootEvents, buildDescendants('descending'));
    expect(runA).toEqual(runB);
  });

  it('passes a hostile U+2028/U+2029-laden frame text through inert, unmodified, never stripped or re-encoded', () => {
    // This projection adds no new interpolation path — it must not mangle, escape,
    // or otherwise touch text that already went through an upstream sanitizer (or
    // that a future producer forgot to sanitize); mangling would itself be a bug.
    const hostile = 'line one line two line three';
    const rootEvents: PersistedEvent[] = [ev(0, { t: 'text', text: hostile, role: 'user' })];
    const descendants = new Map<string, PersistedEvent[]>([
      ['child-c', [ev(0, { t: 'text', text: 'child text', role: 'user' })]],
    ]);
    const out = foldTreeToTranscript(rootEvents, descendants);
    expect(out.some((m) => m.content === hostile)).toBe(true);
  });
});
