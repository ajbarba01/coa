// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COMPLETION_PILL } from './SubagentCards.js';
import { TranscriptRow, type TranscriptFrame } from './Transcript.js';

const SPAWN: TranscriptFrame = {
  id: 's1',
  kind: 'subagent-spawn',
  childSessionId: 'child-1',
  childWorktree: '/repo/.coa/worktrees/child-1',
  agentRef: 'reviewer',
  description: 'review the diff',
  isolate: true,
  color: 'teal',
};

const COMPLETION: TranscriptFrame = {
  id: 'c1',
  kind: 'subagent-completion',
  childSessionId: 'child-1',
  childWorktree: '/repo/.coa/worktrees/child-1',
  agentRef: 'reviewer',
  reason: 'completed',
  result: 'Two findings, both minor.',
};

const MESSAGE: TranscriptFrame = {
  id: 'm1',
  kind: 'subagent-message',
  messageId: 'msg-1',
  threadId: 'msg-1',
  from: 'child-1',
  to: 'child-2',
  direction: 'sent',
  body: 'symbol map attached',
  fromLabel: 'reviewer child',
  toLabel: 'builder child',
};

describe('SubagentSpawnCard (via TranscriptRow)', () => {
  it('renders identity, description, the Spawned pill, and the isolated worktree path', () => {
    render(<TranscriptRow frame={SPAWN} />);
    expect(screen.getByText('reviewer')).toBeTruthy();
    expect(screen.getByText('review the diff')).toBeTruthy();
    expect(screen.getByText('Spawned')).toBeTruthy();
    expect(screen.getByText('/repo/.coa/worktrees/child-1')).toBeTruthy();
  });

  it('wears the agent identity color on the name (slate fallback when absent)', () => {
    const { container, rerender } = render(<TranscriptRow frame={SPAWN} />);
    expect(container.querySelector('.text-agent-teal')?.textContent).toBe('reviewer');
    rerender(<TranscriptRow frame={{ ...SPAWN, color: undefined }} />);
    expect(container.querySelector('.text-agent-slate')?.textContent).toBe('reviewer');
  });

  it('jump-to-thread opens the child session; without the callback no control renders', () => {
    const onOpenSession = vi.fn();
    const { rerender } = render(<TranscriptRow frame={SPAWN} onOpenSession={onOpenSession} />);
    fireEvent.click(screen.getByRole('button', { name: /open thread/i }));
    expect(onOpenSession).toHaveBeenCalledWith('child-1');
    rerender(<TranscriptRow frame={SPAWN} />);
    expect(screen.queryByRole('button', { name: /open thread/i })).toBeNull();
  });

  it('a non-isolated spawn shows no worktree line', () => {
    render(<TranscriptRow frame={{ ...SPAWN, isolate: false }} />);
    expect(screen.queryByText('/repo/.coa/worktrees/child-1')).toBeNull();
  });
});

describe('SubagentCompletionCard (via TranscriptRow)', () => {
  it('quotes the child’s own result verbatim under the Done pill', () => {
    render(<TranscriptRow frame={COMPLETION} />);
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Two findings, both minor.')).toBeTruthy();
  });

  it.each([
    ['errored' as const, 'Errored'],
    ['stopped' as const, 'Stopped'],
  ])('an %s ending wears its own pill and shows detail instead of a result', (reason, label) => {
    render(
      <TranscriptRow
        frame={{ ...COMPLETION, reason, result: undefined, detail: 'rate limited' }}
      />,
    );
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('rate limited')).toBeTruthy();
  });

  it('the pill vocabulary maps every reason to a dot + word', () => {
    expect(COMPLETION_PILL.completed).toEqual({ dot: 'bg-ok', label: 'Done' });
    expect(COMPLETION_PILL.errored).toEqual({ dot: 'bg-crit', label: 'Errored' });
    expect(COMPLETION_PILL.stopped).toEqual({ dot: 'bg-s5', label: 'Stopped' });
  });

  it('jump-to-thread targets the finished child', () => {
    const onOpenSession = vi.fn();
    render(<TranscriptRow frame={COMPLETION} onOpenSession={onOpenSession} />);
    fireEvent.click(screen.getByRole('button', { name: /open thread/i }));
    expect(onOpenSession).toHaveBeenCalledWith('child-1');
  });
});

describe('SubagentMessageCard (via TranscriptRow)', () => {
  it('renders resolved labels, the direction pill, and the body', () => {
    render(<TranscriptRow frame={MESSAGE} />);
    expect(screen.getByText('reviewer child')).toBeTruthy();
    expect(screen.getByText('builder child')).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();
    expect(screen.getByText('symbol map attached')).toBeTruthy();
  });

  it('falls back to the raw session ids when no labels resolved', () => {
    render(<TranscriptRow frame={{ ...MESSAGE, fromLabel: undefined, toLabel: undefined }} />);
    expect(screen.getByText('child-1')).toBeTruthy();
    expect(screen.getByText('child-2')).toBeTruthy();
  });

  it('a received reply wears Reply + Received and jumps to the SENDER', () => {
    const onOpenSession = vi.fn();
    render(
      <TranscriptRow
        frame={{ ...MESSAGE, direction: 'received', replyTo: 'msg-0' }}
        onOpenSession={onOpenSession}
      />,
    );
    expect(screen.getByText('Reply')).toBeTruthy();
    expect(screen.getByText('Received')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /open thread/i }));
    expect(onOpenSession).toHaveBeenCalledWith('child-1');
  });

  it('a sent message jumps to the RECIPIENT (the counterparty, either way)', () => {
    const onOpenSession = vi.fn();
    render(<TranscriptRow frame={MESSAGE} onOpenSession={onOpenSession} />);
    fireEvent.click(screen.getByRole('button', { name: /open thread/i }));
    expect(onOpenSession).toHaveBeenCalledWith('child-2');
  });
});
