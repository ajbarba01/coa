import type { Push } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { parseRunArgs, renderPush } from './run-render.js';

describe('parseRunArgs', () => {
  it('reads the prompt from the trailing args', () => {
    expect(parseRunArgs(['do', 'the', 'thing'])).toEqual({ input: 'do the thing' });
  });

  it('reads --role and --scope flags and keeps the rest as the prompt', () => {
    expect(parseRunArgs(['--role', 'dev', '--scope', 'src/pay', 'fix', 'it'])).toEqual({
      role: 'dev',
      scope: 'src/pay',
      input: 'fix it',
    });
  });

  it('errors when no prompt is given', () => {
    expect(parseRunArgs(['--role', 'dev'])).toEqual({ error: expect.stringMatching(/prompt/i) });
  });

  it('parses --provider and --model into a model selection', () => {
    expect(parseRunArgs(['--provider', 'claude', '--model', 'claude-opus-4-8', 'go'])).toEqual({
      model: { provider: 'claude', model: 'claude-opus-4-8' },
      input: 'go',
    });
  });

  it('parses --reasoning effort levels faithfully (incl. xhigh/max)', () => {
    expect(parseRunArgs(['--reasoning', 'xhigh', 'go'])).toEqual({
      model: { reasoning: { mode: 'effort', effort: 'xhigh' } },
      input: 'go',
    });
    expect(parseRunArgs(['--reasoning', 'off', 'go'])).toEqual({
      model: { reasoning: { mode: 'off' } },
      input: 'go',
    });
  });

  it('parses --reasoning budget:<tokens>', () => {
    expect(parseRunArgs(['--reasoning', 'budget:12000', 'go'])).toEqual({
      model: { reasoning: { mode: 'budget', budgetTokens: 12000 } },
      input: 'go',
    });
  });

  it('errors on an unknown --reasoning spec', () => {
    expect(parseRunArgs(['--reasoning', 'ludicrous', 'go'])).toEqual({
      error: expect.stringMatching(/reasoning/i),
    });
  });

  it('omits model entirely when no model flags are given', () => {
    expect(parseRunArgs(['just', 'a', 'prompt'])).toEqual({ input: 'just a prompt' });
  });
});

describe('renderPush — a CON-PUSH record → terminal lines', () => {
  const turn = (frame: Push extends { kind: 'turn' } ? never : unknown): Push =>
    ({ kind: 'turn', sessionId: 's', worktree: 'w', seq: 0, frame }) as Push;

  it('prints assistant text verbatim', () => {
    expect(renderPush(turn({ t: 'text', text: 'hello world' })).lines).toEqual(['hello world']);
  });

  it('renders a tool_use as an arrow with the tool name', () => {
    const out = renderPush(
      turn({ t: 'tool_use', tool: 'Read', input: { path: 'a.ts' }, handle: 'h' }),
    );
    expect(out.lines[0]).toContain('Read');
    expect(out.lines[0]).toMatch(/^→/u);
  });

  it('marks a failed tool_result distinctly from a successful one', () => {
    const ok = renderPush(turn({ t: 'tool_result', handle: 'h', ok: true, pointer: 'fine' }));
    const bad = renderPush(turn({ t: 'tool_result', handle: 'h', ok: false, pointer: 'boom' }));
    expect(ok.lines[0]).not.toEqual(bad.lines[0]);
  });

  it('flags an error frame with its origin and message', () => {
    const out = renderPush(turn({ t: 'error', message: 'kaboom', origin: 'loop' }));
    expect(out.lines[0]).toContain('kaboom');
  });

  it('renders a deny frame distinctly from an error, carrying its kind and reason', () => {
    const out = renderPush(turn({ t: 'deny', denyKind: 'cost-cap', reason: 'cost cap reached' }));
    expect(out.lines[0]).toContain('cost-cap');
    expect(out.lines[0]).toContain('cost cap reached');
    expect(out.lines[0]).not.toContain('✗');
  });

  it('renders a close-gate deny the same way', () => {
    const out = renderPush(turn({ t: 'deny', denyKind: 'close-gate', reason: 'open invariant' }));
    expect(out.lines[0]).toContain('close-gate');
    expect(out.lines[0]).toContain('open invariant');
  });

  it('marks a done status as the terminal, non-failed signal', () => {
    const out = renderPush({ kind: 'status', sessionId: 's', worktree: 'w', state: 'done' });
    expect(out.terminal).toBe('done');
  });

  it('marks an error status as the terminal, failed signal', () => {
    const out = renderPush({ kind: 'status', sessionId: 's', worktree: 'w', state: 'error' });
    expect(out.terminal).toBe('error');
  });

  it('prints a cost record', () => {
    const out = renderPush({
      kind: 'cost',
      sessionId: 's',
      spent: 0.25,
      remaining: 4,
      capHit: false,
    });
    expect(out.lines.join(' ')).toMatch(/0\.25/u);
  });

  it('emits no lines and no terminal for a running status (start is silent chrome)', () => {
    const out = renderPush({ kind: 'status', sessionId: 's', worktree: 'w', state: 'running' });
    expect(out.terminal).toBeUndefined();
  });

  it('marks an interrupted status as a terminal, non-error, clean stop (SC-1)', () => {
    const out = renderPush({ kind: 'status', sessionId: 's', worktree: 'w', state: 'interrupted' });
    expect(out.terminal).toBe('interrupted');
    expect(out.lines.join(' ')).toMatch(/interrupt/i);
    expect(out.lines.join(' ')).not.toContain('✗');
  });
});
