// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModalShell } from './ModalShell.js';

describe('ModalShell', () => {
  it('renders a labelled dialog and contains focus inside it', async () => {
    render(
      <ModalShell open onClose={() => {}} aria-label="settings">
        <button type="button">first</button>
      </ModalShell>,
    );
    const dialog = screen.getByRole('dialog', { name: 'settings' });
    expect(dialog).toBeInTheDocument();
    // Base UI moves initial focus on a deferred frame
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('Escape closes it through the kit layer stack (real bubble path)', () => {
    const onClose = vi.fn();
    render(<ModalShell open onClose={onClose} aria-label="x" />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closed renders nothing', () => {
    render(<ModalShell open={false} onClose={() => {}} aria-label="x" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
