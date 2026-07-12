// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip.js';

function Host({ keys }: { keys?: string[] }): React.JSX.Element {
  return (
    <TooltipProvider>
      <Tooltip label="search sessions" keys={keys}>
        <button type="button" aria-label="search sessions">
          ⌕
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}

describe('Tooltip', () => {
  it('shows on keyboard focus and hides on blur', async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.queryByText('search sessions')).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByText('search sessions')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByText('search sessions')).not.toBeInTheDocument();
  });

  it('renders the keybind as kbd chips', async () => {
    const user = userEvent.setup();
    render(<Host keys={['ctrl', 'p']} />);
    await user.tab();
    const chips = screen.getAllByText(/ctrl|p/, { selector: 'kbd' });
    expect(chips).toHaveLength(2);
  });

  it('wears the floating-surface skin at the tooltip z', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.tab();
    const popup = screen.getByText('search sessions');
    expect(popup.className).toContain('bg-s3');
    expect(popup.className).toContain('border-s5');
    expect(popup.closest('.z-\\(--z-tooltip\\)')).not.toBeNull();
  });
});
