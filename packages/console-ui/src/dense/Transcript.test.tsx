// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dotTone,
  foldToolFrames,
  toolQuickInfo,
  Transcript,
  TranscriptRow,
  WorkingFooter,
  type TranscriptFrame,
} from './Transcript.js';

// jsdom has no real layout, so scrollIntoView is unimplemented — stub it so the
// pin/jump effects (which call it) don't throw, and so tests can assert it fired.
const scrollIntoViewSpy = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoViewSpy;
  scrollIntoViewSpy.mockClear();
});

describe('dotTone', () => {
  it('tones the status dot by outcome', () => {
    expect(
      dotTone({ id: '1', role: 'agent', kind: 'tool-result', tool: 'x', output: 'ok', ok: true }),
    ).toBe('success');
    expect(
      dotTone({ id: '2', role: 'agent', kind: 'tool-result', tool: 'x', output: 'e', ok: false }),
    ).toBe('danger');
    expect(dotTone({ id: '3', role: 'agent', kind: 'error', message: 'boom' })).toBe('danger');
    expect(dotTone({ id: '4', role: 'agent', kind: 'text', text: 'hi' })).toBe('neutral');
  });

  it('tones a merged tool frame by its ok flag, pending is neutral', () => {
    expect(
      dotTone({ id: '5', role: 'agent', kind: 'tool', tool: 'Read', input: '{}', ok: true }),
    ).toBe('success');
    expect(
      dotTone({ id: '6', role: 'agent', kind: 'tool', tool: 'Read', input: '{}', ok: false }),
    ).toBe('danger');
    expect(dotTone({ id: '7', role: 'agent', kind: 'tool', tool: 'Read', input: '{}' })).toBe(
      'neutral',
    );
  });
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
  it('renders a status dot at the start of a row', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '1', role: 'agent', kind: 'text', text: 'hi' }} />,
    );
    expect(container.querySelector('[data-dot]')).not.toBeNull();
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

  it('offers a copy action on an assistant text turn', () => {
    render(<TranscriptRow frame={{ id: 'a', role: 'agent', kind: 'text', text: '# hi' }} />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
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

  it('renders an agent turn under the gutter spine, no role label', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '2', role: 'agent', kind: 'text', text: 'sure' }} />,
    );
    expect(screen.queryByText(/^agent$/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-role="agent"][data-spine="true"]')).not.toBeNull();
  });

  it('renders the gutter spine line for an agent row', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '2', role: 'agent', kind: 'text', text: 'sure' }} />,
    );
    expect(container.querySelector('[data-spine-line]')).not.toBeNull();
  });

  it('omits the gutter spine line for a user row', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '1', role: 'you', kind: 'text', text: 'hi' }} />,
    );
    expect(container.querySelector('[data-spine-line]')).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'src/auth.ts:42' }));
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
    render(
      <TranscriptRow
        frame={{ id: 'm4', role: 'agent', kind: 'tool', tool: 'Bash', input: '{"command":"ls"}' }}
      />,
    );
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('tones the gutter dot danger for a failed tool-result', () => {
    const { container } = render(
      <TranscriptRow
        frame={{
          id: '2',
          role: 'agent',
          kind: 'tool-result',
          tool: 'Bash',
          output: 'boom',
          ok: false,
        }}
      />,
    );
    expect(container.querySelector('[data-dot]')?.className).toMatch(/bg-danger/);
  });

  it('indents a nested subagent frame', () => {
    const { container } = render(
      <TranscriptRow
        frame={{ id: 't4', role: 'subagent', kind: 'text', text: 'reviewing', depth: 1 }}
      />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.marginLeft).not.toBe('');
  });

  it('renders a subagent rollup chip with its stats', () => {
    render(
      <TranscriptRow
        frame={{
          id: '1',
          kind: 'subagent',
          childWorktree: 'wt',
          event: 'rollup',
          rollup: { tools: 3, cost: 0.25, status: 'done' },
        }}
      />,
    );
    expect(screen.getByText(/subagent/i)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('indents a depth-1 child frame with a nesting spine', () => {
    const { container } = render(
      <TranscriptRow
        frame={{ id: '2', role: 'subagent', kind: 'text', text: 'child work', depth: 1 }}
      />,
    );
    expect(container.querySelector('[data-nested="true"]')).not.toBeNull();
  });

  it('renders approval actions at a larger hit target', () => {
    render(
      <TranscriptRow
        frame={{ id: '1', kind: 'approval', requestId: 'r', tool: 'write_file', summary: 's' }}
        onRespond={() => {}}
      />,
    );
    const approve = screen.getByRole('button', { name: /approve/i });
    const deny = screen.getByRole('button', { name: /deny/i });
    expect(approve).toBeInTheDocument();
    expect(deny).toBeInTheDocument();
    expect(approve.getAttribute('data-size')).toBe('md');
    expect(deny.getAttribute('data-size')).toBe('md');
  });

  it('renders an approval card and fires onRespond on Approve/Deny', () => {
    const onRespond = vi.fn();
    render(
      <TranscriptRow
        frame={{
          id: 't5',
          kind: 'approval',
          requestId: 'r1',
          tool: 'write_file',
          summary: 'src/auth.ts',
          diffStat: '+42 -18',
        }}
        onRespond={onRespond}
      />,
    );
    expect(screen.getByText('write_file')).toBeTruthy();
    expect(screen.getByText('+42 -18')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(onRespond).toHaveBeenNthCalledWith(1, 'r1', 'approve');
    expect(onRespond).toHaveBeenNthCalledWith(2, 'r1', 'deny');
  });

  it('shows a resolved approval without live buttons', () => {
    render(
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
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
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

  it('renders a raw frame verbatim in a monospace block', () => {
    const text = '> assistant: hello\n> tool_use read_file {"path":"a"}';
    const { container } = render(<TranscriptRow frame={{ id: 't8', kind: 'raw', text }} />);
    expect(container.querySelector('pre')?.textContent).toBe(text);
  });

  it('renders a thinking frame collapsed by default, showing only the label', () => {
    render(
      <TranscriptRow frame={{ id: '1', role: 'agent', kind: 'thinking', text: 'considering' }} />,
    );
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
    expect(screen.queryByText('considering')).not.toBeInTheDocument();
  });

  it('expands a thinking frame on click to reveal the full text', async () => {
    render(
      <TranscriptRow frame={{ id: '1', role: 'agent', kind: 'thinking', text: 'considering' }} />,
    );
    const toggle = screen.getByRole('button', { name: /thinking/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('considering')).toBeInTheDocument();
  });

  it('does not render an expandable thinking block when the text is empty', () => {
    render(<TranscriptRow frame={{ id: 't', role: 'agent', kind: 'thinking', text: '   ' }} />);
    expect(screen.queryByRole('button', { name: /thinking/i })).toBeNull();
  });

  it('tints the thinking label on hover', () => {
    render(
      <TranscriptRow frame={{ id: 't', role: 'agent', kind: 'thinking', text: 'reasoning' }} />,
    );
    expect(screen.getByText('Thinking').className).toContain('group-hover:text-muted');
  });

  it('renders an error frame with a danger tone and its message', () => {
    render(
      <TranscriptRow frame={{ id: '2', role: 'agent', kind: 'error', message: 'it broke' }} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('it broke');
  });

  it('renders a plan frame as a checklist with per-item status', () => {
    render(
      <TranscriptRow
        frame={{
          id: '1',
          role: 'agent',
          kind: 'plan',
          items: [
            { text: 'done thing', status: 'done' },
            { text: 'active thing', status: 'in-progress' },
          ],
        }}
      />,
    );
    expect(screen.getByText('done thing')).toBeInTheDocument();
    expect(screen.getByText('active thing')).toBeInTheDocument();
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
  });

  it('renders a user text frame via markdown, same as any other role', () => {
    render(<TranscriptRow frame={{ id: 'u1', role: 'you', kind: 'text', text: 'run `ls` now' }} />);
    expect(screen.getByText('ls').tagName).toBe('CODE');
  });

  it('renders a user turn as a tinted block without a full border or bottom rule', () => {
    render(<TranscriptRow frame={{ id: 'u', role: 'you', kind: 'text', text: 'hello' }} />);
    const block = screen.getByText('hello').closest('[data-role="you"]');
    expect(block?.className).toContain('bg-raised');
    expect(block?.className).not.toContain('border-hairline');
    expect(block?.className).not.toContain('border-b');
  });

  it('renders a centered system note', () => {
    render(<TranscriptRow frame={{ id: 'n', kind: 'note', text: 'switched to Opus 4.8 · high' }} />);
    expect(screen.getByText(/switched to Opus/)).toBeInTheDocument();
  });

  it('tones a note frame neutral (no spine emphasis)', () => {
    expect(dotTone({ id: 'n', kind: 'note', text: 'switched to Opus 4.8 · high' })).toBe('neutral');
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

  it('gives the jump-to-latest control the composer surface background', () => {
    const frames = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      role: 'agent' as const,
      kind: 'text' as const,
      text: `m${i}`,
    }));
    render(<Transcript frames={frames} showJumpToLatest />);
    expect(screen.getByRole('button', { name: /latest/i }).className).toMatch(/bg-raised/);
  });

  it('breaks the spine at the user turn (no connector line on the row)', () => {
    const grouped: TranscriptFrame[] = [
      { id: 'u1', role: 'you', kind: 'text', text: 'first prompt' },
      { id: 'a1', role: 'agent', kind: 'text', text: 'reply one' },
    ];
    const { container } = render(<Transcript frames={grouped} />);
    // The user turn is set apart from the spine: its own row carries no connector line
    // (RowShell's isUser check), so the timeline breaks around it (a run reads continuous
    // between user turns without any group math).
    const userRole = container.querySelector('[data-role="you"]');
    const userRow = userRole?.closest('.gap-3');
    expect(userRow).not.toBeNull();
    expect(userRow?.querySelector('[data-spine-line]')).toBeNull();
  });

  it('renders the working footer while busy', () => {
    render(<Transcript frames={frames} busy />);
    expect(screen.getByText(/working…/i)).toBeInTheDocument();
  });

  it('renders no footer when not busy', () => {
    render(<Transcript frames={frames} />);
    expect(screen.queryByText(/working…/i)).not.toBeInTheDocument();
  });

  it('re-pins to bottom when jumpNonce changes', () => {
    const { rerender } = render(<Transcript frames={frames} jumpNonce={0} showJumpToLatest />);
    // showJumpToLatest forces the button on; after a jumpNonce bump the component pins.
    scrollIntoViewSpy.mockClear();
    rerender(<Transcript frames={frames} jumpNonce={1} />);
    // Not directly observable in jsdom; assert the sentinel scrollIntoView was called.
    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });

  it('renders a "previous prompt" control that jumps to the nearest user row above', async () => {
    const grouped: TranscriptFrame[] = [
      { id: 'u1', role: 'you', kind: 'text', text: 'first prompt' },
      { id: 'a1', role: 'agent', kind: 'text', text: 'reply one' },
      { id: 'u2', role: 'you', kind: 'text', text: 'second prompt' },
      { id: 'a2', role: 'agent', kind: 'text', text: 'reply two' },
    ];
    render(<Transcript frames={grouped} />);
    scrollIntoViewSpy.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /previous prompt/i }));
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
});

describe('WorkingFooter', () => {
  it('renders a spinner and the working label', () => {
    render(<WorkingFooter />);
    expect(screen.getByText(/working…/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the working footer at body size', () => {
    render(<WorkingFooter busySince={Date.now()} />);
    expect(screen.getByText(/working/i).closest('div')?.className).toContain('text-body');
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
      expect(screen.getByText(/working… 0s/i)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText(/working… 1s/i)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByText(/working… 3s/i)).toBeInTheDocument();

      unmount();
      // No interval firing after unmount should throw or leave a dangling timer;
      // advancing further is a no-op check that nothing errors post-unmount.
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
