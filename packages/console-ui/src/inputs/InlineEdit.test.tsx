// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InlineEdit } from './InlineEdit.js';

describe('InlineEdit', () => {
  it('shows the value and enters edit mode on click', async () => {
    render(<InlineEdit value="refactor-bot" onCommit={vi.fn()} label="Agent name" />);
    await userEvent.click(screen.getByRole('button', { name: 'Rename Agent name: refactor-bot' }));
    expect(screen.getByRole('textbox', { name: 'Agent name' })).toHaveValue('refactor-bot');
  });

  it('commits a changed value on Enter', async () => {
    const onCommit = vi.fn();
    render(<InlineEdit value="untitled-agent" onCommit={onCommit} label="Agent name" />);
    await userEvent.click(screen.getByRole('button'));
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '  reviewer  {Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('reviewer');
    expect(screen.getByRole('button')).toBeInTheDocument(); // back to display mode
  });

  it('cancels on Escape without committing', async () => {
    const onCommit = vi.fn();
    render(<InlineEdit value="reviewer" onCommit={onCommit} label="Agent name" />);
    await userEvent.click(screen.getByRole('button'));
    await userEvent.type(screen.getByRole('textbox'), 'zzz{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /reviewer/ })).toBeInTheDocument();
  });

  it('reverts an emptied draft instead of committing', async () => {
    const onCommit = vi.fn();
    render(<InlineEdit value="reviewer" onCommit={onCommit} label="Agent name" />);
    await userEvent.click(screen.getByRole('button'));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits on blur only when changed', async () => {
    const onCommit = vi.fn();
    render(
      <>
        <InlineEdit value="reviewer" onCommit={onCommit} label="Agent name" />
        <button type="button">elsewhere</button>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Rename/ }));
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onCommit).not.toHaveBeenCalled();
  });
});
