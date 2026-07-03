// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, forwardRef, useImperativeHandle } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  dotTone,
  foldToolFrames,
  groupItemStart,
  itemSpine,
  toolQuickInfo,
  Transcript,
  TranscriptRow,
  WorkingFooter,
  type TranscriptFrame,
} from './Transcript.js';

/** A minimal stand-in for `GroupedVirtuoso` that renders every group header and item
 *  eagerly (no virtualization/measurement, which jsdom can't do) and exposes
 *  `scrollToIndex` on the ref so header-click tests can spy on it. Mirrors the real
 *  component's `groupCounts`/`groupContent`/`itemContent` contract closely enough for
 *  render-level assertions without depending on Virtuoso's DOM measurement. Also renders
 *  `components.Footer` when supplied, mirroring Virtuoso's own footer slot. */
const scrollToIndexSpy = vi.fn();
vi.mock('react-virtuoso', () => ({
  GroupedVirtuoso: forwardRef(function FakeGroupedVirtuoso(
    props: {
      groupCounts: number[];
      groupContent: (index: number) => React.ReactNode;
      itemContent: (index: number) => React.ReactNode;
      components?: { Footer?: React.ComponentType };
    },
    ref: React.ForwardedRef<{ scrollToIndex: typeof scrollToIndexSpy }>,
  ) {
    useImperativeHandle(ref, () => ({ scrollToIndex: scrollToIndexSpy }));
    const total = props.groupCounts.reduce((a, b) => a + b, 0);
    const Footer = props.components?.Footer;
    return (
      <div>
        {props.groupCounts.map((_, gi) => (
          <div key={gi}>{props.groupContent(gi)}</div>
        ))}
        {Array.from({ length: total }, (_, i) => (
          <div key={i}>{props.itemContent(i)}</div>
        ))}
        {Footer && <Footer />}
      </div>
    );
  }),
}));

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

describe('groupItemStart', () => {
  it('returns 0 for the first group', () => {
    expect(groupItemStart([2, 3, 1], 0)).toBe(0);
  });

  it('sums counts of preceding groups', () => {
    expect(groupItemStart([2, 3, 1], 1)).toBe(2);
    expect(groupItemStart([2, 3, 1], 2)).toBe(5);
  });

  it('returns 0 for an out-of-range group index', () => {
    expect(groupItemStart([2, 3, 1], -1)).toBe(0);
  });
});

describe('itemSpine', () => {
  it('drops the top segment on a run\'s first row and the bottom on its last', () => {
    // groups of 2 and 3 items → runs [0,1] and [2,3,4]
    expect(itemSpine([2, 3], 0)).toEqual({ top: false, bottom: true }); // first of run 1
    expect(itemSpine([2, 3], 1)).toEqual({ top: true, bottom: false }); // last of run 1
    expect(itemSpine([2, 3], 2)).toEqual({ top: false, bottom: true }); // first of run 2
    expect(itemSpine([2, 3], 3)).toEqual({ top: true, bottom: true }); // middle of run 2
    expect(itemSpine([2, 3], 4)).toEqual({ top: true, bottom: false }); // last of run 2
  });

  it('trims both ends for a lone-item run (just a dot, no line)', () => {
    expect(itemSpine([1], 0)).toEqual({ top: false, bottom: false });
  });

  it('defaults to a full through-line for an out-of-range index', () => {
    expect(itemSpine([2], 5)).toEqual({ top: true, bottom: true });
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
      { id: 'r1', role: 'agent', kind: 'tool-result', tool: 'Read', output: '42 lines', ok: true, handle: 'h1' },
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
      { id: 'r1', role: 'agent', kind: 'tool-result', tool: 'Bash', output: 'boom', ok: false, handle: 'missing' },
    ];
    const folded = foldToolFrames(frames);
    expect(folded).toEqual(frames);
  });

  it('passes through non-tool kinds unchanged and in order', () => {
    const frames: TranscriptFrame[] = [
      { id: 't1', role: 'you', kind: 'text', text: 'hi' },
      { id: 'u1', role: 'agent', kind: 'tool-use', tool: 'Read', input: '{}', handle: 'h1' },
      { id: 't2', role: 'agent', kind: 'text', text: 'ok' },
      { id: 'r1', role: 'agent', kind: 'tool-result', tool: 'Read', output: 'x', ok: true, handle: 'h1' },
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

  it('renders a tool-use frame collapsed, revealing input byte-faithfully on expand', async () => {
    const input = '{\n  "path": "src/auth.ts"\n}';
    const { container } = render(
      <TranscriptRow
        frame={{ id: 't2', role: 'agent', kind: 'tool-use', tool: 'read_file', input }}
      />,
    );
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(container.querySelector('pre')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /read_file/ }));
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(input); // exact bytes, no normalization
  });

  it('renders a tool-result frame collapsed, with output revealed on expand', async () => {
    const { container } = render(
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
    expect(screen.queryByText(/42 lines/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /read_file/ }));
    expect(screen.getByText(/42 lines/)).toBeTruthy();
    // no input for a standalone tool-result — must not render an empty input code block
    expect(container.querySelectorAll('pre')).toHaveLength(1);
  });

  it('does not show a running hint for a standalone tool-use frame', () => {
    render(
      <TranscriptRow
        frame={{ id: 'tu1', role: 'agent', kind: 'tool-use', tool: 'Bash', input: '{}' }}
      />,
    );
    expect(screen.queryByText(/running/i)).not.toBeInTheDocument();
  });

  it('renders a tool-use collapsed, revealing input on expand', async () => {
    render(
      <TranscriptRow
        frame={{ id: '1', role: 'agent', kind: 'tool-use', tool: 'Read', input: '{"path":"a.ts"}' }}
      />,
    );
    expect(screen.queryByText(/"path":"a.ts"/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Read/ }));
    expect(screen.getByText(/"path":"a.ts"/)).toBeInTheDocument();
  });

  it('renders a merged tool frame with a bigger/bolder title and quick-info', () => {
    render(
      <TranscriptRow
        frame={{
          id: 'm1',
          role: 'agent',
          kind: 'tool',
          tool: 'Read',
          input: '{"file_path":"src/auth.ts"}',
        }}
      />,
    );
    const title = screen.getByText('Read');
    expect(title.className).toMatch(/text-label/);
    expect(title.className).toMatch(/font-medium/);
    expect(title.className).toMatch(/text-fg/);
    expect(screen.getByText('src/auth.ts')).toBeInTheDocument();
  });

  it('gives the merged tool card a taller toggle button', () => {
    render(
      <TranscriptRow
        frame={{ id: 'm2', role: 'agent', kind: 'tool', tool: 'Bash', input: '{"command":"ls"}' }}
      />,
    );
    const btn = screen.getByRole('button', { name: /Bash/ });
    expect(btn.className).toMatch(/py-1\.5/);
  });

  it('expands a merged tool frame to reveal both input and labelled output', async () => {
    render(
      <TranscriptRow
        frame={{
          id: 'm3',
          role: 'agent',
          kind: 'tool',
          tool: 'Read',
          input: '{"file_path":"a.ts"}',
          output: '42 lines',
          ok: true,
        }}
      />,
    );
    expect(screen.queryByText('42 lines')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Read/ }));
    expect(screen.getByText('{"file_path":"a.ts"}')).toBeInTheDocument();
    expect(screen.getByText('42 lines')).toBeInTheDocument();
    expect(screen.getByText(/output/i)).toBeInTheDocument();
  });

  it('renders a merged tool frame with no output as a pending call, no status text', () => {
    render(
      <TranscriptRow
        frame={{ id: 'm4', role: 'agent', kind: 'tool', tool: 'Bash', input: '{"command":"ls"}' }}
      />,
    );
    expect(screen.queryByText(/· ok/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/· error/i)).not.toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('does not show quick-info for an unknown tool', () => {
    render(
      <TranscriptRow
        frame={{ id: 'm5', role: 'agent', kind: 'tool', tool: 'Bash', input: '{"command":"ls"}' }}
      />,
    );
    expect(screen.queryByText('ls')).not.toBeInTheDocument();
  });

  it('tones the gutter dot danger for a failed tool-result', () => {
    const { container } = render(
      <TranscriptRow
        frame={{ id: '2', role: 'agent', kind: 'tool-result', tool: 'Bash', output: 'boom', ok: false }}
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

  it('renders an error frame with a danger tone and its message', () => {
    render(<TranscriptRow frame={{ id: '2', role: 'agent', kind: 'error', message: 'it broke' }} />);
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

  it('shows a jump-to-latest control when scrolled away from the bottom', () => {
    const frames = Array.from({ length: 30 }, (_, i) => ({ id: String(i), role: 'agent' as const, kind: 'text' as const, text: `m${i}` }));
    render(<Transcript frames={frames} showJumpToLatest />);
    expect(screen.getByRole('button', { name: /latest/i })).toBeInTheDocument();
  });

  it('gives the jump-to-latest control the composer surface background', () => {
    const frames = Array.from({ length: 30 }, (_, i) => ({ id: String(i), role: 'agent' as const, kind: 'text' as const, text: `m${i}` }));
    render(<Transcript frames={frames} showJumpToLatest />);
    expect(screen.getByRole('button', { name: /latest/i }).className).toMatch(/bg-raised/);
  });

  it('renders the sticky user header as a clickable button with the composer surface', () => {
    const grouped: TranscriptFrame[] = [
      { id: 'u1', role: 'you', kind: 'text', text: 'first prompt' },
      { id: 'a1', role: 'agent', kind: 'text', text: 'reply one' },
      { id: 'u2', role: 'you', kind: 'text', text: 'second prompt' },
      { id: 'a2', role: 'agent', kind: 'text', text: 'reply two' },
    ];
    render(<Transcript frames={grouped} />);
    const header = screen.getByRole('button', { name: /second prompt/ });
    expect(header.className).toMatch(/bg-raised/);
  });

  it('renders the sticky user header as a compact single-line bar with the full text on hover', () => {
    const long = 'a very long user prompt that must stay on one line in the sticky header';
    const grouped: TranscriptFrame[] = [
      { id: 'u1', role: 'you', kind: 'text', text: long },
      { id: 'a1', role: 'agent', kind: 'text', text: 'reply one' },
    ];
    render(<Transcript frames={grouped} />);
    const header = screen.getByRole('button', { name: new RegExp(long.slice(0, 12)) });
    // Compact + uniform: a single truncated line (so GroupedVirtuoso pushes headers cleanly),
    // with the full prompt available on hover.
    expect(header.querySelector('.truncate')).not.toBeNull();
    expect(header).toHaveAttribute('title', long);
  });

  it('breaks the spine at the user turn (no dot or connector line on the header)', () => {
    const grouped: TranscriptFrame[] = [
      { id: 'u1', role: 'you', kind: 'text', text: 'first prompt' },
      { id: 'a1', role: 'agent', kind: 'text', text: 'reply one' },
    ];
    render(<Transcript frames={grouped} />);
    // The user turn is set apart from the spine: its header row carries neither a dot nor a
    // connector line, so the timeline breaks before/after it (adjacent agent dots bookend).
    const header = screen.getByRole('button', { name: /first prompt/ });
    const headerRow = header.closest('.gap-2');
    expect(headerRow).not.toBeNull();
    expect(headerRow?.querySelector('[data-dot]')).toBeNull();
    expect(headerRow?.querySelector('[data-spine-line]')).toBeNull();
  });

  it('scrolls to the group item index when the sticky header is clicked', async () => {
    scrollToIndexSpy.mockClear();
    const grouped: TranscriptFrame[] = [
      { id: 'u1', role: 'you', kind: 'text', text: 'first prompt' },
      { id: 'a1', role: 'agent', kind: 'text', text: 'reply one' },
      { id: 'a1b', role: 'agent', kind: 'text', text: 'reply one b' },
      { id: 'u2', role: 'you', kind: 'text', text: 'second prompt' },
      { id: 'a2', role: 'agent', kind: 'text', text: 'reply two' },
    ];
    render(<Transcript frames={grouped} />);
    await userEvent.click(screen.getByRole('button', { name: /second prompt/ }));
    // group 0 has 2 items (reply one, reply one b); group 1 (second prompt) starts at index 2
    expect(scrollToIndexSpy).toHaveBeenCalledWith({ index: 2, align: 'start', behavior: 'smooth' });
  });

  it('flashes the landed row after the header scrolls, then clears after the timeout', () => {
    vi.useFakeTimers();
    try {
      const grouped: TranscriptFrame[] = [
        { id: 'u1', role: 'you', kind: 'text', text: 'first prompt' },
        { id: 'a1', role: 'agent', kind: 'text', text: 'reply one' },
        { id: 'u2', role: 'you', kind: 'text', text: 'second prompt' },
        { id: 'a2', role: 'agent', kind: 'text', text: 'reply two' },
      ];
      const { container } = render(<Transcript frames={grouped} />);
      fireEvent.click(screen.getByRole('button', { name: /second prompt/ }));
      expect(container.querySelector('[data-flash="true"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      expect(container.querySelector('[data-flash="true"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the working footer while busy', () => {
    render(<Transcript frames={frames} busy />);
    expect(screen.getByText(/working…/i)).toBeInTheDocument();
  });

  it('renders no footer when not busy', () => {
    render(<Transcript frames={frames} />);
    expect(screen.queryByText(/working…/i)).not.toBeInTheDocument();
  });
});

describe('WorkingFooter', () => {
  it('renders a spinner and the working label', () => {
    render(<WorkingFooter />);
    expect(screen.getByText(/working…/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
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
