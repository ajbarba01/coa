// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Sheet } from './Sheet.js';

describe('Sheet', () => {
  it('opens a side drawer as a titled dialog', async () => {
    render(
      <Sheet trigger={<button type="button">Settings</button>} title="Settings" side="right">
        Panel
      </Sheet>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveAttribute('data-side', 'right');
  });
});
