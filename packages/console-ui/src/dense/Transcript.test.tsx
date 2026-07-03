// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { dotTone, Transcript, TranscriptRow, type TranscriptFrame } from './Transcript.js';

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

  it('renders an agent turn under a dotted spine, no role label', () => {
    const { container } = render(
      <TranscriptRow frame={{ id: '2', role: 'agent', kind: 'text', text: 'sure' }} />,
    );
    expect(screen.queryByText(/^agent$/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-role="agent"][data-spine="true"]')).not.toBeNull();
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

  it('renders a tool-result frame collapsed, with an ok/error marker and output on expand', async () => {
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
    expect(screen.queryByText(/42 lines/)).not.toBeInTheDocument();
    expect(screen.getByText(/ok/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /read_file/ }));
    expect(screen.getByText(/42 lines/)).toBeTruthy();
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

  it('shows an error glyph state on a failed tool-result', () => {
    render(
      <TranscriptRow
        frame={{ id: '2', role: 'agent', kind: 'tool-result', tool: 'Bash', output: 'boom', ok: false }}
      />,
    );
    expect(screen.getByText(/error/i)).toBeInTheDocument();
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

  it('renders a thinking frame in a labelled, de-emphasized block', () => {
    render(
      <TranscriptRow frame={{ id: '1', role: 'agent', kind: 'thinking', text: 'considering' }} />,
    );
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
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
});
