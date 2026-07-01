// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Transcript, TranscriptRow, type TranscriptFrame } from './Transcript.js';

describe('TranscriptRow', () => {
  it('renders a text frame with its role and text', () => {
    render(<TranscriptRow frame={{ id: 't1', role: 'you', kind: 'text', text: 'do the thing' }} />);
    expect(screen.getByText('do the thing')).toBeTruthy();
    expect(screen.getByText('you')).toBeTruthy();
  });

  it('renders a tool-use frame byte-faithfully in a monospace block', () => {
    const input = '{\n  "path": "src/auth.ts"\n}';
    const { container } = render(
      <TranscriptRow
        frame={{ id: 't2', role: 'agent', kind: 'tool-use', tool: 'read_file', input }}
      />,
    );
    expect(screen.getByText('read_file')).toBeTruthy();
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(input); // exact bytes, no normalization
  });

  it('renders a tool-result frame with an ok/error marker', () => {
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
    expect(screen.getByText(/42 lines/)).toBeTruthy();
    expect(screen.getByText(/ok/i)).toBeTruthy();
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
});
