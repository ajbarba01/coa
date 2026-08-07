// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  foldToolFrames,
  nextBatchIndex,
  revealSuppressed,
  toolQuickInfo,
  Transcript,
  TranscriptRow,
  WorkingFooter,
  type TranscriptFrame,
} from './Transcript.js';
import { defaultReveal } from './reveal.js';

// jsdom has no real layout, so scrollIntoView is unimplemented — stub it so the
// pin/jump effects (which call it) don't throw, and so tests can assert it fired.
const scrollIntoViewSpy = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoViewSpy;
  scrollIntoViewSpy.mockClear();
});

describe('foldToolFrames', () => {
  it('merges a matched tool-use/tool-result pair into one tool frame with output+ok', () => {
    const frames: TranscriptFrame[] = [
      {
        id: 'u1',
        role: 'agent',
        kind: 'tool-use',
        tool: 'Read',
        input: '{"path":"a.ts"}',
        handle: 'h1',
      },
      {
        id: 'r1',
        role: 'agent',
        kind: 'tool-result',
        tool: 'Read',
        output: '42 lines',
        ok: true,
        handle: 'h1',
      },
    ];
    const folded = foldToolFrames(frames);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({
      id: 'u1',
      kind: 'tool',
      tool: 'Read',
      input: '{"path":"a.ts"}',
      output: '42 lines',
      ok: true,
    });
  });

  it('emits a pending tool frame (no output/ok) for an unmatched tool-use', () => {
    const frames: TranscriptFrame[] = [
      { id: 'u1', role: 'agent', kind: 'tool-use', tool: 'Bash', input: '{}', handle: 'h1' },
    ];
    const folded = foldToolFrames(frames);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ id: 'u1', kind: 'tool', tool: 'Bash' });
    expect((folded[0] as { output?: string }).output).toBeUndefined();
    expect((folded[0] as { ok?: boolean }).ok).toBeUndefined();
  });

  it('passes through an orphan tool-result unchanged', () => {
    const frames: TranscriptFrame[] = [
      {
        id: 'r1',
        role: 'agent',
        kind: 'tool-result',
        tool: 'Bash',
        output: 'boom',
        ok: false,
        handle: 'missing',
      },
    ];
    const folded = foldToolFrames(frames);
    expect(folded).toEqual(frames);
  });

  it('passes through non-tool kinds unchanged and in order', () => {
    const frames: TranscriptFrame[] = [
      { id: 't1', role: 'you', kind: 'text', text: 'hi' },
      { id: 'u1', role: 'agent', kind: 'tool-use', tool: 'Read', input: '{}', handle: 'h1' },
      { id: 't2', role: 'agent', kind: 'text', text: 'ok' },
      {
        id: 'r1',
        role: 'agent',
        kind: 'tool-result',
        tool: 'Read',
        output: 'x',
        ok: true,
        handle: 'h1',
      },
    ];
    const folded = foldToolFrames(frames);
    expect(folded.map((f) => f.id)).toEqual(['t1', 'u1', 't2']);
    expect(folded[0]?.kind).toBe('text');
    expect(folded[2]?.kind).toBe('text');
  });

  it('leaves raw frames untouched (raw mode stays verbatim)', () => {
    const frames: TranscriptFrame[] = [{ id: 'raw1', kind: 'raw', text: 'verbatim' }];
    expect(foldToolFrames(frames)).toEqual(frames);
  });

  it('leaves note frames untouched', () => {
    const frames: TranscriptFrame[] = [{ id: 'n1', kind: 'note', text: 'switched to Opus' }];
    expect(foldToolFrames(frames)).toEqual(frames);
  });

  it('reuses the same merged tool object across calls when the tool-use/result pair is unchanged (memo regression guard)', () => {
    const toolUse: TranscriptFrame = {
      id: 'u1',
      role: 'agent',
      kind: 'tool-use',
      tool: 'Read',
      input: '{"path":"a.ts"}',
      handle: 'h1',
    };
    const toolResult: TranscriptFrame = {
      id: 'r1',
      role: 'agent',
      kind: 'tool-result',
      tool: 'Read',
      output: '42 lines',
      ok: true,
      handle: 'h1',
    };
    const frames = [toolUse, toolResult];
    const first = foldToolFrames(frames);
    const second = foldToolFrames([toolUse, toolResult]);
    expect(second[0]).toBe(first[0]);

    // Changing the result (new object) must recompute — fresh identity.
    const toolResult2: TranscriptFrame = { ...toolResult, output: '43 lines' };
    const third = foldToolFrames([toolUse, toolResult2]);
    expect(third[0]).not.toBe(first[0]);
  });
});

describe('toolQuickInfo', () => {
  it('extracts file_path for Read/Write/Edit/NotebookEdit', () => {
    for (const tool of ['Read', 'Write', 'Edit', 'NotebookEdit']) {
      expect(toolQuickInfo(tool, '{"file_path":"src/auth.ts"}')).toBe('src/auth.ts');
    }
  });

  it('extracts path for Glob and pattern for Grep', () => {
    expect(toolQuickInfo('Glob', '{"path":"packages/core"}')).toBe('packages/core');
    expect(toolQuickInfo('Grep', '{"pattern":"foo.*bar"}')).toBe('foo.*bar');
  });

  it('returns undefined for an unknown tool', () => {
    expect(toolQuickInfo('Bash', '{"command":"ls"}')).toBeUndefined();
  });

  it('returns undefined for malformed JSON, never throws', () => {
    expect(() => toolQuickInfo('Read', 'not json')).not.toThrow();
    expect(toolQuickInfo('Read', 'not json')).toBeUndefined();
  });

  it('returns undefined when the known tool input has no recognizable path field', () => {
    expect(toolQuickInfo('Read', '{"foo":"bar"}')).toBeUndefined();
  });
});

describe('TranscriptRow', () => {
  it('renders a clean row — no status gutter dot or connector', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '1', role: 'agent', kind: 'text', text: 'hi' }} />,
    );
    expect(container.querySelector('[data-dot]')).toBeNull();
    expect(container.querySelector('[data-spine-line]')).toBeNull();
  });
  it('renders a text frame with its text', () => {
    render(<TranscriptRow frame={{ id: 't1', role: 'you', kind: 'text', text: 'do the thing' }} />);
    expect(screen.getByText('do the thing')).toBeTruthy();
  });

  it('renders a text frame as markdown (inline code becomes <code>)', () => {
    render(
      <TranscriptRow frame={{ id: '1', role: 'agent', kind: 'text', text: 'run `ls` now' }} />,
    );
    expect(screen.getByText('ls').tagName).toBe('CODE');
  });

  it('keeps agent prose clean — no message-level copy affordance (copy lives on code blocks)', () => {
    render(<TranscriptRow frame={{ id: 'a', role: 'agent', kind: 'text', text: 'plain reply' }} />);
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('omits the copy action on a user text turn', () => {
    render(<TranscriptRow frame={{ id: 'u', role: 'you', kind: 'text', text: 'hi' }} />);
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('renders a user turn as a flush distinct block without a role label', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '1', role: 'you', kind: 'text', text: 'hi' }} />,
    );
    expect(screen.queryByText(/^you$/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-role="you"]')).not.toBeNull();
  });

  it('marks a pending row so an unsent steer never reads as part of the record', () => {
    const { container } = render(
      <TranscriptRow
        frame={{
          id: 'pending:0',
          role: 'you',
          kind: 'text',
          text: 'use the JSON one',
          pending: true,
        }}
      />,
    );
    expect(container.textContent).toContain('use the JSON one');
    expect(container.querySelector('[data-pending="true"]')).not.toBeNull();
  });

  it('renders an agent turn flush with no role label', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '2', role: 'agent', kind: 'text', text: 'sure' }} />,
    );
    expect(screen.queryByText(/^agent$/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-role="agent"]')).not.toBeNull();
  });

  it('de-indents an agent text row flush with no per-row border', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '2', role: 'agent', kind: 'text', text: 'sure' }} />,
    );
    const roleEl = container.querySelector('[data-role="agent"]');
    expect(roleEl?.className).not.toMatch(/border-l|border-dotted|ml-2|ml-4/);
  });

  // The tool branches now render the shared kit ToolCard (its own suite owns the rich-body
  // detail); these assert the wiring — verb, path/target, output body, pending, ok tone.
  it('renders a tool-use frame with its verb', () => {
    const input = '{\n  "path": "src/auth.ts"\n}';
    render(
      <TranscriptRow
        frame={{ id: 't2', role: 'agent', kind: 'tool-use', tool: 'read_file', input }}
      />,
    );
    expect(screen.getByText('read_file')).toBeInTheDocument();
  });

  it('renders a standalone tool-result frame with its output body', () => {
    render(
      <TranscriptRow
        frame={{
          id: 't3',
          role: 'agent',
          kind: 'tool-result',
          tool: 'read_file',
          output: '42 lines',
          ok: true,
        }}
      />,
    );
    expect(screen.getByText(/42 lines/)).toBeInTheDocument();
  });

  it('renders a merged tool frame with its verb and clickable path target', () => {
    const onOpenPath = vi.fn();
    render(
      <TranscriptRow
        frame={{
          id: 'm1',
          role: 'agent',
          kind: 'tool',
          tool: 'Read',
          input: '{"file_path":"src/auth.ts"}',
          output: '42 lines',
          ok: true,
        }}
        onOpenPath={onOpenPath}
      />,
    );
    expect(screen.getByText('Read')).toBeInTheDocument();
    const link = screen.getByRole('button', { name: 'src/auth.ts' });
    fireEvent.click(link);
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts', undefined);
  });

  it('threads a Read offset into the reveal line', () => {
    const onOpenPath = vi.fn();
    render(
      <TranscriptRow
        frame={{
          id: 'm1b',
          role: 'agent',
          kind: 'tool',
          tool: 'Read',
          input: '{"file_path":"src/auth.ts","offset":42}',
          output: 'x',
          ok: true,
        }}
        onOpenPath={onOpenPath}
      />,
    );
    // The `:line` tail is a separate low-emphasis span, so the computed accessible name
    // joins it with a space even though the two sit flush together visually.
    fireEvent.click(screen.getByRole('button', { name: /^src\/auth\.ts\s*:42$/ }));
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts', 42);
  });

  it('renders a merged tool frame with output as an output body', () => {
    render(
      <TranscriptRow
        frame={{
          id: 'm3',
          role: 'agent',
          kind: 'tool',
          tool: 'Bash',
          input: '{"command":"ls"}',
          output: '42 lines',
          ok: true,
        }}
      />,
    );
    expect(screen.getByText('42 lines')).toBeInTheDocument();
  });

  it('renders a merged tool frame with no output as a pending call', () => {
    const { container } = render(
      <TranscriptRow
        frame={{ id: 'm4', role: 'agent', kind: 'tool', tool: 'Bash', input: '{"command":"ls"}' }}
      />,
    );
    // Running earns the blue dot and no body (the dot is the only live emphasis).
    expect(container.querySelector('[aria-label="running" i]')).toBeInTheDocument();
  });

  it('indents a nested subagent frame with a left hairline rail (per row, since rows render independently)', () => {
    const { container } = render(
      <TranscriptRow
        frame={{ id: 't4', role: 'subagent', kind: 'text', text: 'reviewing', depth: 1 }}
      />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.paddingLeft).not.toBe('');
    expect(row.className).toMatch(/border-l/);
    expect(row.className).toMatch(/border-s3/);
  });

  it('renders a subagent rollup as an unboxed receipt: name, cost stats, status', () => {
    render(
      <TranscriptRow
        frame={{
          id: '1',
          kind: 'subagent',
          childWorktree: 'nested/worktrees/wt',
          event: 'rollup',
          rollup: { tools: 3, tokens: 1234, cost: 0.25, status: 'done' },
        }}
      />,
    );
    // The display name is the tail segment of the worktree path.
    expect(screen.getByText('wt')).toBeInTheDocument();
    // Stats join into one meta line: "3 tools · 1.2k tok · $0.25" — compact `1.2k`-style
    // token formatting.
    expect(screen.getByText(/3 tools · 1\.2k tok · \$0\.25/)).toBeInTheDocument();
  });

  it('shows the running dot for a live "running" subagent event', () => {
    const { container } = render(
      <TranscriptRow
        frame={{ id: '2', kind: 'subagent', childWorktree: 'wt', event: 'running' }}
      />,
    );
    expect(container.querySelector('.bg-run')).not.toBeNull();
    expect(screen.getByText(/^running$/i)).toBeInTheDocument();
  });

  it('shows the critical dot for a failed subagent rollup', () => {
    const { container } = render(
      <TranscriptRow
        frame={{
          id: '3',
          kind: 'subagent',
          childWorktree: 'wt',
          event: 'rollup',
          rollup: { status: 'failed' },
        }}
      />,
    );
    expect(container.querySelector('.bg-crit')).not.toBeNull();
    expect(container.querySelector('.bg-ok')).toBeNull();
  });

  it('reveals watch/stop actions on hover for a running subagent, not for a settled one', () => {
    const { rerender } = render(
      <TranscriptRow
        frame={{ id: '4', kind: 'subagent', childWorktree: 'wt', event: 'running' }}
      />,
    );
    expect(screen.getByRole('button', { name: /watch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();

    rerender(
      <TranscriptRow frame={{ id: '4', kind: 'subagent', childWorktree: 'wt', event: 'idle' }} />,
    );
    expect(screen.queryByRole('button', { name: /watch/i })).toBeNull();
  });

  it('shows a resolved approval as an unboxed one-line receipt without live buttons', () => {
    const { container } = render(
      <TranscriptRow
        frame={{
          id: 't6',
          kind: 'approval',
          requestId: 'r2',
          tool: 'write_file',
          summary: 's',
          resolved: 'approved',
        }}
      />,
    );
    expect(screen.getByText(/approved/i)).toBeTruthy();
    expect(screen.getByText('write_file')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    // An answered question earns no card.
    expect(container.querySelector('.rounded-surface')).toBeNull();
  });

  it('marks a denied resolved approval with the dash glyph, not the checkmark', () => {
    render(
      <TranscriptRow
        frame={{
          id: 't6b',
          kind: 'approval',
          requestId: 'r3',
          tool: 'write_file',
          summary: 's',
          resolved: 'denied',
        }}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/denied/i)).toBeInTheDocument();
  });

  it('renders nothing for a pending (unresolved) approval — the composer docks it instead', () => {
    const { container } = render(
      <TranscriptRow
        frame={{ id: 't6c', kind: 'approval', requestId: 'r4', tool: 'write_file', summary: 's' }}
        onRespond={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /deny/i })).toBeNull();
  });

  it('renders a deny frame through the SC-1 DenyNotice (it gates nothing)', () => {
    const { container } = render(
      <TranscriptRow
        frame={{ id: 't7', kind: 'deny', denyKind: 'cost-cap', reason: 'cap reached' }}
      />,
    );
    expect(container.querySelector('[data-deny-kind="cost-cap"]')).not.toBeNull();
    expect(screen.getByText('cap reached')).toBeTruthy();
  });

  it('renders a raw frame verbatim, plain mono with no chrome — D85, the mask comes off', () => {
    const text = '> assistant: hello\n> tool_use read_file {"path":"a"}';
    const { container } = render(<TranscriptRow frame={{ id: 't8', kind: 'raw', text }} />);
    expect(container.textContent).toBe(text);
    const el = container.querySelector('.whitespace-pre-wrap');
    expect(el?.className).toMatch(/font-mono/);
  });

  it('never animates a raw row (D85 — the loop is byte-faithful, not styled)', () => {
    const text = 'verbatim';
    render(<TranscriptRow frame={{ id: 't8b', kind: 'raw', text }} />);
    const el = screen.getByText(text);
    expect(el.className).not.toMatch(/slip-enter|cx-word|cx-block-enter/);
    expect(revealSuppressed({ id: 't8b', kind: 'raw', text })).toBe(true);
  });

  it('renders a settled thinking frame as "Thought" (not "Thinking"), collapsed by default', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '1', role: 'agent', kind: 'thinking', text: 'considering' }} />,
    );
    // A SETTLED block reads past-tense "Thought" — reload has no live stream, so it must not
    // fall back to the present-tense "Thinking" (the reported live-vs-reload mismatch).
    expect(screen.getByRole('button', { name: /thought/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText(/^thinking/i)).toBeNull();
    const collapse = container.querySelector('.cx-collapse');
    expect(collapse?.getAttribute('data-open')).toBe('false');
    expect(collapse?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders "Thought for Ns" from the persisted durationMs (identical live and on reload)', () => {
    render(
      <TranscriptRow
        frame={{ id: '1', role: 'agent', kind: 'thinking', text: 'considering', durationMs: 4200 }}
      />,
    );
    expect(screen.getByRole('button', { name: /thought for 4s/i })).toBeInTheDocument();
  });

  it('shows a derived token estimate in the reasoning title', () => {
    // ~4 chars/token: a 40-char reasoning trace → ~10 tokens, derived from text (no persistence).
    render(
      <TranscriptRow
        frame={{ id: '1', role: 'agent', kind: 'thinking', text: 'x'.repeat(40), durationMs: 1000 }}
      />,
    );
    expect(screen.getByRole('button', { name: /10 toks/i })).toBeInTheDocument();
  });

  it('shows a present-tense "Thinking" only while the block is still streaming', () => {
    render(
      <TranscriptRow
        frame={{ id: '1', role: 'agent', kind: 'thinking', text: 'considering', streaming: true }}
      />,
    );
    expect(screen.getByRole('button', { name: /thinking/i })).toBeInTheDocument();
    expect(screen.queryByText(/thought/i)).toBeNull();
  });

  it('expands a thinking frame on click to reveal the full text', async () => {
    render(
      <TranscriptRow frame={{ id: '1', role: 'agent', kind: 'thinking', text: 'considering' }} />,
    );
    const toggle = screen.getByRole('button', { name: /thought/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('considering')).toBeInTheDocument();
  });

  it('does not render an expandable thinking block when the text is empty', () => {
    render(<TranscriptRow frame={{ id: 't', role: 'agent', kind: 'thinking', text: '   ' }} />);
    expect(screen.queryByRole('button', { name: /thought|thinking/i })).toBeNull();
  });

  it('tints the reasoning toggle on hover', () => {
    render(
      <TranscriptRow
        frame={{ id: 't', role: 'agent', kind: 'thinking', text: 'reasoning', streaming: true }}
      />,
    );
    expect(screen.getByRole('button', { name: /thinking/i }).className).toContain('hover:text-s10');
  });

  it('renders an error as one information line — a mark, the message, no origin chip by default', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '2', role: 'agent', kind: 'error', message: 'it broke' }} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('it broke');
    expect(container.querySelector('[data-origin-chip]')).toBeNull();
  });

  it('renders the origin chip only when origin is present', () => {
    render(
      <TranscriptRow
        frame={{ id: '2b', role: 'agent', kind: 'error', message: 'it broke', origin: 'tool' }}
      />,
    );
    expect(screen.getByText('tool')).toBeInTheDocument();
  });

  it('renders a plan frame as an unboxed checklist with a done/total header', () => {
    const { container } = render(
      <TranscriptRow
        frame={{
          id: '1',
          role: 'agent',
          kind: 'plan',
          items: [
            { text: 'done thing', status: 'done' },
            { text: 'active thing', status: 'in-progress' },
            { text: 'later thing', status: 'pending' },
          ],
        }}
      />,
    );
    expect(screen.getByText('done thing')).toBeInTheDocument();
    expect(screen.getByText('active thing')).toBeInTheDocument();
    expect(screen.getByText('later thing')).toBeInTheDocument();
    // "plan" + "· 1/3" — working memory, not a boxed unit of output.
    expect(screen.getByText(/plan/i)).toBeInTheDocument();
    expect(screen.getByText(/1\/3/)).toBeInTheDocument();
    expect(container.querySelector('.rounded-surface, .bg-subtle')).toBeNull();
  });

  it("exposes each plan item's status to the a11y tree without visible clutter", () => {
    render(
      <TranscriptRow
        frame={{
          id: '1',
          role: 'agent',
          kind: 'plan',
          items: [
            { text: 'done thing', status: 'done' },
            { text: 'active thing', status: 'in-progress' },
            { text: 'later thing', status: 'pending' },
          ],
        }}
      />,
    );
    const statuses = Array.from(document.querySelectorAll('.sr-only')).map((n) => n.textContent);
    expect(statuses).toEqual(['Done', 'In progress', 'Pending']);
  });

  it('makes the in-progress plan item the only element carrying the run/blue token; done is never struck through', () => {
    const { container } = render(
      <TranscriptRow
        frame={{
          id: '1',
          role: 'agent',
          kind: 'plan',
          items: [
            { text: 'done thing', status: 'done' },
            { text: 'active thing', status: 'in-progress' },
            { text: 'later thing', status: 'pending' },
          ],
        }}
      />,
    );
    // Only the in-progress glyph carries the run/blue token — item text is toned by
    // weight (text-s12), not color, so blue never doubles up.
    const runEls = container.querySelectorAll('.text-run');
    expect(runEls).toHaveLength(1);
    expect(screen.getByText('done thing').className).not.toContain('line-through');
  });

  it("renders a user turn as plain text, never markdown-interpreted (D85 — the mask stays off the user's own words)", () => {
    render(<TranscriptRow frame={{ id: 'u1', role: 'you', kind: 'text', text: 'run `ls` now' }} />);
    // The literal backtick survives — no <code> element is produced for a user turn.
    expect(screen.getByText('run `ls` now')).toBeInTheDocument();
    expect(screen.queryByText('ls')).toBeNull();
  });

  it('renders a user turn as a right-aligned bubble with the sand-scale surface and an asymmetric corner', () => {
    render(<TranscriptRow frame={{ id: 'u', role: 'you', kind: 'text', text: 'hello' }} />);
    const block = screen.getByText('hello').closest('[data-role="you"]');
    expect(block?.className).toContain('bg-s3');
    expect(block?.className).toContain('ml-auto');
    expect(block?.className).toContain('rounded-[6px_6px_2px_6px]');
    expect(block?.className).not.toMatch(/bg-raised|border-hairline|rounded-surface/);
  });

  it('renders a centered system note', () => {
    render(
      <TranscriptRow frame={{ id: 'n', kind: 'note', text: 'switched to Opus 4.8 · high' }} />,
    );
    expect(screen.getByText(/switched to Opus/)).toBeInTheDocument();
  });
});

describe('Transcript container', () => {
  const frames: TranscriptFrame[] = [{ id: 'a', role: 'you', kind: 'text', text: 'hi' }];

  it('is a labelled log region', () => {
    render(<Transcript frames={frames} label="Conversation" />);
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeTruthy();
  });

  it('renders nothing structural for an empty stream (the panel owns EmptyState)', () => {
    const { container } = render(<Transcript frames={[]} />);
    expect(container.querySelector('[role="log"]')).toBeNull();
  });

  it('renders every frame to the DOM (non-virtualized)', () => {
    const frames: TranscriptFrame[] = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      role: 'agent' as const,
      kind: 'text' as const,
      text: `line ${i}`,
    }));
    render(<Transcript frames={frames} />);
    // Every line is present — including ones far off-screen (would be absent if windowed).
    expect(screen.getByText('line 0')).toBeInTheDocument();
    expect(screen.getByText('line 59')).toBeInTheDocument();
  });

  it('shows a jump-to-latest control when scrolled away from the bottom', () => {
    const frames = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      role: 'agent' as const,
      kind: 'text' as const,
      text: `m${i}`,
    }));
    render(<Transcript frames={frames} showJumpToLatest />);
    expect(screen.getByRole('button', { name: /latest/i })).toBeInTheDocument();
  });

  it('styles the jump-to-latest control as the sand raised pill', () => {
    const frames = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      role: 'agent' as const,
      kind: 'text' as const,
      text: `m${i}`,
    }));
    render(<Transcript frames={frames} showJumpToLatest />);
    const btn = screen.getByRole('button', { name: /latest/i });
    expect(btn.className).toMatch(/bg-s3/);
    expect(btn.className).toMatch(/border-s5/);
  });

  it('toggles the transcript measure between the whole panel and a reading width', async () => {
    const { container } = render(<Transcript frames={frames} />);
    const col = container.querySelector('[role="log"] > div');
    // Wide by default — the column fills the panel (no reading cap).
    expect(col?.className ?? '').not.toMatch(/max-w-180/);
    await userEvent.click(screen.getByRole('button', { name: /narrow transcript/i }));
    expect(col?.className ?? '').toMatch(/mx-auto max-w-180/);
    // The control now offers to widen again.
    expect(screen.getByRole('button', { name: /widen transcript/i })).toBeInTheDocument();
  });

  it('renders the working footer while busy', () => {
    render(<Transcript frames={frames} busy />);
    expect(screen.getByText(/^working$/i)).toBeInTheDocument();
  });

  it('renders no footer when not busy', () => {
    render(<Transcript frames={frames} />);
    expect(screen.queryByText('working')).not.toBeInTheDocument();
  });

  it('re-pins to bottom when jumpNonce changes', () => {
    const { rerender } = render(<Transcript frames={frames} jumpNonce={0} showJumpToLatest />);
    // showJumpToLatest forces the button on; after a jumpNonce bump the component pins.
    scrollIntoViewSpy.mockClear();
    rerender(<Transcript frames={frames} jumpNonce={1} />);
    // Not directly observable in jsdom; assert the sentinel scrollIntoView was called.
    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });
});

describe('Transcript stick-to-bottom', () => {
  const frames: TranscriptFrame[] = [
    { id: 'a', role: 'agent', kind: 'text', text: 'one' },
    { id: 'b', role: 'agent', kind: 'text', text: 'two' },
  ];

  it('re-pins with a direct scrollTop write when the content resizes (streamed growth)', () => {
    let fire: (() => void) | undefined;
    class MockRO {
      private readonly cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        fire = (): void => this.cb();
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', MockRO);
    try {
      render(<Transcript frames={frames} />);
      const scroller = screen.getByRole('log');
      Object.defineProperty(scroller, 'scrollHeight', { value: 3000, configurable: true });
      act(() => fire?.());
      expect(scroller.scrollTop).toBe(3000);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Transcript keep-alive (active prop)', () => {
  const frames: TranscriptFrame[] = [
    { id: 'a', role: 'agent', kind: 'text', text: 'Hello World' },
    { id: 'b', role: 'agent', kind: 'text', text: 'two' },
  ];

  it('an inactive (hidden-tab) transcript ignores Ctrl+F', () => {
    render(<Transcript frames={frames} active={false} />);
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(screen.queryByRole('search', { name: /find/i })).not.toBeInTheDocument();
  });

  it('does NOT re-pin on mount just because a jumpNonce value exists', () => {
    // Seed memory: the reader had scrolled up (not pinned) in this session.
    const { unmount } = render(<Transcript frames={frames} scrollKey="keep-1" />);
    const scroller = screen.getByRole('log');
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    unmount();

    scrollIntoViewSpy.mockClear();
    // Remount with a standing sendNonce (always a number in the app) — the
    // restored offset must win; only a CHANGE of nonce re-pins.
    render(<Transcript frames={frames} scrollKey="keep-1" jumpNonce={5} />);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('log').scrollTop).toBe(100);
  });

  it('restores the remembered place when reactivated after being hidden', () => {
    const { rerender } = render(<Transcript frames={frames} scrollKey="keep-2" active />);
    const scroller = screen.getByRole('log');
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    scroller.scrollTop = 300;
    fireEvent.scroll(scroller);

    rerender(<Transcript frames={frames} scrollKey="keep-2" active={false} />);
    // display:none wipes the live scroll position
    scroller.scrollTop = 0;
    rerender(<Transcript frames={frames} scrollKey="keep-2" active />);
    expect(scroller.scrollTop).toBe(300);
  });
});

describe('Transcript scroll memory', () => {
  const frames: TranscriptFrame[] = [
    { id: 'a', role: 'agent', kind: 'text', text: 'one' },
    { id: 'b', role: 'agent', kind: 'text', text: 'two' },
  ];

  const fakeGeometry = (el: HTMLElement): void => {
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true });
  };

  it('restores the remembered scroll position for the same scrollKey', () => {
    const { unmount } = render(<Transcript frames={frames} scrollKey="mem-1" />);
    const scroller = screen.getByRole('log');
    fakeGeometry(scroller);
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    unmount();

    render(<Transcript frames={frames} scrollKey="mem-1" />);
    const again = screen.getByRole('log');
    expect(again.scrollTop).toBe(100);
  });

  it('a session left pinned to bottom re-pins on return instead of restoring a stale offset', () => {
    const { unmount } = render(<Transcript frames={frames} scrollKey="mem-2" />);
    const scroller = screen.getByRole('log');
    fakeGeometry(scroller);
    scroller.scrollTop = 1500; // 2000 - (1500 + 500) = 0 → near bottom
    fireEvent.scroll(scroller);
    unmount();

    scrollIntoViewSpy.mockClear();
    render(<Transcript frames={frames} scrollKey="mem-2" />);
    // pinned memory → the stick-to-bottom sentinel scroll fires, not a scrollTop restore
    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });
});

describe('Transcript find-in-conversation', () => {
  const frames: TranscriptFrame[] = [
    { id: 'a', role: 'agent', kind: 'text', text: 'Hello World' },
    { id: 'b', role: 'agent', kind: 'text', text: 'nothing here' },
    { id: 'c', role: 'you', kind: 'text', text: 'say hello again' },
  ];

  it('opens the find bar on Ctrl+F and closes it on Escape', () => {
    render(<Transcript frames={frames} />);
    expect(screen.queryByRole('search', { name: /find/i })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(screen.getByRole('search', { name: /find/i })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('search', { name: /find/i })).not.toBeInTheDocument();
  });

  it('opens the find bar on Cmd+F (metaKey)', () => {
    render(<Transcript frames={frames} />);
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(screen.getByRole('search', { name: /find/i })).toBeInTheDocument();
  });

  it('Ctrl+F toggles — a second press closes the find bar', () => {
    render(<Transcript frames={frames} />);
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(screen.getByRole('search', { name: /find/i })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(screen.queryByRole('search', { name: /find/i })).not.toBeInTheDocument();
  });

  it('closes the find bar via its own close button', async () => {
    render(<Transcript frames={frames} />);
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    await userEvent.click(screen.getByRole('button', { name: /close find/i }));
    expect(screen.queryByRole('search', { name: /find/i })).not.toBeInTheDocument();
  });

  it('typing a query updates the match count', async () => {
    render(<Transcript frames={frames} />);
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    await userEvent.type(screen.getByRole('textbox', { name: /find/i }), 'hello');
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('prev/next scroll through matches', async () => {
    render(<Transcript frames={frames} />);
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    await userEvent.type(screen.getByRole('textbox', { name: /find/i }), 'hello');
    scrollIntoViewSpy.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /next match/i }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(scrollIntoViewSpy).toHaveBeenCalled();
    scrollIntoViewSpy.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /previous match/i }));
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });

  it('marks the active match row with data-find-active', async () => {
    const { container } = render(<Transcript frames={frames} />);
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    await userEvent.type(screen.getByRole('textbox', { name: /find/i }), 'hello');
    expect(container.querySelector('[data-find-active="true"]')).not.toBeNull();
  });

  it('wears a quiet amber wash on the active match, not a ring (a highlight, not a focus/error affordance)', async () => {
    const { container } = render(<Transcript frames={frames} />);
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    await userEvent.type(screen.getByRole('textbox', { name: /find/i }), 'hello');
    const active = container.querySelector('[data-find-active="true"]');
    expect(active?.className).toMatch(/bg-warn\/8/);
    expect(active?.className).not.toMatch(/ring-info|bg-info-tint|rounded-surface/);
  });
});

describe('WorkingFooter', () => {
  it('renders a pulsing running dot and the working label, announced as a live status', () => {
    const { container } = render(<WorkingFooter />);
    expect(screen.getByText(/^working$/i)).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(container.querySelector('.motion-safe\\:animate-pulse')).not.toBeNull();
  });

  it('renders the working label in the meta/mono status tone (not the legacy body/muted pair)', () => {
    render(<WorkingFooter busySince={Date.now()} />);
    const status = screen.getByRole('status');
    expect(status.className).toContain('text-meta');
    expect(status.className).toContain('font-mono');
    expect(status.className).not.toMatch(/text-body|text-muted/);
  });

  it('shows no elapsed counter without a busySince', () => {
    render(<WorkingFooter />);
    expect(screen.queryByText(/\ds/)).not.toBeInTheDocument();
  });

  it('shows a live elapsed counter that ticks once a second, cleaned up on unmount', () => {
    vi.useFakeTimers();
    try {
      const since = Date.now();
      const { unmount } = render(<WorkingFooter busySince={since} />);
      expect(screen.getByText(/^working$/i)).toBeInTheDocument();
      expect(screen.getByText('0s')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('1s')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByText('3s')).toBeInTheDocument();

      unmount();
      // No interval firing after unmount should throw or leave a dangling timer;
      // advancing further is a no-op check that nothing errors post-unmount.
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Transcript container motion (block entrance)', () => {
  it('gives a live-arriving row the shared kit .cx-block-enter entrance (not a bespoke WAAPI call)', () => {
    const frames: TranscriptFrame[] = [
      { id: 'a', role: 'agent', kind: 'tool', tool: 'Bash', input: '{}', ok: true },
    ];
    const { rerender, container } = render(<Transcript frames={frames} />);
    // History mounted on open never animates.
    expect(container.querySelector('[data-row-index="0"]')?.className ?? '').not.toMatch(
      /cx-block-enter/,
    );

    const frames2: TranscriptFrame[] = [
      ...frames,
      { id: 'b', role: 'agent', kind: 'tool', tool: 'Bash', input: '{}', ok: true },
    ];
    rerender(<Transcript frames={frames2} />);
    const liveRow = container.querySelector('[data-row-index="1"]');
    expect(liveRow?.className).toMatch(/cx-block-enter/);
    expect(liveRow?.getAttribute('data-enter')).toBe('fadeRise');
  });

  it('never gives a live raw row the block entrance (D85 — the loop is byte-faithful, never styled)', () => {
    const frames: TranscriptFrame[] = [{ id: 'a', role: 'agent', kind: 'text', text: 'hi' }];
    const { rerender, container } = render(<Transcript frames={frames} />);
    const frames2: TranscriptFrame[] = [...frames, { id: 'raw1', kind: 'raw', text: 'verbatim' }];
    rerender(<Transcript frames={frames2} />);
    const rawRow = container.querySelector('[data-row-index="1"]');
    expect(rawRow?.className ?? '').not.toMatch(/cx-block-enter|slip-enter/);
  });
});

describe('revealSuppressed', () => {
  it('suppresses the block entrance for agent text/thinking (the per-word reveal channel) and raw', () => {
    expect(
      revealSuppressed({ id: '1', role: 'agent', kind: 'text', text: 'x' } as TranscriptFrame),
    ).toBe(true);
    expect(
      revealSuppressed({
        id: '2',
        role: 'subagent',
        kind: 'thinking',
        text: 'x',
      } as TranscriptFrame),
    ).toBe(true);
    expect(revealSuppressed({ id: '3', kind: 'raw', text: 'x' } as TranscriptFrame)).toBe(true);
  });
  it('does not suppress the entrance for a user turn or a tool card', () => {
    expect(
      revealSuppressed({ id: '4', role: 'you', kind: 'text', text: 'x' } as TranscriptFrame),
    ).toBe(false);
    expect(
      revealSuppressed({
        id: '5',
        role: 'agent',
        kind: 'tool',
        tool: 'Edit',
        input: '',
      } as TranscriptFrame),
    ).toBe(false);
  });
});

describe('nextBatchIndex', () => {
  it('hands out incrementing indices within one synchronous burst', () => {
    const a = nextBatchIndex();
    const b = nextBatchIndex();
    const c = nextBatchIndex();
    expect(b).toBe(a + 1);
    expect(c).toBe(a + 2);
  });
});

describe('ThinkingCard reasoning modes', () => {
  it('auto-expand (the design default): streaming renders expanded under the live "thinking" label', () => {
    const frame = {
      id: 't',
      role: 'agent',
      kind: 'thinking',
      text: 'reasoning…',
      streaming: true,
    } as const;
    const { container } = render(<TranscriptRow frame={frame} />);
    expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('true');
    expect(screen.getByRole('button', { name: /thinking/i })).toBeInTheDocument();
  });

  it('auto-expand: on settle the body melts closed and the resting line reads "thought for Ns"', () => {
    vi.useFakeTimers();
    try {
      const frame = {
        id: 't',
        role: 'agent',
        kind: 'thinking',
        text: 'reasoning…',
        streaming: true,
      } as const;
      const { rerender, container } = render(<TranscriptRow frame={frame} />);
      expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('true');

      // stream ends: the settled frame carries the daemon-stamped duration (2.3s); after the
      // hold, the body melts closed and the label reads it from the frame, not a live clock.
      rerender(<TranscriptRow frame={{ ...frame, streaming: false, durationMs: 2300 }} />);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('false');
      expect(screen.getByRole('button', { name: /thought for 2s/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-expand: a user click always wins, re-expanding the melted-closed body', () => {
    vi.useFakeTimers();
    try {
      const frame = {
        id: 't',
        role: 'agent',
        kind: 'thinking',
        text: 'reasoning…',
        streaming: true,
      } as const;
      const { rerender, container } = render(<TranscriptRow frame={frame} />);
      rerender(<TranscriptRow frame={{ ...frame, streaming: false, durationMs: 2300 }} />);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('false');

      fireEvent.click(screen.getByRole('button', { name: /thought for 2s/i }));
      expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the shimmer mode reachable via the config seam (no auto-expand; the collapsed label shimmers)', () => {
    defaultReveal.reasoning.mode = 'shimmer';
    try {
      const frame = {
        id: 't',
        role: 'agent',
        kind: 'thinking',
        text: 'reasoning…',
        streaming: true,
      } as const;
      const { rerender, container } = render(<TranscriptRow frame={frame} />);
      // shimmer: collapsed while thinking (no auto-expand), the label shimmers
      expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('false');
      expect(container.querySelector('.cx-shimmer')).not.toBeNull();

      rerender(<TranscriptRow frame={{ ...frame, streaming: false, durationMs: 2300 }} />);
      expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('false');
      expect(container.querySelector('.cx-shimmer')).toBeNull();
      expect(container.textContent).toMatch(/thought for 2s/i);
    } finally {
      defaultReveal.reasoning.mode = 'auto-expand';
    }
  });

  it('starts collapsed for a settled (non-streaming) reasoning frame', () => {
    const frame = { id: 't2', role: 'agent', kind: 'thinking', text: 'done reasoning' } as const;
    const { container } = render(<TranscriptRow frame={frame} />);
    expect(container.querySelector('.cx-collapse')?.getAttribute('data-open')).toBe('false');
  });
});

describe('TranscriptRow streaming reveal', () => {
  it('reveals a streaming agent text frame as whole markdown blocks (not per-word)', () => {
    const frame = {
      id: 'a',
      role: 'agent',
      kind: 'text',
      text: 'para one\n\npara two',
      streaming: true,
    } as const;
    const { container } = render(<TranscriptRow frame={frame} />);
    // output never streams per-word: a completed block appears whole + formatted, the still-forming
    // trailing block is held until it completes
    expect(container.querySelectorAll('span.cx-word').length).toBe(0);
    expect(container.querySelector('.cx-block-enter p')?.textContent).toBe('para one');
  });

  it('renders a settled agent text frame as plain markdown (no reveal spans)', () => {
    const frame = { id: 'a', role: 'agent', kind: 'text', text: 'hello world' } as const;
    const { container } = render(<TranscriptRow frame={frame} />);
    expect(container.querySelectorAll('span.cx-word').length).toBe(0);
  });

  it('reveals streaming reasoning per word (mounted in the reveal body)', () => {
    const frame = {
      id: 't',
      role: 'agent',
      kind: 'thinking',
      text: 'weighing options',
      streaming: true,
    } as const;
    const { container } = render(<TranscriptRow frame={frame} />);
    // auto-expand: the body is open while streaming, and the per-word reasoning is mounted in it
    expect(container.querySelectorAll('span.cx-word').length).toBe(2);
  });
});
