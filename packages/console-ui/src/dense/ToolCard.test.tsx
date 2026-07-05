// packages/console-ui/src/dense/ToolCard.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaneOverlayProvider } from '../layout/PaneOverlay.js';
import { ToolCard } from './ToolCard.js';

const editInput = JSON.stringify({
  file_path: 'src/auth.ts',
  old_string: 'const a = 1;',
  new_string: 'const a = 2;',
});

describe('ToolCard', () => {
  it('renders the verb, a clickable path button that fires onOpenPath, tokens and status', async () => {
    const onOpenPath = vi.fn();
    render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} onOpenPath={onOpenPath} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
    const pathBtn = screen.getByRole('button', { name: 'src/auth.ts' });
    await userEvent.click(pathBtn);
    expect(onOpenPath).toHaveBeenCalledWith('src/auth.ts');
    expect(screen.getByText(/≈ .* tok/)).toBeInTheDocument();
  });

  it('renders the path as plain text (no button) when onOpenPath is omitted', () => {
    render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} />);
    expect(screen.queryByRole('button', { name: 'src/auth.ts' })).not.toBeInTheDocument();
    expect(screen.getByText('src/auth.ts')).toBeInTheDocument();
  });

  it('truncates a long body and expands it into the pane overlay', async () => {
    const output = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    render(
      <PaneOverlayProvider>
        <ToolCard tool="Bash" input='{"command":"seq 30"}' output={output} ok={true} maxLines={5} />
      </PaneOverlayProvider>,
    );
    // Clamped: an early line is hidden by the tail clamp; the Expand affordance shows the hidden count.
    const expand = screen.getByRole('button', { name: /expand|more/i });
    expect(expand).toBeInTheDocument();
    await userEvent.click(expand);
    // The overlay (role=dialog) now holds the full body — line 0 is present there.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('line 0');
  });

  it('renders a byte-faithful highlighted diff for an edit', () => {
    const { container } = render(<ToolCard tool="Edit" input={editInput} output="ok" ok={true} />);
    expect(container.querySelector('.bg-danger-tint')?.textContent).toContain('const a = 1;');
    expect(container.querySelector('.bg-success-tint')?.textContent).toContain('const a = 2;');
  });
});
