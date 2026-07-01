// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Play } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton.js';

describe('IconButton', () => {
  it('requires and applies an accessible label', () => {
    render(<IconButton icon={Play} label="Run" />);
    expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
  });
  it('blocks click while loading', async () => {
    const onClick = vi.fn();
    render(<IconButton icon={Play} label="Run" loading onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
